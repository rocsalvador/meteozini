export const TIME_ZONE = "Europe/Madrid";

const hourFmt = new Intl.DateTimeFormat("ca-ES", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: TIME_ZONE,
});

const weekdayFmt = new Intl.DateTimeFormat("ca-ES", { weekday: "short", timeZone: TIME_ZONE });
const dayFmt = new Intl.DateTimeFormat("ca-ES", { day: "numeric", timeZone: TIME_ZONE });
const monthShortFmt = new Intl.DateTimeFormat("ca-ES", { month: "short", timeZone: TIME_ZONE });
const monthLongFmt = new Intl.DateTimeFormat("ca-ES", { month: "long", timeZone: TIME_ZONE });
const dayNumFmt = new Intl.DateTimeFormat("ca-ES", { day: "numeric", timeZone: TIME_ZONE });

export function fmtHour(value: Date | string | number): string {
  return hourFmt.format(new Date(value));
}

export function weekdayShort(value: Date | string | number): string {
  return weekdayFmt.format(new Date(value)).replace(".", "");
}

/** "dg. 22 · 15:00" */
export function frameShortLabel(value: Date | string | number): string {
  const d = new Date(value);
  return `${weekdayShort(d)}. ${dayFmt.format(d)} · ${fmtHour(d)}`;
}

/** "22 de nov., 15:00 CET" */
export function frameLongLabel(value: Date | string | number): string {
  const d = new Date(value);
  return `${dayNumFmt.format(d)} de ${monthShortFmt.format(d).replace(".", "")}., ${fmtHour(d)} CET`;
}

export function monthLong(value: Date | string | number): string {
  return monthLongFmt.format(new Date(value));
}

export function isoDay(value: Date | string | number): string {
  const d = new Date(value);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

