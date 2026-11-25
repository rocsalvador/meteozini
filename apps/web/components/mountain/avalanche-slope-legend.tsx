import { AVALANCHE_SLOPES } from "@meteozini/core";

/** ICGC slope-angle legend for the avalanche slope raster. */
export function AvalancheSlopeLegend({ className = "" }: { className?: string }) {
  return (
    <div
      className={`rounded-md border px-2 py-1.5 ${className}`}
      style={{
        backgroundColor: "var(--card)",
        borderColor: "var(--border)",
        color: "var(--card-foreground)",
      }}
      aria-label="Llegenda de pendents d'allaus de l'ICGC"
    >
      <div className="mb-1 text-[9px] font-bold uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>
        Pendents · ICGC
      </div>
      <ul className="space-y-0.5">
        {AVALANCHE_SLOPES.map((slope) => (
          <li key={slope.id} className="flex items-center gap-1.5 text-[10px]">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: slope.color }} />
            <span className="font-semibold">{slope.label}</span>
            <span className="font-mono" style={{ color: "var(--muted-foreground)" }}>
              {slope.range}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
