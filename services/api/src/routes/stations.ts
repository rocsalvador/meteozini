import { Hono } from "hono";
import { fetchJson } from "../cache.js";

const METAR = "https://aviationweather.gov/api/data/metar?bbox=39.9,-0.2,43.0,3.5&format=json";

function rh(t: number, td: number) {
  const es = (x: number) => 6.112 * Math.exp((17.67 * x) / (x + 243.5));
  return Math.max(0, Math.min(100, (100 * es(td)) / es(t)));
}

const router = new Hono();

router.get("/obs/stations", async (c) => {
  try {
    const rows = await fetchJson<any[]>(METAR, 300_000);
    const stations = (Array.isArray(rows) ? rows : [])
      .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon))
      .map((r) => {
        const temp = typeof r.temp === "number" ? r.temp : null;
        const dewp = typeof r.dewp === "number" ? r.dewp : null;
        const wspd = typeof r.wspd === "number" ? r.wspd * 1.852 : null;
        const wgst = typeof r.wgst === "number" ? r.wgst * 1.852 : null;
        const dir = typeof r.wdir === "number" ? r.wdir : null;
        return {
          id: String(r.icaoId ?? r.station_id ?? Math.random()),
          name: String(r.name ?? r.icaoId ?? "Estació"),
          network: "METAR",
          lat: r.lat,
          lon: r.lon,
          alt: null,
          ta: temp,
          hr: temp != null && dewp != null ? Math.round(rh(temp, dewp)) : null,
          vv: wspd,
          dv: dir,
          vmax: wgst,
          prec: null,
          day_tmax: null,
          day_tmin: null,
          day_prec: null,
          day_vmax: null,
          observed_at: r.obsTime ? new Date(r.obsTime * 1000).toISOString() : null,
        };
      });
    return c.json(
      {
        stations,
        observed_at: new Date().toISOString(),
        n_stations: stations.length,
        networks: { METAR: stations.length },
      },
      200,
      { "cache-control": "public, max-age=300, s-maxage=300" },
    );
  } catch (e) {
    return c.json(
      { stations: [], observed_at: new Date().toISOString(), n_stations: 0, networks: {}, error: String(e) },
      200,
    );
  }
});

export default router;
