import { Hono } from "hono";
import { fetchBuffer, fetchText, memoize } from "../cache.js";

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
// built as a 30-day mosaic where the least-cloudy pass wins each spot. Gaps with
// no pass at all stay transparent (the PNG carries alpha).
// Sentinel-2 has no IR/VIS split here, so it only serves the true-colour view.
const CDSE_TOKEN_URL = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token";
const CDSE_PROCESS_URL = "https://sh.dataspace.copernicus.eu/api/v1/process";
const S2_LOOKBACK_MS = 30 * 86_400_000;
const S2_PIXEL_SIZE = 300;
const S2_MAX_SIDE = 1400;
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

// Requested in Mercator so the pixels are square on the ground and line up with
// the map's own projection.
const X0 = mercatorX(BOUNDS.west);
const Y0 = mercatorY(BOUNDS.south);
const X1 = mercatorX(BOUNDS.east);
const Y1 = mercatorY(BOUNDS.north);

/** Image size for a pixel size, capped so one request cannot ask for a huge image. */
function rasterSize(pixelSize: number, maxSide: number) {
  const spanX = (X1 - X0) / pixelSize;
  const spanY = (Y1 - Y0) / pixelSize;
  const scale = Math.min(1, maxSide / Math.max(spanX, spanY));
  return { width: Math.round(spanX * scale), height: Math.round(spanY * scale) };
}

const MTG_SIZE = rasterSize(PIXEL_SIZE, MAX_SIDE);
const S2_SIZE = rasterSize(S2_PIXEL_SIZE, S2_MAX_SIDE);

const hasCdse = () => Boolean(process.env.CDSE_CLIENT_ID && process.env.CDSE_CLIENT_SECRET);

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

// `endIso` anchors the mosaic window; bucketing it to the hour keeps the URL
// stable so the response cache actually hits on repeated map loads.
function sentinelMosaic(endIso: string): Promise<{ body: ArrayBuffer; contentType: string }> {
  return memoize(`cdse:s2:${endIso}`, 30 * 60_000, async () => {
    const end = Date.parse(endIso);
    if (!Number.isFinite(end)) throw new Error("invalid time");
    const token = await cdseToken();
    const payload = {
      input: {
        bounds: { bbox: [X0, Y0, X1, Y1], properties: { crs: "http://www.opengis.net/def/crs/EPSG/0/3857" } },
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
        width: S2_SIZE.width,
        height: S2_SIZE.height,
        responses: [{ identifier: "default", format: { type: "image/png" } }],
      },
      evalscript: S2_EVALSCRIPT,
    };
    const res = await fetch(CDSE_PROCESS_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`CDSE process ${res.status}`);
    return { body: await res.arrayBuffer(), contentType: res.headers.get("content-type") ?? "image/png" };
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
    // One frame only: the mosaic already blends 30 days, so it does not move with
    // the time slider. Without CDSE credentials there is nothing to show.
    const end = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000).toISOString();
    const color = hasCdse()
      ? [
          {
            slot: 0,
            time: end,
            url: `/up/api/satellite/image?source=s2&layer=color&time=${encodeURIComponent(end)}`,
          },
        ]
      : [];
    return c.json({ bounds: BOUNDS, layers: { color } }, 200, headers);
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
    const time = c.req.query("time") ?? new Date().toISOString();
    try {
      const { body, contentType } = await sentinelMosaic(time);
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
