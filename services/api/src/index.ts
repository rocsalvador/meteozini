import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { DATA_DIR } from "./data.js";
import catalog from "./routes/catalog.js";
import climate from "./routes/climate.js";
import climatology from "./routes/climatology.js";
import ensemble from "./routes/ensemble.js";
import geocode from "./routes/geocode.js";
import models from "./routes/models.js";
import modelgrid from "./routes/modelgrid.js";
import mountain from "./routes/mountain.js";
import radar from "./routes/radar.js";
import satellite from "./routes/satellite.js";
import stations from "./routes/stations.js";
import staticRoutes from "./routes/static.js";
import weather from "./routes/weather.js";

// The Copernicus satellite source needs the CDSE OAuth client, which lives in the
// gitignored repo-root .env. Load it when it has not been exported already.
if (!process.env.CDSE_CLIENT_ID) {
  try {
    process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
  } catch {
    /* no root .env — the Copernicus source will report itself unavailable */
  }
}

const app = new Hono();

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: process.env.API_CORS_ORIGIN ?? "*",
    allowMethods: ["GET", "HEAD", "OPTIONS"],
    maxAge: 86_400,
  }),
);

app.get("/health", (c) => c.json({ ok: true, data_dir: DATA_DIR }));

// Open-Meteo proxies
app.route("/v1/api", weather);
app.route("/v1/api", geocode);
app.route("/v1/api", models);
app.route("/v1/api", modelgrid);
app.route("/v1/api", ensemble);
app.route("/v1/api", climate);
app.route("/v1/api", climatology);
app.route("/v1/api", mountain);

// Observation / radar / satellite / catalogue
app.route("/v1/api", stations);
app.route("/v1/api", radar);
app.route("/v1/api", satellite);
app.route("/v1/api", catalog);

// Pipeline products (PNG overlays, value grids, wind fields)
app.route("/v1", staticRoutes);

app.notFound((c) => c.json({ error: "not found" }, 404));

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`meteozini api on http://localhost:${info.port} (data: ${DATA_DIR})`);
});

export default app;
