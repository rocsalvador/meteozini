"use client";

import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Pause,
  Play,
} from "lucide-react";
import { VAR_META, frameShortLabel, fmtHour, weekdayShort } from "@meteozini/core";
import { selectionStyle } from "@/components/selection";

export function Legend({ variable }: { variable: string | null }) {
  const meta = variable ? VAR_META[variable] : null;
  if (!meta) return null;
  return (
    <div className="relative h-[18px] w-full" style={{ background: meta.legend }} aria-label={`Escala: ${meta.stops.join(", ")} ${meta.unit}`}>
      <div className="legend-inside absolute inset-0 font-mono text-[10px] font-semibold text-white">
        {meta.stops.map((s, i) => {
          const p = meta.stopPositions?.[i] ?? (meta.stops.length > 1 ? i / (meta.stops.length - 1) : 0);
          const translate =
            i === 0
              ? "translateY(-50%)"
              : i === meta.stops.length - 1
                ? "translate(-100%, -50%)"
                : "translate(-50%, -50%)";
          return (
            <span
              key={`${s}-${i}`}
              className="absolute top-1/2 whitespace-nowrap"
              style={{ left: `${p * 100}%`, transform: translate }}
            >
              {s}
            </span>
          );
        })}
        {meta.unit && !meta.stopPositions && <span className="absolute right-1 top-1/2 -translate-y-1/2">{meta.unit}</span>}
      </div>
    </div>
  );
}

/** Hour axis + range input, shared by the interactive map and `/mapes`. */
export function TimeSlider({
  times,
  index,
  count,
  onIndex,
  className = "px-2.5 pt-0.5 sm:px-3",
}: {
  times: string[];
  index: number;
  count: number;
  onIndex: (i: number) => void;
  className?: string;
}) {
  const disabled = count <= 1;
  const progress = count > 1 ? (index / (count - 1)) * 100 : 0;
  const label = times[index] ? frameShortLabel(times[index]) : "—";

  // Sparse hour axis: day changes are always labelled, otherwise a nice hour
  // interval. Ticks are aligned to the first frame (models can start at :00,
  // :01 or :07), not to wall-clock hour divisibility.
  const firstMs = times.length ? Date.parse(times[0]) : NaN;
  const lastMs = times.length ? Date.parse(times[times.length - 1]) : NaN;
  const spanHours = Number.isFinite(firstMs) && Number.isFinite(lastMs) ? Math.max(0, (lastMs - firstMs) / 3_600_000) : 0;
  const intervalHours = [3, 6, 12, 24].find((hours) => spanHours / hours <= 8) ?? 24;
  const ticks = times.flatMap((stamp, i) => {
    const d = new Date(stamp);
    const prev = i > 0 ? new Date(times[i - 1]) : null;
    const dayStart = !prev || d.getDate() !== prev.getDate();
    const elapsed = Number.isFinite(firstMs) ? (d.getTime() - firstMs) / 3_600_000 : 0;
    const onInterval = Math.abs(elapsed % intervalHours) < 0.01 || Math.abs((elapsed % intervalHours) - intervalHours) < 0.01;
    if (!dayStart && !onInterval) return [];
    return [
      {
        i,
        dayStart,
        text: dayStart ? `${weekdayShort(d)} ${d.getDate()}` : fmtHour(d).replace(":00", "h"),
      },
    ];
  });

  // "Now" marker, like Windy's reference line.
  const nowMs = Date.now();
  const nowIdx = times.findIndex((stamp) => new Date(stamp).getTime() >= nowMs);
  const nowPct = nowIdx > 0 && count > 1 ? (nowIdx / (count - 1)) * 100 : null;

  return (
    <div className={className}>
      <div className="relative pb-1">
        <div className="relative h-3.5">
          {ticks.map((tick) => {
            const pct = (tick.i / (count - 1)) * 100;
            const translate = tick.i === 0 ? "0%" : tick.i === count - 1 ? "-100%" : "-50%";
            return (
              <span
                key={tick.i}
                className="pointer-events-none absolute top-0 whitespace-nowrap font-mono text-[9px] leading-3.5"
                style={{
                  left: `${pct}%`,
                  transform: `translateX(${translate})`,
                  color: tick.dayStart ? "var(--foreground)" : "var(--muted-foreground)",
                  fontWeight: tick.dayStart ? 700 : 500,
                }}
              >
                {tick.text}
              </span>
            );
          })}
        </div>
        {nowPct != null && (
          <span
            aria-hidden
            className="pointer-events-none absolute bottom-0 z-0 w-px"
            style={{ left: `${nowPct}%`, top: 0, backgroundColor: "var(--foreground)", opacity: 0.35 }}
          />
        )}
        <input
          type="range"
          min={0}
          max={Math.max(0, count - 1)}
          step={1}
          value={index}
          disabled={disabled}
          onChange={(event) => onIndex(Number(event.target.value))}
          aria-label="Hora del mapa"
          aria-valuetext={label}
          className="mz-range -mt-0.5 block"
          style={{ "--mz-progress": `${progress}%` } as React.CSSProperties}
        />
      </div>
    </div>
  );
}

/** Speed picker, shared by the interactive map and `/mapes`. */
export function SpeedSelector({
  speed,
  onSpeed,
  disabled = false,
  className = "ml-1 flex items-center gap-0.5 text-[11px] font-semibold",
}: {
  speed: number;
  onSpeed: (s: number) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div role="group" aria-label="Velocitat de reproducció" className={className}>
      {[1, 2, 3].map((s) => (
        <button
          key={s}
          type="button"
          aria-pressed={speed === s}
          aria-label={`Velocitat ${s}×`}
          disabled={disabled}
          onClick={() => onSpeed(s)}
          className="rounded-md border px-2 py-0.5 text-[11px] font-semibold disabled:opacity-35"
          style={selectionStyle(speed === s)}
        >
          {s}×
        </button>
      ))}
    </div>
  );
}

export function Timeline({
  sourceLabel,
  time,
  index,
  count,
  onIndex,
  playing,
  onPlay,
  speed,
  onSpeed,
  variable,
  variableLabel,
  onOpenLayers,
  tabs,
  leadingHref,
  times,
  extraLegend,
  timeText,
}: {
  sourceLabel: string;
  time: string | null;
  index: number;
  count: number;
  onIndex: (i: number) => void;
  playing: boolean;
  onPlay: () => void;
  speed: number;
  onSpeed: (s: number) => void;
  variable: string | null;
  variableLabel: string | null;
  onOpenLayers: () => void;
  tabs?: React.ReactNode;
  leadingHref?: { href: string; label: string };
  times?: string[];
  extraLegend?: React.ReactNode;
  timeText?: string;
}) {
  const disabled = count <= 1;
  const label = timeText ?? (time ? frameShortLabel(time) : "—");
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 px-2 pb-[max(8px,env(safe-area-inset-bottom))] sm:px-3 sm:pb-3">
      <div
        className="pointer-events-auto mx-auto max-w-[620px] overflow-hidden rounded-2xl border"
        style={{ backgroundColor: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)" }}
      >
        <span className="sr-only" data-testid="map-source-label">
          {sourceLabel}
        </span>
        {tabs}
        <div className="flex items-center justify-between gap-2 px-2 pb-1.5 pt-1.5 sm:flex-col sm:justify-center sm:gap-1 sm:px-2.5 sm:pb-2 sm:pt-2">
          <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
            {leadingHref && (
              <a
                href={leadingHref.href}
                className="mr-1 hidden rounded-full border px-2 py-1 text-[11px] font-semibold sm:inline-block"
                style={{ borderColor: "var(--border)" }}
              >
                {leadingHref.label}
              </a>
            )}
            <button
              type="button"
              disabled={disabled || index <= 0}
              onClick={() => onIndex(0)}
              aria-label="Primera hora"
              className="grid h-7 w-7 place-items-center rounded-full border disabled:opacity-35 sm:h-8 sm:w-8"
              style={{ borderColor: "var(--border)" }}
            >
              <ChevronsLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              disabled={disabled || index <= 0}
              onClick={() => onIndex(index - 1)}
              aria-label="Hora anterior"
              className="grid h-8 w-8 place-items-center rounded-full border disabled:opacity-35 sm:h-9 sm:w-9"
              style={{ borderColor: "var(--border)" }}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={onPlay}
              aria-label={playing ? "Pausa" : "Reprodueix"}
              className="grid h-9 w-9 place-items-center rounded-full text-white disabled:opacity-35 sm:h-10 sm:w-10"
              style={{ backgroundColor: "var(--accent)" }}
            >
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-px" />}
            </button>
            <button
              type="button"
              disabled={disabled || index >= count - 1}
              onClick={() => onIndex(index + 1)}
              aria-label="Hora següent"
              className="grid h-8 w-8 place-items-center rounded-full border disabled:opacity-35 sm:h-9 sm:w-9"
              style={{ borderColor: "var(--border)" }}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              disabled={disabled || index >= count - 1}
              onClick={() => onIndex(count - 1)}
              aria-label="Última hora"
              className="grid h-7 w-7 place-items-center rounded-full border disabled:opacity-35 sm:h-8 sm:w-8"
              style={{ borderColor: "var(--border)" }}
            >
              <ChevronsRight className="h-4 w-4" />
            </button>
            <SpeedSelector
              speed={speed}
              onSpeed={onSpeed}
              disabled={disabled}
              className="ml-1 hidden items-center gap-0.5 sm:flex"
            />
          </div>
          <div className="flex min-w-0 max-w-full flex-col items-end gap-0 sm:flex-row sm:items-center sm:justify-center sm:gap-1.5">
            <span className="shrink-0 whitespace-nowrap font-mono text-[12px] font-semibold">{label}</span>
            {variableLabel && (
              <button
                type="button"
                onClick={onOpenLayers}
                className="hidden min-h-[26px] min-w-0 items-center gap-0.5 rounded-md px-1.5 text-[12px] font-semibold hover:bg-black/5 dark:hover:bg-white/10 sm:inline-flex"
                aria-label={`Capa: ${variableLabel}. Canvia-la`}
              >
                <span className="truncate">{variableLabel}</span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
              </button>
            )}
            {count > 1 && <span className="font-mono text-[10px] sm:hidden" style={{ color: "var(--muted-foreground)" }}>{index + 1}/{count}</span>}
          </div>
        </div>
        {count > 1 && <TimeSlider times={times ?? []} index={index} count={count} onIndex={onIndex} />}
        {extraLegend}
        {variable && (
          <div className="-mt-1">
            <Legend variable={variable} />
          </div>
        )}
      </div>
    </div>
  );
}
