import { Hono } from "hono";
import { fetchJson } from "../cache.js";

const ENSEMBLES: Record<string, { api: string; label: string }> = {
  ifs: { api: "ecmwf_ifs025", label: "IFS ENS" },
  aifs: { api: "ecmwf_aifs025_single", label: "AIFS ENS" },
  gfs: { api: "gfs025", label: "GFS ENS" },
};

const VARIABLES: Record<string, { api: string; unit: string; label: string }> = {
  temperature: { api: "temperature_2m", unit: "°C", label: "Temperatura a 2 m" },
  temperature_850: { api: "temperature_850hPa", unit: "°C", label: "Temperatura a 850 hPa" },
  temperature_500: { api: "temperature_500hPa", unit: "°C", label: "Temperatura a 500 hPa" },
  wind_speed: { api: "wind_speed_10m", unit: "km/h", label: "Vent mitjà a 10 m" },
  wind_gust: { api: "wind_gusts_10m", unit: "km/h", label: "Ratxa màxima a 10 m" },
  precipitation: { api: "precipitation", unit: "mm", label: "Precipitació acumulada" },
  snow: { api: "snowfall", unit: "cm", label: "Neu acumulada" },
};

function percentile(sorted: number[], p: number) {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

const router = new Hono();

router.get("/ensemble", async (c) => {
  const lat = Number(c.req.query("lat"));
  const lon = Number(c.req.query("lon"));
  const modelKey = c.req.query("model") ?? "ifs";
  const variable = c.req.query("variable") ?? "temperature";
  const ens = ENSEMBLES[modelKey] ?? ENSEMBLES.ifs;
  const def = VARIABLES[variable] ?? VARIABLES.temperature;

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return c.json({ error: "lat and lon required" }, 400);
  }

  const url = new URL("https://ensemble-api.open-meteo.com/v1/ensemble");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("hourly", def.api);
  url.searchParams.set("models", ens.api);
  url.searchParams.set("forecast_days", "7");
  url.searchParams.set("timezone", "Europe/Madrid");
  url.searchParams.set("wind_speed_unit", "kmh");

  try {
    const data = await fetchJson<any>(url.toString(), 900_000);
    const time: string[] = data.hourly?.time ?? [];
    const memberKeys = Object.keys(data.hourly ?? {}).filter(
      (k) => k === def.api || k.startsWith(`${def.api}_member`),
    );

    const members = memberKeys.map((k) => data.hourly[k] as (number | null)[]).filter(Boolean);
    const mean = time.map((_, i) => {
      const vals = members.map((m) => m[i]).filter((v): v is number => typeof v === "number");
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    });
    const p10 = time.map((_, i) => {
      const vals = members.map((m) => m[i]).filter((v): v is number => typeof v === "number").sort((a, b) => a - b);
      return percentile(vals, 0.1);
    });
    const p90 = time.map((_, i) => {
      const vals = members.map((m) => m[i]).filter((v): v is number => typeof v === "number").sort((a, b) => a - b);
      return percentile(vals, 0.9);
    });

    return c.json({
      time,
      members,
      mean,
      p10,
      p90,
      unit: def.unit,
      label: def.label,
      modelLabel: ens.label,
      memberCount: members.length,
    });
  } catch (error) {
    return c.json({ error: String(error) }, 502);
  }
});

export default router;
