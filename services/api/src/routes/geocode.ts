import { Hono } from "hono";
import { fetchJson } from "../cache.js";

const router = new Hono();

router.get("/geocode", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 2) return c.json({ results: [] });

  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", q);
  url.searchParams.set("count", "8");
  url.searchParams.set("language", "ca");
  url.searchParams.set("format", "json");

  try {
    const data = await fetchJson<{ results?: any[] }>(url.toString(), 86_400_000);
    const results = (data.results ?? []).map((r) => ({
      name: r.name,
      admin1: r.admin1 ?? null,
      country: r.country_code ?? r.country ?? null,
      latitude: r.latitude,
      longitude: r.longitude,
      elevation: r.elevation ?? null,
      population: r.population ?? null,
    }));
    return c.json({ results });
  } catch (error) {
    return c.json({ results: [], error: String(error) }, 502);
  }
});

export default router;
