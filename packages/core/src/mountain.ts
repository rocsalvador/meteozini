/**
 * Pure helpers for the mountain planner: track geometry, arrival times and the
 * ICGC avalanche danger scale. No DOM access here — GPX parsing and MapLibre
 * live in `apps/web`, so a native client can reuse everything below.
 */

import type { Bounds } from "./map-data";

export type TrackPoint = { lat: number; lon: number; ele?: number | null; time?: string | null };

export type MountainActivity = { id: string; label: string; kmh: number; hint: string };

export const MOUNTAIN_ACTIVITIES: MountainActivity[] = [
  { id: "caminar", label: "Caminar", kmh: 4.5, hint: "4,5 km/h" },
  { id: "senderisme", label: "Senderisme", kmh: 3.5, hint: "3,5 km/h" },
  { id: "cursa", label: "Cursa de muntanya", kmh: 8, hint: "8 km/h" },
  { id: "esqui", label: "Esquí de muntanya", kmh: 2.8, hint: "2,8 km/h" },
  { id: "alpinisme", label: "Alpinisme", kmh: 2, hint: "2 km/h" },
  { id: "btt", label: "BTT", kmh: 10, hint: "10 km/h" },
];

export type PaceModel = "constant" | "naismith";

const EARTH_RADIUS = 6_371_000;

export function haversine(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type ItineraryLeg = {
  index: number;
  lat: number;
  lon: number;
  ele: number | null;
  /** Cumulative distance in metres. */
  distance: number;
  /** Cumulative ascent / descent in metres. */
  ascent: number;
  descent: number;
  /** Elapsed seconds since the start. */
  seconds: number;
  /** Local wall-clock arrival time, `YYYY-MM-DDTHH:mm` (same format as Open-Meteo). */
  eta: string;
};

export type ItinerarySample = ItineraryLeg & { number: number };

export type Itinerary = {
  legs: ItineraryLeg[];
  samples: ItinerarySample[];
  total: { distance: number; ascent: number; descent: number; seconds: number };
};

export type ItineraryOptions = {
  start: Date | string | number;
  kmh: number;
  model?: PaceModel;
  /** Extra minutes per 100 m of ascent in Naismith mode. Defaults to 10 (1 h / 600 m). */
  penaltyMinPer100m?: number;
  /** Maximum number of sampled legs, endpoints included. */
  maxSamples?: number;
};

function localIso(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Naismith's rule: base walking time from the horizontal distance plus a time
 * penalty per 100 m of ascent (one hour per 600 m by default). Constant mode
 * uses the flat speed only.
 */
export function buildItinerary(points: TrackPoint[], options: ItineraryOptions): Itinerary {
  const start = new Date(options.start);
  const startMs = Number.isFinite(start.getTime()) ? start.getTime() : Date.now();
  const kmh = options.kmh > 0 ? options.kmh : 4;
  const naismith = options.model === "naismith";
  const penaltyMinPer100m =
    typeof options.penaltyMinPer100m === "number" && Number.isFinite(options.penaltyMinPer100m) && options.penaltyMinPer100m >= 0
      ? options.penaltyMinPer100m
      : 10;

  const legs: ItineraryLeg[] = [
    {
      index: 0,
      lat: points[0]?.lat ?? 0,
      lon: points[0]?.lon ?? 0,
      ele: numberOrNull(points[0]?.ele),
      distance: 0,
      ascent: 0,
      descent: 0,
      seconds: 0,
      eta: localIso(new Date(startMs)),
    },
  ];

  let distance = 0;
  let ascent = 0;
  let descent = 0;
  let seconds = 0;

  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const current = points[i];
    const step = haversine(prev, current);
    const dz = numberOrNull(current.ele) != null && numberOrNull(prev.ele) != null
      ? (current.ele as number) - (prev.ele as number)
      : 0;
    if (dz > 0) ascent += dz;
    else descent -= dz;

    const hours = step / 1000 / kmh + (naismith ? (Math.max(0, dz) / 100) * (penaltyMinPer100m / 60) : 0);
    distance += step;
    seconds += hours * 3600;

    legs.push({
      index: i,
      lat: current.lat,
      lon: current.lon,
      ele: numberOrNull(current.ele),
      distance,
      ascent,
      descent,
      seconds,
      eta: localIso(new Date(startMs + seconds * 1000)),
    });
  }

  const total = { distance, ascent, descent, seconds };
  return { legs, samples: pickSamples(legs, options.maxSamples ?? 10), total };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Evenly spaced legs by cumulative distance, always keeping the endpoints. */
export function pickSamples(legs: ItineraryLeg[], maxSamples: number): ItinerarySample[] {
  if (!legs.length) return [];
  const count = Math.max(2, Math.min(maxSamples, legs.length));
  if (legs.length <= count) return legs.map((leg, i) => ({ ...leg, number: i + 1 }));

  const total = legs[legs.length - 1].distance;
  const picked: ItineraryLeg[] = [legs[0]];
  for (let k = 1; k < count - 1; k += 1) {
    const target = (total * k) / (count - 1);
    let best = legs[0];
    let bestDiff = Infinity;
    for (const leg of legs) {
      const diff = Math.abs(leg.distance - target);
      if (diff < bestDiff) {
        best = leg;
        bestDiff = diff;
      }
    }
    if (picked[picked.length - 1].index !== best.index) picked.push(best);
  }
  const last = legs[legs.length - 1];
  if (picked[picked.length - 1].index !== last.index) picked.push(last);
  return picked.map((leg, i) => ({ ...leg, number: i + 1 }));
}

export function trackBounds(points: { lat: number; lon: number }[]): Bounds | null {
  if (!points.length) return null;
  let west = points[0].lon;
  let east = points[0].lon;
  let south = points[0].lat;
  let north = points[0].lat;
  for (const point of points) {
    west = Math.min(west, point.lon);
    east = Math.max(east, point.lon);
    south = Math.min(south, point.lat);
    north = Math.max(north, point.lat);
  }
  return { west, south, east, north };
}

export function padBounds(bounds: Bounds, fraction = 0.15): Bounds {
  const dx = Math.max(0.005, (bounds.east - bounds.west) * fraction);
  const dy = Math.max(0.005, (bounds.north - bounds.south) * fraction);
  return {
    west: bounds.west - dx,
    east: bounds.east + dx,
    south: bounds.south - dy,
    north: bounds.north + dy,
  };
}

/** Ray casting on a single ring; returns true when the point is inside. */
export function pointInRing(lat: number, lon: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function pointInPolygonGeometry(
  lat: number,
  lon: number,
  geometry: { type: string; coordinates: unknown }
): boolean {
  if (geometry.type === "Polygon") {
    const rings = geometry.coordinates as [number, number][][];
    if (!rings?.length) return false;
    return pointInRing(lat, lon, rings[0]);
  }
  if (geometry.type === "MultiPolygon") {
    const polygons = geometry.coordinates as [number, number][][][];
    return polygons.some((rings) => rings.length > 0 && pointInRing(lat, lon, rings[0]));
  }
  return false;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!hours) return `${minutes} min`;
  if (!minutes) return `${hours} h`;
  return `${hours} h ${minutes} min`;
}

export function formatDistance(metres: number): string {
  if (!Number.isFinite(metres)) return "—";
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(1).replace(".", ",")} km`;
}

export type AvalancheDanger = { level: number; label: string; short: string; color: string; note: string };

/** ICGC slope classification used by the `class_pendents` WMS layer. */
export type AvalancheSlopeClass = { id: string; label: string; range: string; color: string };

export const AVALANCHE_SLOPES: AvalancheSlopeClass[] = [
  { id: "propici", label: "Propicis", range: "28–35°", color: "#ff6600" },
  { id: "molt", label: "Molt propicis", range: "35–45°", color: "#cc0000" },
  { id: "poc", label: "Poc propicis", range: ">45°", color: "#660099" },
];

/** EAWS danger scale used by the ICGC bulletin. Level 0 means "no bulletin issued". */
export const AVALANCHE_DANGER: AvalancheDanger[] = [
  { level: 0, label: "Sense butlletí", short: "—", color: "#9a9898", note: "Fora de temporada o sense dades" },
  { level: 1, label: "Feble", short: "1", color: "#59a14f", note: "Allaus naturals grans són improbables" },
  { level: 2, label: "Moderat", short: "2", color: "#f2c94c", note: "Allaus naturals grans possibles en zones molt inclinades" },
  { level: 3, label: "Marcat", short: "3", color: "#f29b38", note: "Allaus naturals i accidentals probables" },
  { level: 4, label: "Fort", short: "4", color: "#e4572e", note: "Allaus naturals i accidentals molt probables" },
  { level: 5, label: "Molt fort", short: "5", color: "#b3261e", note: "Allaus grans i nombroses, sovint fins al fons de vall" },
];

export function dangerMeta(level: number | null | undefined): AvalancheDanger {
  return AVALANCHE_DANGER.find((d) => d.level === (level ?? 0)) ?? AVALANCHE_DANGER[0];
}

export const ICGC_AVALANCHE_WMS = "https://geoserveis.icgc.cat/servei/catalunya/nivoallaus/wms";

/**
 * Raster tile URL for an ICGC avalanche WMS layer (`class_pendents`,
 * `zonesnivoclima`, ...). MapLibre fills `{bbox-epsg-3857}` per tile.
 */
export function icgcWmsTileUrl(layer: string): string {
  // Built by hand: URLSearchParams would percent-encode the `{bbox-epsg-3857}`
  // placeholder, and MapLibre then would not substitute it per tile.
  const params = [
    "service=WMS",
    "version=1.3.0",
    "request=GetMap",
    `layers=${encodeURIComponent(layer)}`,
    "styles=",
    "format=image%2Fpng",
    "transparent=true",
    "crs=EPSG%3A3857",
    "width=256",
    "height=256",
    "bbox={bbox-epsg-3857}",
  ].join("&");
  return `${ICGC_AVALANCHE_WMS}?${params}`;
}

/** Snow-fraction colour ramp; must stay in sync with pipeline/fetch_snow.py. */
export type SnowCoverStop = { value: number; label: string; color: string };

export const SNOW_COVER_STOPS: SnowCoverStop[] = [
  { value: 1, label: "1 %", color: "#a8d0f2" },
  { value: 25, label: "25 %", color: "#96d2f5" },
  { value: 50, label: "50 %", color: "#56a8e0" },
  { value: 75, label: "75 %", color: "#2a70be" },
  { value: 100, label: "100 %", color: "#123c8c" },
];

export const CLMS_SNOW_ATTRIBUTION = "© Unió Europea, Copernicus Land Monitoring Service";
export const CLMS_SNOW_URL = "https://land.copernicus.eu/en/products/snow";

/** One published day of the snow overlay (the slider walks this list). */
export type SnowCoverDay = {
  /** `YYYY-MM-DD`. */
  date: string;
  /** `/static/snow/<product>-<date>.png`. */
  image: string;
  /** True when the product had no observed snow that day. */
  empty: boolean;
};

/** Daily snow overlay metadata, served by `/v1/api/mountain/snow`. */
export type SnowCoverIndex = {
  available?: boolean;
  product: "SCE" | "GFSC";
  source: string;
  attribution: string;
  url: string;
  date: string;
  generated_at: string;
  bounds: Bounds;
  file: string;
  image: string;
  width: number;
  height: number;
  unit: string;
  empty: boolean;
  /** Oldest first; `date`/`image` above point at the newest day with snow. */
  days?: SnowCoverDay[];
};
