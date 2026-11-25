import { Hono } from "hono";
import { fetchJson } from "../cache.js";

const BOUNDS = { west: -1, south: 39.8, east: 4.5, north: 43.5 };

const router = new Hono();

router.get("/radar/products", async (c) => {
  try {
    const data = await fetchJson<any>("https://api.rainviewer.com/public/weather-maps.json", 60_000);
    const host: string = data.host ?? "https://tilecache.rainviewer.com";
    const raw = [...(data.radar?.past ?? []), ...(data.radar?.nowcast ?? [])].slice(-18);
    const frames = raw.map((f: { time: number; path: string }) => ({
      time: new Date(f.time * 1000).toISOString(),
      path: f.path,
    }));
    const maps = {
      radar_rate: frames.map((f, i) => ({
        variable: "radar_rate",
        hour: i,
        timestamp: f.time,
        valid_time: f.time,
        filepath: "",
        web_filepath: "",
        web_bounds: BOUNDS,
        unit: "mm/h",
      })),
    };
    return c.json(
      {
        run_time: frames.at(-1)?.time ?? new Date().toISOString(),
        run_id: "rainviewer",
        generated_at: new Date().toISOString(),
        model: "Radar RainViewer",
        source: "RainViewer",
        credit: "Radar. RainViewer. meteozini.",
        variables: ["radar_rate"],
        num_frames: frames.length,
        bounds: BOUNDS,
        maps,
        rainviewer: { host, frames },
      },
      200,
      { "cache-control": "public, max-age=60" },
    );
  } catch {
    return c.json(
      {
        run_time: new Date().toISOString(),
        run_id: "rainviewer",
        generated_at: new Date().toISOString(),
        model: "Radar",
        source: "RainViewer",
        credit: "RainViewer",
        variables: [],
        num_frames: 0,
        bounds: BOUNDS,
        maps: {},
      },
      200,
      { "cache-control": "no-store" },
    );
  }
});

export default router;
