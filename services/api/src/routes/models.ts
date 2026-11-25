import { Hono } from "hono";
import { fetchJson } from "../cache.js";

export const MODEL_DEFS = [
  { id: "ecmwf_ifs025", label: "IFS HRES", color: "#2563eb" },
  { id: "gfs_seamless", label: "GFS", color: "#16a34a" },
  { id: "icon_global", label: "ICON Global", color: "#d97706" },
  { id: "gem_seamless", label: "GEM", color: "#7c3aed" },
  { id: "meteofrance_arome_france_hd", label: "AROME HD", color: "#e4572e" },
  { id: "icon_eu", label: "ICON-EU", color: "#0891b2" },
] as const;

const MODEL_VARIABLES: Record<string, { api: string; label: string; unit: string; cumulative?: boolean }> = {
  temperature: { api: "temperature_2m", label: "Temperatura a 2 m", unit: "°C" },
  temperature_850: { api: "temperature_850hPa", label: "Temperatura a 850 hPa", unit: "°C" },
  precipitation: { api: "precipitation", label: "Precipitació acumulada", unit: "mm", cumulative: true },
  snow: { api: "snowfall", label: "Neu acumulada", unit: "cm", cumulative: true },
  wind_speed: { api: "wind_speed_10m", label: "Vent mitjà a 10 m", unit: "km/h" },
  wind_gust: { api: "wind_gusts_10m", label: "Ratxa màxima a 10 m", unit: "km/h" },
  wind_direction: { api: "wind_direction_10m", label: "Direcció del vent a 10 m", unit: "°" },
  pressure: { api: "pressure_msl", label: "Pressió al nivell del mar", unit: "hPa" },
};

const router = new Hono();

router.get("/models", async (c) => {
  const lat = Number(c.req.query("lat"));
  const lon = Number(c.req.query("lon"));
  const variable = c.req.query("variable") ?? "temperature";
  const def = MODEL_VARIABLES[variable] ?? MODEL_VARIABLES.temperature;

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return c.json({ error: "lat and lon required" }, 400);
  }

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("hourly", def.api);
  url.searchParams.set("models", MODEL_DEFS.map((m) => m.id).join(","));
  url.searchParams.set("forecast_days", "7");
  url.searchParams.set("timezone", "Europe/Madrid");
  url.searchParams.set("wind_speed_unit", "kmh");

  try {
    const data = await fetchJson<any>(url.toString(), 900_000);
    const time: string[] = data.hourly?.time ?? [];

    const models = MODEL_DEFS.map((m) => {
      const raw: (number | null)[] = data.hourly?.[`${def.api}_${m.id}`] ?? [];
      let values = raw;
      if (def.cumulative) {
        let total = 0;
        values = raw.map((v) => {
          total += v ?? 0;
          return Math.round(total * 10) / 10;
        });
      }
      return { id: m.id, label: m.label, color: m.color, values };
    });

    const consensus = time.map((_, i) => {
      const vals = models.map((m) => m.values[i]).filter((v): v is number => typeof v === "number");
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    });

    return c.json({
      time,
      models,
      consensus,
      unit: def.unit,
      label: def.label,
      meta: { latitude: data.latitude, longitude: data.longitude, elevation: data.elevation },
    });
  } catch (error) {
    return c.json({ error: String(error) }, 502);
  }
});

export default router;
