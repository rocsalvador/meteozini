export type Bounds = { west: number; south: number; east: number; north: number };

export type MapFrame = {
  variable: string;
  hour: number;
  timestamp: string;
  valid_time: string;
  filepath: string;
  web_filepath: string;
  web_bounds: Bounds;
  unit?: string;
  forecast?: boolean;
};

export type MapsResponse = {
  run_time: string;
  run_id: string;
  generated_at?: string;
  model: string;
  source: string;
  credit: string;
  variables: string[];
  num_frames: number;
  bounds: Bounds;
  maps: Record<string, MapFrame[]>;
  rainviewer?: { host: string; frames: { time: string; path: string }[] };
};

export type SatFrames = {
  bounds: Bounds;
  layers: Record<string, { slot: number; time: string; url: string }[]>;
};

export type Station = {
  id: string;
  name: string;
  network: string;
  lat: number;
  lon: number;
  alt: number | null;
  ta: number | null;
  hr: number | null;
  vv: number | null;
  dv: number | null;
  vmax: number | null;
  prec: number | null;
  day_tmax: number | null;
  day_tmin: number | null;
  day_prec: number | null;
  day_vmax: number | null;
  observed_at: string | null;
};

export type StationsResponse = {
  stations: Station[];
  observed_at: string;
  n_stations: number;
  networks: Record<string, number>;
};

export function proxyUrl(path: string | null | undefined): string {
  if (!path) return "";
  if (!path.startsWith("/static/")) return path;
  return `/up${path}`;
}

/** Build the wind_uv raster URL for a frame by swapping the variable directory. */
export function windFieldUrl(frame: MapFrame | undefined): string | null {
  if (!frame?.web_filepath) return null;
  const clean = frame.web_filepath.split("?")[0];
  const m = clean.match(/^(.*\/)([^/]+)\/([^/]+)_(\d{8}_\d{4})\.png$/);
  if (!m) return null;
  const [, runDir, , , stamp] = m;
  return `/up${runDir}wind_uv/wind_uv_${stamp}.png`;
}

/** Build the values.json sidecar URL (grid used for readouts and labels). */
export function valuesUrl(frame: MapFrame | undefined): string | null {
  if (!frame?.web_filepath) return null;
  const clean = frame.web_filepath.split("?")[0];
  if (!clean.endsWith(".png")) return null;
  return `/up${clean.replace(/\.png$/, ".values.json")}`;
}

export type ValueGrid = {
  width: number;
  height: number;
  bounds: Bounds;
  min: number;
  step: number;
  unit: string;
  values: Float32Array;
};

export function sampleGrid(grid: ValueGrid, lat: number, lon: number): number | null {
  const { west, east, south, north } = grid.bounds;
  const x = ((lon - west) / (east - west)) * grid.width - 0.5;
  const y = ((north - lat) / (north - south)) * grid.height - 0.5;
  if (x < -0.5 || y < -0.5 || x > grid.width - 0.5 || y > grid.height - 0.5) return null;
  const x0 = Math.max(0, Math.min(grid.width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(grid.height - 1, Math.floor(y)));
  const x1 = Math.min(grid.width - 1, x0 + 1);
  const y1 = Math.min(grid.height - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, x - x0));
  const fy = Math.max(0, Math.min(1, y - y0));
  let sum = 0;
  let weight = 0;
  for (const [xi, yi, w] of [
    [x0, y0, (1 - fx) * (1 - fy)],
    [x1, y0, fx * (1 - fy)],
    [x0, y1, (1 - fx) * fy],
    [x1, y1, fx * fy],
  ] as [number, number, number][]) {
    const v = grid.values[yi * grid.width + xi];
    if (Number.isFinite(v) && w > 0) {
      sum += v * w;
      weight += w;
    }
  }
  if (weight > 0) return sum / weight;
  return null;
}

export function defaultFrameIndex(frames: MapFrame[], source: "arome" | "obs" | "radar" | "sat"): number {
  if (!frames.length) return 0;
  if (source !== "arome") {
    if (source === "radar") {
      for (let i = frames.length - 1; i >= 0; i -= 1) if (!frames[i].forecast) return i;
    }
    return frames.length - 1;
  }
  const now = Date.now();
  let best = 0;
  let bestDiff = Infinity;
  frames.forEach((f, i) => {
    const t = Date.parse(f.timestamp);
    if (Number.isFinite(t) && t <= now && now - t < bestDiff) {
      best = i;
      bestDiff = now - t;
    }
  });
  return best;
}
