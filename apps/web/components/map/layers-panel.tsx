"use client";

import {
  CloudRain,
  Droplets,
  Eye,
  Gauge,
  Layers,
  RefreshCw,
  Snowflake,
  Thermometer,
  Wind,
  X,
} from "lucide-react";
import { MAP_MODELS } from "@/lib/model-grid";
import { VAR_META } from "@meteozini/core";
import { selectionStyle } from "@/components/selection";

type Group = { id: string; label: string; variables: string[] };

export type MapOptions = {
  basemap: "clar" | "fosc" | "relleu" | "satellit" | "topo";
  windAnim: boolean;
  comarques: boolean;
  poblacions: boolean;
  peaks: boolean;
  values: boolean;
  hillshade: boolean;
  allow3d: boolean;
  avalancheSlopes: boolean;
  avalancheRisk: boolean;
  snowCover: boolean;
  opacity: number;
};

const BASEMAPS: { id: MapOptions["basemap"]; label: string }[] = [
  { id: "clar", label: "Clar" },
  { id: "fosc", label: "Fosc" },
  { id: "relleu", label: "Relleu" },
  { id: "satellit", label: "Satèl·lit" },
  { id: "topo", label: "Topogràfic" },
];

const WEATHER_SWITCHES: { key: keyof MapOptions; label: string }[] = [
  { key: "windAnim", label: "Animació del vent" },
  { key: "comarques", label: "Comarques" },
  { key: "poblacions", label: "Poblacions" },
  { key: "peaks", label: "Noms dels cims (des de prop)" },
  { key: "values", label: "Valors sobre el mapa" },
  { key: "hillshade", label: "Ombra del relleu" },
  { key: "allow3d", label: "3D (relleu i inclinació)" },
];

/** Mountain mode has no weather raster, so wind animation and value labels make no sense there. */
const MOUNTAIN_SWITCHES = WEATHER_SWITCHES.filter((s) => s.key !== "windAnim" && s.key !== "values");

export function variableIcon(variable: string) {
  if (variable.startsWith("temp")) return Thermometer;
  if (variable.startsWith("humidity")) return Droplets;
  if (variable.startsWith("wind") || variable === "temp_wind") return Gauge;
  if (variable.startsWith("precip") || variable.startsWith("graupel") || variable.startsWith("radar")) return CloudRain;
  if (variable.startsWith("snow")) return Snowflake;
  if (variable === "visibility") return Eye;
  if (variable === "cape") return Wind;
  return Layers;
}

export function LayersPanel({
  open,
  onClose,
  mode,
  model,
  onModel,
  gridMode = false,
  groups,
  variable,
  onSelect,
  options,
  setOptions,
  modelLabel,
  onRefresh,
}: {
  open: boolean;
  onClose: () => void;
  mode: "models" | "obs" | "muntanya";
  model: string;
  onModel: (id: string) => void;
  gridMode?: boolean;
  groups: Group[];
  variable: string;
  onSelect: (v: string) => void;
  options: MapOptions;
  setOptions: (patch: Partial<MapOptions>) => void;
  modelLabel: string;
  onRefresh: () => void;
}) {
  if (!open) return null;

  const mountain = mode === "muntanya";
  const switches = mountain
    ? MOUNTAIN_SWITCHES
    : gridMode
      ? WEATHER_SWITCHES.filter((item) => item.key !== "values")
      : WEATHER_SWITCHES;

  const renderSwitch = ({ key, label }: { key: keyof MapOptions; label: string }) => {
    const on = Boolean(options[key] as boolean);
    return (
      <button
        key={key}
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => setOptions({ [key]: !on } as Partial<MapOptions>)}
        className="flex w-full items-center justify-between gap-3 rounded-lg px-1 py-1.5 text-left text-[13px] hover:bg-black/5 dark:hover:bg-white/10"
      >
        <span>{label}</span>
        <span
          className="relative h-5 w-9 shrink-0 rounded-full transition-colors"
          style={{ backgroundColor: on ? "var(--accent)" : "var(--border)" }}
        >
          <span
            className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all"
            style={{ left: on ? 18 : 2 }}
          />
        </span>
      </button>
    );
  };

  return (
    <>
      <button
        type="button"
        aria-label="Tanca el menú"
        onClick={onClose}
        className="absolute inset-0 z-[60] bg-black/40"
      />
      <aside
        role="dialog"
        aria-label="Capes i vista del mapa"
        className="absolute right-2 top-2 z-[61] flex max-h-[calc(100%-16px)] w-[min(360px,calc(100vw-16px))] flex-col overflow-hidden rounded-md border sm:right-3"
        style={{ backgroundColor: "var(--card)", borderColor: "var(--border)", color: "var(--card-foreground)" }}
      >
        <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
          <h2 className="text-base font-bold">Capes</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tanca"
            className="grid h-8 w-8 place-items-center rounded hover:bg-[color:var(--muted)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {mountain && (
          <div className="border-b px-4 py-2 text-[11px] leading-relaxed" style={{ borderColor: "var(--border)", color: "var(--muted-foreground)" }}>
            Les capes de neu i allaus es controlen des de la llegenda del mapa.
          </div>
        )}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
          {(
            <>
              {mode === "models" && (
                <section>
                  <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>
                    Model
                  </h3>
                  <div role="radiogroup" aria-label="Model de previsió" className="grid grid-cols-2 gap-1.5">
                    {MAP_MODELS.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        role="radio"
                        aria-checked={model === item.id}
                        onClick={() => onModel(item.id)}
                        className="rounded-lg border px-2 py-1.5 text-left"
                        style={selectionStyle(model === item.id)}
                      >
                        <span className="block text-[12px] font-semibold">{item.label}</span>
                        <span className="block text-[10px]" style={{ color: model === item.id ? undefined : "var(--muted-foreground)" }}>
                          {item.detail}
                        </span>
                      </button>
                    ))}
                  </div>
                  {model !== "arome" && (
                    <p className="mt-1.5 text-[10px] leading-relaxed" style={{ color: "var(--muted-foreground)" }}>
                      Malla del model pintada al navegador. Menys detall que AROME, però permet comparar models al
                      mapa.
                    </p>
                  )}
                </section>
              )}

              {mountain ? (
                <p className="text-[11px] leading-relaxed" style={{ color: "var(--muted-foreground)" }}>
                  La vista Muntanya no superposa cap capa meteorològica: només el relleu i els punts que triïs.
                </p>
              ) : (
                groups.map((group) => (
                  <section key={group.id}>
                    <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>
                      {group.label}
                    </h3>
                    <div role="radiogroup" aria-label={group.label} className="space-y-0.5">
                      {group.variables.map((v) => {
                        const meta = VAR_META[v];
                        if (!meta) return null;
                        const Icon = variableIcon(v);
                        const checked = v === variable;
                        return (
                          <button
                            key={v}
                            type="button"
                            role="radio"
                            aria-checked={checked}
                            onClick={() => onSelect(v)}
                            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-[13px] transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                            style={{
                              backgroundColor: checked ? "var(--accent-soft)" : "transparent",
                              fontWeight: checked ? 600 : 500,
                            }}
                          >
                            <Icon className="h-4 w-4 shrink-0" style={{ color: checked ? "var(--accent)" : "var(--muted-foreground)" }} />
                            <span className="min-w-0 flex-1 truncate">{meta.label}</span>
                            {meta.unit && (
                              <span className="shrink-0 font-mono text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                                {meta.unit}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </section>
                ))
              )}

              <section>
                <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>
                  Fons
                </h3>
                <div role="radiogroup" aria-label="Fons del mapa" className="grid grid-cols-2 gap-1.5">
                  {BASEMAPS.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      role="radio"
                      aria-checked={options.basemap === b.id}
                      onClick={() => setOptions({ basemap: b.id })}
                      className="rounded-lg border px-2 py-2 text-[13px] font-semibold"
                      style={selectionStyle(options.basemap === b.id)}
                    >
                      {b.label}
                    </button>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>
                  Mostra
                </h3>
                <div className="space-y-1">
                  {switches.map(renderSwitch)}
                  {!mountain && (
                    <label className="flex items-center gap-3 px-1 pt-2 text-[13px]">
                      <span className="flex-1">Opacitat</span>
                      <input
                        type="range"
                        min={10}
                        max={100}
                        value={Math.round(options.opacity * 100)}
                        onChange={(e) => setOptions({ opacity: Number(e.target.value) / 100 })}
                        aria-label="Opacitat"
                        className="w-28 accent-[color:var(--accent)]"
                        style={{ accentColor: "var(--accent)" }}
                      />
                      <span className="w-7 text-right font-mono text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                        {Math.round(options.opacity * 100)}
                      </span>
                    </label>
                  )}
                </div>
              </section>
            </>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-t px-4 py-2.5 text-[11px]" style={{ borderColor: "var(--border)" }}>
          <span className="truncate" style={{ color: "var(--muted-foreground)" }}>
            {modelLabel}
          </span>
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 font-semibold hover:bg-black/5 dark:hover:bg-white/10"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Actualitza
          </button>
        </div>
      </aside>
    </>
  );
}
