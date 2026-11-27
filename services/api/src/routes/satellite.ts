import { readFile } from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import { fetchBuffer, fetchText, memoize } from "../cache.js";
import { DATA_DIR } from "../data.js";

const CAPS = "https://view.eumetsat.int/geoserver/wms?service=WMS&version=1.3.0&request=GetCapabilities";
const STEP = 10 * 60 * 1000;
const COUNT = 13;

// Catalonia plus a margin of sea and neighbouring ranges, the frame the map clamps
// to. Asking the WMS for the whole Meteosat disc at 1200x900 left ~7 km per pixel
// over Catalonia; the native-resolution crop is ~0.4 km per pixel.
const BOUNDS = { west: -2.5, south: 39.0, east: 5.5, north: 44.2 };
// Metres per pixel in EPSG:3857. The MTG geocolour composite is built from 1 km
// channels, so ~0.4 km oversamples it enough to stay crisp at a modest file size.
const PIXEL_SIZE = 400;
const MAX_SIDE = 4096;

const LAYERS: Record<string, { layer: string; style: string }> = {
  color: { layer: "mtg_fd:rgb_geocolour", style: "" },
  ir: { layer: "mtg_fd:ir105_hrfi", style: "mtg_fd_ir105_hrfi_grayscale" },
  vis: { layer: "mtg_fd:rgb_truecolour", style: "" },
};

// Copernicus Sentinel-2 through the Data Space Ecosystem process API. A single
// Sentinel-2 pass is only a 290 km strip every few days, so one shared frame is
// built as a 30-day mosaic where the least-cloudy pass wins each spot.
// Sentinel-2 has no IR/VIS split here, so it only serves the true-colour view.
const CDSE_TOKEN_URL = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token";
const CDSE_PROCESS_URL = "https://sh.dataspace.copernicus.eu/api/v1/process";
const S2_LOOKBACK_MS = 30 * 86_400_000;
// The Process API rejects any single response above 2500x2500 px, so a whole-
// Catalonia frame tops out at ~267 m per pixel. Asking for 512 px tiles instead
// buys real 10 m detail, but every tile picks its own least-cloudy scene, which
// paints hard acquisition-date seams across the mosaic (a snow-free summer scene
// next to a snowy November one). One shared frame keeps the colours consistent;
// the seamless 10 m view is the annual EOX cloudless basemap instead.
const S2_PIXEL_SIZE = 10;
const S2_MAX_SIDE = 2500;
// Lossy WebP is ~1/7 the bytes of PNG at the same size.
const S2_FORMAT = "image/webp";
const S2_EVALSCRIPT = `//VERSION=3
function setup() { return { input: ["B02", "B03", "B04"], output: { bands: 4 } }; }
function evaluatePixel(s) {
  if (isNaN(s.B02) || isNaN(s.B03) || isNaN(s.B04)) return [0, 0, 0, 0];
  const max = 0.42, gamma = 2.2;
  const rgb = [s.B04, s.B03, s.B02].map((v) => Math.pow(Math.max(0, Math.min(1, v / max)), 1 / gamma));
  return [rgb[0], rgb[1], rgb[2], 1];
}`;

const EARTH_RADIUS = 6_378_137.0;
const mercatorX = (lon: number) => ((lon * Math.PI) / 180) * EARTH_RADIUS;
const mercatorY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + ((lat * Math.PI) / 180) / 2)) * EARTH_RADIUS;

// Sentinel-2 uses the AROME/snow frame instead of the wider Meteosat one, so every
// overlay on the map ends on the same edge.
const S2_BOUNDS = { west: -1.0, south: 39.8, east: 4.5, north: 43.5 };

// Requested in Mercator so the pixels are square on the ground and line up with
// the map's own projection.
const [X0, Y0, X1, Y1] = mercatorBox(BOUNDS);
const [S2X0, S2Y0, S2X1, S2Y1] = mercatorBox(S2_BOUNDS);

function mercatorBox(bounds: typeof BOUNDS): [number, number, number, number] {
  return [mercatorX(bounds.west), mercatorY(bounds.south), mercatorX(bounds.east), mercatorY(bounds.north)];
}

/** Image size for a pixel size, capped so one request cannot ask for a huge image. */
function rasterSize(box: [number, number, number, number], pixelSize: number, maxSide: number) {
  const spanX = (box[2] - box[0]) / pixelSize;
  const spanY = (box[3] - box[1]) / pixelSize;
  const scale = Math.min(1, maxSide / Math.max(spanX, spanY));
  return { width: Math.round(spanX * scale), height: Math.round(spanY * scale) };
}

const MTG_SIZE = rasterSize([X0, Y0, X1, Y1], PIXEL_SIZE, MAX_SIDE);
const S2_SIZE = rasterSize([S2X0, S2Y0, S2X1, S2Y1], S2_PIXEL_SIZE, S2_MAX_SIDE);

const hasCdse = () => Boolean(process.env.CDSE_CLIENT_ID && process.env.CDSE_CLIENT_SECRET);

/** The mosaic pipeline/fetch_s2.py published, if any. Tiles beat the live frame:
 *  they follow the zoom instead of one 267 m per pixel picture of the country. */
type S2Index = {
  run: string;
  bounds: typeof S2_BOUNDS;
  tiles: string;
  min_zoom: number;
  max_zoom: number;
  tile_size: number;
  attribution: string;
};

function s2Index(): Promise<S2Index | null> {
  return memoize("cdse:s2:index", 60_000, async () => {
    try {
      return JSON.parse(await readFile(path.join(DATA_DIR, "static", "s2", "index.json"), "utf8")) as S2Index;
    } catch {
      return null;
    }
  });
}

let tokenCache: { value: string; expires: number } | null = null;
async function cdseToken(): Promise<string> {
  if (tokenCache && tokenCache.expires > Date.now()) return tokenCache.value;
  const res = await fetch(CDSE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.CDSE_CLIENT_ID ?? "",
      client_secret: process.env.CDSE_CLIENT_SECRET ?? "",
    }),
  });
  if (!res.ok) throw new Error(`CDSE token ${res.status}`);
  const data = (await res.json()) as { access_token: string; expires_in?: number };
  tokenCache = { value: data.access_token, expires: Date.now() + Math.max(60, (data.expires_in ?? 600) - 60) * 1000 };
  return tokenCache.value;
}

type Bbox = [number, number, number, number];

/** Hour bucket for the mosaic window, so repeat requests inside the hour share it. */
const hourBucket = () => new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000).toISOString();

function s2Mosaic(bbox: Bbox, width: number, height: number, endIso: string): Promise<{ body: ArrayBuffer; contentType: string }> {
  const key = `cdse:s2:${width}x${height}:${bbox.map((n) => Math.round(n)).join(",")}:${endIso}`;
  return memoize(key, 3 * 3_600_000, async () => {
    const end = Date.parse(endIso);
    if (!Number.isFinite(end)) throw new Error("invalid time");
    const token = await cdseToken();
    const payload = {
      input: {
        bounds: { bbox, properties: { crs: "http://www.opengis.net/def/crs/EPSG/0/3857" } },
        data: [
          {
            type: "sentinel-2-l2a",
            dataFilter: {
              timeRange: { from: new Date(end - S2_LOOKBACK_MS).toISOString(), to: new Date(end).toISOString() },
              mosaickingOrder: "leastCC",
            },
          },
        ],
      },
      output: {
        width,
        height,
        responses: [{ identifier: "default", format: { type: S2_FORMAT } }],
      },
      evalscript: S2_EVALSCRIPT,
    };
    const res = await fetch(CDSE_PROCESS_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`CDSE process ${res.status}`);
    return { body: await res.arrayBuffer(), contentType: res.headers.get("content-type") ?? S2_FORMAT };
  });
}

async function latestTime(): Promise<number> {
  try {
    const xml = await fetchText(CAPS, 300_000);
    const i = xml.indexOf("mtg_fd:rgb_geocolour");
    if (i >= 0) {
      const m = xml.slice(i).match(/<Dimension name="time"[^>]*>([^<]+)<\/Dimension>/);
      if (m) {
        const end = m[1].split("/")[1];
        const t = Date.parse(end);
        if (Number.isFinite(t)) return t;
      }
    }
  } catch {
    /* fall through */
  }
  return Math.floor((Date.now() - 20 * 60 * 1000) / STEP) * STEP;
}

const router = new Hono();

router.get("/satellite/frames", async (c) => {
  const headers = { "cache-control": "public, max-age=300, s-maxage=300" };

  if (c.req.query("source") === "s2") {
    // Prefer the tiles the pipeline published; fall back to a live frame when it
    // has not run yet (fresh checkout) so the layer is never empty with credentials.
    const index = await s2Index();
    if (index) {
      return c.json(
        {
          bounds: index.bounds,
          tiles: index.tiles,
          minzoom: index.min_zoom,
          maxzoom: index.max_zoom,
          tile_size: index.tile_size,
          layers: { color: [{ slot: 0, time: `${index.run}T00:00:00.000Z`, url: "" }] },
        },
        200,
        headers,
      );
    }
    // One frame only: the mosaic already blends 30 days, so it does not move with
    // the time slider. Without CDSE credentials there is nothing to show.
    const end = hourBucket();
    const color = hasCdse()
      ? [
          {
            slot: 0,
            time: end,
            url: `/up/api/satellite/image?source=s2&layer=color&time=${encodeURIComponent(end)}`,
          },
        ]
      : [];
    return c.json({ bounds: S2_BOUNDS, layers: { color } }, 200, headers);
  }

  const end = await latestTime();
  const ts = Array.from({ length: COUNT }, (_, i) => new Date(end - (COUNT - 1 - i) * STEP).toISOString());
  const layer = (name: string) =>
    ts.map((time, i) => ({ slot: i, time, url: `/up/api/satellite/image?layer=${name}&time=${encodeURIComponent(time)}` }));
  return c.json(
    {
      bounds: BOUNDS,
      layers: { color: layer("color"), ir: layer("ir"), vis: layer("vis") },
    },
    200,
    headers,
  );
});

router.get("/satellite/image", async (c) => {
  if (c.req.query("source") === "s2") {
    const time = c.req.query("time") ?? hourBucket();
    try {
      const { body, contentType } = await s2Mosaic([S2X0, S2Y0, S2X1, S2Y1], S2_SIZE.width, S2_SIZE.height, time);
      return new Response(body, {
        headers: {
          "content-type": contentType,
          "cache-control": "public, max-age=1800, s-maxage=3600",
        },
      });
    } catch {
      return c.text("Sentinel unavailable", 502);
    }
  }

  const name = c.req.query("layer") ?? "color";
  const time = c.req.query("time") ?? new Date().toISOString();
  const spec = LAYERS[name] ?? LAYERS.color;
  const params = new URLSearchParams({
    service: "WMS",
    version: "1.3.0",
    request: "GetMap",
    layers: spec.layer,
    styles: spec.style,
    crs: "EPSG:3857",
    bbox: `${X0},${Y0},${X1},${Y1}`,
    width: String(MTG_SIZE.width),
    height: String(MTG_SIZE.height),
    format: "image/jpeg",
    time,
  });
  try {
    const { body, contentType } = await fetchBuffer(
      `https://view.eumetsat.int/geoserver/wms?${params.toString()}`,
      3_600_000,
    );
    return new Response(body, {
      headers: {
        "content-type": contentType,
        "cache-control": "public, max-age=600, s-maxage=3600",
      },
    });
  } catch {
    return c.text("Satellite unavailable", 502);
  }
});

export default router;
