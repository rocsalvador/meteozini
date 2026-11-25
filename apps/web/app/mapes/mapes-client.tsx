"use client";

import { Pause, Play, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Waypoints } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppHeader, BottomNav } from "@/components/header";
import { Footer } from "@/components/footer";
import {
  VAR_META,
  type MapFrame,
  type MapsResponse,
  defaultFrameIndex,
  frameLongLabel,
  frameShortLabel,
} from "@meteozini/core";
import { variableIcon } from "@/components/map/layers-panel";
import { SpeedSelector, TimeSlider } from "@/components/map/timeline";
import { selectionStyle } from "@/components/selection";
import { CATALUNYA_BOUNDS, StaticWeatherMap } from "@/components/map/static-map";
import {
  MAP_MODELS,
  fetchModelGrid,
  gridResolution,
  modelGridGroups,
  modelGridImage,
  modelSupportsVariable,
  modelLabel,
  type ModelGrid,
} from "@/lib/model-grid";

type Section = "meso" | "obs";

const SECTION_CARDS = [
  { id: "meso" as const, label: "Mesoescala", sub: "AROME HD · Catalunya · 1,3 km" },
  { id: "obs" as const, label: "Observacions", sub: "Anàlisi · Catalunya · xarxes automàtiques" },
];

const MESO_FAMILIES = [
  { id: "surface", label: "Superfície", variables: ["temperature", "humidity", "pressure_msl"] },
  { id: "precipitation", label: "Precipitació", variables: ["precipitation", "precip_accum", "snow_precipitation", "snow_accum", "graupel"] },
  { id: "wind", label: "Vent", variables: ["wind_speed", "temp_wind"] },
  { id: "instability", label: "Inestabilitat", variables: ["cape"] },
];

const OBS_FAMILIES = [
  { id: "now", label: "Ara", variables: ["temperature", "humidity", "wind_speed", "wind_gust", "precipitation", "snow_level", "precipitation_type", "snow_depth"] },
  { id: "today", label: "Avui · fins ara", variables: ["temp_max", "temp_min", "humidity_min", "humidity_max", "wind_gust_max", "precip_daily", "snow_level_min", "temp_max_anomaly", "temp_min_anomaly"] },
  { id: "sea", label: "Mar · última nit", variables: ["sst", "sst_anomaly"] },
];

const SHORT_LABELS: Record<string, string> = {
  snow_precipitation: "Neu",
  graupel: "Calamarsa",
};

const TITLES: Record<string, string> = {
  temperature: "Temperatura a 2 m",
  temp_max: "Temperatura màxima",
  temp_min: "Temperatura mínima",
  humidity: "Humitat relativa",
  visibility: "Visibilitat",
  precipitation: "Precipitació 1 h",
  precip_accum: "Precipitació acumulada",
  snow_precipitation: "Neu 1 h",
  snow_accum: "Neu acumulada",
  snow_level: "Cota de neu",
  snow_depth: "Gruix de neu",
  graupel: "Calamarsa 1 h",
  precipitation_type: "Tipus de precipitació",
  wind_speed: "Vent mitjà a 10 m",
  wind_gust: "Ratxa màxima a 10 m",
  temp_wind: "Temperatura i vent",
  cape: "CAPE",
  humidity_min: "Humitat mínima",
  humidity_max: "Humitat màxima",
  wind_gust_max: "Ratxa màxima del dia",
  precip_daily: "Precipitació d'avui",
  snow_level_min: "Cota de neu mínima",
  temp_max_anomaly: "Anomalia de la màxima",
  temp_min_anomaly: "Anomalia de la mínima",
  sst: "Temperatura del mar",
  sst_anomaly: "Anomalia del mar",
};

function ColorLegend({ variable }: { variable: string }) {
  const meta = VAR_META[variable];
  if (!meta?.legend) return null;
  return (
    <div className="border-t px-3 py-2" style={{ borderColor: "var(--border)" }}>
      <div className="mb-1 flex items-center justify-between text-[11px] font-semibold">
        <span>{meta.label}</span>
        <span style={{ color: "var(--muted-foreground)" }}>{meta.unit}</span>
      </div>
      <div className="h-2.5 w-full rounded" style={{ background: meta.legend }} />
      {!meta.categorical && (
        <div className="relative mt-1 h-3 text-[9px]" style={{ color: "var(--muted-foreground)" }}>
          {meta.stops.map((stop, i) => {
            const p = meta.stopPositions?.[i] ?? (meta.stops.length > 1 ? i / (meta.stops.length - 1) : 0);
            const transform = i === 0 ? "none" : i === meta.stops.length - 1 ? "translateX(-100%)" : "translateX(-50%)";
            return (
              <span key={`${stop}-${i}`} className="absolute top-0 whitespace-nowrap" style={{ left: `${p * 100}%`, transform }}>
                {stop}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function labelFor(variable: string) {
  return TITLES[variable] ?? VAR_META[variable]?.label ?? variable;
}

export default function MapesPage() {
  const [section, setSection] = useState<Section>("meso");
  const [family, setFamily] = useState<string>("surface");
  const [variable, setVariable] = useState("temperature");
  const [mapModel, setMapModel] = useState("arome");
  const [modelGrid, setModelGrid] = useState<ModelGrid | null>(null);
  const [modelLoading, setModelLoading] = useState(false);
  const [arome, setArome] = useState<MapsResponse | null>(null);
  const [obs, setObs] = useState<MapsResponse | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const get = (url: string) =>
      fetch(url)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
    get("/up/api/arome/maps")
      .then((d) => d && setArome(d))
      .finally(() => setLoaded((l) => ({ ...l, meso: true })));
    get("/up/api/obs/maps")
      .then((d) => d && setObs(d))
      .finally(() => setLoaded((l) => ({ ...l, obs: true })));
  }, []);

  const gridMode = section === "meso" && mapModel !== "arome";
  const families = useMemo(
    () =>
      section === "meso"
        ? gridMode
          ? modelGridGroups(mapModel)
          : MESO_FAMILIES
        : OBS_FAMILIES,
    [section, gridMode, mapModel]
  );

  useEffect(() => {
    const fam = families.find((f) => f.id === family) ?? families[0];
    if (!fam.variables.includes(variable)) setVariable(fam.variables[0]);
  }, [families, family, variable]);

  // Gridded Open-Meteo model for the Mesoescala section.
  useEffect(() => {
    if (!gridMode || !modelSupportsVariable(mapModel, variable)) {
      setModelGrid(null);
      setModelLoading(false);
      return;
    }
    let cancelled = false;
    setModelGrid(null);
    setModelLoading(true);
    fetchModelGrid(mapModel, variable)
      .then((data) => {
        if (!cancelled) setModelGrid(data);
      })
      .finally(() => {
        if (!cancelled) setModelLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [gridMode, mapModel, variable]);

  const dataset = section === "meso" ? arome : obs;
  const modelFrames: MapFrame[] = useMemo(
    () =>
      modelGrid && modelGrid.variable === variable
        ? modelGrid.times.map((time, hour) => ({
            variable,
            hour,
            timestamp: time,
            valid_time: time,
            filepath: "",
            web_filepath: "",
            web_bounds: modelGrid.bounds,
          }))
        : [],
    [modelGrid, variable]
  );
  const frames: MapFrame[] = useMemo(
    () => (gridMode ? modelFrames : dataset?.maps?.[variable] ?? []),
    [gridMode, modelFrames, dataset, variable]
  );

  useEffect(() => {
    setIndex(defaultFrameIndex(frames, section === "obs" ? "obs" : "arome"));
    setPlaying(false);
  }, [frames, section]);

  useEffect(() => {
    if (!playing || frames.length <= 1) return;
    const id = setInterval(() => setIndex((i) => (i + 1 >= frames.length ? 0 : i + 1)), 900 / speed);
    return () => clearInterval(id);
  }, [playing, frames.length, speed]);

  const frame = frames[index] ?? null;
  const src = gridMode
    ? modelGrid && frame && modelGrid.hasData
      ? modelGridImage(modelGrid, index)
      : null
    : frame
      ? `/up${frame.filepath}`
      : null;
  const credit = (
    section === "meso"
      ? gridMode
        ? `${modelLabel(mapModel)} (${modelGrid?.source ?? "Open-Meteo"}, malla ${modelGrid ? gridResolution(modelGrid) : "…"}°). meteozini.`
        : "AROME HD 1.3 km (0.01°). Météo-France. meteozini."
      : dataset?.credit ?? "meteozini"
  ).replace(/tolemeteo\.cat/g, "meteozini");

  return (
    <div className="flex min-h-screen flex-col" style={{ backgroundColor: "var(--background)" }}>
      <AppHeader />
      <main className="page-shell flex-1 py-4 pb-24 md:py-6 lg:pb-8">
        <div className="mx-auto max-w-5xl space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="flex items-center gap-2 font-display text-2xl font-extrabold tracking-tight">
                <Waypoints className="h-6 w-6" style={{ color: "var(--accent)" }} />
                Mapes
              </h1>
              <p className="mt-0.5 text-sm" style={{ color: "var(--muted-foreground)" }}>
                Catalunya amb AROME HD i les observacions de les xarxes automàtiques.
              </p>
            </div>
            <a
              href="/"
              className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-white"
              style={{ backgroundColor: "var(--accent)" }}
            >
              Mapa interactiu
            </a>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            {SECTION_CARDS.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={section === s.id}
                onClick={() => {
                  setSection(s.id);
                  setFamily(s.id === "meso" ? "surface" : "now");
                }}
                className="rounded-xl border px-3 py-2.5 text-left transition-colors"
                style={{
                  borderColor: section === s.id ? "var(--accent)" : "var(--border)",
                  backgroundColor: section === s.id ? "var(--accent-soft)" : "var(--card)",
                }}
              >
                <div className="text-sm font-bold">{s.label}</div>
                <div className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                  {s.sub}
                </div>
              </button>
            ))}
          </div>

          {section === "meso" && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold" style={{ color: "var(--muted-foreground)" }}>
                Model
              </span>
              {MAP_MODELS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={mapModel === m.id}
                  onClick={() => {
                    setMapModel(m.id);
                    setFamily("surface");
                  }}
                  title={m.detail}
                  className="rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold"
                  style={selectionStyle(mapModel === m.id)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}

          <div role="tablist" aria-label="Família de variables" className="no-scrollbar flex gap-1 overflow-x-auto p-1">
            {families.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={family === f.id}
                onClick={() => setFamily(f.id)}
                className="shrink-0 rounded-lg border px-3 py-1.5 text-[12px] font-semibold"
                style={selectionStyle(family === f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1.5">
              {(families.find((f) => f.id === family)?.variables ?? []).map((v) => {
                const Icon = variableIcon(v);
                return (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={variable === v}
                    onClick={() => setVariable(v)}
                    className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold"
                    style={selectionStyle(variable === v)}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {SHORT_LABELS[v] ?? VAR_META[v]?.shortLabel ?? v}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border" style={{ borderColor: "var(--border)", backgroundColor: "var(--card)" }}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 text-xs" style={{ borderColor: "var(--border)" }}>
              <div className="font-semibold">{labelFor(variable)}</div>
              <div className="font-mono" style={{ color: "var(--muted-foreground)" }}>
                {frame ? `${frameLongLabel(frame.timestamp)} · H+${String(frame.hour).padStart(3, "0")}` : "—"}
              </div>
            </div>
            <div className="relative w-full" style={{ backgroundColor: "var(--card)" }}>
              {src ? (
                <StaticWeatherMap imageUrl={src} bounds={frame?.web_bounds ?? null} focusBounds={CATALUNYA_BOUNDS} />
              ) : (
                <div className="grid h-[46vh] place-items-center text-sm" style={{ color: "var(--muted-foreground)" }}>
                  {gridMode && modelLoading
                    ? "Carregant el model…"
                    : loaded[section] || (gridMode && modelGrid)
                      ? "Sense dades disponibles per a aquesta secció encara."
                      : "Carregant el mapa…"}
                </div>
              )}
            </div>
            {src && <ColorLegend variable={variable} />}
            {frames.length > 1 && (
              <div className="border-t px-3 pt-2" style={{ borderColor: "var(--border)" }}>
                <TimeSlider
                  times={frames.map((f) => f.timestamp)}
                  index={index}
                  count={frames.length}
                  onIndex={setIndex}
                  className=""
                />
              </div>
            )}
            <div className="flex flex-wrap items-center justify-center gap-1.5 border-t px-3 py-2" style={{ borderColor: "var(--border)" }}>
              <button type="button" aria-label="Primer fotograma" disabled={index <= 0} onClick={() => setIndex(0)} className="grid h-8 w-8 place-items-center rounded-full border disabled:opacity-35" style={{ borderColor: "var(--border)" }}>
                <ChevronsLeft className="h-4 w-4" />
              </button>
              <button type="button" aria-label="Fotograma anterior" disabled={index <= 0} onClick={() => setIndex(index - 1)} className="grid h-8 w-8 place-items-center rounded-full border disabled:opacity-35" style={{ borderColor: "var(--border)" }}>
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button type="button" aria-label={playing ? "Pausa" : "Reprodueix"} onClick={() => setPlaying((p) => !p)} disabled={frames.length <= 1} className="grid h-9 w-9 place-items-center rounded-full text-white disabled:opacity-35" style={{ backgroundColor: "var(--accent)" }}>
                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-px" />}
              </button>
              <button type="button" aria-label="Fotograma següent" disabled={index >= frames.length - 1} onClick={() => setIndex(index + 1)} className="grid h-8 w-8 place-items-center rounded-full border disabled:opacity-35" style={{ borderColor: "var(--border)" }}>
                <ChevronRight className="h-4 w-4" />
              </button>
              <button type="button" aria-label="Últim fotograma" disabled={index >= frames.length - 1} onClick={() => setIndex(frames.length - 1)} className="grid h-8 w-8 place-items-center rounded-full border disabled:opacity-35" style={{ borderColor: "var(--border)" }}>
                <ChevronsRight className="h-4 w-4" />
              </button>
              <span className="mx-1 font-mono text-[12px]">
                {frame ? frameShortLabel(frame.timestamp) : "—"}
              </span>
              <span className="font-mono text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                {frames.length ? `${index + 1}/${frames.length}` : ""}
              </span>
              <SpeedSelector speed={speed} onSpeed={setSpeed} disabled={frames.length <= 1} />
            </div>
            <div className="border-t px-3 py-2 text-[11px]" style={{ borderColor: "var(--border)", color: "var(--muted-foreground)" }}>
              {credit}
            </div>
          </div>
        </div>
      </main>
      <Footer />
      <BottomNav />
    </div>
  );
}
