import { readFile } from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import { DATA_DIR } from "../data.js";

const router = new Hono();

/** AROME catalogue produced by pipeline/build_arome.py. */
router.get("/arome/maps", async (c) => {
  try {
    const body = await readFile(path.join(DATA_DIR, "api", "arome", "maps"), "utf8");
    return c.body(body, 200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=30",
    });
  } catch {
    return c.json({ error: "AROME catalogue not available" }, 404);
  }
});

/** Static observation catalogue (the station layer is served by /obs/stations). */
router.get("/obs/maps", (c) =>
  c.json(
    {
      run_time: new Date().toISOString(),
      run_id: "metar",
      generated_at: new Date().toISOString(),
      model: "Observacions METAR",
      source: "NOAA Aviation Weather",
      credit: "METAR. NOAA/NWS. meteozini.",
      variables: [],
      num_frames: 0,
      bounds: { west: -1, south: 39.8, east: 4.5, north: 43.5 },
      maps: {},
    },
    200,
    { "cache-control": "public, max-age=300" },
  ),
);

export default router;
