"use client";

import {
  AVALANCHE_DANGER,
  AVALANCHE_SLOPES,
  CLMS_SNOW_ATTRIBUTION,
  CLMS_SNOW_URL,
  SNOW_COVER_STOPS,
} from "@meteozini/core";

const TITLE = "text-[9px] font-bold uppercase tracking-wider";

function Swatch({ color, shape = "square" }: { color: string; shape?: "square" | "circle" }) {
  return (
    <span
      className={`h-2.5 w-2.5 shrink-0 ${shape === "circle" ? "rounded-full" : "rounded-sm"}`}
      style={{ backgroundColor: color }}
    />
  );
}

/**
 * Compact legends for the mountain overlays (snow cover, avalanche slopes and
 * the ICGC danger bulletin). Rendered inside the bottom time bar so they stay
 * readable on phones instead of floating over the map.
 */
export function OverlayLegends({
  snowCover,
  avalancheSlopes,
  avalancheRisk,
  snowEmpty,
}: {
  snowCover: boolean;
  avalancheSlopes: boolean;
  avalancheRisk: boolean;
  snowEmpty?: boolean;
}) {
  if (!snowCover && !avalancheSlopes && !avalancheRisk) return null;
  const gradient = SNOW_COVER_STOPS.map((stop) => stop.color).join(", ");

  return (
    <div className="space-y-1 border-t px-2 py-1.5" style={{ borderColor: "var(--border)" }}>
      {snowCover && (
        <div>
          <div className={TITLE} style={{ color: "var(--muted-foreground)" }}>
            Neu al terra
          </div>
          {snowEmpty ? (
            <div className="text-[9px]" style={{ color: "var(--muted-foreground)" }}>
              Sense neu observada
            </div>
          ) : (
            <>
              <div className="h-1.5 w-full rounded-sm" style={{ background: `linear-gradient(90deg, ${gradient})` }} />
              <div className="flex justify-between font-mono text-[9px]" style={{ color: "var(--muted-foreground)" }}>
                {SNOW_COVER_STOPS.map((stop) => (
                  <span key={stop.value}>{stop.label}</span>
                ))}
              </div>
            </>
          )}
          <a
            href={CLMS_SNOW_URL}
            target="_blank"
            rel="noreferrer"
            className="text-[8px] underline-offset-2 hover:underline"
            style={{ color: "var(--muted-foreground)" }}
          >
            {CLMS_SNOW_ATTRIBUTION}
          </a>
        </div>
      )}

      {avalancheSlopes && (
        <div>
          <div className={TITLE} style={{ color: "var(--muted-foreground)" }}>
            Pendents · ICGC
          </div>
          <ul className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-[9px]">
            {AVALANCHE_SLOPES.map((slope) => (
              <li key={slope.id} className="flex items-center gap-1">
                <Swatch color={slope.color} />
                <span className="font-semibold">{slope.label}</span>
                <span className="font-mono" style={{ color: "var(--muted-foreground)" }}>
                  {slope.range}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {avalancheRisk && (
        <div>
          <div className={TITLE} style={{ color: "var(--muted-foreground)" }}>
            Perill d&apos;allaus · ICGC
          </div>
          <ul className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-[9px]">
            {AVALANCHE_DANGER.filter((danger) => danger.level > 0).map((danger) => (
              <li key={danger.level} className="flex items-center gap-1">
                <Swatch color={danger.color} shape="circle" />
                <span className="font-mono font-bold">{danger.short}</span>
                <span>{danger.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
