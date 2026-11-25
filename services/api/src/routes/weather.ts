import { Hono } from "hono";
import { tryFetchJson } from "../cache.js";

type AnyRecord = Record<string, any>;

const CURRENT = [
  "temperature_2m", "relative_humidity_2m", "precipitation", "precipitation_probability",
  "weather_code", "wind_speed_10m", "wind_gusts_10m", "wind_direction_10m", "cloud_cover",
  "pressure_msl", "uv_index", "is_day", "apparent_temperature",
].join(",");

const HOURLY_KEYS = [
  "temperature_2m", "relative_humidity_2m", "dew_point_2m", "precipitation",
  "precipitation_probability", "weather_code", "wind_speed_10m", "wind_gusts_10m",
  "wind_direction_10m", "cloud_cover", "pressure_msl", "freezing_level_height", "is_day",
  "apparent_temperature", "visibility", "cloud_cover_low", "cloud_cover_mid", "cloud_cover_high",
  "cape",
];

const DAILY_KEYS = [
  "weather_code", "temperature_2m_max", "temperature_2m_min", "precipitation_sum",
  "precipitation_probability_max", "sunrise", "sunset", "wind_speed_10m_max", "uv_index_max",
];

const HOURLY = HOURLY_KEYS.join(",");
const DAILY = DAILY_KEYS.join(",");

const num = (a: unknown, b: unknown) =>
  typeof a === "number" && Number.isFinite(a) ? a : typeof b === "number" && Number.isFinite(b) ? b : null;

const pickAny = (a: unknown, b: unknown) => (a != null && a !== "" ? a : b != null ? b : null);

function mergeSeries(primary: AnyRecord | null, fallback: AnyRecord | null, keys: string[]) {
  const time: string[] = primary?.time ?? fallback?.time ?? [];
  const out: AnyRecord = { time };
  for (const key of keys) out[key] = time.map((_, i) => num(primary?.[key]?.[i], fallback?.[key]?.[i]));
  return out;
}

function mergeCurrent(primary: AnyRecord | null, fallback: AnyRecord | null) {
  const out: AnyRecord = { ...(fallback ?? {}), ...(primary ?? {}) };
  for (const key of new Set([...Object.keys(primary ?? {}), ...Object.keys(fallback ?? {})])) {
    const pv = primary?.[key];
    const fv = fallback?.[key];
    out[key] = typeof pv === "number" ? num(pv, fv) : pickAny(pv, fv);
  }
  return out;
}

function mergeDaily(primary: AnyRecord | null, fallback: AnyRecord | null, keys: string[]) {
  const time: string[] = primary?.time ?? fallback?.time ?? [];
  const out: AnyRecord = { time };
  for (const key of keys) {
    out[key] = time.map((_, i) => {
      const pv = primary?.[key]?.[i];
      const fv = fallback?.[key]?.[i];
      return typeof pv === "string" || typeof fv === "string" ? pickAny(pv, fv) : num(pv, fv);
    });
  }
  return out;
}

function zipHourly(h: AnyRecord) {
  const rows = [];
  for (let i = 0; i < h.time.length; i += 1) {
    rows.push({
      time: h.time[i],
      temperature: h.temperature_2m?.[i] ?? null,
      humidity: h.relative_humidity_2m?.[i] ?? null,
      dewPoint: h.dew_point_2m?.[i] ?? null,
      precipitation: h.precipitation?.[i] ?? null,
      precipitationProbability: h.precipitation_probability?.[i] ?? null,
      weathercode: h.weather_code?.[i] ?? null,
      windSpeed: h.wind_speed_10m?.[i] ?? null,
      windGusts: h.wind_gusts_10m?.[i] ?? null,
      windDirection: h.wind_direction_10m?.[i] ?? null,
      cloudcover: h.cloud_cover?.[i] ?? null,
      pressure: h.pressure_msl?.[i] ?? null,
      freezingLevel: h.freezing_level_height?.[i] ?? null,
      isDay: h.is_day?.[i] ?? null,
      apparentTemperature: h.apparent_temperature?.[i] ?? null,
      visibility: h.visibility?.[i] ?? null,
      cape: h.cape?.[i] ?? null,
    });
  }
  return rows;
}

function zipDaily(d: AnyRecord) {
  const rows = [];
  for (let i = 0; i < d.time.length; i += 1) {
    rows.push({
      date: d.time[i],
      weathercode: d.weather_code?.[i] ?? null,
      temperatureMax: d.temperature_2m_max?.[i] ?? null,
      temperatureMin: d.temperature_2m_min?.[i] ?? null,
      precipitationSum: d.precipitation_sum?.[i] ?? null,
      precipitationProbability: d.precipitation_probability_max?.[i] ?? null,
      sunrise: d.sunrise?.[i] ?? null,
      sunset: d.sunset?.[i] ?? null,
      windSpeedMax: d.wind_speed_10m_max?.[i] ?? null,
      uvIndexMax: d.uv_index_max?.[i] ?? null,
    });
  }
  return rows;
}

const router = new Hono();

router.get("/weather", async (c) => {
  const lat = Number(c.req.query("lat"));
  const lon = Number(c.req.query("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return c.json({ error: "lat and lon required" }, 400);
  }

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("current", CURRENT);
  url.searchParams.set("hourly", HOURLY);
  url.searchParams.set("daily", DAILY);
  url.searchParams.set("timezone", "Europe/Madrid");
  url.searchParams.set("forecast_days", "8");
  url.searchParams.set("wind_speed_unit", "kmh");

  try {
    const make = (model: string) => {
      const u = new URL(url.toString());
      u.searchParams.set("models", model);
      return u.toString();
    };
    const [arome, best] = await Promise.all([
      tryFetchJson<AnyRecord>(make("meteofrance_arome_france_hd"), 300_000),
      tryFetchJson<AnyRecord>(make("best_match"), 300_000),
    ]);
    if (!arome && !best) throw new Error("open-meteo unavailable");
    const base = arome?.latitude ? arome : best ?? {};

    const cur = mergeCurrent(arome?.current ?? null, best?.current ?? null);
    const hourly = mergeSeries(arome?.hourly ?? null, best?.hourly ?? null, HOURLY_KEYS);
    const daily = mergeDaily(arome?.daily ?? null, best?.daily ?? null, DAILY_KEYS);

    return c.json({
      location: {
        latitude: base.latitude,
        longitude: base.longitude,
        timezone: base.timezone,
        elevation: base.elevation,
      },
      current: {
        time: cur.time,
        temperature: cur.temperature_2m ?? null,
        humidity: cur.relative_humidity_2m ?? null,
        precipitation: cur.precipitation ?? null,
        precipitationProbability: cur.precipitation_probability ?? null,
        weathercode: cur.weather_code ?? null,
        windSpeed: cur.wind_speed_10m ?? null,
        windGusts: cur.wind_gusts_10m ?? null,
        windDirection: cur.wind_direction_10m ?? null,
        cloudcover: cur.cloud_cover ?? null,
        pressure: cur.pressure_msl ?? null,
        uvIndex: cur.uv_index ?? null,
        isDay: cur.is_day ?? null,
        apparentTemperature: cur.apparent_temperature ?? null,
      },
      hourly: zipHourly(hourly),
      daily: zipDaily(daily),
      metadata: {
        generatedAt: new Date().toISOString(),
        model: arome ? "AROME HD + Open-Meteo" : "Open-Meteo",
      },
    });
  } catch (error) {
    return c.json({ error: String(error) }, 502);
  }
});

export default router;
