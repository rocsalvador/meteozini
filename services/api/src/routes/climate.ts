import { Hono } from "hono";

type Row = { date: string; tmax: number | null; tmin: number | null; tmean: number | null; precip: number | null };

const cache = new Map<string, { at: number; data: any }>();
const TTL = 6 * 60 * 60 * 1000;

function keyOf(date: string) {
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  return m * 100 + d;
}

function buildNormals(rows: Row[]) {
  const byKey = new Map<number, number[]>();
  for (const row of rows) {
    if (row.tmax == null) continue;
    const k = keyOf(row.date);
    const arr = byKey.get(k) ?? [];
    arr.push(row.tmax);
    byKey.set(k, arr);
  }
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const normals = new Map<number, { mean: number; p10: number; p90: number; values: number[] }>();
  for (let i = 0; i < sorted.length; i += 1) {
    const row = sorted[i];
    if (row.tmax == null) continue;
    const k = keyOf(row.date);
    if (normals.has(k)) continue;
    const values: number[] = [];
    for (let j = Math.max(0, i - 5); j <= Math.min(sorted.length - 1, i + 5); j += 1) {
      const v = sorted[j].tmax;
      if (v != null) values.push(v);
    }
    if (values.length < 5) continue;
    values.sort((a, b) => a - b);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const q = (p: number) => values[Math.min(values.length - 1, Math.max(0, Math.round((values.length - 1) * p)))];
    normals.set(k, { mean, p10: q(0.1), p90: q(0.9), values });
  }
  return normals;
}

function percentileRank(values: number[], value: number) {
  let below = 0;
  for (const v of values) if (v < value) below += 1;
  return Math.round((below / values.length) * 100);
}

async function compute(lat: number, lon: number) {
  const today = new Date();
  const end = today.toISOString().slice(0, 10);
  const url = new URL("https://archive-api.open-meteo.com/v1/archive");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("start_date", "1950-01-01");
  url.searchParams.set("end_date", end);
  url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum");
  url.searchParams.set("timezone", "Europe/Madrid");

  const res = await fetch(url);
  if (!res.ok) throw new Error(`archive ${res.status}`);
  const data = await res.json();
  const daily = data.daily ?? { time: [] };
  const rows: Row[] = daily.time.map((date: string, i: number) => ({
    date,
    tmax: daily.temperature_2m_max?.[i] ?? null,
    tmin: daily.temperature_2m_min?.[i] ?? null,
    tmean: daily.temperature_2m_mean?.[i] ?? null,
    precip: daily.precipitation_sum?.[i] ?? null,
  }));

  const base = rows.filter((r) => r.date >= "1991-01-01" && r.date <= "2020-12-31");
  const normals = buildNormals(base);

  const cell = (row: Row) => {
    const n = normals.get(keyOf(row.date));
    if (!n || row.tmax == null) return null;
    return {
      date: row.date,
      anomaly: Math.round((row.tmax - n.mean) * 10) / 10,
      percentile: percentileRank(n.values, row.tmax),
      value: Math.round(row.tmax * 10) / 10,
    };
  };

  const nowYear = Number(end.slice(0, 4));
  const nowMonth = Number(end.slice(5, 7));

  const monthRows = rows.filter((r) => r.date >= `${nowYear}-${String(nowMonth).padStart(2, "0")}-01` && r.date <= end);
  const monthCells = monthRows.map(cell).filter(Boolean) as NonNullable<ReturnType<typeof cell>>[];
  const monthAnomalies = monthCells.map((c) => c.anomaly);
  const monthSummary = {
    meanAnomaly: monthAnomalies.length ? Math.round((monthAnomalies.reduce((a, b) => a + b, 0) / monthAnomalies.length) * 100) / 100 : null,
    daysAboveP90: monthCells.filter((c) => c.percentile >= 90).length,
    daysBelowP10: monthCells.filter((c) => c.percentile <= 10).length,
  };

  const yearCells = rows.filter((r) => r.date.startsWith(`${nowYear}-`)).map(cell).filter(Boolean);
  const yearAnomalies = (yearCells as NonNullable<ReturnType<typeof cell>>[]).map((c) => c.anomaly);
  const yearSummary = {
    year: nowYear,
    meanAnomaly: yearAnomalies.length ? Math.round((yearAnomalies.reduce((a, b) => a + b, 0) / yearAnomalies.length) * 100) / 100 : null,
    daysAboveP90: (yearCells as NonNullable<ReturnType<typeof cell>>[]).filter((c) => c.percentile >= 90).length,
    daysBelowP10: (yearCells as NonNullable<ReturnType<typeof cell>>[]).filter((c) => c.percentile <= 10).length,
  };

  const monthAgg: { sum: number; n: number; precip: number; rainDays: number }[] = Array.from({ length: 12 }, () => ({ sum: 0, n: 0, precip: 0, rainDays: 0 }));
  for (const r of base) {
    const m = Number(r.date.slice(5, 7)) - 1;
    if (r.tmean != null) {
      monthAgg[m].sum += r.tmean;
      monthAgg[m].n += 1;
    }
    if (r.precip != null) {
      monthAgg[m].precip += r.precip;
      if (r.precip >= 1) monthAgg[m].rainDays += 1;
    }
  }
  const yearsBase = base.length ? new Set(base.map((r) => r.date.slice(0, 4))).size : 30;
  const monthlyNormals = monthAgg.map((a) => ({
    tmean: a.n ? Math.round((a.sum / a.n) * 10) / 10 : null,
    precip: Math.round((a.precip / yearsBase) * 10) / 10,
    rainDays: Math.round((a.rainDays / yearsBase) * 10) / 10,
  }));

  const yearAgg = new Map<number, { sum: number; n: number }>();
  for (const r of rows) {
    if (r.tmean == null) continue;
    const y = Number(r.date.slice(0, 4));
    const agg = yearAgg.get(y) ?? { sum: 0, n: 0 };
    agg.sum += r.tmean;
    agg.n += 1;
    yearAgg.set(y, agg);
  }
  const baseYears = [...yearAgg.entries()].filter(([y]) => y >= 1991 && y <= 2020);
  const baseMean = baseYears.reduce((a, [, v]) => a + v.sum / v.n, 0) / Math.max(1, baseYears.length);
  const series = [...yearAgg.entries()]
    .map(([year, v]) => ({ year, anomaly: Math.round((v.sum / v.n - baseMean) * 100) / 100, incomplete: year === nowYear }))
    .sort((a, b) => a.year - b.year);

  const complete = series.filter((s) => !s.incomplete);
  const n = complete.length;
  const xMean = complete.reduce((a, s) => a + s.year, 0) / Math.max(1, n);
  const yMean = complete.reduce((a, s) => a + s.anomaly, 0) / Math.max(1, n);
  const slope = complete.reduce((a, s) => a + (s.year - xMean) * (s.anomaly - yMean), 0) / Math.max(1, complete.reduce((a, s) => a + (s.year - xMean) ** 2, 0));

  const warmest = [...complete].sort((a, b) => b.anomaly - a.anomaly).slice(0, 3).map((s) => s.year);
  const lastDecade = complete.filter((s) => s.year >= nowYear - 10).sort((a, b) => b.anomaly - a.anomaly);
  const topTen = [...complete].sort((a, b) => b.anomaly - a.anomaly).slice(0, 10);

  const hottestMonth = monthlyNormals.reduce((best, m, i) => (m.tmean != null && (best == null || m.tmean > monthlyNormals[best].tmean!)) ? i : best, null as number | null);
  const coldestMonth = monthlyNormals.reduce((best, m, i) => (m.tmean != null && (best == null || m.tmean < monthlyNormals[best].tmean!)) ? i : best, null as number | null);
  const wettestMonth = monthlyNormals.reduce((best, m, i) => (best == null || m.precip > monthlyNormals[best].precip) ? i : best, null as number | null);
  const annualPrecip = monthlyNormals.reduce((a, m) => a + m.precip, 0);

  return {
    location: { latitude: data.latitude, longitude: data.longitude, elevation: data.elevation },
    month: { year: nowYear, month: nowMonth, cells: monthCells, summary: monthSummary },
    year: { cells: yearCells, summary: yearSummary },
    monthlyNormals,
    series,
    stats: {
      trendPerDecade: Math.round(slope * 10 * 100) / 100,
      topTenWarmDecade: topTen.filter((s) => s.year >= nowYear - 10).length,
      warmest,
      lastDecade,
      hottestMonth,
      coldestMonth,
      wettestMonth,
      annualPrecip: Math.round(annualPrecip),
    },
    generatedAt: new Date().toISOString(),
  };
}

const router = new Hono();

router.get("/climate", async (c) => {
  const lat = Number(c.req.query("lat"));
  const lon = Number(c.req.query("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return c.json({ error: "lat and lon required" }, 400);
  }
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return c.json(hit.data);

  try {
    const data = await compute(lat, lon);
    cache.set(key, { at: Date.now(), data });
    if (cache.size > 40) cache.delete(cache.keys().next().value as string);
    return c.json(data);
  } catch (error) {
    return c.json({ error: String(error) }, 502);
  }
});

export default router;
