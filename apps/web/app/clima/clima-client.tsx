"use client";

import { CalendarDays, ChevronLeft, ChevronRight, Flame, Snowflake, Sun, Thermometer } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AppHeader, BottomNav } from "@/components/header";
import { Footer } from "@/components/footer";
import { selectionStyle } from "@/components/selection";
import { monthLong } from "@meteozini/core";

type Cell = { date: string; anomaly: number; percentile: number; value: number };

type ClimateData = {
  location: { latitude: number; longitude: number; elevation: number | null };
  month: { year: number; month: number; cells: Cell[]; summary: { meanAnomaly: number | null; daysAboveP90: number; daysBelowP10: number } };
  year: { cells: Cell[]; summary: { year: number; meanAnomaly: number | null; daysAboveP90: number; daysBelowP10: number } };
  monthlyNormals: { tmean: number | null; precip: number; rainDays: number }[];
  series: { year: number; anomaly: number; incomplete: boolean }[];
  stats: {
    trendPerDecade: number;
    topTenWarmDecade: number;
    warmest: number[];
    hottestMonth: number | null;
    coldestMonth: number | null;
    wettestMonth: number | null;
    annualPrecip: number;
  };
};

const MONTHS_SHORT = ["gen", "feb", "mar", "abr", "mai", "jun", "jul", "ago", "set", "oct", "nov", "des"];

function anomalyColor(a: number, max = 4) {
  const f = Math.max(-1, Math.min(1, a / max));
  if (f >= 0) {
    const x = Math.round(255 + (198 - 255) * f);
    const y = Math.round(255 + (40 - 255) * f);
    const z = Math.round(255 + (40 - 255) * f);
    return `rgb(${x},${y},${z})`;
  }
  const g = -f;
  return `rgb(${Math.round(255 + (33 - 255) * g)},${Math.round(255 + (113 - 255) * g)},${Math.round(255 + (181 - 255) * g)})`;
}

function percentileColor(p: number) {
  if (p >= 90) return "rgb(198,40,40)";
  if (p >= 75) return "rgb(235,120,70)";
  if (p >= 50) return "rgb(245,190,110)";
  if (p >= 25) return "rgb(170,200,225)";
  if (p >= 10) return "rgb(100,160,215)";
  return "rgb(33,113,181)";
}

function fmtAnom(a: number) {
  return `${a > 0 ? "+" : ""}${a.toFixed(1).replace(".", ",")}`;
}

const WEEKDAYS = ["Dl", "Dm", "Dc", "Dj", "Dv", "Ds", "Dg"];

export default function ClimaPage() {
  const params = useSearchParams();
  const lat = Number(params.get("lat") ?? 41.3874);
  const lon = Number(params.get("lon") ?? 2.1686);
  const place = params.get("name") ?? "Barcelona";

  const [data, setData] = useState<ClimateData | null>(null);
  const [mode, setMode] = useState<"anomaly" | "percentile">("anomaly");
  const [yearMode, setYearMode] = useState<"anomaly" | "percentile">("anomaly");

  useEffect(() => {
    setData(null);
    fetch(`/api/climate?lat=${lat}&lon=${lon}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setData(d))
      .catch(() => {});
  }, [lat, lon]);

  const calendar = useMemo(() => {
    if (!data) return [] as (Cell | null)[];
    const first = new Date(`${data.month.year}-${String(data.month.month).padStart(2, "0")}-01T12:00:00`);
    const offset = (first.getDay() + 6) % 7;
    const byDate = new Map(data.month.cells.map((c) => [c.date, c]));
    const daysInMonth = new Date(data.month.year, data.month.month, 0).getDate();
    const cells: (Cell | null)[] = Array.from({ length: offset }, () => null);
    for (let d = 1; d <= daysInMonth; d += 1) {
      const date = `${data.month.year}-${String(data.month.month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      cells.push(byDate.get(date) ?? { date, anomaly: NaN, percentile: NaN, value: NaN });
    }
    return cells;
  }, [data]);

  const yearByDate = useMemo(() => {
    const map = new Map<string, Cell>();
    data?.year.cells.forEach((c) => map.set(c.date, c));
    return map;
  }, [data]);

  const seriesMin = data ? Math.min(...data.series.map((s) => s.anomaly)) : 0;
  const seriesMax = data ? Math.max(...data.series.map((s) => s.anomaly)) : 1;

  return (
    <div className="flex min-h-screen flex-col" style={{ backgroundColor: "var(--background)" }}>
      <AppHeader />
      <main className="page-shell flex-1 py-4 pb-24 md:py-6 lg:pb-8">
        <div className="mx-auto max-w-6xl space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="flex items-center gap-2 font-display text-2xl font-extrabold tracking-tight">
              <CalendarDays className="h-6 w-6" style={{ color: "var(--accent)" }} />
              Clima
            </h1>
            <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>
              {place} · {lat.toFixed(2)}, {lon.toFixed(2)}
            </span>
          </div>

          {!data && (
            <div className="space-y-3">
              <div className="h-96 animate-pulse rounded-2xl" style={{ backgroundColor: "var(--muted)" }} />
              <div className="h-64 animate-pulse rounded-2xl" style={{ backgroundColor: "var(--muted)" }} />
            </div>
          )}

          {data && (
            <>
              <section className="card p-3 sm:p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="flex items-center gap-2 font-display text-lg font-bold">
                      <Thermometer className="h-4 w-4" style={{ color: "var(--accent)" }} />
                      Calendari d&apos;anomalies
                    </h2>
                    <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                      Temperatura màxima diària vs 1991–2020 · ERA5
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button type="button" aria-label="Mes anterior" className="grid h-8 w-8 place-items-center rounded-full border opacity-40" style={{ borderColor: "var(--border)" }}>
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <span className="min-w-[110px] text-center text-sm font-semibold">
                      {monthLong(new Date(data.month.year, data.month.month - 1, 15))} {data.month.year}
                    </span>
                    <button type="button" aria-label="Mes següent" disabled className="grid h-8 w-8 place-items-center rounded-full border disabled:opacity-35" style={{ borderColor: "var(--border)" }}>
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="mt-2 flex items-center justify-between gap-2">
                  <div role="radiogroup" className="flex gap-0.5">
                    {(["anomaly", "percentile"] as const).map((m) => (
                      <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className="rounded-md border px-2.5 py-1 text-[11px] font-semibold" style={selectionStyle(mode === m)}>
                        {m === "anomaly" ? "Anomalia" : "Percentil"}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  {[
                    { label: "Anomalia mitjana", value: data.month.summary.meanAnomaly != null ? `${fmtAnom(data.month.summary.meanAnomaly)} °C` : "—" },
                    { label: "dies per sobre del P90", value: String(data.month.summary.daysAboveP90) },
                    { label: "dies per sota del P10", value: String(data.month.summary.daysBelowP10) },
                  ].map((s) => (
                    <div key={s.label} className="rounded-xl px-3 py-2" style={{ backgroundColor: "var(--muted)" }}>
                      <div className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>{s.label}</div>
                      <div className="mt-0.5 font-display text-lg font-bold">{s.value}</div>
                    </div>
                  ))}
                </div>

                <div className="mt-4">
                  <div className="mb-1 text-[11px] font-semibold capitalize" style={{ color: "var(--muted-foreground)" }}>
                    {monthLong(new Date(data.month.year, data.month.month - 1, 15))} {data.month.year}
                  </div>
                  <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold" style={{ color: "var(--muted-foreground)" }}>
                    {WEEKDAYS.map((d) => (
                      <div key={d} className="py-1">{d}</div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {calendar.map((cell, i) => {
                      if (!cell) return <div key={`e-${i}`} />;
                      const valid = Number.isFinite(cell.anomaly);
                      const bg = valid ? (mode === "anomaly" ? anomalyColor(cell.anomaly) : percentileColor(cell.percentile)) : "var(--muted)";
                      const dark = !valid || (mode === "anomaly" ? Math.abs(cell.anomaly) > 2.2 : cell.percentile > 75 || cell.percentile < 15);
                      return (
                        <div
                          key={cell.date}
                          title={`${cell.date} · ${valid ? `${fmtAnom(cell.anomaly)} °C` : "sense dades"}`}
                          className="flex min-h-[52px] flex-col justify-between rounded-md p-1"
                          style={{ backgroundColor: bg, color: dark ? "#fff" : "#1f2937" }}
                        >
                          <div className="text-[11px] font-semibold leading-none">{Number(cell.date.slice(8, 10))}</div>
                          {valid && (
                            <div className="text-center font-mono text-[10px] font-semibold leading-none">
                              {mode === "anomaly" ? fmtAnom(cell.anomaly) : `P${cell.percentile}`}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <p className="mt-2 text-[10px]" style={{ color: "var(--muted-foreground)" }}>
                  Anomalia i percentil respecte de la normal 1991–2020 (ERA5, finestra de ±5 dies).
                </p>
              </section>

              <div className="grid gap-3 lg:grid-cols-2">
                <section className="card p-3 sm:p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h2 className="flex items-center gap-2 font-display text-lg font-bold">
                        <Flame className="h-4 w-4" style={{ color: "var(--accent)" }} />
                        L&apos;any dia a dia
                      </h2>
                      <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                        Anomalia i percentil respecte de la normal 1991–2020
                      </p>
                    </div>
                    <span className="text-sm font-bold">{data.year.summary.year}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div role="radiogroup" className="flex gap-0.5">
                      {(["anomaly", "percentile"] as const).map((m) => (
                        <button key={m} type="button" role="radio" aria-checked={yearMode === m} onClick={() => setYearMode(m)} className="rounded-md border px-2 py-1 text-[10px] font-semibold" style={selectionStyle(yearMode === m)}>
                          {m === "anomaly" ? "Anomalia" : "Percentil"}
                        </button>
                      ))}
                    </div>
                    <span className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>
                      {data.year.summary.daysAboveP90} dies &gt; P90 · {data.year.summary.daysBelowP10} dies &lt; P10
                    </span>
                  </div>
                  <div className="mt-2 flex gap-0.5">
                    {Array.from({ length: 12 }, (_, m) => {
                      const days = new Date(data.year.summary.year, m + 1, 0).getDate();
                      return (
                        <div key={m} className="flex-1">
                          <div className="mb-0.5 text-center text-[9px]" style={{ color: "var(--muted-foreground)" }}>
                            {MONTHS_SHORT[m]}
                          </div>
                          <div className="flex flex-col gap-0.5">
                            {Array.from({ length: days }, (_, d) => {
                              const date = `${data.year.summary.year}-${String(m + 1).padStart(2, "0")}-${String(d + 1).padStart(2, "0")}`;
                              const cell = yearByDate.get(date);
                              const valid = cell && Number.isFinite(cell.anomaly);
                              const bg = valid ? (yearMode === "anomaly" ? anomalyColor(cell.anomaly) : percentileColor(cell.percentile)) : "var(--muted)";
                              return (
                                <div
                                  key={d}
                                  title={valid ? `${date} · ${fmtAnom(cell.anomaly)} °C` : date}
                                  className="h-1.5 w-full rounded-[1px]"
                                  style={{ backgroundColor: bg }}
                                />
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-[10px]" style={{ color: "var(--muted-foreground)" }}>
                    Anomalia i percentil respecte de la normal 1991–2020 (ERA5, finestra de ±5 dies).
                  </p>
                </section>

                <section className="card p-3 sm:p-4">
                  <h2 className="flex items-center gap-2 font-display text-lg font-bold">
                    <Sun className="h-4 w-4" style={{ color: "var(--accent)" }} />
                    Clima de l&apos;any
                  </h2>
                  <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                    Normals 1991–2020 · reanàlisi ERA5
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                    {[
                      ["Mes més càlid", data.stats.hottestMonth != null ? MONTHS_SHORT[data.stats.hottestMonth] : "—"],
                      ["Mes més fred", data.stats.coldestMonth != null ? MONTHS_SHORT[data.stats.coldestMonth] : "—"],
                      ["Mes més plujós", data.stats.wettestMonth != null ? MONTHS_SHORT[data.stats.wettestMonth] : "—"],
                      ["Pluja anual típica", `${data.stats.annualPrecip} mm`],
                    ].map(([k, v]) => (
                      <div key={k} className="rounded-lg px-2 py-1.5" style={{ backgroundColor: "var(--muted)" }}>
                        <div style={{ color: "var(--muted-foreground)" }}>{k}</div>
                        <div className="font-semibold">{v}</div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-3 text-[11px] font-semibold">Temperatura mitjana per mes</div>
                  <div className="mt-1 flex h-24 items-end gap-1">
                    {data.monthlyNormals.map((m, i) => {
                      const max = Math.max(...data.monthlyNormals.map((x) => x.tmean ?? 0), 1);
                      const min = Math.min(...data.monthlyNormals.map((x) => x.tmean ?? 0), 0);
                      const h = (((m.tmean ?? min) - min) / Math.max(1, max - min)) * 100;
                      return (
                        <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-0.5" title={`${MONTHS_SHORT[i]}: ${m.tmean?.toFixed(1).replace(".", ",")} °C`}>
                          <div className="w-full rounded-t" style={{ height: `${Math.max(4, h)}%`, backgroundColor: "var(--chart-warm)" }} />
                          <span className="text-[8px]" style={{ color: "var(--muted-foreground)" }}>{MONTHS_SHORT[i]}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-2 text-[11px] font-semibold">Precipitació típica per mes</div>
                  <div className="mt-1 flex h-20 items-end gap-1">
                    {data.monthlyNormals.map((m, i) => {
                      const max = Math.max(...data.monthlyNormals.map((x) => x.precip), 1);
                      return (
                        <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-0.5" title={`${MONTHS_SHORT[i]}: ${m.precip} mm`}>
                          <div className="w-full rounded-t" style={{ height: `${Math.max(4, (m.precip / max) * 100)}%`, backgroundColor: "var(--chart-rain)" }} />
                          <span className="text-[8px]" style={{ color: "var(--muted-foreground)" }}>{MONTHS_SHORT[i]}</span>
                        </div>
                      );
                    })}
                  </div>
                </section>
              </div>

              <section className="card p-3 sm:p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="flex items-center gap-2 font-display text-lg font-bold">
                      <Snowflake className="h-4 w-4" style={{ color: "var(--accent)" }} />
                      Sèrie històrica
                    </h2>
                    <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                      1950–{data.year.summary.year} · reanàlisi ERA5
                    </p>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                  {[
                    ["Tendència observada", `${data.stats.trendPerDecade > 0 ? "+" : ""}${data.stats.trendPerDecade.toFixed(2).replace(".", ",")} °C per dècada`],
                    ["dels 10 anys més càlids", `${data.stats.topTenWarmDecade} són de l'última dècada`],
                    ["Anys més càlids", data.stats.warmest.join(" · ")],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-lg px-2 py-1.5" style={{ backgroundColor: "var(--muted)" }}>
                      <div style={{ color: "var(--muted-foreground)" }}>{k}</div>
                      <div className="font-semibold">{v}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex h-40 items-end gap-[2px]">
                  {data.series.map((s) => {
                    const h = ((s.anomaly - seriesMin) / Math.max(0.1, seriesMax - seriesMin)) * 100;
                    return (
                      <div
                        key={s.year}
                        className="flex-1 rounded-t-sm"
                        title={`${s.year}: ${fmtAnom(s.anomaly)} °C${s.incomplete ? " (any incomplet)" : ""}`}
                        style={{
                          height: `${Math.max(3, h)}%`,
                          backgroundColor: s.anomaly >= 0 ? "var(--chart-warm)" : "var(--chart-cold)",
                          opacity: s.incomplete ? 0.5 : 1,
                        }}
                      />
                    );
                  })}
                </div>
                <div className="mt-1 flex justify-between text-[10px]" style={{ color: "var(--muted-foreground)" }}>
                  <span>{data.series[0]?.year}</span>
                  <span>{data.series[data.series.length - 1]?.year}</span>
                </div>
                <p className="mt-1 text-[10px]" style={{ color: "var(--muted-foreground)" }}>
                  Anomalia anual respecte de la mitjana 1991–2020 (ERA5).
                </p>
              </section>
            </>
          )}
        </div>
      </main>
      <Footer />
      <BottomNav />
    </div>
  );
}
