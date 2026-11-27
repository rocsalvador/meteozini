import { setWorkerUrl } from "maplibre-gl";

// Turbopack rewrites MapLibre's import.meta.url to a disk path instead of its emitted worker asset.
setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).toString());

export * from "maplibre-gl";
