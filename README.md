# meteozini

Self-hosted, weather site for Catalonia.

Next.js 15 · React 19 · TypeScript · Tailwind · MapLibre GL 5 · Hono · Python pipeline.

## Quick start

```sh
npm install
./pipeline/run.sh --limit 6   # needs the pipeline venv, see below
npm run dev:api               # data API on :8787 — start this first
npm run dev                   # web app on :3000
```

Without `data/up` the map has nothing to draw; `./pipeline/run.sh` (no `--limit`) builds 48 h of
products. `npm run typecheck` and `npm run build` must pass. There is no test suite: check the
touched pages in light and dark theme and at ~390 px width.

## Layout

- `apps/web` — Next.js app: interactive map (`app/page.tsx`) and the `/mapes`, `/models`,
  `/clima`, `/lloc`, `/muntanya`, `/privadesa`, `/cookies` pages.
- `services/api` — Hono API under `/v1/api/*` (JSON) and `/v1/static/*` (pipeline PNGs, value
  grids), CORS-enabled. Reads `data/up` via `MZ_DATA_DIR`.
- `packages/core` — shared, DOM-free TypeScript: response types, legend/label metadata,
  formatting helpers.
- `pipeline/` — Python (numpy, Pillow, eccodes) jobs that write the map products into
  `data/up` (gitignored) and the GeoJSON files into `apps/web/public`.
  `pipeline/.venv` + `./pipeline/run.sh` is the supported entry point.

## Configuration

| Variable | Default | Used by |
| --- | --- | --- |
| `API_BASE_URL` | `http://localhost:8787` | web rewrites |
| `MZ_DATA_DIR` | `data/up` | API |
| `PORT` | `8787` | API |
| `MODEL_GRID_STEP` / `MODEL_GRID_REFRESH_HOURS` | `0.25` / `6` | gridded models |
| `OPEN_METEO_API_KEY` | — | paid Open-Meteo endpoint |
| `CDSE_CLIENT_ID` / `CDSE_CLIENT_SECRET` | — | daily CLMS snow overlay and the Sentinel-2 satellite source |

Secrets live in the gitignored root `.env` (template: `.env.example`); the API loads that file
itself when `CDSE_CLIENT_ID` is not already exported.

The satellite tab of the map has a source selector: Meteosat (live, 10-minute frames, EUMETSAT)
or Sentinel-2 (Copernicus, a 30-day mosaic served through the CDSE process API). Without CDSE
credentials the Sentinel-2 source reports an empty frame set, so nothing is drawn.

Basemap data: © OpenStreetMap · © OpenFreeMap · Límits © ICGC; relief © Mapterhorn; topo
© OpenTopoMap (CC-BY-SA). Weather data from Open-Meteo, Météo-France (AROME), Meteocat/XEMA,
AEMET, ACA, Météo-France, Meteo.ad, NOAA/NCEP, EUMETNET/OPERA, EUMETSAT and ICGC.
