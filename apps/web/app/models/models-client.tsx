"use client";

import { Info, Thermometer } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AppHeader, BottomNav } from "@/components/header";
import { Footer } from "@/components/footer";
import { selectionStyle } from "@/components/selection";
import { fmtHour, weekdayShort } from "@meteozini/core";

type ModelsResponse = {
  time: string[];
  models: { id: string; label: string; color: string; values: (number | null)[] }[];
  consensus: (number | null)[];
  unit: string;
  label: string;
};

type EnsembleResponse = {
  time: string[];
  members: (number | null)[][];
  mean: (number | null)[];
  p10: (number | null)[];
  p90: (number | null)[];
  unit: string;
  modelLabel: string;
  memberCount: number;
};

const MODEL_VARS = [
  ["temperature", "Temperatura a 2 m"],
  ["temperature_850", "Temperatura a 850 hPa"],
  ["precipitation", "Precipitació acumulada"],
  ["snow", "Neu acumulada"],
  ["wind_speed", "Vent mitjà a 10 m"],
  ["wind_gust", "Ratxa màxima a 10 m"],
  ["pressure", "Pressió al nivell del mar"],
] as const;

const ENS_VARS = [
  ["temperature", "Temperatura a 2 m"],
  ["temperature_850", "Temperatura a 850 hPa"],
  ["temperature_500", "Temperatura a 500 hPa"],
  ["wind_speed", "Vent mitjà a 10 m"],
  ["wind_gust", "Ratxa màxima a 10 m"],
  ["precipitation", "Precipitació acumulada"],
  ["snow", "Neu acumulada"],
] as const;

const DEFAULT_MODELS = ["icon_global", "meteofrance_arome_france_hd", "icon_eu"];

function fmtVal(v: number | null | undefined, decimals = 1) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(decimals).replace(".", ",")}${""}`;
}

function fmtUnit(v: number | null | undefined, unit: string) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${fmtVal(v)}${unit === "°C" ? "°" : ` ${unit}`}`;
}

type ChartSeries = {
  label: string;
  color: string;
  values: (number | null)[];
  width?: number;
  dashed?: boolean;
  opacity?: number;
  showInTooltip?: boolean;
};

function Chart({
  time,
  series,
  consensus,
  unit,
  band,
  height = 240,
  showDots = false,
  hint = true,
  onHover,
}: {
  time: string[];
  series: ChartSeries[];
  consensus?: (number | null)[];
  unit: string;
  band?: { p10: (number | null)[]; p90: (number | null)[] };
  height?: number;
  showDots?: boolean;
  hint?: boolean;
  onHover?: (index: number | null) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 760;
  const H = height;
  const padL = 34;
  const padR = 10;
  const padT = 12;
  const padB = 24;
  const all = series.flatMap((s) => s.values).filter((v): v is number => v != null);
  if (!all.length) {
    return <div className="grid h-[180px] place-items-center text-sm" style={{ color: "var(--muted-foreground)" }}>Sense dades disponibles</div>;
  }
  const min = Math.min(...all);
  const max = Math.max(...all);
  const lo = Math.floor(min - Math.max(0.5, (max - min) * 0.08));
  const hi = Math.ceil(max + Math.max(0.5, (max - min) * 0.08));
  const x = (i: number) => padL + (i / Math.max(1, time.length - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - lo) / Math.max(0.0001, hi - lo)) * (H - padT - padB);
  const path = (vals: (number | null)[]) => {
    let d = "";
    let open = false;
    vals.forEach((v, i) => {
      if (v == null) {
        open = false;
        return;
      }
      d += `${open ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      open = true;
    });
    return d;
  };
  const bandArea = (p10: (number | null)[], p90: (number | null)[]) => {
    let d = "";
    let open = false;
    p10.forEach((v, i) => {
      if (v == null) return;
      d += `${open ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      open = true;
    });
    for (let i = p90.length - 1; i >= 0; i -= 1) {
      const v = p90[i];
      if (v == null) continue;
      d += `L${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    }
    return `${d}Z`;
  };
  const dayTicks = time.map((t, i) => (t.slice(11, 13) === "00" ? i : -1)).filter((i) => i > 0);
  const yTicks = 4;
  const decimals = Math.abs(hi - lo) >= 20 ? 0 : 1;
  const active = hover != null ? Math.max(0, Math.min(time.length - 1, hover)) : null;

  const onPointer = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / Math.max(1, rect.width)) * W;
    const i = Math.round(((vx - padL) / Math.max(1, W - padL - padR)) * (time.length - 1));
    const clamped = Math.max(0, Math.min(time.length - 1, i));
    setHover(clamped);
    onHover?.(clamped);
  };

  return (
    <div
      className="relative select-none"
      onPointerLeave={() => {
        setHover(null);
        onHover?.(null);
      }}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full cursor-crosshair"
        role="img"
        aria-label={`Gràfic de ${unit}`}
        onPointerMove={onPointer}
        onPointerDown={onPointer}
        style={{ touchAction: "pan-y" }}
      >
        <rect x={padL} y={padT} width={W - padL - padR} height={H - padT - padB} fill="transparent" />
        {Array.from({ length: yTicks + 1 }, (_, k) => {
          const v = lo + ((hi - lo) * k) / yTicks;
          return (
            <g key={k}>
              <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={0.5} opacity={0.6} />
              <text x={padL - 4} y={y(v) + 3} textAnchor="end" fontSize={8} fill="var(--muted-foreground)">
                {v.toFixed(decimals).replace(".", ",")}
              </text>
            </g>
          );
        })}
        {dayTicks.map((i) => (
          <g key={i}>
            <line x1={x(i)} x2={x(i)} y1={padT} y2={H - padB} stroke="var(--border)" strokeWidth={0.5} opacity={0.5} />
            <text x={x(i)} y={H - 8} textAnchor="middle" fontSize={9} fill="var(--muted-foreground)">
              {weekdayShort(time[i])}
            </text>
          </g>
        ))}
        {band && <path d={bandArea(band.p10, band.p90)} fill="var(--accent)" opacity={0.12} />}
        {consensus && (
          <path d={path(consensus)} fill="none" stroke="var(--muted-foreground)" strokeWidth={1.3} strokeDasharray="4 3" opacity={0.8} />
        )}
        {series.map((s) => (
          <path
            key={s.label}
            d={path(s.values)}
            fill="none"
            stroke={s.color}
            strokeWidth={s.width ?? 1.6}
            strokeDasharray={s.dashed ? "4 3" : undefined}
            opacity={s.opacity ?? 1}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {series
          .filter((s) => (s.width ?? 1.6) >= 1.2)
          .map((s) => (
            <circle key={`d-${s.label}`} cx={x(time.length - 1)} cy={y(s.values[s.values.length - 1] ?? lo)} r={2.4} fill={s.color} />
          ))}
        {showDots &&
          series.map((s) =>
            s.values.map((v, i) =>
              v == null ? null : <circle key={`${s.label}-${i}`} cx={x(i)} cy={y(v)} r={1.1} fill={s.color} opacity={0.5} />
            )
          )}
        {active != null && (
          <g>
            <line x1={x(active)} x2={x(active)} y1={padT} y2={H - padB} stroke="var(--foreground)" strokeWidth={1} strokeDasharray="3 3" opacity={0.45} />
            {series
              .filter((s) => s.showInTooltip)
              .map((s) => {
                const v = s.values[active];
                return v == null ? null : (
                  <circle key={`h-${s.label}`} cx={x(active)} cy={y(v)} r={3} fill={s.color} stroke="var(--background)" strokeWidth={1.2} />
                );
              })}
          </g>
        )}
      </svg>
      {hint && (
        <p className="mt-1 text-[10px]" style={{ color: "var(--muted-foreground)" }}>
          Passa el cursor (o toca) el gràfic per veure els valors de cada hora.
        </p>
      )}
    </div>
  );
}

function Section({
  title,
  children,
  info,
}: {
  title: string;
  children: React.ReactNode;
  info?: string;
}) {
  return (
    <section className="card p-3 sm:p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-display text-base font-bold sm:text-lg">{title}</h2>
        {info && (
          <button type="button" title={info} aria-label="Informació" className="grid h-6 w-6 place-items-center rounded-full hover:bg-black/5 dark:hover:bg-white/10" style={{ color: "var(--muted-foreground)" }}>
            <Info className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

export default function ModelsPage() {
  const params = useSearchParams();
  const lat = Number(params.get("lat") ?? 41.3874);
  const lon = Number(params.get("lon") ?? 2.1686);
  const placeName = params.get("name") ?? "Barcelona";

  const [variable, setVariable] = useState<string>("temperature");
  const [data, setData] = useState<ModelsResponse | null>(null);
  const [selected, setSelected] = useState<string[]>(DEFAULT_MODELS);
  const [ensModel, setEnsModel] = useState<"ifs" | "aifs" | "gfs">("ifs");
  const [ensVariable, setEnsVariable] = useState("temperature");
  const [ens, setEns] = useState<EnsembleResponse | null>(null);
  const [clim, setClim] = useState<{ values: (number | null)[]; unit: string; period: string } | null>(null);
  const [hoverModels, setHoverModels] = useState<number | null>(null);
  const [hoverEns, setHoverEns] = useState<number | null>(null);

  useEffect(() => {
    setData(null);
    setHoverModels(null);
    fetch(`/api/models?lat=${lat}&lon=${lon}&variable=${variable}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setData(d))
      .catch(() => {});
  }, [lat, lon, variable]);

  useEffect(() => {
    setEns(null);
    setHoverEns(null);
    fetch(`/api/ensemble?lat=${lat}&lon=${lon}&model=${ensModel}&variable=${ensVariable}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setEns(d))
      .catch(() => {});
  }, [lat, lon, ensModel, ensVariable]);

  useEffect(() => {
    setClim(null);
    if (!ens?.time?.length) return;
    const start = ens.time[0];
    const count = ens.time.length;
    fetch(`/api/climatology?lat=${lat}&lon=${lon}&variable=${ensVariable}&start=${encodeURIComponent(start)}&count=${count}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && !d.error && setClim(d))
      .catch(() => {});
  }, [lat, lon, ensVariable, ens]);

  // Daily reliability from model spread.
  const reliability = useMemo(() => {
    if (!data) return [];
    const byDay = new Map<string, { values: number[]; date: string }>();
    data.time.forEach((t, i) => {
      if (t.slice(11, 13) !== "12") return;
      const date = t.slice(0, 10);
      const entry = byDay.get(date) ?? { values: [], date };
      const vals = data.models.filter((m) => selected.includes(m.id)).map((m) => m.values[i]).filter((v): v is number => v != null);
      if (vals.length > 1) entry.values.push(Math.max(...vals) - Math.min(...vals));
      byDay.set(date, entry);
    });
    return [...byDay.values()].slice(0, 7).map((d) => {
      const spread = d.values.length ? d.values.reduce((a, b) => a + b, 0) / d.values.length : 0;
      const sigma = spread / 2;
      const level = sigma < 0.8 ? "Segur" : sigma < 1.5 ? "Dubtós" : "Incert";
      return { date: d.date, sigma, level };
    });
  }, [data, selected]);

  const deviation = useMemo(() => {
    if (!data) return [];
    return data.models
      .map((m) => {
        let sum = 0;
        let n = 0;
        m.values.forEach((v, i) => {
          const c = data.consensus[i];
          if (v != null && c != null) {
            sum += Math.abs(v - c);
            n += 1;
          }
        });
        return { id: m.id, label: m.label, color: m.color, mean: n ? sum / n : null };
      })
      .sort((a, b) => (a.mean ?? 999) - (b.mean ?? 999));
  }, [data]);

  const rainProb = useMemo(() => {
    if (!ens || ensVariable !== "precipitation") return [];
    const byDay = new Map<string, { total: number; wet: number }>();
    ens.time.forEach((t, i) => {
      const date = t.slice(0, 10);
      const entry = byDay.get(date) ?? { total: 0, wet: 0 };
      entry.total += 1;
      const wet = ens.members.filter((m) => ((m[i] as number | null) ?? 0) >= 1).length / Math.max(1, ens.members.length);
      entry.wet += wet;
      byDay.set(date, entry);
    });
    return [...byDay.entries()].slice(0, 7).map(([date, v]) => ({ date, p: Math.round((v.wet / Math.max(1, v.total)) * 100) }));
  }, [ens, ensVariable]);

  const selectedIdx = data ? Math.max(0, data.time.findIndex((t) => Date.parse(t) >= Date.now() - 30 * 60 * 1000)) : 0;
  const modelIdx = Math.min(hoverModels ?? selectedIdx, Math.max(0, (data?.time.length ?? 1) - 1));
  const ensIdx = Math.min(hoverEns ?? selectedIdx, Math.max(0, (ens?.time.length ?? 1) - 1));

  return (
    <div className="flex min-h-screen flex-col" style={{ backgroundColor: "var(--background)" }}>
      <AppHeader />
      <main className="page-shell flex-1 py-4 pb-24 md:py-6 lg:pb-8">
        <div className="mx-auto max-w-5xl space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="flex items-center gap-2 font-display text-2xl font-extrabold tracking-tight">
              <Thermometer className="h-6 w-6" style={{ color: "var(--accent)" }} />
              Comparativa de models
            </h1>
            <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>
              {placeName} · {lat.toFixed(2)}, {lon.toFixed(2)}
            </span>
          </div>

          <Section title="Comparativa de models" info="Compara les trajectòries dels models globals i d'alta resolució per a aquest punt.">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <label className="text-[11px] font-semibold" style={{ color: "var(--muted-foreground)" }}>
                Variable
              </label>
              <select
                value={variable}
                onChange={(e) => setVariable(e.target.value)}
                className="rounded-lg border px-2 py-1 text-[12px] font-semibold"
                style={{ borderColor: "var(--border)", backgroundColor: "var(--card)" }}
              >
                {MODEL_VARS.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            {data ? (
              <>
                <div className="mb-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                  <span className="font-semibold" style={{ color: "var(--muted-foreground)" }}>
                    {timeLabel(data.time[modelIdx])}
                  </span>
                  {data.models
                    .filter((m) => selected.includes(m.id))
                    .map((m) => (
                      <span key={m.id} className="inline-flex items-center gap-1">
                        <span className="inline-block h-1.5 w-3 rounded-full" style={{ backgroundColor: m.color }} />
                        {m.label}
                        <b>{fmtUnit(m.values[modelIdx], data.unit)}</b>
                      </span>
                    ))}
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block h-1.5 w-3 rounded-full" style={{ backgroundColor: "var(--muted-foreground)" }} />
                    Consens <b>{fmtUnit(data.consensus[modelIdx], data.unit)}</b>
                  </span>
                </div>
                <Chart
                  time={data.time}
                  series={data.models.filter((m) => selected.includes(m.id)).map((m) => ({ label: m.label, color: m.color, values: m.values, showInTooltip: true }))}
                  consensus={data.consensus}
                  unit={data.unit}
                  onHover={setHoverModels}
                />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {data.models.map((m) => {
                    const on = selected.includes(m.id);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() =>
                          setSelected((prev) => (on ? prev.filter((x) => x !== m.id) : [...prev, m.id]))
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-semibold"
                        style={{
                          borderColor: on ? m.color : "var(--border)",
                          backgroundColor: on ? `${m.color}18` : "transparent",
                          opacity: on ? 1 : 0.65,
                        }}
                      >
                        <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: m.color }} />
                        {m.label}
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="h-[240px] animate-pulse rounded-xl" style={{ backgroundColor: "var(--muted)" }} />
            )}
          </Section>

          <div className="grid gap-3 md:grid-cols-2">
            <Section title="Fiabilitat" info="Amplitud entre models per a cada dia; com més petita, més acord.">
              <div className="grid grid-cols-7 gap-1">
                {reliability.map((r) => {
                  const color = r.level === "Segur" ? "var(--ok)" : r.level === "Dubtós" ? "#d97706" : "#c2410c";
                  return (
                    <div key={r.date} className="rounded-lg px-1 py-1.5 text-center" style={{ backgroundColor: "var(--muted)" }}>
                      <div className="text-[10px] font-semibold" style={{ color: "var(--muted-foreground)" }}>
                        {weekdayShort(r.date)}
                      </div>
                      <div className="mx-auto my-1 h-1.5 w-6 rounded-full" style={{ backgroundColor: color }} />
                      <div className="text-[11px] font-semibold" style={{ color }}>
                        ±{r.sigma.toFixed(1).replace(".", ",")}°
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px]" style={{ color: "var(--muted-foreground)" }}>
                <span className="inline-flex items-center gap-1"><i className="inline-block h-1.5 w-4 rounded-full" style={{ backgroundColor: "var(--ok)" }} />Segur</span>
                <span className="inline-flex items-center gap-1"><i className="inline-block h-1.5 w-4 rounded-full" style={{ backgroundColor: "#d97706" }} />Dubtós</span>
                <span className="inline-flex items-center gap-1"><i className="inline-block h-1.5 w-4 rounded-full" style={{ backgroundColor: "#c2410c" }} />Incert</span>
              </div>
            </Section>

            <Section title="Validació de models" info="Desviació mitjana de cada model respecte del consens (els últims 8 dies).">
              <p className="text-sm">
                <b>{deviation[0]?.label ?? "—"}</b>{" "}
                <span style={{ color: "var(--muted-foreground)" }}>s'allunya</span> {deviation[0]?.mean != null ? deviation[0].mean.toFixed(1).replace(".", ",") : "—"} {data?.unit ?? ""} del consens
              </p>
              <ol className="mt-2 space-y-1">
                {deviation.slice(0, 6).map((d, i) => (
                  <li key={d.id} className="flex items-center gap-2 rounded-lg px-2 py-1 text-[12px]" style={{ backgroundColor: i === 0 ? "var(--accent-soft)" : "transparent" }}>
                    <span className="w-4 text-center font-mono text-[10px]" style={{ color: "var(--muted-foreground)" }}>{i + 1}</span>
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: d.color }} />
                    <span className="flex-1 truncate">{d.label}</span>
                    <span className="font-mono text-[11px]">
                      {d.mean != null ? d.mean.toFixed(1).replace(".", ",") : "—"} {data?.unit}
                    </span>
                  </li>
                ))}
              </ol>
              <p className="mt-2 text-[10px]" style={{ color: "var(--muted-foreground)" }}>
                Desviació respecte del consens multi-model · últims 8 dies
              </p>
            </Section>
          </div>

          <Section title="Ensembles" info="Dispersió de les pertorbacions del model d'ensemble per a aquest punt.">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <div role="radiogroup" className="flex gap-0.5">
                {([
                  ["ifs", "IFS ENS"],
                  ["aifs", "AIFS ENS"],
                  ["gfs", "GFS ENS"],
                ] as const).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={ensModel === id}
                    onClick={() => setEnsModel(id)}
                    className="rounded-md border px-2 py-1 text-[11px] font-semibold"
                    style={selectionStyle(ensModel === id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <select
                value={ensVariable}
                onChange={(e) => setEnsVariable(e.target.value)}
                className="rounded-lg border px-2 py-1 text-[12px] font-semibold"
                style={{ borderColor: "var(--border)", backgroundColor: "var(--card)" }}
              >
                {ENS_VARS.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            {ens ? (
              <>
                <div className="mb-1 flex flex-wrap gap-x-3 text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                  <span className="font-semibold" style={{ color: "var(--foreground)" }}>{timeLabel(ens.time[ensIdx])}</span>
                  <span>Mitjana {fmtUnit(ens.mean[ensIdx], ens.unit)}</span>
                  {clim && (
                    <span>
                      Clima {clim.period}{" "}
                      <b>{fmtUnit(clim.values[ensIdx], clim.unit)}</b>
                    </span>
                  )}
                  <span>{ens.memberCount} membres</span>
                </div>
                <Chart
                  time={ens.time}
                  series={[
                    ...ens.members.slice(0, 30).map((m, i) => ({
                      label: `m${i}`,
                      color: "var(--chart-neutral)",
                      values: m,
                      width: 0.6,
                      opacity: 0.35,
                    })),
                    { label: "Mitjana", color: "var(--accent)", values: ens.mean, width: 2, showInTooltip: true },
                    ...(clim
                      ? [{ label: "Clima ERA5", color: "var(--muted-foreground)", values: clim.values, width: 1.4, dashed: true, showInTooltip: true }]
                      : []),
                  ]}
                  unit={ens.unit}
                  band={{ p10: ens.p10, p90: ens.p90 }}
                  onHover={setHoverEns}
                />
                {clim && (
                  <p className="mt-1 text-[10px]" style={{ color: "var(--muted-foreground)" }}>
                    Línia discontínua: mitjana climàtica {clim.period} (ERA5) per a aquesta hora de l&apos;any.
                  </p>
                )}
                {rainProb.length > 0 && (
                  <div className="mt-2 grid grid-cols-7 gap-1">
                    {rainProb.map((d) => (
                      <div key={d.date} className="text-center">
                        <div className="text-[10px] font-semibold" style={{ color: "var(--muted-foreground)" }}>{weekdayShort(d.date)}</div>
                        <div className="mx-auto mt-1 flex h-14 w-5 items-end overflow-hidden rounded" style={{ backgroundColor: "var(--muted)" }}>
                          <div className="w-full" style={{ height: `${d.p}%`, backgroundColor: "var(--chart-rain)" }} />
                        </div>
                        <div className="mt-0.5 text-[10px] font-semibold">{d.p}%</div>
                      </div>
                    ))}
                    <div className="col-span-7 text-[10px]" style={{ color: "var(--muted-foreground)" }}>
                      Probabilitat de pluja ≥1 mm segons l&apos;ensemble de precipitació
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="h-[240px] animate-pulse rounded-xl" style={{ backgroundColor: "var(--muted)" }} />
            )}
          </Section>
        </div>
      </main>
      <Footer />
      <BottomNav />
    </div>
  );
}

function timeLabel(t: string | undefined) {
  if (!t) return "—";
  return `${weekdayShort(t)} ${fmtHour(t)}`;
}
