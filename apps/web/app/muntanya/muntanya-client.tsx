"use client";

import {
  CheckCircle2,
  CloudLightning,
  CloudRain,
  CloudUpload,
  Droplets,
  Eye,
  FileUp,
  Gauge,
  MountainSnow,
  Snowflake,
  Thermometer,
  ThermometerSnowflake,
  TriangleAlert,
  Wind,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppHeader, BottomNav } from "@/components/header";
import { Footer } from "@/components/footer";
import { selectionStyle } from "@/components/selection";
import { WeatherIcon, weatherLabel } from "@/components/weather-icon";
import { MountainMap, type AvalancheZoneFeature } from "@/components/mountain/mountain-map";
import { parseGpx, type ParsedGpx } from "@/lib/gpx";
import {
  AVALANCHE_DANGER,
  MOUNTAIN_ACTIVITIES,
  buildItinerary,
  compassName,
  dangerMeta,
  fmtHour,
  formatDistance,
  formatDuration,
  isoDay,
  pointInPolygonGeometry,
  weekdayShort,
  type ItineraryLeg,
  type ItinerarySample,
} from "@meteozini/core";

type HourlyRow = {
  time: string;
  temperature: number | null;
  apparentTemperature: number | null;
  precipitation: number | null;
  precipitationProbability: number | null;
  weathercode: number | null;
  windSpeed: number | null;
  windGusts: number | null;
  windDirection: number | null;
  cloudcover: number | null;
  freezingLevel: number | null;
  snowfall: number | null;
  snowDepth: number | null;
  visibility: number | null;
  isDay: number | null;
};

type PointForecast = { latitude: number; longitude: number; elevation: number | null; hourly: HourlyRow[] };

type BpaProblem = { type: string; size: number | null; trend: number | null; priority: number | null };

type BpaZone = {
  id: string;
  name: string;
  danger: number;
  secondary: number | null;
  issued: string | null;
  validUntil: string | null;
  bulletin: string | null;
  snowpack: string | null;
  distribution: string | null;
  trend: string | null;
  note: string | null;
  footer: string | null;
  problems: BpaProblem[];
};

type BpaResponse = { date: string; validUntil?: string | null; zones: BpaZone[]; warning?: string };

type ZoneCollection = {
  type: "FeatureCollection";
  features: { type: "Feature"; properties: { id: string; name: string }; geometry: { type: string; coordinates: unknown } }[];
};

function round(value: number | null | undefined, unit = "") {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Math.round(value)}${unit}`;
}

function decimal(value: number | null | undefined, unit = "") {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(1).replace(".", ",")}${unit}`;
}

/** Closest forecast hour at or after the arrival time, or null when it falls outside the run. */
function rowAt(hourly: HourlyRow[], eta: string): HourlyRow | null {
  if (!hourly.length) return null;
  const target = Date.parse(eta);
  const first = Date.parse(hourly[0].time);
  const last = Date.parse(hourly[hourly.length - 1].time);
  if (!Number.isFinite(target) || target < first || target > last + 3_600_000) return null;
  let previous: HourlyRow | null = null;
  for (const row of hourly) {
    const stamp = Date.parse(row.time);
    if (!Number.isFinite(stamp)) continue;
    if (stamp >= target) return row;
    previous = row;
  }
  return previous;
}

type WarningKind = "wind" | "rain" | "snow" | "storm" | "cold" | "heat" | "visibility";

type RowWarning = { kind: WarningKind; label: string; detail: string; severity: 1 | 2 };

/** Route weather alerts derived from one hourly forecast row. */
function warningsForRow(row: HourlyRow, ele: number | null): RowWarning[] {
  const out: RowWarning[] = [];
  const gust = row.windGusts;
  const wind = row.windSpeed;
  if (gust != null && gust >= 60) {
    out.push({ kind: "wind", label: "Ratxes fortes", detail: `${round(gust)} km/h`, severity: gust >= 90 ? 2 : 1 });
  } else if (wind != null && wind >= 40) {
    out.push({ kind: "wind", label: "Vent fort", detail: `${round(wind)} km/h`, severity: wind >= 60 ? 2 : 1 });
  }

  const rain = row.precipitation ?? 0;
  const probability = row.precipitationProbability ?? 0;
  if (rain >= 6 || (rain >= 4 && probability >= 80)) {
    out.push({ kind: "rain", label: "Pluja intensa", detail: `${decimal(rain, " mm/h")} · ${round(probability, "%")}`, severity: 2 });
  } else if (rain >= 2 && probability >= 60) {
    out.push({ kind: "rain", label: "Pluja", detail: `${decimal(rain, " mm/h")} · ${round(probability, "%")}`, severity: 1 });
  }

  const snow = row.snowfall ?? 0;
  if (snow >= 3) {
    out.push({ kind: "snow", label: "Neu abundant", detail: `${decimal(snow, " cm/h")}`, severity: 2 });
  } else if (snow >= 1) {
    out.push({ kind: "snow", label: "Neu", detail: `${decimal(snow, " cm/h")}`, severity: 1 });
  }

  if (row.freezingLevel != null && ele != null) {
    if (row.freezingLevel <= ele - 300) {
      out.push({
        kind: "snow",
        label: "Cota de neu molt per sota la ruta",
        detail: `${round(row.freezingLevel, " m")} · ruta ${round(ele, " m")}`,
        severity: 2,
      });
    } else if (row.freezingLevel <= ele) {
      out.push({
        kind: "snow",
        label: "Cota de neu per sota la ruta",
        detail: `${round(row.freezingLevel, " m")} · ruta ${round(ele, " m")}`,
        severity: 1,
      });
    }
  }

  if (row.visibility != null) {
    if (row.visibility < 1000) out.push({ kind: "visibility", label: "Visibilitat molt baixa", detail: round(row.visibility, " m"), severity: 2 });
    else if (row.visibility < 4000) out.push({ kind: "visibility", label: "Visibilitat reduïda", detail: round(row.visibility, " m"), severity: 1 });
  }

  const code = row.weathercode ?? 0;
  if (code >= 95) {
    out.push({ kind: "storm", label: "Tempesta", detail: weatherLabel(code), severity: 2 });
  } else if (code === 66 || code === 67) {
    out.push({ kind: "storm", label: "Pluja gelada", detail: weatherLabel(code), severity: 1 });
  }

  const feels = row.apparentTemperature;
  if (feels != null) {
    if (feels <= -12) out.push({ kind: "cold", label: "Fred extrem", detail: round(feels, "°C"), severity: 2 });
    else if (feels <= -5) out.push({ kind: "cold", label: "Fred intens", detail: round(feels, "°C"), severity: 1 });
    else if (feels >= 34) out.push({ kind: "heat", label: "Calor extrema", detail: round(feels, "°C"), severity: 2 });
    else if (feels >= 28) out.push({ kind: "heat", label: "Calor", detail: round(feels, "°C"), severity: 1 });
  }

  return out;
}

export type RouteWarning = {
  point: number;
  kind: WarningKind;
  label: string;
  detail: string;
  severity: 1 | 2;
  start: string;
  end: string;
  /** Whether the predicted arrival hour itself is inside this warning's time span. */
  atEta: boolean;
};

/**
 * Warnings for every GPX sample point across the route timeframe. Every forecast
 * hour in that window is checked, not only the hour closest to the predicted ETA,
 * so a storm that arrives earlier or later still shows up.
 */
function buildRouteWarnings(samples: ItinerarySample[], weather: PointForecast[] | null): RouteWarning[] {
  if (!samples.length || !weather?.length) return [];
  const startMs = Date.parse(samples[0].eta);
  const endMs = Date.parse(samples[samples.length - 1].eta);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return [];
  const from = startMs - 3_600_000;
  const to = endMs + 3_600_000;

  const out: RouteWarning[] = [];
  samples.forEach((sample, index) => {
    const point = weather[index];
    if (!point?.hourly?.length) return;
    const etaRow = rowAt(point.hourly, sample.eta);
    const etaMs = etaRow ? Date.parse(etaRow.time) : NaN;

    const runs = new Map<WarningKind, { severity: 1 | 2; label: string; detail: string; start: string; end: string; lastMs: number }[]>();
    const rows = [...point.hourly].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
    for (const row of rows) {
      const stamp = Date.parse(row.time);
      if (!Number.isFinite(stamp) || stamp < from || stamp > to) continue;
      for (const warning of warningsForRow(row, sample.ele)) {
        const list = runs.get(warning.kind) ?? [];
        const last = list[list.length - 1];
        if (last && stamp - last.lastMs <= 3_600_000 + 60_000) {
          last.end = row.time;
          last.lastMs = stamp;
          if (warning.severity > last.severity) {
            last.severity = warning.severity;
            last.label = warning.label;
            last.detail = warning.detail;
          }
        } else {
          list.push({ ...warning, start: row.time, end: row.time, lastMs: stamp });
          runs.set(warning.kind, list);
        }
      }
    }

    for (const [kind, list] of runs) {
      for (const run of list) {
        const start = Date.parse(run.start);
        const end = Date.parse(run.end);
        out.push({
          point: sample.number,
          kind,
          label: run.label,
          detail: run.detail,
          severity: run.severity,
          start: run.start,
          end: run.end,
          atEta: Number.isFinite(etaMs) && etaMs >= start && etaMs <= end,
        });
      }
    }
  });

  return out.sort(
    (a, b) => b.severity - a.severity || Date.parse(a.start) - Date.parse(b.start) || a.point - b.point
  );
}

const WARNING_ICONS: Record<WarningKind, typeof Wind> = {
  wind: Wind,
  rain: CloudRain,
  snow: Snowflake,
  storm: CloudLightning,
  cold: ThermometerSnowflake,
  heat: Thermometer,
  visibility: Eye,
};

function warningRange(warning: RouteWarning) {
  return warning.start === warning.end
    ? fmtHour(warning.start)
    : `${fmtHour(warning.start)}–${fmtHour(warning.end)}`;
}

function ElevationProfile({ legs, samples }: { legs: ItineraryLeg[]; samples: ItinerarySample[] }) {
  const raw = legs.filter((leg) => leg.ele != null);
  if (raw.length < 2) {
    return (
      <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
        El fitxer no porta dades d&apos;altitud, així que no es pot dibuixar el perfil.
      </p>
    );
  }
  // Long recorded tracks can carry tens of thousands of points; keep the SVG light.
  const stride = Math.max(1, Math.floor(raw.length / 400));
  const points = raw.filter((_, i) => i % stride === 0 || i === raw.length - 1);

  const W = 800;
  const H = 160;
  const padL = 38;
  const padR = 12;
  const padT = 12;
  const padB = 22;
  const elevs = points.map((p) => p.ele as number);
  const min = Math.floor(Math.min(...elevs) / 100) * 100;
  const max = Math.ceil(Math.max(...elevs) / 100) * 100;
  const total = Math.max(1, points[points.length - 1].distance);
  const x = (distance: number) => padL + (distance / total) * (W - padL - padR);
  const y = (ele: number) => padT + (1 - (ele - min) / Math.max(1, max - min)) * (H - padT - padB);

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.distance).toFixed(1)},${y(p.ele as number).toFixed(1)}`).join("");
  const area = `${line}L${x(total).toFixed(1)},${H - padB}L${padL},${H - padB}Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Perfil d'altitud del recorregut">
      {[min, Math.round((min + max) / 2), max].map((value) => (
        <g key={value}>
          <line x1={padL} x2={W - padR} y1={y(value)} y2={y(value)} stroke="var(--border)" strokeWidth={0.5} opacity={0.6} />
          <text x={padL - 5} y={y(value) + 3} textAnchor="end" fontSize={8} fill="var(--muted-foreground)">
            {value} m
          </text>
        </g>
      ))}
      <path d={area} fill="var(--accent-soft)" stroke="none" />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth={1.6} strokeLinejoin="round" />
      {samples.map((sample) => {
        if (sample.ele == null) return null;
        return (
          <g key={sample.index}>
            <circle cx={x(sample.distance)} cy={y(sample.ele)} r={3.6} fill="var(--foreground)" stroke="var(--card)" strokeWidth={1.2}>
              <title>{`#${sample.number} · ${fmtHour(sample.eta)} · ${Math.round(sample.ele)} m`}</title>
            </circle>
            <text x={x(sample.distance)} y={y(sample.ele) - 7} textAnchor="middle" fontSize={8} fontWeight={600} fill="var(--foreground)">
              {sample.number}
            </text>
          </g>
        );
      })}
      <text x={padL} y={H - 6} fontSize={8} fill="var(--muted-foreground)">
        0 km
      </text>
      <text x={W - padR} y={H - 6} textAnchor="end" fontSize={8} fill="var(--muted-foreground)">
        {formatDistance(total)}
      </text>
    </svg>
  );
}

function DangerBadge({ level, className = "" }: { level: number; className?: string }) {
  const meta = dangerMeta(level);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-semibold ${className}`}
      style={{ backgroundColor: meta.color, color: level >= 2 && level <= 3 ? "#201d1d" : "#ffffff" }}
    >
      <span className="grid h-4 w-4 place-items-center rounded-full bg-white/25 font-mono text-[10px] font-bold">
        {meta.short}
      </span>
      {meta.label}
    </span>
  );
}

export default function MuntanyaPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [gpx, setGpx] = useState<ParsedGpx | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Computed after mount so the statically rendered HTML does not freeze the build date.
  const [today, setToday] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("08:00");
  const [activityId, setActivityId] = useState("senderisme");
  const [speedInput, setSpeedInput] = useState(String(MOUNTAIN_ACTIVITIES[1].kmh));
  const [penaltyInput, setPenaltyInput] = useState("10");

  const [weather, setWeather] = useState<PointForecast[] | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherModel, setWeatherModel] = useState<string>("");

  const [bulletin, setBulletin] = useState<BpaResponse | null>(null);
  const [zoneCollection, setZoneCollection] = useState<ZoneCollection | null>(null);

  const [showSlopes, setShowSlopes] = useState(true);
  const [showZones, setShowZones] = useState(true);

  const speedKmh = Number.parseFloat(speedInput.replace(",", "."));
  const penaltyMinPer100m = Number.parseFloat(penaltyInput.replace(",", "."));

  const itinerary = useMemo(() => {
    if (!gpx) return null;
    return buildItinerary(gpx.points, {
      start: new Date(`${date}T${time}:00`),
      kmh: Number.isFinite(speedKmh) && speedKmh > 0 ? speedKmh : 4,
      model: "naismith",
      penaltyMinPer100m: Number.isFinite(penaltyMinPer100m) && penaltyMinPer100m >= 0 ? penaltyMinPer100m : 0,
      maxSamples: 10,
    });
  }, [gpx, date, time, speedKmh, penaltyMinPer100m]);

  const samples = itinerary?.samples ?? [];

  const elevationRange = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const leg of itinerary?.legs ?? []) {
      if (leg.ele == null) continue;
      min = Math.min(min, leg.ele);
      max = Math.max(max, leg.ele);
    }
    return min <= max ? { min, max } : null;
  }, [itinerary]);

  const pointsKey = useMemo(
    () => samples.map((s) => `${s.lat.toFixed(4)},${s.lon.toFixed(4)}`).join(";"),
    [samples]
  );

  const coverage = useMemo(() => {
    const hours = weather?.[0]?.hourly;
    if (!hours?.length) return null;
    return { start: hours[0].time, end: hours[hours.length - 1].time };
  }, [weather]);

  const routeWarnings = useMemo(() => buildRouteWarnings(samples, weather), [samples, weather]);

  const outsideForecast = Boolean(
    coverage && samples.some((sample) => sample.eta < coverage.start || sample.eta > coverage.end)
  );

  useEffect(() => {
    const day = isoDay(new Date());
    setToday(day);
    setDate((current) => current || day);
  }, []);

  useEffect(() => {
    if (!pointsKey) return;
    let cancelled = false;
    setWeatherLoading(true);
    setWeather(null);
    fetch(`/api/mountain/weather?points=${pointsKey}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { points?: PointForecast[]; model?: string } | null) => {
        if (cancelled) return;
        setWeather(data?.points ?? []);
        setWeatherModel(data?.model ?? "");
      })
      .catch(() => !cancelled && setWeather([]))
      .finally(() => !cancelled && setWeatherLoading(false));
    return () => {
      cancelled = true;
    };
  }, [pointsKey]);

  useEffect(() => {
    fetch("/api/mountain/avalanche/zones")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: ZoneCollection | null) => data?.features && setZoneCollection(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const target = date > today ? today : date;
    let cancelled = false;
    fetch(`/api/mountain/avalanche/bpa?date=${target}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: BpaResponse | null) => !cancelled && setBulletin(data))
      .catch(() => !cancelled && setBulletin(null));
    return () => {
      cancelled = true;
    };
  }, [date, today]);

  const dangerByZone = useMemo(() => {
    const map: Record<string, number> = {};
    for (const zone of bulletin?.zones ?? []) map[zone.id] = zone.danger;
    return map;
  }, [bulletin]);

  const mapZones: AvalancheZoneFeature[] | null = useMemo(() => {
    if (!zoneCollection) return null;
    return zoneCollection.features.map((feature) => ({
      type: "Feature",
      properties: {
        id: feature.properties.id,
        name: feature.properties.name,
        danger: dangerByZone[feature.properties.id] ?? 0,
      },
      geometry: feature.geometry,
    }));
  }, [zoneCollection, dangerByZone]);

  const matchedZones = useMemo(() => {
    if (!gpx || !zoneCollection || !bulletin?.zones.length) return [];
    const step = Math.max(1, Math.floor(gpx.points.length / 300));
    const byId = new Map(bulletin.zones.map((zone) => [zone.id, zone]));
    const matched: BpaZone[] = [];
    for (const feature of zoneCollection.features) {
      const zone = byId.get(feature.properties.id);
      if (!zone) continue;
      const inside = gpx.points.some(
        (point, i) => i % step === 0 && pointInPolygonGeometry(point.lat, point.lon, feature.geometry)
      );
      if (inside) matched.push(zone);
    }
    return matched.sort((a, b) => b.danger - a.danger);
  }, [gpx, zoneCollection, bulletin]);

  const showSlopeZoneWarning = matchedZones.some((zone) => zone.danger >= 3);

  const loadFile = async (file: File) => {
    if (!/\.gpx$/i.test(file.name)) {
      setError("El fitxer ha de tenir extensió .gpx.");
      return;
    }
    try {
      const parsed = parseGpx(await file.text(), file.name);
      if (!parsed) {
        setError("No s'ha trobat cap recorregut utilitzable dins del GPX.");
        return;
      }
      setError(null);
      setGpx(parsed);
      setFileName(file.name);
      setWeather(null);
    } catch {
      setError("No s'ha pogut llegir el fitxer.");
    }
  };

  const reset = () => {
    setGpx(null);
    setFileName("");
    setWeather(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const total = itinerary?.total;

  return (
    <div className="flex min-h-screen flex-col" style={{ backgroundColor: "var(--background)" }}>
      <AppHeader />
      <main className="page-shell flex-1 py-4 pb-24 md:py-6 lg:pb-8">
        <div className="mx-auto max-w-5xl space-y-3">
          <header className="space-y-1">
            <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
              Planifica una sortida a la muntanya
            </h1>
            <p className="max-w-2xl text-xs leading-relaxed sm:text-sm" style={{ color: "var(--muted-foreground)" }}>
              Carrega un recorregut GPX i mira la previsió punt a punt segons l&apos;hora de sortida i el ritme, amb el
              perill d&apos;allaus que publica l&apos;ICGC per al Pirineu.
            </p>
          </header>

          <section className="card p-3 sm:p-4">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const file = e.dataTransfer.files?.[0];
                if (file) void loadFile(file);
              }}
              className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed px-4 py-7 text-center"
              style={{
                borderColor: dragOver ? "var(--accent)" : "var(--border)",
                backgroundColor: dragOver ? "var(--accent-soft)" : "transparent",
              }}
            >
              <CloudUpload className="h-6 w-6" style={{ color: "var(--muted-foreground)" }} />
              <p className="text-sm font-semibold">Arrossega el GPX aquí</p>
              <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                o tria&apos;l des del dispositiu. El fitxer es queda al navegador: només s&apos;envien les
                coordenades dels punts de mostra per demanar la previsió.
              </p>
              <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-white"
                  style={{ backgroundColor: "var(--accent)" }}
                >
                  <FileUp className="h-3.5 w-3.5" />
                  Tria un fitxer
                </button>
                {gpx && (
                  <button
                    type="button"
                    onClick={reset}
                    className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <X className="h-3.5 w-3.5" />
                    Treu el fitxer
                  </button>
                )}
              </div>
              <input
                ref={inputRef}
                type="file"
                accept=".gpx,application/gpx+xml,application/xml,text/xml"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void loadFile(file);
                }}
              />
              {fileName && (
                <p className="mt-1 font-mono text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                  {fileName}
                </p>
              )}
            </div>
            {error && (
              <p className="mt-2 text-xs font-semibold" style={{ color: "var(--danger)" }}>
                {error}
              </p>
            )}
          </section>

          {gpx && itinerary && total && (
            <>
              <section className="card p-3 sm:p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="font-display text-lg font-bold">{gpx.name}</h2>
                    <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                      {gpx.source} · {gpx.points.length} punts
                      {elevationRange
                        ? ` · cota ${Math.round(elevationRange.min)}–${Math.round(elevationRange.max)} m`
                        : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      ["Distància", formatDistance(total.distance)],
                      ["Desnivell +", `${Math.round(total.ascent)} m`],
                      ["Desnivell −", `${Math.round(total.descent)} m`],
                      ["Durada", formatDuration(total.seconds)],
                      ["Arribada", fmtHour(new Date(Date.parse(itinerary.legs[itinerary.legs.length - 1].eta)))],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-lg px-2.5 py-1.5" style={{ backgroundColor: "var(--muted)" }}>
                        <div className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>
                          {label}
                        </div>
                        <div className="text-xs font-semibold">{value}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="text-xs">
                    <span className="mb-1 block font-semibold">Data de la sortida</span>
                    <input
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      className="h-9 w-full rounded-md px-2 text-[13px]"
                      style={{ backgroundColor: "var(--input-bg)", border: "1px solid var(--input-border)", color: "var(--foreground)" }}
                    />
                  </label>
                  <label className="text-xs">
                    <span className="mb-1 block font-semibold">Hora d&apos;inici</span>
                    <input
                      type="time"
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                      className="h-9 w-full rounded-md px-2 text-[13px]"
                      style={{ backgroundColor: "var(--input-bg)", border: "1px solid var(--input-border)", color: "var(--foreground)" }}
                    />
                  </label>
                </div>

                <div className="mt-3">
                  <div className="mb-1 text-xs font-semibold">Activitat</div>
                  <div role="radiogroup" aria-label="Activitat" className="flex flex-wrap gap-1.5">
                    {MOUNTAIN_ACTIVITIES.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        role="radio"
                        aria-checked={activityId === item.id}
                        onClick={() => {
                          setActivityId(item.id);
                          setSpeedInput(String(item.kmh));
                        }}
                        className="rounded-md border px-2.5 py-1.5 text-[11px] font-semibold"
                        style={selectionStyle(activityId === item.id)}
                      >
                        {item.label}
                        <span className="ml-1 font-mono font-normal opacity-70">{item.hint}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-3">
                  <div className="mb-1 text-xs font-semibold">Ritme</div>
                  <div className="grid gap-2 sm:max-w-md sm:grid-cols-2">
                    <label className="flex flex-col justify-end text-xs">
                      <span className="mb-1 block font-semibold">Velocitat (km/h)</span>
                      <input
                        type="number"
                        min={0.5}
                        max={20}
                        step={0.1}
                        inputMode="decimal"
                        value={speedInput}
                        onChange={(e) => setSpeedInput(e.target.value)}
                        aria-label="Velocitat en km/h"
                        className="h-9 w-full rounded-md px-2 text-[13px]"
                        style={{ backgroundColor: "var(--input-bg)", border: "1px solid var(--input-border)", color: "var(--foreground)" }}
                      />
                    </label>
                    <label className="flex flex-col justify-end text-xs">
                      <span className="mb-1 block font-semibold">Penalització (min/100 m)</span>
                      <input
                        type="number"
                        min={0}
                        max={120}
                        step={0.5}
                        inputMode="decimal"
                        value={penaltyInput}
                        onChange={(e) => setPenaltyInput(e.target.value)}
                        aria-label="Penalització per cada 100 metres de pujada, en minuts"
                        className="h-9 w-full rounded-md px-2 text-[13px]"
                        style={{ backgroundColor: "var(--input-bg)", border: "1px solid var(--input-border)", color: "var(--foreground)" }}
                      />
                    </label>
                  </div>
                  <p className="mt-1 text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                    La penalització només compta el desnivell positiu; 0 calcula només amb la distància. Escollir una
                    activitat ajusta la velocitat.
                  </p>
                </div>
              </section>

              <section className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-display text-lg font-bold">Recorregut i allaus</h2>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { on: showSlopes, label: "Pendents d'allaus", set: setShowSlopes },
                      { on: showZones, label: "Zones de perill", set: setShowZones },
                    ].map((toggle) => (
                      <button
                        key={toggle.label}
                        type="button"
                        role="switch"
                        aria-checked={toggle.on}
                        onClick={() => toggle.set(!toggle.on)}
                        className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-semibold"
                        style={selectionStyle(toggle.on)}
                      >
                        <MountainSnow className="h-3.5 w-3.5" />
                        {toggle.label}
                      </button>
                    ))}
                  </div>
                </div>
                <MountainMap
                  track={gpx.points}
                  samples={samples.map((s) => ({ number: s.number, lat: s.lat, lon: s.lon }))}
                  zones={mapZones}
                  showSlopes={showSlopes}
                  showZones={showZones}
                />
                <p className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>
                  Pendents: classificació de zones de sortida d&apos;allaus de l&apos;ICGC (28–35° propici, 35–45° molt
                  propici, &gt;45° poc propici). Les zones discontínues són les zones nivoclimàtiques del butlletí.
                </p>
              </section>

              <section className="card p-3 sm:p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="flex items-center gap-1.5 font-display text-lg font-bold">
                    <TriangleAlert className="h-4 w-4" style={{ color: dangerMeta(matchedZones[0]?.danger).color }} />
                    Perill d&apos;allaus
                  </h2>
                  <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                    {bulletin?.date ? `Butlletí del ${bulletin.date.split("-").reverse().join("/")}` : "Sense butlletí"}
                    {bulletin?.validUntil ? ` · vàlid fins ${bulletin.validUntil.split("-").reverse().join("/")}` : ""}
                  </span>
                </div>

                {date > today && (
                  <p className="mt-1 text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                    El butlletí només es publica cada dia: per a aquesta data encara no existeix. S&apos;ha consultat el
                    d&apos;avui; torna-hi el mateix dia de la sortida.
                  </p>
                )}

                {matchedZones.length === 0 && (
                  <div className="mt-2 rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: "var(--muted)" }}>
                    {bulletin?.warning
                      ? bulletin.warning
                      : "El recorregut no entra a cap de les zones amb butlletí d'allaus de l'ICGC (Pirineu). Si et mous per terreny nevós, consulta igualment el butlletí oficial."}
                  </div>
                )}

                {matchedZones.length > 0 && (
                  <div className="mt-2 space-y-2">
                    {showSlopeZoneWarning && (
                      <p className="rounded-lg px-3 py-2 text-xs font-semibold" style={{ backgroundColor: "var(--accent-soft)", color: "var(--accent-text)" }}>
                        Perill marcat o superior a la zona del recorregut: valora alternatives i consulta el butlletí
                        complet abans de sortir.
                      </p>
                    )}
                    {matchedZones.map((zone) => (
                      <article key={zone.id} className="rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h3 className="text-sm font-bold">{zone.name}</h3>
                          <DangerBadge level={zone.danger} />
                        </div>
                        <p className="mt-1 text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                          {dangerMeta(zone.danger).note}
                          {zone.secondary ? ` · perill secundari ${dangerMeta(zone.secondary).label.toLowerCase()}` : ""}
                        </p>
                        {zone.problems.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {zone.problems.map((problem, i) => (
                              <span
                                key={`${zone.id}-${i}`}
                                className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                                style={{ backgroundColor: "var(--muted)", color: "var(--foreground)" }}
                              >
                                {problem.type}
                                {problem.size ? ` · mida ${problem.size}/5` : ""}
                              </span>
                            ))}
                          </div>
                        )}
                        {zone.note && (
                          <p className="mt-2 whitespace-pre-line text-[11px] leading-relaxed">{zone.note.trim()}</p>
                        )}
                        {(zone.bulletin || zone.snowpack || zone.distribution || zone.trend) && (
                          <details className="mt-2">
                            <summary className="cursor-pointer text-[11px] font-semibold" style={{ color: "var(--accent-text)" }}>
                              Detalls del butlletí
                            </summary>
                            <div className="mt-1 space-y-1.5 text-[11px] leading-relaxed">
                              {zone.bulletin && <p className="whitespace-pre-line font-semibold">{zone.bulletin.trim()}</p>}
                              {zone.snowpack && <p className="whitespace-pre-line">{zone.snowpack.trim()}</p>}
                              {zone.distribution && <p className="whitespace-pre-line">{zone.distribution.trim()}</p>}
                              {zone.trend && <p className="whitespace-pre-line">{zone.trend.trim()}</p>}
                            </div>
                          </details>
                        )}
                      </article>
                    ))}
                  </div>
                )}

                <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]" style={{ color: "var(--muted-foreground)" }}>
                  <span className="flex flex-wrap items-center gap-1.5">
                    {AVALANCHE_DANGER.filter((d) => d.level > 0).map((d) => (
                      <span key={d.level} className="inline-flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: d.color }} />
                        {d.level} {d.label}
                      </span>
                    ))}
                  </span>
                  <a href="https://bpa.icgc.cat/" target="_blank" rel="noreferrer" className="font-semibold underline">
                    Butlletí oficial de l&apos;ICGC
                  </a>
                </div>
                <p className="mt-1 text-[10px]" style={{ color: "var(--muted-foreground)" }}>
                  El butlletí no és vàlid dins de pistes d&apos;esquí ni zones controlades. Porta sempre DVA, pala i sonda.
                </p>
              </section>

              {gpx && (
                <section className="card p-3 sm:p-4" aria-labelledby="route-warnings-title">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 id="route-warnings-title" className="font-display text-lg font-bold">
                      Avisos meteorològics
                    </h2>
                    <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                      Tots els punts del GPX · totes les hores del recorregut
                    </span>
                  </div>

                  {weatherLoading && (
                    <div className="mt-2 h-10 animate-pulse rounded" style={{ backgroundColor: "var(--muted)" }} />
                  )}

                  {!weatherLoading && weather && routeWarnings.length === 0 && (
                    <p
                      className="mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-[12px]"
                      style={{ backgroundColor: "var(--muted)" }}
                    >
                      <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: "var(--ok)" }} />
                      Cap avís rellevant per a les condicions previstes durant el recorregut.
                    </p>
                  )}

                  {!weatherLoading && routeWarnings.length > 0 && (
                    <>
                      <ul className="mt-2 space-y-1.5">
                        {routeWarnings.slice(0, 12).map((warning, i) => {
                          const Icon = WARNING_ICONS[warning.kind];
                          const color = warning.severity === 2 ? "var(--danger)" : "var(--warning)";
                          return (
                            <li
                              key={`${warning.point}-${warning.kind}-${warning.start}-${i}`}
                              className="flex items-start gap-2 rounded-lg border px-2.5 py-2"
                              style={{ borderColor: "var(--border)" }}
                            >
                              <Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color }} />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-baseline gap-x-2">
                                  <span className="text-[12px] font-semibold">{warning.label}</span>
                                  <span className="font-mono text-[10px]" style={{ color: "var(--muted-foreground)" }}>
                                    {warning.detail}
                                  </span>
                                </div>
                                <div
                                  className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px]"
                                  style={{ color: "var(--muted-foreground)" }}
                                >
                                  <span>Punt {warning.point}</span>
                                  <span className="font-mono">{warningRange(warning)}</span>
                                  {!warning.atEta && (
                                    <span className="rounded px-1.5 py-0.5" style={{ backgroundColor: "var(--muted)" }}>
                                      fora de l&apos;hora prevista
                                    </span>
                                  )}
                                </div>
                              </div>
                              <span className="shrink-0 text-[9px] font-bold uppercase" style={{ color }}>
                                {warning.severity === 2 ? "Important" : "Precaució"}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                      {routeWarnings.length > 12 && (
                        <p className="mt-1.5 text-[10px]" style={{ color: "var(--muted-foreground)" }}>
                          Es mostren els 12 avisos més rellevants de {routeWarnings.length}.
                        </p>
                      )}
                      <p className="mt-2 text-[10px] leading-relaxed" style={{ color: "var(--muted-foreground)" }}>
                        S&apos;analitzen totes les hores de previsió de cada punt del GPX dins la franja del recorregut,
                        encara que no coincideixin amb l&apos;hora prevista d&apos;arribada. És una ajuda orientativa:
                        consulta els avisos oficials.
                      </p>
                    </>
                  )}
                </section>
              )}

              <section className="card p-3 sm:p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-display text-lg font-bold">Previsió al llarg del recorregut</h2>
                  <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                    {weatherModel}
                    {weather && weather[0]?.elevation != null ? ` · model a ${Math.round(weather[0].elevation)} m` : ""}
                  </span>
                </div>

                {outsideForecast && coverage && (
                  <p className="mt-1 rounded-lg px-3 py-2 text-[11px]" style={{ backgroundColor: "var(--muted)" }}>
                    La previsió disponible va del {coverage.start.slice(0, 10).split("-").reverse().join("/")} al{" "}
                    {coverage.end.slice(0, 10).split("-").reverse().join("/")}. Els punts fora d&apos;aquest interval es
                    mostren amb guions.
                  </p>
                )}

                {weatherLoading && (
                  <div className="mt-2 space-y-1.5">
                    {samples.slice(0, 4).map((sample) => (
                      <div key={sample.index} className="h-9 animate-pulse rounded" style={{ backgroundColor: "var(--muted)" }} />
                    ))}
                  </div>
                )}

                {!weatherLoading && weather && (
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full min-w-[640px] border-collapse text-[11px]">
                      <thead>
                        <tr style={{ color: "var(--muted-foreground)" }}>
                          <th className="py-1 pr-2 text-left font-semibold">#</th>
                          <th className="py-1 pr-2 text-left font-semibold">Hora</th>
                          <th className="py-1 pr-2 text-left font-semibold">Cota</th>
                          <th className="py-1 pr-2 text-left font-semibold">Temps</th>
                          <th className="py-1 pr-2 text-right font-semibold">Temp.</th>
                          <th className="py-1 pr-2 text-right font-semibold">Vent</th>
                          <th className="py-1 pr-2 text-right font-semibold">Pluja</th>
                          <th className="py-1 pr-2 text-right font-semibold">Cota neu</th>
                        </tr>
                      </thead>
                      <tbody>
                        {samples.map((sample, i) => {
                          const point = weather[i];
                          const row = point ? rowAt(point.hourly, sample.eta) : null;
                          const snow = row?.freezingLevel != null && sample.ele != null && row.freezingLevel <= sample.ele;
                          return (
                            <tr key={sample.index} className="border-t" style={{ borderColor: "var(--border)" }}>
                              <td className="py-1.5 pr-2 font-mono font-bold">{sample.number}</td>
                              <td className="py-1.5 pr-2 whitespace-nowrap">
                                {fmtHour(sample.eta)}
                                <span className="ml-1" style={{ color: "var(--muted-foreground)" }}>
                                  {weekdayShort(sample.eta)}
                                </span>
                              </td>
                              <td className="py-1.5 pr-2 whitespace-nowrap">{sample.ele != null ? `${Math.round(sample.ele)} m` : "—"}</td>
                              <td className="py-1.5 pr-2">
                                <span className="inline-flex items-center gap-1">
                                  <WeatherIcon code={row?.weathercode} isDay={row?.isDay} className="h-3.5 w-3.5" />
                                  <span className="whitespace-nowrap">{weatherLabel(row?.weathercode)}</span>
                                  {snow && <Snowflake className="h-3 w-3" style={{ color: "var(--chart-cold)" }} aria-label="Possible neu a aquesta cota" />}
                                </span>
                              </td>
                              <td className="py-1.5 pr-2 text-right whitespace-nowrap">
                                {round(row?.temperature, "°")}
                                <span className="ml-1" style={{ color: "var(--muted-foreground)" }}>
                                  {round(row?.apparentTemperature, "°")}
                                </span>
                              </td>
                              <td className="py-1.5 pr-2 text-right whitespace-nowrap">
                                {round(row?.windSpeed)}
                                <span className="ml-1" style={{ color: "var(--muted-foreground)" }}>
                                  {round(row?.windGusts)}
                                </span>
                                <span className="ml-1" style={{ color: "var(--muted-foreground)" }}>
                                  {compassName(row?.windDirection)}
                                </span>
                              </td>
                              <td className="py-1.5 pr-2 text-right whitespace-nowrap">
                                {round(row?.precipitationProbability, "%")}
                                <span className="ml-1" style={{ color: "var(--muted-foreground)" }}>
                                  {decimal(row?.precipitation, " mm")}
                                </span>
                              </td>
                              <td className="py-1.5 pr-2 text-right whitespace-nowrap" style={{ color: snow ? "var(--chart-cold)" : undefined }}>
                                {row?.freezingLevel != null ? `${Math.round(row.freezingLevel)} m` : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="mt-2 flex flex-wrap gap-3 text-[10px]" style={{ color: "var(--muted-foreground)" }}>
                  <span className="inline-flex items-center gap-1">
                    <Wind className="h-3 w-3" /> vent mitjà / ratxa (km/h) i direcció
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Thermometer className="h-3 w-3" /> temperatura / sensació
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Droplets className="h-3 w-3" /> probabilitat / pluja
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Gauge className="h-3 w-3" /> cota de neu (nivell de congelació)
                  </span>
                </div>
              </section>

              <section className="card p-3 sm:p-4">
                <h2 className="font-display text-lg font-bold">Perfil del recorregut</h2>
                <ElevationProfile legs={itinerary.legs} samples={samples} />
                <p className="mt-1 text-[10px]" style={{ color: "var(--muted-foreground)" }}>
                  Els números coincideixen amb els punts de la taula i del mapa. Els temps són estimacions: ajusta el
                  ritme a la teva condició i a les condicions de la neu.
                </p>
              </section>
            </>
          )}

          <section className="card p-3 text-[11px] leading-relaxed sm:p-4" style={{ color: "var(--muted-foreground)" }}>
            <p>
              Aquesta planificació és orientativa. La previsió de muntanya canvia ràpid: revisa el butlletí i la
              predicció el mateix dia, i no surtis mai sol sense material de seguretat.
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              <Link href="/mapes" className="font-semibold underline">
                Mapes de previsió
              </Link>
              <Link href="/models" className="font-semibold underline">
                Comparar models
              </Link>
              <a
                href="https://www.icgc.cat/ca/Ambits-tematics/Riscos-i-emergencies/Allaus"
                target="_blank"
                rel="noreferrer"
                className="font-semibold underline"
              >
                Allaus a l&apos;ICGC
              </a>
            </p>
          </section>
        </div>
      </main>
      <Footer />
      <BottomNav />
    </div>
  );
}
