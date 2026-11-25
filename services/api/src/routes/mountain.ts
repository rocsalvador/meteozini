import { Hono } from "hono";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fetchJson, fetchText, tryFetchJson } from "../cache.js";
import { DATA_DIR } from "../data.js";

type AnyRecord = Record<string, any>;

const BPA_BASE = "https://bpa.icgc.cat/api/apiext/butlletiglobal";
const BPA_ZONES = "https://bpa.icgc.cat/zones/zones.geojson";

/** Available avalanche zones (Aran, Pallaresa, Cadí…), as a GeoJSON collection. */
const ZONE_NAMES: Record<string, string> = {
  "1": "Aran - Franja Nord Pallaresa",
  "2": "Ribagorçana - Vall Fosca",
  "3": "Pallaresa",
  "4": "Perafita - Puigpedrós",
  "5": "Vessant Nord del Cadí-Moixeró",
  "6": "Prepirineu",
  "7": "Ter - Freser",
};

const HOURLY = [
  "temperature_2m", "apparent_temperature", "relative_humidity_2m", "precipitation",
  "precipitation_probability", "weather_code", "wind_speed_10m", "wind_gusts_10m",
  "wind_direction_10m", "cloud_cover", "freezing_level_height", "snowfall", "snow_depth",
  "visibility", "is_day",
].join(",");

const localDay = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());

function normalizeZone(zone: AnyRecord) {
  return {
    id: String(zone.id_zona ?? ""),
    name: zone.nom_zona ?? ZONE_NAMES[String(zone.id_zona ?? "")] ?? "",
    danger: Number(zone.grau_perill_primari ?? 0) || 0,
    secondary: zone.grau_perill_secundari == null ? null : Number(zone.grau_perill_secundari),
    issued: zone.databutlleti ?? null,
    validUntil: zone.datavalidesabutlleti ?? null,
    bulletin: zone.perill_text ?? null,
    snowpack: zone.text_estat_mantell ?? null,
    distribution: zone.text_distribucio ?? null,
    trend: zone.text_tendencia ?? null,
    note: zone.nota_text ?? null,
    footer: zone.peu_nota_text ?? null,
    problems: (zone.problems ?? []).map((p: AnyRecord) => ({
      type: p.tipus_situacio ?? "",
      size: Number(p.mida ?? 0) || null,
      trend: Number(p.tendencia ?? 0) || null,
      priority: Number(p.priority ?? 0) || null,
    })),
  };
}

const router = new Hono();

/** Daily avalanche bulletin (BPA) per zone, proxied and normalized. */
router.get("/mountain/avalanche/bpa", async (c) => {
  const requested = c.req.query("date");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(requested ?? "") ? (requested as string) : localDay();

  try {
    const data = await fetchJson<AnyRecord[]>(`${BPA_BASE}?id=512&values=${date};1`, 1_800_000);
    if (!Array.isArray(data) || data.length === 0) {
      return c.json({ date, zones: [], warning: "El butlletí encara no està publicat." });
    }
    return c.json({
      date: data[0]?.databutlleti ?? date,
      validUntil: data[0]?.datavalidesabutlleti ?? null,
      zones: data.map(normalizeZone),
    });
  } catch (error) {
    return c.json({ date, zones: [], error: String(error) }, 502);
  }
});

/** ICGC avalanche zones as GeoJSON, read from the BPA viewer's own layer file. */
router.get("/mountain/avalanche/zones", async (c) => {
  try {
    const text = await fetchText(BPA_ZONES, 21_600_000);
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end < start) throw new Error("unexpected zones payload");
    const raw = JSON.parse(text.slice(start, end + 1)) as {
      type: string;
      features: { properties: AnyRecord; geometry: unknown }[];
    };
    const features = raw.features.map((feature) => ({
      type: "Feature" as const,
      properties: {
        id: String(feature.properties?.id ?? ""),
        name: feature.properties?.name ?? "",
      },
      geometry: feature.geometry,
    }));
    return c.json({ type: "FeatureCollection", features });
  } catch (error) {
    return c.json({ type: "FeatureCollection", features: [], error: String(error) }, 502);
  }
});

/** Daily CLMS snow overlay written by pipeline/fetch_snow.py. */
router.get("/mountain/snow", async (c) => {
  try {
    const raw = await readFile(path.join(DATA_DIR, "static", "snow", "index.json"), "utf8");
    c.header("cache-control", "public, max-age=300");
    return c.json({ ...JSON.parse(raw), available: true });
  } catch {
    c.header("cache-control", "public, max-age=60");
    return c.json({ available: false });
  }
});

/** Hourly forecast for several points in a single upstream call (track sampling). */
router.get("/mountain/weather", async (c) => {
  const raw = c.req.query("points") ?? "";
  const points = raw
    .split(";")
    .map((pair) => pair.split(",").map(Number))
    .filter((pair) => pair.length === 2 && pair.every(Number.isFinite))
    .slice(0, 16);
  if (!points.length) return c.json({ error: "points required" }, 400);

  const build = (model?: string) => {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", points.map((p) => p[0]).join(","));
    url.searchParams.set("longitude", points.map((p) => p[1]).join(","));
    url.searchParams.set("hourly", HOURLY);
    url.searchParams.set("timezone", "Europe/Madrid");
    url.searchParams.set("forecast_days", "8");
    url.searchParams.set("wind_speed_unit", "kmh");
    if (model) url.searchParams.set("models", model);
    return url.toString();
  };

  try {
    const [arome, best] = await Promise.all([
      tryFetchJson<AnyRecord | AnyRecord[]>(build("meteofrance_arome_france_hd"), 900_000),
      tryFetchJson<AnyRecord | AnyRecord[]>(build(), 900_000),
    ]);
    if (!arome && !best) throw new Error("open-meteo unavailable");

    const primary = listOf(arome);
    const fallback = listOf(best);
    const count = Math.max(primary.length, fallback.length);
    const out = [];
    for (let i = 0; i < count; i += 1) {
      const base = primary[i];
      const fill = fallback[i];
      out.push({
        latitude: base?.latitude ?? fill?.latitude ?? points[i]?.[0] ?? null,
        longitude: base?.longitude ?? fill?.longitude ?? points[i]?.[1] ?? null,
        elevation: base?.elevation ?? fill?.elevation ?? null,
        hourly: mergeRows(rowsOf(base), rowsOf(fill)),
      });
    }
    return c.json({ points: out, model: primary.length ? "AROME HD + Open-Meteo" : "Open-Meteo" });
  } catch (error) {
    return c.json({ points: [], error: String(error) }, 502);
  }
});

function listOf(data: AnyRecord | AnyRecord[] | null): AnyRecord[] {
  if (!data) return [];
  return Array.isArray(data) ? data : [data];
}

function rowsOf(entry: AnyRecord | undefined): AnyRecord[] {
  const times: string[] = entry?.hourly?.time ?? [];
  return times.map((time, i) => ({
    time,
    temperature: entry?.hourly?.temperature_2m?.[i] ?? null,
    apparentTemperature: entry?.hourly?.apparent_temperature?.[i] ?? null,
    humidity: entry?.hourly?.relative_humidity_2m?.[i] ?? null,
    precipitation: entry?.hourly?.precipitation?.[i] ?? null,
    precipitationProbability: entry?.hourly?.precipitation_probability?.[i] ?? null,
    weathercode: entry?.hourly?.weather_code?.[i] ?? null,
    windSpeed: entry?.hourly?.wind_speed_10m?.[i] ?? null,
    windGusts: entry?.hourly?.wind_gusts_10m?.[i] ?? null,
    windDirection: entry?.hourly?.wind_direction_10m?.[i] ?? null,
    cloudcover: entry?.hourly?.cloud_cover?.[i] ?? null,
    freezingLevel: entry?.hourly?.freezing_level_height?.[i] ?? null,
    snowfall: entry?.hourly?.snowfall?.[i] ?? null,
    snowDepth: entry?.hourly?.snow_depth?.[i] ?? null,
    visibility: entry?.hourly?.visibility?.[i] ?? null,
    isDay: entry?.hourly?.is_day?.[i] ?? null,
  }));
}

/** Fill AROME gaps (probability, weather code, freezing level…) with the best-match model. */
function mergeRows(primary: AnyRecord[], fallback: AnyRecord[]): AnyRecord[] {
  const byTime = new Map(fallback.map((row) => [row.time, row]));
  return primary.map((row) => {
    const extra = byTime.get(row.time);
    if (!extra) return row;
    const merged: AnyRecord = { time: row.time };
    for (const key of Object.keys(row)) {
      if (key === "time") continue;
      merged[key] = row[key] ?? extra[key] ?? null;
    }
    return merged;
  });
}

export default router;
