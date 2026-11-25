import { Hono } from "hono";

const VARS: Record<string, { api: string; unit: string }> = {
  temperature: { api: "temperature_2m", unit: "°C" },
  temperature_850: { api: "temperature_850hPa", unit: "°C" },
  temperature_500: { api: "temperature_500hPa", unit: "°C" },
  wind_speed: { api: "wind_speed_10m", unit: "km/h" },
  wind_gust: { api: "wind_gusts_10m", unit: "km/h" },
  precipitation: { api: "precipitation", unit: "mm" },
  snow: { api: "snowfall", unit: "cm" },
};

type Climatology = { sums: Map<string, number>; counts: Map<string, number> };

const cache = new Map<string, { at: number; data: Climatology }>();
const TTL = 24 * 60 * 60 * 1000;

async function load(lat: number, lon: number, apiVar: string): Promise<Climatology> {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)},${apiVar}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.data;

  const url = new URL("https://archive-api.open-meteo.com/v1/archive");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("start_date", "1991-01-01");
  url.searchParams.set("end_date", "2020-12-31");
  url.searchParams.set("hourly", apiVar);
  url.searchParams.set("models", "era5");
  url.searchParams.set("timezone", "Europe/Madrid");
  url.searchParams.set("wind_speed_unit", "kmh");

  const res = await fetch(url);
  if (!res.ok) throw new Error(`era5 ${res.status}`);
  const json = await res.json();
  const time: string[] = json.hourly?.time ?? [];
  const values: (number | null)[] = json.hourly?.[apiVar] ?? [];
  const sums = new Map<string, number>();
  const counts = new Map<string, number>();
  time.forEach((t, i) => {
    const v = values[i];
    if (typeof v !== "number" || !Number.isFinite(v)) return;
    const k = `${t.slice(5, 10)}T${t.slice(11, 13)}`;
    sums.set(k, (sums.get(k) ?? 0) + v);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  });
  const data = { sums, counts };
  cache.set(key, { at: Date.now(), data });
  return data;
}

const router = new Hono();

router.get("/climatology", async (c) => {
  const lat = Number(c.req.query("lat"));
  const lon = Number(c.req.query("lon"));
  const variable = c.req.query("variable") ?? "temperature";
  const start = c.req.query("start") ?? new Date().toISOString().slice(0, 13) + ":00";
  const count = Math.max(1, Math.min(400, Number(c.req.query("count") ?? 168)));
  const def = VARS[variable] ?? VARS.temperature;

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return c.json({ error: "lat and lon required" }, 400);
  }

  try {
    const { sums, counts } = await load(lat, lon, def.api);
    const [datePart, timePart] = start.split("T");
    const [y, m, d] = datePart.split("-").map(Number);
    const [hh] = (timePart ?? "00:00").split(":").map(Number);
    const base = Date.UTC(y, m - 1, d, hh, 0, 0);

    const values = Array.from({ length: count }, (_, i) => {
      const dt = new Date(base + i * 3_600_000);
      const key = `${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}T${String(dt.getUTCHours()).padStart(2, "0")}`;
      const sum = sums.get(key);
      const n = counts.get(key);
      return sum != null && n ? Math.round((sum / n) * 100) / 100 : null;
    });

    return c.json(
      { values, unit: def.unit, period: "1991–2020", label: "Clima ERA5", source: "ERA5" },
      200,
      { "cache-control": "public, max-age=86400, s-maxage=86400" },
    );
  } catch (error) {
    return c.json({ error: String(error) }, 502);
  }
});

export default router;
