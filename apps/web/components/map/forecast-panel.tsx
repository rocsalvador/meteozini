"use client";

import { ArrowRight, X } from "lucide-react";
import Link from "next/link";
import { WeatherIcon, weatherLabel } from "@/components/weather-icon";
import { compassName, fmtHour, weekdayShort } from "@meteozini/core";

export type WeatherData = {
  location: { latitude: number; longitude: number; elevation: number | null; timezone: string };
  current: {
    time: string;
    temperature: number | null;
    humidity: number | null;
    precipitation: number | null;
    precipitationProbability: number | null;
    weathercode: number | null;
    windSpeed: number | null;
    windGusts: number | null;
    windDirection: number | null;
    cloudcover: number | null;
    pressure: number | null;
    uvIndex: number | null;
    isDay: number | null;
    apparentTemperature: number | null;
  };
  hourly: {
    time: string;
    temperature: number | null;
    precipitation: number | null;
    precipitationProbability: number | null;
    weathercode: number | null;
    windSpeed: number | null;
    windGusts: number | null;
    windDirection: number | null;
    isDay: number | null;
  }[];
  metadata?: { generatedAt?: string; model?: string };
  daily: {
    date: string;
    weathercode: number | null;
    temperatureMax: number | null;
    temperatureMin: number | null;
    precipitationSum: number | null;
    precipitationProbability: number | null;
    sunrise: string | null;
    sunset: string | null;
  }[];
};

function round(v: number | null | undefined) {
  return v == null || !Number.isFinite(v) ? "—" : `${Math.round(v)}°`;
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

export function ForecastPanel({
  open,
  loading,
  name,
  lat,
  lon,
  data,
  onClose,
}: {
  open: boolean;
  loading: boolean;
  name: string;
  lat: number;
  lon: number;
  data: WeatherData | null;
  onClose: () => void;
}) {
  if (!open) return null;
  const current = data?.current;
  const daily = data?.daily ?? [];
  const today = daily[0];
  const elevation = data?.location.elevation;

  const startIdx = data
    ? Math.max(0, data.hourly.findIndex((h) => Date.parse(h.time) >= Date.now() - 30 * 60 * 1000))
    : 0;
  const strip = data
    ? data.hourly.slice(startIdx, startIdx + 24).filter((_, i) => i % 3 === 0).slice(0, 8)
    : [];
  const rain24 = data ? data.hourly.slice(startIdx, startIdx + 24).reduce((a, h) => a + (h.precipitation ?? 0), 0) : 0;
  const allMin = Math.min(...daily.map((d) => d.temperatureMin ?? 999));
  const allMax = Math.max(...daily.map((d) => d.temperatureMax ?? -999));

  return (
    <aside
      aria-label={`Previsió per a ${name}`}
      className="absolute inset-x-0 bottom-0 z-40 max-h-[72dvh] overflow-y-auto rounded-t-md border sm:bottom-2 sm:left-auto sm:right-2 sm:top-2 sm:max-h-none sm:w-[380px] sm:rounded-md"
      style={{ backgroundColor: "var(--card)", borderColor: "var(--border)", color: "var(--card-foreground)" }}
    >
      <div className="sticky top-0 z-10 flex items-start justify-between gap-2 border-b px-4 py-3" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
        <div>
          <h2 className="text-base font-bold leading-tight">{name}</h2>
          <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
            {elevation != null ? `${Math.round(elevation)} m` : `${lat.toFixed(2)}, ${lon.toFixed(2)}`}
            {today?.sunrise && today?.sunset && ` · sol ${fmtHour(today.sunrise)}–${fmtHour(today.sunset)}`}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Tanca la fitxa" className="grid h-8 w-8 place-items-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10">
          <X className="h-4 w-4" />
        </button>
      </div>

      {loading && (
        <div className="space-y-3 p-4">
          <div className="h-16 animate-pulse rounded-xl" style={{ backgroundColor: "var(--muted)" }} />
          <div className="h-24 animate-pulse rounded-xl" style={{ backgroundColor: "var(--muted)" }} />
          <div className="h-40 animate-pulse rounded-xl" style={{ backgroundColor: "var(--muted)" }} />
        </div>
      )}

      {!loading && data && current && (
        <div className="space-y-3 p-4">
          <div className="flex items-center gap-4">
            <div className="font-display text-5xl font-bold leading-none">{round(current.temperature)}</div>
            <WeatherIcon code={current.weathercode} isDay={current.isDay} className="h-10 w-10" />
            <div className="min-w-0 text-[11px]" style={{ color: "var(--muted-foreground)" }}>
              <p className="font-semibold" style={{ color: "var(--foreground)" }}>
                {weatherLabel(current.weathercode)}
              </p>
              <p>
                {data.metadata?.model ?? "Open-Meteo"} · {current.time ? fmtHour(current.time) : ""}
              </p>
            </div>
          </div>

          <p className="text-sm">
            {rain24 < 0.1
              ? "No s'espera pluja en 24 hores."
              : `S'esperen ${rain24.toFixed(rain24 < 10 ? 1 : 0).replace(".", ",")} mm en les properes 24 hores.`}
          </p>

          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Sensació", value: round(current.apparentTemperature) },
              {
                label: compassName(current.windDirection),
                value: current.windSpeed == null ? "—" : `${Math.round(current.windSpeed)}`,
                extra: `km/h · ratxa ${current.windGusts == null ? "—" : Math.round(current.windGusts)}`,
              },
              { label: "Pluja 24 h", value: `${rain24.toFixed(rain24 < 10 ? 1 : 0).replace(".", ",")} mm` },
            ].map((box) => (
              <div key={box.label} className="rounded-xl px-2.5 py-2" style={{ backgroundColor: "var(--muted)" }}>
                <div className="truncate text-[10px]" style={{ color: "var(--muted-foreground)" }}>
                  {box.label}
                </div>
                <div className="mt-0.5 flex items-baseline gap-1">
                  <span className="text-base font-semibold">{box.value}</span>
                </div>
                {"extra" in box && box.extra && (
                  <div className="whitespace-nowrap text-[9px]" style={{ color: "var(--muted-foreground)" }}>
                    {box.extra}
                  </div>
                )}
              </div>
            ))}
          </div>

          {strip.length > 0 && (
            <figure className="pt-1">
              <div className="grid grid-cols-8 gap-0.5 text-center text-[10px]">
                {strip.map((h) => (
                  <div key={h.time} className="flex min-w-0 flex-col items-center gap-0.5">
                    <span style={{ color: "var(--muted-foreground)" }}>{fmtHour(h.time)}</span>
                    <WeatherIcon code={h.weathercode} isDay={h.isDay} className="h-4 w-4" />
                    <span className="font-semibold">{round(h.temperature)}</span>
                  </div>
                ))}
                <div className="col-span-8 mt-1 grid grid-cols-8 gap-0.5 border-t pt-1 text-[9px]" style={{ borderColor: "var(--border)" }}>
                  {strip.map((h) => (
                    <div key={`w-${h.time}`} className="flex flex-col items-center leading-tight">
                      <span className="font-semibold">{Math.round(h.windSpeed ?? 0)}</span>
                      <span style={{ color: "var(--muted-foreground)" }}>{Math.round(h.windGusts ?? 0)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <figcaption className="sr-only">Temperatura, pluja i vent (km/h, ratxa) de les pròximes 24 hores</figcaption>
            </figure>
          )}

          <ul className="divide-y" style={{ borderColor: "var(--border)" }} aria-label="Pròxims dies">
            {daily.slice(0, 6).map((d, i) => {
              const lo = d.temperatureMin ?? 0;
              const hi = d.temperatureMax ?? 0;
              const span = Math.max(1, allMax - allMin);
              return (
                <li key={d.date} className="flex items-center gap-2 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
                  <span className="w-10 shrink-0 text-[12px] font-semibold" style={{ color: i === 0 ? "var(--foreground)" : "var(--muted-foreground)" }}>
                    {i === 0 ? "Avui" : weekdayShort(d.date)}
                  </span>
                  <WeatherIcon code={d.weathercode} className="h-4 w-4 shrink-0" />
                  <span className="w-7 shrink-0 text-right text-[12px]" style={{ color: "var(--muted-foreground)" }}>
                    {round(lo)}
                  </span>
                  <span className="relative h-1.5 flex-1 overflow-hidden rounded-full" style={{ backgroundColor: "var(--muted)" }}>
                    <span
                      className="absolute inset-y-0 rounded-full"
                      style={{
                        left: `${clamp01((lo - allMin) / span) * 100}%`,
                        right: `${(1 - clamp01((hi - allMin) / span)) * 100}%`,
                        background: "linear-gradient(90deg,#4AA3DF,#F2B134,#E4572E)",
                      }}
                    />
                  </span>
                  <span className="w-7 shrink-0 text-[12px] font-semibold">{round(hi)}</span>
                  <span className="w-8 shrink-0 text-right text-[11px]" style={{ color: "var(--chart-rain)" }}>
                    {d.precipitationProbability != null && d.precipitationProbability >= 25 ? `${d.precipitationProbability}%` : ""}
                  </span>
                </li>
              );
            })}
          </ul>

          <Link
            href={`/lloc?lat=${lat}&lon=${lon}&name=${encodeURIComponent(name)}`}
            className="flex items-center justify-center gap-2 rounded py-2.5 text-sm font-medium text-white"
            style={{ backgroundColor: "var(--accent)" }}
          >
            Previsió completa
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      )}
    </aside>
  );
}
