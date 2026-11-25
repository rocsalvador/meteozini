import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import { fetchJson } from "../cache.js";
import { DATA_DIR } from "../data.js";
import { MODEL_DEFS } from "./models.js";

/**
 * Coarse gridded forecast fields for the Open-Meteo deterministic models. The
 * interactive map and `/mapes` render these as local rasters, because only
 * AROME has pre-generated PNG overlays.
 *
 * Open-Meteo counts each location in a multi-point request as one API call. A
 * per-variable grid would therefore cost hundreds of calls; instead we fetch
 * all variables for a model in a single request (the weight stays ~1 per
 * location) and cache the bundle in memory and on disk for 3 hours.
 */

const BASE_VARS = [
  "temperature_2m",
  "relative_humidity_2m",
  "pressure_msl",
  "visibility",
  "precipitation",
  "snowfall",
  "freezing_level_height",
  "wind_speed_10m",
  "wind_gusts_10m",
  "cape",
] as const;

/** Map-layer variable → source series and unit. */
const VARIABLES: Record<string, { unit: string; from: string; accumulate?: boolean }> = {
  temperature: { unit: "°C", from: "temperature_2m" },
  humidity: { unit: "%", from: "relative_humidity_2m" },
  pressure_msl: { unit: "hPa", from: "pressure_msl" },
  visibility: { unit: "m", from: "visibility" },
  precipitation: { unit: "mm", from: "precipitation" },
  precip_accum: { unit: "mm", from: "precipitation", accumulate: true },
  snow_precipitation: { unit: "cm", from: "snowfall" },
  snow_accum: { unit: "cm", from: "snowfall", accumulate: true },
  snow_level: { unit: "m", from: "freezing_level_height" },
  wind_speed: { unit: "km/h", from: "wind_speed_10m" },
  wind_gust: { unit: "km/h", from: "wind_gusts_10m" },
  cape: { unit: "J/kg", from: "cape" },
};

const WEST = -1;
const SOUTH = 39.8;
const EAST = 4.5;
const NORTH = 43.5;
// Open-Meteo bills one call per location. 0.25° over Catalonia is 368 points, so
// a full model bundle costs ~368 calls; raise the resolution only if you set an
// API key (`OPEN_METEO_API_KEY`) or accept slower refreshes.
const STEP = (() => {
  const value = Number(process.env.MODEL_GRID_STEP);
  return Number.isFinite(value) && value >= 0.05 && value <= 1 ? value : 0.25;
})();
const REFRESH_HOURS = (() => {
  const value = Number(process.env.MODEL_GRID_REFRESH_HOURS);
  if (Number.isFinite(value) && value > 0) return value;
  // Free tier: keep 5 model bundles under the 10k/day budget.
  return STEP <= 0.25 ? 6 : STEP <= 0.5 ? 3 : 2;
})();
const MAX_AGE = REFRESH_HOURS * 60 * 60 * 1000;

const API_KEY = process.env.OPEN_METEO_API_KEY?.trim();
const API_HOST = API_KEY ? "https://customer-api.open-meteo.com" : "https://api.open-meteo.com";

type Series = (number | null)[];

type Bundle = {
  model: string;
  label: string;
  source?: string;
  step: number;
  generatedAt: string;
  bounds: { west: number; south: number; east: number; north: number };
  lats: number[];
  lons: number[];
  times: string[];
  series: Record<string, Series>;
};

function axis(from: number, to: number) {
  const out: number[] = [];
  for (let v = from; v <= to + 1e-9; v += STEP) out.push(Math.round(v * 100) / 100);
  return out;
}

const LONS = axis(WEST, EAST);
const LATS = axis(SOUTH, NORTH);
const COUNT = LONS.length * LATS.length;
const BOUNDS = { west: LONS[0], south: LATS[0], east: LONS[LONS.length - 1], north: LATS[LATS.length - 1] };

const round = (v: number) => Math.round(v * 100) / 100;

const CACHE_DIR = path.join(DATA_DIR, "api", "model-grid");
const memory = new Map<string, { at: number; bundle: Bundle }>();
const inflight = new Map<string, Promise<Bundle>>();

/** Best cached bundle for a model: pipeline (ECMWF) wins, then newest. */
async function readDisk(model: string): Promise<Bundle | null> {
  let files: string[];
  try {
    files = await readdir(CACHE_DIR);
  } catch {
    return null;
  }
  let best: Bundle | null = null;
  for (const file of files) {
    if (!file.startsWith(`${model}_`) || !file.endsWith(".json")) continue;
    try {
      const bundle = JSON.parse(await readFile(path.join(CACHE_DIR, file), "utf8")) as Bundle;
      if (!bundle?.times?.length || !bundle?.series) continue;
      const ecmwf = bundle.source === "ECMWF open data";
      const bestEcmwf = best?.source === "ECMWF open data";
      if (
        !best ||
        (ecmwf && !bestEcmwf) ||
        (ecmwf === bestEcmwf && Date.parse(bundle.generatedAt) > Date.parse(best.generatedAt))
      ) {
        best = bundle;
      }
    } catch {
      /* ignore broken file */
    }
  }
  return best;
}

const cacheFile = (model: string) => path.join(CACHE_DIR, `${model}_${String(STEP).replace(".", "p")}.json`);

async function writeDisk(bundle: Bundle) {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(cacheFile(bundle.model), JSON.stringify(bundle));
  } catch {
    /* cache is best-effort */
  }
}

async function fetchBundle(model: string, label: string): Promise<Bundle> {
  const url = new URL(`${API_HOST}/v1/forecast`);
  const lats: string[] = [];
  const lons: string[] = [];
  for (const lat of LATS) {
    for (const lon of LONS) {
      lats.push(String(lat));
      lons.push(String(lon));
    }
  }
  url.searchParams.set("latitude", lats.join(","));
  url.searchParams.set("longitude", lons.join(","));
  url.searchParams.set("hourly", BASE_VARS.join(","));
  url.searchParams.set("models", model);
  url.searchParams.set("forecast_days", "3");
  url.searchParams.set("timezone", "Europe/Madrid");
  url.searchParams.set("wind_speed_unit", "kmh");
  if (API_KEY) url.searchParams.set("apikey", API_KEY);

  const data = await fetchJson<any>(url.toString(), MAX_AGE);
  const locations: any[] = Array.isArray(data) ? data : [data];
  const times: string[] = locations[0]?.hourly?.time ?? [];
  if (!times.length) throw new Error("no time axis");

  const series: Record<string, Series> = {};
  for (const apiVar of BASE_VARS) {
    const flat: Series = new Array(times.length * COUNT).fill(null);
    locations.forEach((location, cell) => {
      const values: Series | undefined = location?.hourly?.[apiVar];
      if (!values || cell >= COUNT) return;
      for (let t = 0; t < times.length; t += 1) {
        const value = values[t];
        if (typeof value === "number" && Number.isFinite(value)) flat[t * COUNT + cell] = round(value);
      }
    });
    series[apiVar] = flat;
  }

  return {
    model,
    label,
    source: "Open-Meteo",
    step: STEP,
    generatedAt: new Date().toISOString(),
    bounds: BOUNDS,
    lats: LATS,
    lons: LONS,
    times,
    series,
  };
}

/**
 * Fresh bundle from memory/disk, otherwise upstream. If upstream fails (rate
 * limit) an older disk bundle is still served rather than showing no data.
 */
async function getBundle(model: string, label: string): Promise<{ bundle: Bundle; stale: boolean }> {
  const now = Date.now();
  const hit = memory.get(model);

  // Prefer a newer disk bundle (e.g. written by `pipeline/fetch_ifs.py`).
  const disk = await readDisk(model);
  const diskAt = disk ? Date.parse(disk.generatedAt) : NaN;
  const diskFresh = Boolean(disk && Number.isFinite(diskAt) && now - diskAt < MAX_AGE);
  if (disk && disk.source === "ECMWF open data") {
    // Pipeline-managed data: never replace it with an Open-Meteo bundle; keep it
    // until `pipeline/fetch_ifs.py` writes a newer run.
    memory.set(model, { at: diskAt, bundle: disk });
    return { bundle: disk, stale: !diskFresh };
  }
  if (disk && diskFresh) {
    memory.set(model, { at: diskAt, bundle: disk });
    return { bundle: disk, stale: false };
  }
  if (hit && now - hit.at < MAX_AGE) return { bundle: hit.bundle, stale: false };
  const fallback = disk;

  const running = inflight.get(model);
  if (running) return { bundle: await running, stale: false };

  const promise = fetchBundle(model, label)
    .then(async (bundle) => {
      memory.set(model, { at: Date.now(), bundle });
      await writeDisk(bundle);
      return bundle;
    })
    .finally(() => inflight.delete(model));
  inflight.set(model, promise);

  try {
    return { bundle: await promise, stale: false };
  } catch (error) {
    if (fallback) {
      // Retry upstream after 5 minutes, but keep showing the cached grid meanwhile.
      memory.set(model, { at: now - MAX_AGE + 5 * 60 * 1000, bundle: fallback });
      return { bundle: fallback, stale: true };
    }
    throw error;
  }
}

function cumulative(values: Series): Series {
  const out: Series = new Array(values.length).fill(null);
  const sums = new Array(COUNT).fill(0);
  for (let t = 0; t < values.length / COUNT; t += 1) {
    for (let i = 0; i < COUNT; i += 1) {
      const idx = t * COUNT + i;
      sums[i] += values[idx] ?? 0;
      out[idx] = round(sums[i]);
    }
  }
  return out;
}

const router = new Hono();

router.get("/model/grid", async (c) => {
  const model = c.req.query("model") ?? "";
  const variable = c.req.query("variable") ?? "temperature";
  const def = VARIABLES[variable];
  const modelDef = MODEL_DEFS.find((m) => m.id === model);
  if (!modelDef || !def) return c.json({ error: "unknown model or variable" }, 400);

  try {
    const { bundle, stale } = await getBundle(modelDef.id, modelDef.label);
    const source = bundle.series[def.from];
    if (!source) return c.json({ error: "variable not available for this model" }, 502);
    const values = def.accumulate ? cumulative(source) : source;
    return c.json({
      model: bundle.model,
      label: bundle.label,
      source: bundle.source ?? "Open-Meteo",
      step: bundle.step,
      variable,
      unit: def.unit,
      hasData: values.some((value) => value != null),
      generatedAt: bundle.generatedAt,
      stale,
      bounds: bundle.bounds,
      lats: bundle.lats,
      lons: bundle.lons,
      times: bundle.times,
      values,
    });
  } catch (error) {
    return c.json({ error: String(error) }, 502);
  }
});

export default router;
