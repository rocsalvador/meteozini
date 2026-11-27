# Copilot instructions for meteozini

Catalan-language, self-hosted weather site for Catalonia (Next.js 15 + React 19 + TypeScript +
Tailwind + MapLibre GL 5). All weather map products are generated locally by `pipeline/` and
served from `data/up/`; there is **no dependency on any third-party Catalan weather site**.

## Commands

```sh
npm run dev:api             # data API on :8787 (tsx watch) — run this first
npm run dev                 # web dev server on :3000 (proxies to the API)
npm run typecheck           # tsc across all workspaces (must pass)
npm run build               # build API (tsc) then web (next build) (must pass)
npm run start:api           # serve the API production build
npm run start               # serve the web production build
./pipeline/run.sh           # regenerate 48 h of AROME products into data/up
./pipeline/run.sh --limit 6 # fast pipeline smoke run
./pipeline/run.sh --force   # rebuild even if the current run is already published
python3 pipeline/fetch_comarques.py   # apps/web/public/comarques.geojson (ICGC WFS)
python3 pipeline/fetch_coastline.py   # apps/web/public/coastline.geojson (Overpass, OSM coastline)
python3 pipeline/fetch_peaks.py       # apps/web/public/peaks.geojson (Overpass)
pipeline/.venv/bin/python pipeline/fetch_snow.py   # CLMS daily snow overlay (needs CDSE OAuth, see .env.example)
pipeline/.venv/bin/python pipeline/fetch_s2.py     # Sentinel-2 mosaic tiles for data/up/static/s2 (same CDSE OAuth)
```

Set `API_BASE_URL` (default `http://localhost:8787`) for the web rewrites and `MZ_DATA_DIR`
(default `data/up`) for the API. There is no automated test suite. Verify with `npm run typecheck`,
`npm run build`, run both servers, and manually check the touched pages in light + dark theme and
at ~390 px width.

## Architecture

The repo is an npm-workspaces monorepo with a strict data/UI split:

- `services/api` (`@meteozini/api`, Hono) is **layer 1**: every upstream proxy,
  the AROME catalogue and the pipeline products. Routes are namespaced under
  `/v1/api/*` (JSON) and `/v1/static/*` (PNG overlays, value grids, wind fields),
  with CORS enabled so a mobile app can consume them directly. Reads `data/up`
  via `MZ_DATA_DIR`. Per-route TTL caching lives in `src/cache.ts`.
- `apps/web` (`@meteozini/web`, Next.js 15) is **layer 2**: a pure client of the
  API. `app/page.tsx` → interactive map (`components/map/map-app.tsx`, wrapped in
  `<Suspense>` because it uses `useSearchParams`); `app/mapes`, `app/models`,
  `app/clima`, `app/lloc`, `app/muntanya`, `app/privadesa`, `app/cookies` are the pages.
  `next.config.ts` rewrites `/api/*`, `/up/api/*` and `/up/static/*` to
  `API_BASE_URL` so client URLs stay same-origin. There are **no** `app/api` or
  `app/up` route handlers and no second app at the repo root: `apps/web` is the only
  Next.js app.
- `/mapes` has exactly two sections, Mesoescala (AROME HD or a gridded model) and
  Observacions. There is no synoptic section: `/v1/api/{gfs,ifs}/maps` was never a route
  and nothing in `pipeline/` writes those products, so do not re-add the section without
  a data source.
- `packages/core` (`@meteozini/core`) holds shared TS: the API response types
  (`MapFrame`, `MapsResponse`, `SatFrames`, `Station`, `ValueGrid`), `weather-meta.ts`
  (labels, units, legend stops, layer groups), `time.ts`, `cities.ts`, plus pure
  helpers (`sampleGrid`, `defaultFrameIndex`, `proxyUrl`, `windFieldUrl`, `valuesUrl`,
  `compassName`). Keep it DOM-free so React Native can reuse it; browser-only code
  (canvas grid decoding) stays in `apps/web/lib/load-grid.ts`.
- `pipeline/` regenerates the AROME products into `data/up` (gitignored, ~800 MB). `build_arome.py`
  compares the newest data.gouv run with the current catalogue and exits without downloading
  when that run is already built (override with `--force`). The API's `/v1/static/*` serves that
  directory; `fetch_comarques.py`/`fetch_coastline.py`/`fetch_peaks.py` write their GeoJSON into
  `apps/web/public/`.
- `pipeline/fetch_snow.py` writes the daily Copernicus CLMS snow overlay
  (`data/up/static/snow/<product>-<date>.png` + `index.json`, read by
  `/v1/api/mountain/snow`). It uses the CLMS BYOC collections on the Copernicus Data Space
  Ecosystem, so it needs `CDSE_CLIENT_ID`/`CDSE_CLIENT_SECRET` in the gitignored root `.env`
  (template in `.env.example`; `run.sh` sources it). Default product is GFSC 60 m gap-filled;
  `--product sce` uses the 500 m SCE. The SCE band arrives with a **+100 offset** (100 = 0 %,
  200 = 100 %, 255 = no data). The step is best-effort: a CDSE failure must not break AROME/IFS.
- `pipeline/fetch_s2.py` writes the recent Sentinel-2 mosaic as WebP tiles under
  `data/up/static/s2`: a 10-day window rendered as 3x3 Process API frames (~89 m/px), composited
  newest-first with SCL cloud masking, cut into z8-z10 tiles, with `index.json` read by
  `/v1/api/satellite/frames?source=s2`. The free CDSE quota is 10 000 requests and 10 000
  processing units per month and one 2500 px frame is ~22 PU, so the step is gated on a free STAC
  query and on the day frames already on disk — never refetch on a timer. A single Process API
  response is capped at 2500x2500 px, and per-tile requests would each pick their own scene and
  show date seams, which is why the mosaic is composited here and not on demand.
- Map UI pieces: `components/map/layers-panel.tsx` (owns the `MapOptions` type),
  `timeline.tsx` (playback + Windy-style time slider + legend; its `TimeSlider` is also used by
  `/mapes`), `forecast-panel.tsx`,
  `wind-particles.tsx`, `static-map.tsx` (used by `/mapes`; it draws the AROME/obs raster over its
  own `web_bounds` but frames the view on `CATALUNYA_BOUNDS`, leaving only a thin margin outside
  Catalonia).
- Model selector: `/v1/api/model/grid` serves gridded data for IFS HRES, GFS, ICON Global, GEM,
  AROME HD and ICON-EU. The model list lives once in `services/api/src/routes/models.ts`
  (`MODEL_DEFS`) and is reused by the grid route; `apps/web/lib/model-grid.ts` keeps its own
  `MAP_MODELS` only for the display `detail` strings. One Open-Meteo request fetches all variables for a model (multi-location
  calls are billed per location, so per-variable requests would exhaust the quota), and the bundle
  is cached in memory and in `data/up/api/model-grid/<model>_<step>.json`; stale/other-resolution
  disk data is served if upstream returns 429. `MODEL_GRID_STEP` defaults to `0.25` (368 calls per
  model bundle) and `MODEL_GRID_REFRESH_HOURS` defaults to 6 h for that resolution; both are env
  overrides. Set `OPEN_METEO_API_KEY` to use the paid `customer-api.open-meteo.com` endpoint.
  IFS can instead be built from ECMWF open data: `pipeline/.venv/bin/python pipeline/fetch_ifs.py
  --hours 72 --resolution 0.1` range-downloads only the needed surface fields from
  `https://data.ecmwf.int/forecasts/.../ifs/0p1/oper/*-sfc.index` (3-hourly, ~500 MB per run,
  ~2 min) and writes the same bundle with `source: "ECMWF open data"`; 0.1° is the highest free IFS
  resolution (0.25° also supported), and visibility/freezing level are not available there. The
  API prefers a pipeline bundle over any Open-Meteo one. `apps/web/lib/model-grid.ts` colours the values with the variable's legend and paints a
  PNG data URL; the interactive map updates an image source and `/mapes` passes the same URL to
  `StaticWeatherMap`. Only AROME HD has pre-generated local PNGs.

## Conventions

- All user-facing copy is **Catalan**, sentence case, no emoji. Aria-labels too.
- Colours only through the CSS variables in `app/globals.css` (`--background`, `--card`,
  `--muted`, `--border`, `--accent`). Never hard-code a colour where a variable exists.
- Every toggle, tab and segmented control uses the selected state from
  `components/selection.ts` (`selectionStyle()`: `--accent` border + `--accent-soft` fill +
  `--accent-text`); don't invent per-control selected colours.
- Design is flat "OpenCode" style: IBM Plex Mono everywhere, 4 px radius, **shadows disabled** in
  `tailwind.config.ts` — use 1 px borders, never `shadow-*`.
- Dark mode is class-based (`html.dark`) via `components/theme.tsx`.
- Register new weather variables once in `packages/core/src/weather-meta.ts` (`VAR_META` + the
  relevant `AROME_GROUPS`/`OBS_GROUPS`/`RADAR_GROUPS` entry) so map, `/mapes` and legends stay in
  sync.
- Rain/snow (instant and accumulated) and graupel share the Meteociel AROME precipitation palette:
  `VAR_META[*].palette` drives the client rasters and legends, and `STEP_PALETTES` in
  `pipeline/build_arome.py` must stay identical for the AROME PNGs. Those rasters use a soft
  alpha ramp + 0.8 px Gaussian blur, and model grids use the same ramp + canvas blur, to avoid
  pixel staircases on precipitation edges.
- Format numbers with `formatValue`/`compactValue` (Catalan decimal comma), dates with
  `packages/core/src/time.ts` and wind directions with `compassName`; never call
  `toLocaleString()` ad hoc.
- Keep the required attribution: `© OpenStreetMap · © OpenFreeMap · Límits © ICGC` in the map
  attribution, `© Mapterhorn` for the DEM, `© OpenTopoMap (CC-BY-SA)` for the topo basemap, and
  the footer source links (Open-Meteo, Meteocat/XEMA, AEMET, ACA, Météo-France, Meteo.ad,
  NOAA/NCEP, EUMETNET/OPERA, EUMETSAT, ICGC).

## Map rules (`components/map/map-app.tsx`)

- Style is built in `baseStyle()`: background + `topo`, `satellite`, `dem` and `hillshade`
  raster sources. Vector sources `places` and `detail` both use the OpenFreeMap planet tileset.
- Layer order matters: weather raster → `detail-*` (water, roads, tracks, buildings, street
  labels) → `values-labels` → coastline/comarques → place labels → peaks → stations → selection.
- Labels are progressive: cities z5.2, towns z7.2, villages z9.2, hamlets z11.5, localities z13;
  peaks only from z11.6 and with the same contrast as place labels.
- Comarca borders fade with zoom (gone by ~z14). The weather raster also fades with zoom so
  roads/trails stay readable; **do not add any extra opacity reduction for 3D** — 3D must keep
  the same colours as the 2D view.
- 3D: `MapOptions.allow3d` is the user-facing switch. When on, a `pitch` listener turns terrain
  on above 20° and off below 4°; in 3D `maxPitch` is 58, buildings are hidden, vector detail and
  labels are hidden during gestures, and wind particles pause. When off, `maxPitch` is 0 so the
  map cannot be tilted at all (helps slow devices).
- Search and geolocation arrive as `/?lat=…&lon=…&name=…`; the map flies there and selects the
  point instead of navigating to `/lloc`. Map clicks name the point using the nearest settlement
  from the loaded `place` tiles, falling back to `packages/core/src/cities.ts`.
- Keep `minZoom` (raster-coverage based), `maxZoom: 16` and the bounds clamp intact.

## Pitfalls

- Files added to `apps/web/public/` after `npm run build` return 404 until the app is rebuilt.
- MapLibre GL v5 resolves custom tile protocols inside its worker, so main-thread `addProtocol`
  is insufficient for vector sources; the `maplibre-contour` approach was removed because of
  this. Contour lines come from the OpenTopoMap basemap — do not reintroduce a half-working
  vector contour layer.
- Next's data cache refuses upstream bodies > 2 MB (ERA5, some EUMETSAT images) and logs
  warnings; keep using module-level caches/explicit headers as the existing routes do.
- `data/up/` is gitignored: a fresh checkout must run `./pipeline/run.sh` before the map has
  anything to draw. AROME runs only exist once Météo-France has published the SP1/SP2 packages.
- Secrets (`CDSE_*`, `OPEN_METEO_API_KEY`) go in the gitignored root `.env` (template in
  `.env.example`), never in a tracked file.
- The AROME grid is 1.3 km, so anything past `maxZoom` is upscaled — do not promise
  street-level precision for the weather field.
