"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import {
  AVALANCHE_DANGER,
  AVALANCHE_SLOPES,
  CLMS_SNOW_ATTRIBUTION,
  CLMS_SNOW_URL,
  SNOW_COVER_STOPS,
  type SnowCoverDay,
} from "@meteozini/core";
import type { MapOptions } from "@/components/map/layers-panel";

const LABEL = "text-[10px]";

function Toggle({
  on,
  label,
  onToggle,
}: {
  on: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className="flex w-full items-center justify-between gap-2 py-1 text-left text-[12px] font-semibold hover:text-[color:var(--accent)]"
    >
      <span>{label}</span>
      <span
        className="relative h-4 w-7 shrink-0 rounded-full transition-colors"
        style={{ backgroundColor: on ? "var(--accent)" : "var(--border)" }}
      >
        <span
          className="absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all"
          style={{ left: on ? 14 : 2 }}
        />
      </span>
    </button>
  );
}

function Section({
  title,
  on,
  onToggle,
  children,
}: {
  title: string;
  on: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-0.5 border-t pt-1.5" style={{ borderColor: "var(--border)" }}>
      <Toggle on={on} label={title} onToggle={onToggle} />
      {on && <div className="pb-0.5">{children}</div>}
    </div>
  );
}

/** Day axis for the snow raster, kept compact enough for the legend card. */
function SnowDaySlider({
  days,
  index,
  onIndex,
}: {
  days: SnowCoverDay[];
  index: number;
  onIndex: (i: number) => void;
}) {
  const progress = days.length > 1 ? (index / (days.length - 1)) * 100 : 0;
  const day = days[index];
  const label = day ? `${day.date.slice(8, 10)}/${day.date.slice(5, 7)}` : "—";
  return (
    <div className="pt-0.5">
      <div className="flex items-baseline justify-between font-mono text-[10px]" style={{ color: "var(--muted-foreground)" }}>
        <span>{days[0] ? `${days[0].date.slice(8, 10)}/${days[0].date.slice(5, 7)}` : ""}</span>
        <span className="font-bold" style={{ color: "var(--foreground)" }}>
          {label}
        </span>
        <span>{days[days.length - 1] ? `${days[days.length - 1].date.slice(8, 10)}/${days[days.length - 1].date.slice(5, 7)}` : ""}</span>
      </div>
      <input
        type="range"
        min={0}
        max={Math.max(0, days.length - 1)}
        step={1}
        value={index}
        disabled={days.length <= 1}
        onChange={(event) => onIndex(Number(event.target.value))}
        aria-label="Dia de la neu al terra"
        aria-valuetext={label}
        className="mz-range block"
        style={{ "--mz-progress": `${progress}%` } as React.CSSProperties}
      />
    </div>
  );
}

/**
 * Single control + legend card for the mountain view: snow cover, ICGC
 * avalanche slopes and the daily danger scale live here, next to the map,
 * instead of being split between the Capes dialog and two floating legends.
 */
export function MountainLegend({
  options,
  setOptions,
  snowDays = [],
  snowDay = 0,
  setSnowDay,
  snowEmpty,
  className = "",
}: {
  options: MapOptions;
  setOptions: (patch: Partial<MapOptions>) => void;
  snowDays?: SnowCoverDay[];
  snowDay?: number;
  setSnowDay?: (i: number) => void;
  snowEmpty?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(true);
  // On phones the full card covers half the map, so it starts collapsed.
  useEffect(() => {
    if (window.matchMedia("(max-width: 639px)").matches) setOpen(false);
  }, []);
  const gradient = SNOW_COVER_STOPS.map((stop) => stop.color).join(", ");

  return (
    <div
      className={`max-h-[52vh] w-[204px] max-w-[calc(100vw-16px)] overflow-y-auto rounded-md border px-2 py-1.5 ${className}`}
      style={{ backgroundColor: "var(--card)", borderColor: "var(--border)", color: "var(--card-foreground)" }}
      aria-label="Llegenda i capes de muntanya"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-wider"
        style={{ color: "var(--muted-foreground)" }}
      >
        <span>Llegenda</span>
        <ChevronDown className="h-3 w-3 transition-transform" style={{ transform: open ? "rotate(180deg)" : "none" }} />
      </button>

      {open && (
        <div className="mt-1 space-y-1.5">
          <Section
            title="Neu al terra"
            on={options.snowCover}
            onToggle={() => setOptions({ snowCover: !options.snowCover })}
          >
            <div className="h-1.5 w-full rounded-sm" style={{ background: `linear-gradient(90deg, ${gradient})` }} />
            <div className="flex justify-between font-mono text-[9px]" style={{ color: "var(--muted-foreground)" }}>
              {SNOW_COVER_STOPS.map((stop) => (
                <span key={stop.value}>{stop.label}</span>
              ))}
            </div>
            {snowEmpty && (
              <div className="text-[9px]" style={{ color: "var(--muted-foreground)" }}>
                Sense neu observada
              </div>
            )}
            {snowDays.length > 1 && setSnowDay && (
              <SnowDaySlider days={snowDays} index={snowDay} onIndex={setSnowDay} />
            )}
            <a
              href={CLMS_SNOW_URL}
              target="_blank"
              rel="noreferrer"
              className="block text-[9px] underline"
              style={{ color: "var(--muted-foreground)" }}
            >
              {CLMS_SNOW_ATTRIBUTION}
            </a>
          </Section>

          <Section
            title="Pendents d'allaus"
            on={options.avalancheSlopes}
            onToggle={() => setOptions({ avalancheSlopes: !options.avalancheSlopes })}
          >
            <ul className="space-y-0.5">
              {AVALANCHE_SLOPES.map((slope) => (
                <li key={slope.id} className={`flex items-center gap-1.5 ${LABEL}`}>
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: slope.color }} />
                  <span className="font-semibold">{slope.label}</span>
                  <span className="ml-auto font-mono" style={{ color: "var(--muted-foreground)" }}>
                    {slope.range}
                  </span>
                </li>
              ))}
            </ul>
          </Section>

          <Section
            title="Zones de perill"
            on={options.avalancheRisk}
            onToggle={() => setOptions({ avalancheRisk: !options.avalancheRisk })}
          >
            <ul className="space-y-0.5">
              {AVALANCHE_DANGER.filter((danger) => danger.level > 0).map((danger) => (
                <li key={danger.level} className={`flex items-center gap-1.5 ${LABEL}`}>
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: danger.color }} />
                  <span className="font-mono font-bold">{danger.short}</span>
                  <span>{danger.label}</span>
                </li>
              ))}
            </ul>
            <a
              href="https://bpa.icgc.cat/"
              target="_blank"
              rel="noreferrer"
              className="mt-0.5 block text-[9px] underline"
              style={{ color: "var(--muted-foreground)" }}
            >
              © ICGC · Butlletí de perill
            </a>
          </Section>
        </div>
      )}
    </div>
  );
}
