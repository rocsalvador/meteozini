import { VAR_META } from "@meteozini/core";

/**
 * Client-side rendering of coarse model grids fetched from `/api/model/grid`.
 * Open-Meteo's deterministic models are only available as point series, so we
 * sample a regular grid and draw it into a canvas used as a raster overlay.
 */

export type MapModel = { id: string; label: string; detail: string };

export const MAP_MODELS: MapModel[] = [
  { id: "arome", label: "AROME HD", detail: "1,3 km · local" },
  { id: "ecmwf_ifs025", label: "IFS HRES", detail: "ECMWF" },
  { id: "gfs_seamless", label: "GFS", detail: "NOAA" },
  { id: "icon_global", label: "ICON Global", detail: "DWD" },
  { id: "gem_seamless", label: "GEM", detail: "ECCC" },
  { id: "icon_eu", label: "ICON-EU", detail: "DWD" },
];

export const modelLabel = (id: string) => MAP_MODELS.find((m) => m.id === id)?.label ?? id;

/** Variables the gridded model endpoint can provide. */
export const MODEL_GRID_VARIABLES = new Set([
  "temperature",
  "humidity",
  "pressure_msl",
  "visibility",
  "precipitation",
  "precip_accum",
  "snow_precipitation",
  "snow_accum",
  "snow_level",
  "wind_speed",
  "wind_gust",
  "cape",
]);

/** Variables missing from a specific gridded source (ECMWF open data has no visibility/freezing level). */
const MODEL_MISSING: Record<string, string[]> = {
  ecmwf_ifs025: ["visibility", "snow_level"],
};

export function modelSupportsVariable(model: string, variable: string): boolean {
  return MODEL_GRID_VARIABLES.has(variable) && !(MODEL_MISSING[model]?.includes(variable) ?? false);
}

export function modelGridGroups(model: string) {
  return MODEL_GRID_GROUPS.map((group) => ({
    ...group,
    variables: group.variables.filter((variable) => modelSupportsVariable(model, variable)),
  })).filter((group) => group.variables.length > 0);
}

export const MODEL_GRID_GROUPS = [
  { id: "surface", label: "Superfície", variables: ["temperature", "humidity", "pressure_msl", "visibility"] },
  {
    id: "precipitation",
    label: "Precipitació i neu",
    variables: ["precipitation", "precip_accum", "snow_precipitation", "snow_accum", "snow_level"],
  },
  { id: "wind", label: "Vent", variables: ["wind_speed", "wind_gust"] },
  { id: "instability", label: "Atmosfera", variables: ["cape"] },
];

export type GeoBounds = { west: number; south: number; east: number; north: number };

export type ModelGrid = {
  model: string;
  label: string;
  source?: string;
  step?: number;
  generatedAt?: string;
  stale?: boolean;
  variable: string;
  unit: string;
  hasData: boolean;
  bounds: GeoBounds;
  lats: number[];
  lons: number[];
  times: string[];
  /** Flat time-major grid: values[t * lats * lons + latIndex * lons + lonIndex]. */
  values: (number | null)[];
};

/** Sampling step of a grid in degrees, formatted for the UI. */
export function gridResolution(grid: ModelGrid): string {
  const step = grid.step ?? (grid.lats.length > 1 ? grid.lats[1] - grid.lats[0] : null);
  if (step == null || !Number.isFinite(step)) return "?";
  return String(Math.round(step * 100) / 100).replace(".", ",");
}

export async function fetchModelGrid(model: string, variable: string): Promise<ModelGrid | null> {
  if (model === "arome") return null;
  try {
    const res = await fetch(`/up/api/model/grid?model=${encodeURIComponent(model)}&variable=${encodeURIComponent(variable)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as ModelGrid;
    if (!data?.times?.length || !data.lats?.length || !data.lons?.length) return null;
    return data;
  } catch {
    return null;
  }
}

type Rgb = [number, number, number];
type ColorPoint = { p: number; c: Rgb };

const colorCache = new Map<string, ((value: number) => Rgb) | null>();
const imageCache = new Map<string, string>();

/** Below these values the overlay stays transparent (dry / no convection). */
const TRANSPARENT_BELOW: Record<string, number> = {
  precipitation: 0.1,
  precip_accum: 0.1,
  snow_precipitation: 0.1,
  snow_accum: 0.1,
  graupel: 0.1,
  cape: 1,
};

/** Precipitation edges fade between these values (mm) instead of a hard cut. */
const SOFT_ALPHA: Record<string, [number, number]> = {
  precipitation: [0.05, 0.3],
  precip_accum: [0.05, 0.3],
  snow_precipitation: [0.05, 0.3],
  snow_accum: [0.05, 0.3],
  graupel: [0.05, 0.3],
};

function parseColor(hex: string): Rgb {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Turn the CSS `linear-gradient(...)` legend of a variable into colour points. */
function gradientPoints(legend: string): ColorPoint[] {
  const points: ColorPoint[] = [];
  const re = /#([0-9a-fA-F]{6})\s+([\d.]+)%(?:\s+([\d.]+)%)?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(legend))) {
    const color = parseColor(match[1]);
    points.push({ p: Number(match[2]) / 100, c: color });
    if (match[3] != null) points.push({ p: Number(match[3]) / 100, c: color });
  }
  return points.sort((a, b) => a.p - b.p);
}

function parseStop(label: string): number | null {
  const text = label.replace(",", ".").replace("+", "").trim().toLowerCase();
  const thousands = text.endsWith("k");
  const value = Number.parseFloat(text);
  if (!Number.isFinite(value)) return null;
  return thousands ? value * 1000 : value;
}

/** Value → colour lookup table, using the variable's displayed legend and stops. */
function colorLut(variable: string): ((value: number) => Rgb) | null {
  if (colorCache.has(variable)) return colorCache.get(variable) ?? null;
  const meta = VAR_META[variable];
  if (!meta || meta.categorical) {
    colorCache.set(variable, null);
    return null;
  }
  if (meta.palette?.length) {
    const palette = [...meta.palette].filter((entry) => entry.value > 0).sort((a, b) => a.value - b.value);
    const lut = (value: number): Rgb => {
      let color = palette[0].color;
      for (const entry of palette) {
        if (value >= entry.value) color = entry.color;
        else break;
      }
      return parseColor(color);
    };
    colorCache.set(variable, lut);
    return lut;
  }
  const stops = meta.stops.map(parseStop);
  if (stops.some((s) => s == null)) {
    colorCache.set(variable, null);
    return null;
  }
  const values = stops as number[];
  const gradient = gradientPoints(meta.legend);
  if (values.length < 2 || gradient.length < 2) {
    colorCache.set(variable, null);
    return null;
  }

  const colorAt = (p: number): Rgb => {
    const clamped = Math.max(0, Math.min(1, p));
    for (let i = 1; i < gradient.length; i += 1) {
      if (clamped <= gradient[i].p) {
        const a = gradient[i - 1];
        const b = gradient[i];
        const f = b.p <= a.p ? 0 : (clamped - a.p) / (b.p - a.p);
        return [
          Math.round(a.c[0] + (b.c[0] - a.c[0]) * f),
          Math.round(a.c[1] + (b.c[1] - a.c[1]) * f),
          Math.round(a.c[2] + (b.c[2] - a.c[2]) * f),
        ];
      }
    }
    return gradient[gradient.length - 1].c;
  };

  const lut = (value: number): Rgb => {
    if (value <= values[0]) return colorAt(0);
    if (value >= values[values.length - 1]) return colorAt(1);
    for (let i = 1; i < values.length; i += 1) {
      if (value <= values[i]) {
        const f = (value - values[i - 1]) / Math.max(0.0001, values[i] - values[i - 1]);
        return colorAt((i - 1 + f) / (values.length - 1));
      }
    }
    return colorAt(1);
  };
  colorCache.set(variable, lut);
  return lut;
}

/** PNG data URL for one forecast hour of a model grid. Cached per model/variable/hour. */
export function modelGridImage(grid: ModelGrid, index: number): string | null {
  if (typeof document === "undefined") return null;
  const key = `${grid.model}|${grid.variable}|${index}`;
  const cached = imageCache.get(key);
  if (cached) return cached;

  const nlon = grid.lons.length;
  const nlat = grid.lats.length;
  const base = document.createElement("canvas");
  base.width = nlon;
  base.height = nlat;
  const ctx = base.getContext("2d");
  if (!ctx) return null;

  const lut = colorLut(grid.variable);
  const cut = TRANSPARENT_BELOW[grid.variable];
  const soft = SOFT_ALPHA[grid.variable];
  const img = ctx.createImageData(nlon, nlat);
  const offset = index * nlon * nlat;
  for (let j = 0; j < nlat; j += 1) {
    const row = nlat - 1 - j; // ImageData row 0 is the northern edge.
    for (let i = 0; i < nlon; i += 1) {
      const value = grid.values[offset + j * nlon + i];
      const visible = value != null && (cut == null || value >= cut);
      // Even invisible cells keep the low-precipitation colour, so bilinear
      // filtering does not bleed black/white halos into the edges.
      const rgb = lut ? lut(value ?? 0) : null;
      const alpha =
        visible && value != null
          ? soft
            ? Math.round(Math.max(0, Math.min(1, (value - soft[0]) / (soft[1] - soft[0]))) * 210)
            : 210
          : 0;
      const k = (row * nlon + i) * 4;
      img.data[k] = rgb ? rgb[0] : 0;
      img.data[k + 1] = rgb ? rgb[1] : 0;
      img.data[k + 2] = rgb ? rgb[2] : 0;
      img.data[k + 3] = alpha;
    }
  }
  ctx.putImageData(img, 0, 0);

  const scale = 6;
  const out = document.createElement("canvas");
  out.width = nlon * scale;
  out.height = nlat * scale;
  const scaled = out.getContext("2d");
  if (!scaled) return base.toDataURL("image/png");
  scaled.imageSmoothingEnabled = true;
  scaled.imageSmoothingQuality = "high";
  if (soft) scaled.filter = "blur(0.7px)";
  scaled.drawImage(base, 0, 0, out.width, out.height);
  if (soft) scaled.filter = "none";
  const url = out.toDataURL("image/png");

  imageCache.set(key, url);
  if (imageCache.size > 180) {
    const oldest = imageCache.keys().next().value;
    if (oldest) imageCache.delete(oldest);
  }
  return url;
}

/** Bilinear sample of a model grid at a coordinate for the given hour. */
export function sampleModelGrid(grid: ModelGrid, index: number, lat: number, lon: number): number | null {
  const { lats, lons, values } = grid;
  if (!lats.length || !lons.length) return null;
  if (lat < lats[0] || lat > lats[lats.length - 1] || lon < lons[0] || lon > lons[lons.length - 1]) return null;

  const locate = (axis: number[], value: number) => {
    let i = 0;
    while (i < axis.length - 2 && value > axis[i + 1]) i += 1;
    const span = axis[i + 1] - axis[i];
    return { i, f: span <= 0 ? 0 : (value - axis[i]) / span };
  };
  const { i, f } = locate(lats, lat);
  const { i: k, f: g } = locate(lons, lon);
  const nlon = lons.length;
  const offset = index * nlon * lats.length;
  const at = (ay: number, ax: number) => values[offset + ay * nlon + ax];

  const v00 = at(i, k);
  const v01 = at(i, k + 1);
  const v10 = at(i + 1, k);
  const v11 = at(i + 1, k + 1);
  const weighted = (a: number | null, b: number | null, c: number | null, d: number | null) => {
    let total = 0;
    let weight = 0;
    if (a != null) {
      total += a * (1 - g) * (1 - f);
      weight += (1 - g) * (1 - f);
    }
    if (b != null) {
      total += b * g * (1 - f);
      weight += g * (1 - f);
    }
    if (c != null) {
      total += c * (1 - g) * f;
      weight += (1 - g) * f;
    }
    if (d != null) {
      total += d * g * f;
      weight += g * f;
    }
    return weight > 0 ? total / weight : null;
  };
  return weighted(v00, v01, v10, v11);
}
