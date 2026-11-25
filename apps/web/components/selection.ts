import type { CSSProperties } from "react";

/**
 * Shared look for toggle and segmented controls: the selected option is the only
 * accent treatment on a control (flat 1 px border, no shadow).
 */
export function selectionStyle(active: boolean): CSSProperties {
  return {
    borderColor: active ? "var(--accent)" : "var(--border)",
    backgroundColor: active ? "var(--accent-soft)" : "transparent",
    color: active ? "var(--accent-text)" : "var(--muted-foreground)",
  };
}
