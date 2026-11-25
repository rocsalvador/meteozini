"use client";

import { ArrowLeft, Droplets, Eye, Gauge, Sunrise, Sunset, Thermometer, Wind } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AppHeader, BottomNav } from "@/components/header";
import { Footer } from "@/components/footer";
import { WeatherIcon, weatherLabel } from "@/components/weather-icon";
import type { WeatherData } from "@/components/map/forecast-panel";
import { compassName, fmtHour, weekdayShort } from "@meteozini/core";

function round(v: number | null | undefined, unit = "°") {
  return v == null || !Number.isFinite(v) ? "—" : `${Math.round(v)}${unit}`;
}

function TempPrecipChart({ rows }: { rows: WeatherData["hourly"] }) {
  const W = 760;
  const H = 170;
  const padL = 30;
  const padR = 10;
  const padT = 10;
  const padB = 22;
  const temps = rows.map((r) => r.temperature).filter((v): v is number => v != null);
  if (!temps.length) return null;
  const min = Math.floor(Math.min(...temps) - 1);
  const max = Math.ceil(Math.max(...temps) + 1);
  const maxRain = Math.max(1, ...rows.map((r) => r.precipitation ?? 0));
  const x = (i: number) => padL + (i / Math.max(1, rows.length - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - min) / Math.max(1, max - min)) * (H - padT - padB);
  const path = rows
    .map((r, i) => (r.temperature == null ? "" : `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(r.temperature).toFixed(1)}`))
    .join("");
  const dayTicks = rows.map((r, i) => (r.time.slice(11, 13) === "00" ? i : -1)).filter((i) => i > 0);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Temperatura i precipitació de les pròximes hores">
      {[min, Math.round((min + max) / 2), max].map((v) => (
        <g key={v}>
          <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={0.5} opacity={0.6} />
          <text x={padL - 4} y={y(v) + 3} textAnchor="end" fontSize={8} fill="var(--muted-foreground)">{v}°</text>
        </g>
      ))}
      {rows.map((r, i) =>
        r.precipitation && r.precipitation > 0 ? (
          <rect
            key={`p-${i}`}
            x={x(i) - 1.5}
            y={H - padB - ((r.precipitation / maxRain) * (H - padT - padB) * 0.4)}
            width={3}
            height={(r.precipitation / maxRain) * (H - padT - padB) * 0.4}
            fill="var(--chart-rain)"
            opacity={0.65}
          />
        ) : null
      )}
      <path d={path} fill="none" stroke="var(--chart-warm)" strokeWidth={1.8} strokeLinejoin="round" />
      {dayTicks.map((i) => (
        <g key={i}>
          <line x1={x(i)} x2={x(i)} y1={padT} y2={H - padB} stroke="var(--border)" strokeWidth={0.5} opacity={0.5} />
          <text x={x(i)} y={H - 7} textAnchor="middle" fontSize={9} fill="var(--muted-foreground)">
            {weekdayShort(rows[i].time)} {fmtHour(rows[i].time)}
          </text>
        </g>
      ))}
    </svg>
  );
}

export default function LlocPage() {
  const params = useSearchParams();
  const lat = Number(params.get("lat") ?? 41.3874);
  const lon = Number(params.get("lon") ?? 2.1686);
  const name = params.get("name") ?? "Barcelona";
  const [data, setData] = useState<WeatherData | null>(null);

  useEffect(() => {
    setData(null);
    fetch(`/api/weather?lat=${lat}&lon=${lon}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setData(d))
      .catch(() => {});
  }, [lat, lon]);

  const today = data?.daily[0];
  const next48 = useMemo(() => {
    if (!data) return [];
    const start = Math.max(0, data.hourly.findIndex((h) => Date.parse(h.time) >= Date.now() - 30 * 60 * 1000));
    return data.hourly.slice(start, start + 48);
  }, [data]);

  const current = data?.current;
  const allMin = Math.min(...(data?.daily.map((d) => d.temperatureMin ?? 999) ?? [0]));
  const allMax = Math.max(...(data?.daily.map((d) => d.temperatureMax ?? -999) ?? [1]));

  return (
    <div className="flex min-h-screen flex-col" style={{ backgroundColor: "var(--background)" }}>
      <AppHeader />
      <main className="page-shell flex-1 py-4 pb-24 md:py-6 lg:pb-8">
        <div className="mx-auto max-w-4xl space-y-3">
          <Link href="/" className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: "var(--muted-foreground)" }}>
            <ArrowLeft className="h-3.5 w-3.5" />
            Tornar al mapa
          </Link>

          {!data && (
            <div className="space-y-3">
              <div className="h-40 animate-pulse rounded-2xl" style={{ backgroundColor: "var(--muted)" }} />
              <div className="h-48 animate-pulse rounded-2xl" style={{ backgroundColor: "var(--muted)" }} />
            </div>
          )}

          {data && current && (
            <>
              <section className="card p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h1 className="font-display text-2xl font-extrabold tracking-tight">{name}</h1>
                    <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                      {data.location.elevation != null ? `${Math.round(data.location.elevation)} m` : ""} · {lat.toFixed(4)}, {lon.toFixed(4)}
                      {today?.sunrise && today?.sunset && (
                        <>
                          {" · "}
                          <Sunrise className="inline h-3 w-3" /> {fmtHour(today.sunrise)}{" "}
                          <Sunset className="inline h-3 w-3" /> {fmtHour(today.sunset)}
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="font-display text-5xl font-bold leading-none">{round(current.temperature)}</div>
                    <WeatherIcon code={current.weathercode} isDay={current.isDay} className="h-12 w-12" />
                    <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                      {weatherLabel(current.weathercode)}
                      <br />
                      Sensació {round(current.apparentTemperature)}
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    { icon: Thermometer, label: "Sensació", value: round(current.apparentTemperature) },
                    { icon: Droplets, label: "Humitat", value: round(current.humidity, "%") },
                    { icon: Wind, label: compassName(current.windDirection), value: `${round(current.windSpeed, "")} km/h`, sub: `ratxa ${round(current.windGusts, "")}` },
                    { icon: Gauge, label: "Pressió", value: round(current.pressure, " hPa") },
                    { icon: Eye, label: "Núvols", value: round(current.cloudcover, "%") },
                    { icon: Thermometer, label: "UV", value: current.uvIndex != null ? current.uvIndex.toFixed(1).replace(".", ",") : "—" },
                    { icon: Droplets, label: "Pluja ara", value: `${(current.precipitation ?? 0).toFixed(1).replace(".", ",")} mm` },
                    { icon: Droplets, label: "Prob. pluja", value: round(current.precipitationProbability, "%") },
                  ].map(({ icon: Icon, label, value, sub }) => (
                    <div key={label} className="rounded-xl px-2.5 py-2" style={{ backgroundColor: "var(--muted)" }}>
                      <div className="flex items-center gap-1 text-[10px]" style={{ color: "var(--muted-foreground)" }}>
                        <Icon className="h-3 w-3" />
                        {label}
                      </div>
                      <div className="mt-0.5 text-sm font-semibold">{value}</div>
                      {sub && <div className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>{sub}</div>}
                    </div>
                  ))}
                </div>
              </section>

              <section className="card p-3 sm:p-4">
                <h2 className="font-display text-lg font-bold">Pròximes 48 hores</h2>
                <TempPrecipChart rows={next48} />
                <div className="no-scrollbar mt-2 flex gap-2 overflow-x-auto pb-1">
                  {next48.map((h) => (
                    <div key={h.time} className="flex w-14 shrink-0 flex-col items-center gap-1 rounded-lg px-1 py-1.5 text-center" style={{ backgroundColor: "var(--muted)" }}>
                      <span className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>{fmtHour(h.time)}</span>
                      <WeatherIcon code={h.weathercode} isDay={h.isDay} className="h-4 w-4" />
                      <span className="text-[11px] font-semibold">{round(h.temperature)}</span>
                      <span className="text-[9px]" style={{ color: "var(--chart-rain)" }}>{(h.precipitation ?? 0) > 0 ? `${(h.precipitation ?? 0).toFixed(1).replace(".", ",")} mm` : ""}</span>
                      <span className="text-[9px]" style={{ color: "var(--muted-foreground)" }}>{round(h.windSpeed, "")}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="card p-3 sm:p-4">
                <h2 className="font-display text-lg font-bold">Pròxims dies</h2>
                <ul className="mt-1 divide-y" style={{ borderColor: "var(--border)" }}>
                  {data.daily.slice(0, 8).map((d, i) => {
                    const lo = d.temperatureMin ?? 0;
                    const hi = d.temperatureMax ?? 0;
                    const span = Math.max(1, allMax - allMin);
                    return (
                      <li key={d.date} className="flex items-center gap-2 py-2.5 text-sm" style={{ borderColor: "var(--border)" }}>
                        <span className="w-12 shrink-0 text-[12px] font-semibold">{i === 0 ? "Avui" : weekdayShort(d.date)}</span>
                        <WeatherIcon code={d.weathercode} className="h-4 w-4 shrink-0" />
                        <span className="w-9 shrink-0 text-right text-[12px]" style={{ color: "var(--muted-foreground)" }}>{round(lo)}</span>
                        <span className="relative h-1.5 flex-1 overflow-hidden rounded-full" style={{ backgroundColor: "var(--muted)" }}>
                          <span
                            className="absolute inset-y-0 rounded-full"
                            style={{
                              left: `${Math.max(0, Math.min(1, (lo - allMin) / span)) * 100}%`,
                              right: `${(1 - Math.max(0, Math.min(1, (hi - allMin) / span))) * 100}%`,
                              background: "linear-gradient(90deg,#4AA3DF,#F2B134,#E4572E)",
                            }}
                          />
                        </span>
                        <span className="w-9 shrink-0 text-[12px] font-semibold">{round(hi)}</span>
                        <span className="w-16 shrink-0 text-right text-[11px]" style={{ color: "var(--chart-rain)" }}>
                          {d.precipitationSum ? `${d.precipitationSum.toFixed(1).replace(".", ",")} mm` : ""}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>

              <div className="flex flex-wrap gap-2">
                <Link href={`/models?lat=${lat}&lon=${lon}&name=${encodeURIComponent(name)}`} className="rounded-xl border px-3 py-2 text-xs font-semibold" style={{ borderColor: "var(--border)" }}>
                  Comparar models
                </Link>
                <Link href={`/clima?lat=${lat}&lon=${lon}&name=${encodeURIComponent(name)}`} className="rounded-xl border px-3 py-2 text-xs font-semibold" style={{ borderColor: "var(--border)" }}>
                  Clima del lloc
                </Link>
                <Link href={`/mapes?lat=${lat}&lon=${lon}`} className="rounded-xl border px-3 py-2 text-xs font-semibold" style={{ borderColor: "var(--border)" }}>
                  Mapes
                </Link>
              </div>
            </>
          )}
        </div>
      </main>
      <Footer />
      <BottomNav />
    </div>
  );
}
