import { Hono } from "hono";
import { fetchBuffer, fetchText } from "../cache.js";

const CAPS = "https://view.eumetsat.int/geoserver/wms?service=WMS&version=1.3.0&request=GetCapabilities";
const STEP = 10 * 60 * 1000;
const COUNT = 13;

const LAYERS: Record<string, { layer: string; style: string }> = {
  color: { layer: "mtg_fd:rgb_geocolour", style: "" },
  ir: { layer: "mtg_fd:ir105_hrfi", style: "mtg_fd_ir105_hrfi_grayscale" },
  vis: { layer: "mtg_fd:rgb_truecolour", style: "" },
};

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
  const end = await latestTime();
  const ts = Array.from({ length: COUNT }, (_, i) => new Date(end - (COUNT - 1 - i) * STEP).toISOString());
  const layer = (name: string) =>
    ts.map((time, i) => ({ slot: i, time, url: `/up/api/satellite/image?layer=${name}&time=${encodeURIComponent(time)}` }));
  return c.json(
    {
      bounds: { west: -30, south: 27, east: 45, north: 70 },
      cloud_bounds: { west: -2.5, south: 39, east: 5.5, north: 44.2 },
      layers: { color: layer("color"), ir: layer("ir"), vis: layer("vis") },
    },
    200,
    { "cache-control": "public, max-age=300, s-maxage=300" },
  );
});

router.get("/satellite/image", async (c) => {
  const name = c.req.query("layer") ?? "color";
  const time = c.req.query("time") ?? new Date().toISOString();
  const spec = LAYERS[name] ?? LAYERS.color;
  const params = new URLSearchParams({
    service: "WMS",
    version: "1.3.0",
    request: "GetMap",
    layers: spec.layer,
    styles: spec.style,
    crs: "EPSG:4326",
    bbox: "27,-30,70,45",
    width: "1200",
    height: "900",
    format: "image/png",
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
