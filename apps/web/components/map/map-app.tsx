"use client";

import maplibregl, { type Map as MapLibreMap, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { LocateFixed, MountainSnow, SlidersHorizontal, X } from "lucide-react";
import { AppHeader } from "@/components/header";
import { selectionStyle } from "@/components/selection";
import {
  VAR_META,
  AROME_GROUPS,
  RADAR_GROUPS,
  compactValue,
  formatValue,
  displayLabel,
  type Bounds,
  type MapFrame,
  type MapsResponse,
  type SatFrames,
  type Station,
  type StationsResponse,
  type SnowCoverIndex,
  type ValueGrid,
  defaultFrameIndex,
  dangerMeta,
  icgcWmsTileUrl,
  proxyUrl,
  sampleGrid,
  windFieldUrl,
  CATALAN_PEAKS,
  nearestCityName,
} from "@meteozini/core";
import { loadValueGrid } from "@/lib/load-grid";
import {
  fetchModelGrid,
  gridResolution,
  modelGridGroups,
  modelGridImage,
  modelSupportsVariable,
  modelLabel,
  sampleModelGrid,
  type ModelGrid,
} from "@/lib/model-grid";
import { WindParticles } from "./wind-particles";
import { LayersPanel, type MapOptions, variableIcon } from "./layers-panel";
import { Timeline } from "./timeline";
import { MountainLegend } from "@/components/mountain/mountain-legend";
import { ForecastPanel, type WeatherData } from "./forecast-panel";

const SATELLITE_TILE =
  "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg";
const DEM_TILE = "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp";

function baseStyle(theme: "light" | "dark"): StyleSpecification {
  return {
    version: 8,
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: {
      topo: {
        type: "raster",
        tiles: ["https://tile.opentopomap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        minzoom: 0,
        maxzoom: 17,
        attribution: "© OpenTopoMap (CC-BY-SA)",
      },
      satellite: {
        type: "raster",
        tiles: [SATELLITE_TILE],
        tileSize: 256,
        minzoom: 0,
        maxzoom: 14,
        attribution: "Sentinel-2 cloudless © EOX / Copernicus",
      },
      dem: {
        type: "raster-dem",
        tiles: [DEM_TILE],
        encoding: "terrarium",
        tileSize: 512,
        maxzoom: 14,
        attribution: "© Mapterhorn",
      },
      // Separate, coarser DEM for the flat-view hillshade: half the tiles, and it stays out of 3D.
      hillshade: {
        type: "raster-dem",
        tiles: [DEM_TILE],
        encoding: "terrarium",
        tileSize: 512,
        maxzoom: 12,
        attribution: "© Mapterhorn",
      },
    },
    layers: [
      { id: "background-land", type: "background", paint: { "background-color": theme === "dark" ? "#201d1d" : "#fdfcfc" } },
      {
        id: "topo-base",
        type: "raster",
        source: "topo",
        layout: { visibility: "none" },
        paint: { "raster-opacity": 1, "raster-fade-duration": 200 },
      },
      {
        id: "satellite-base",
        type: "raster",
        source: "satellite",
        layout: { visibility: "none" },
        paint: {
          "raster-saturation": -0.08,
          "raster-contrast": 0.12,
          "raster-brightness-min": 0.04,
          "raster-brightness-max": 0.94,
          "raster-fade-duration": 250,
        },
      },
      {
        id: "terrain-hillshade",
        type: "hillshade",
        source: "hillshade",
        paint: {
          "hillshade-method": "combined",
          "hillshade-exaggeration": theme === "dark" ? 0.3 : 0.22,
          "hillshade-illumination-altitude": 42,
          "hillshade-illumination-direction": 315,
          "hillshade-shadow-color": theme === "dark" ? "#000000" : "#646262",
          "hillshade-highlight-color": theme === "dark" ? "#3a3535" : "#ffffff",
          "hillshade-accent-color": theme === "dark" ? "#302c2c" : "#9a9898",
        },
      },
    ],
  };
}

const PLACE_LAYER_IDS = ["place-locality", "place-hamlet", "place-village", "place-town", "place-city"];
const SETTLEMENT_CLASSES = new Set(["city", "town", "village", "hamlet", "locality", "isolated_dwelling"]);

/** Nearest settlement loaded in the current tiles, so small villages win over the curated city list. */
function nearestPlaceName(map: MapLibreMap, lat: number, lon: number) {
  let best = Infinity;
  let name: string | null = null;
  try {
    const features = map.querySourceFeatures("places", { sourceLayer: "place" });
    const cos = Math.cos((lat * Math.PI) / 180);
    for (const feature of features) {
      if (feature.geometry.type !== "Point") continue;
      if (!SETTLEMENT_CLASSES.has(String(feature.properties?.class ?? ""))) continue;
      const [flon, flat] = feature.geometry.coordinates as [number, number];
      const dx = (flon - lon) * cos;
      const dy = flat - lat;
      const d = dx * dx + dy * dy;
      const label = String(feature.properties?.name ?? feature.properties?.["name:latin"] ?? "").trim();
      if (!label || d >= best) continue;
      best = d;
      name = label;
    }
  } catch {
    return null;
  }
  return name;
}

function mercatorY(lat: number) {
  return Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
}

/** Smallest zoom at which the painted raster still covers the viewport. */
function coverZoom(bounds: Bounds, width: number, height: number) {
  const lonSpan = Math.max(0.0001, bounds.east - bounds.west);
  const ySpan = Math.max(0.0001, mercatorY(bounds.north) - mercatorY(bounds.south));
  const zx = Math.log2((width * 360) / (512 * lonSpan));
  const zy = Math.log2((height * 2 * Math.PI) / (512 * ySpan));
  return Math.max(zx, zy);
}

function tempColor(t: number | null, stops: [number, string][]) {
  if (t == null) return "#94a3b8";
  if (t <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i += 1) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const f = (t - t0) / Math.max(0.0001, t1 - t0);
      return mixHex(c0, c1, f);
    }
  }
  return stops[stops.length - 1][1];
}

function mixHex(a: string, b: string, f: number) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ar = (pa >> 16) & 255, ag = (pa >> 8) & 255, ab = pa & 255;
  const br = (pb >> 16) & 255, bg = (pb >> 8) & 255, bb = pb & 255;
  return `#${[ar + (br - ar) * f, ag + (bg - ag) * f, ab + (bb - ab) * f]
    .map((v) => Math.round(v).toString(16).padStart(2, "0"))
    .join("")}`;
}

const TEMP_STOPS: [number, string][] = [
  [-10, "#1d87e7"], [0, "#a3faf9"], [10, "#2b763b"], [20, "#fff1bd"], [30, "#e25b39"], [40, "#a64093"],
];

type SourceKind = "arome" | "obs" | "radar" | "sat";

type AvalancheZoneCollection = {
  type: "FeatureCollection";
  features: { type: "Feature"; properties: { id: string; name: string }; geometry: unknown }[];
};

type AvalancheBulletin = { zones: { id: string; danger: number }[] };

export default function MapApp() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);

  const [mode, setMode] = useState<"models" | "obs" | "muntanya">("models");
  const [obsTab, setObsTab] = useState<"stations" | "radar" | "satellite">("stations");

  const [mapModel, setMapModel] = useState("arome");
  const [modelGrid, setModelGrid] = useState<ModelGrid | null>(null);
  const [modelGridLoading, setModelGridLoading] = useState(false);
  const [modelGridTick, setModelGridTick] = useState(0);

  const [arome, setArome] = useState<MapsResponse | null>(null);
  const [obs, setObs] = useState<MapsResponse | null>(null);
  const [radar, setRadar] = useState<MapsResponse | null>(null);
  const [sat, setSat] = useState<SatFrames | null>(null);
  const [stations, setStations] = useState<Station[]>([]);
  const [avalancheZones, setAvalancheZones] = useState<AvalancheZoneCollection | null>(null);
  const [avalancheDanger, setAvalancheDanger] = useState<Record<string, number>>({});
  const [snowIndex, setSnowIndex] = useState<SnowCoverIndex | null>(null);
  const [snowDay, setSnowDay] = useState(0);

  const [varArome, setVarArome] = useState("temperature");
  const [varObs, setVarObs] = useState("temperature");
  const [varRadar, setVarRadar] = useState("radar_rate");
  const [varSat, setVarSat] = useState<"color" | "ir" | "vis">("color");

  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [layersOpen, setLayersOpen] = useState(false);
  const [interacting, setInteracting] = useState(false);
  // Actual 3D state: only ever on when the user allows 3D and the camera is tilted.
  const [terrain3d, setTerrain3d] = useState(false);

  const [options, setOptionsState] = useState<MapOptions>({
    basemap: "clar",
    windAnim: true,
    comarques: true,
    poblacions: true,
    peaks: true,
    values: true,
    hillshade: true,
    allow3d: true,
    avalancheSlopes: false,
    avalancheRisk: false,
    snowCover: false,
    opacity: 0.78,
  });
  const setOptions = useCallback((patch: Partial<MapOptions>) => {
    setOptionsState((prev) => ({ ...prev, ...patch }));
  }, []);

  const mountain = mode === "muntanya";
  // Non-AROME models come from coarse Open-Meteo grids rendered client-side.
  const gridMode = mode === "models" && mapModel !== "arome";
  const gridModeRef = useRef(false);
  const modelGridRef = useRef<ModelGrid | null>(null);
  const indexRef = useRef(0);
  // Basemap to restore when leaving the mountain view.
  const prevBasemapRef = useRef<MapOptions["basemap"]>("clar");
  const prevHillshadeRef = useRef(true);

  // 3D follows the camera: tilting away from zenith turns terrain on, levelling out turns it off.
  const terrainOnRef = useRef(false);
  const allow3dRef = useRef(true);
  const pitchIsProgrammaticRef = useRef(false);

  const [selected, setSelected] = useState<{
    lat: number;
    lon: number;
    value: number | null;
    x: number;
    y: number;
    name?: string;
  } | null>(null);
  const [forecast, setForecast] = useState<{ open: boolean; loading: boolean; data: WeatherData | null; name: string; lat: number; lon: number }>({
    open: false,
    loading: false,
    data: null,
    name: "",
    lat: 0,
    lon: 0,
  });
  const [grid, setGrid] = useState<ValueGrid | null>(null);
  const gridRef = useRef<ValueGrid | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");

  const sourceKind: SourceKind =
    mode === "muntanya" || mode === "models" ? "arome" : obsTab === "stations" ? "obs" : obsTab === "radar" ? "radar" : "sat";
  const variable =
    sourceKind === "arome" ? varArome : sourceKind === "obs" ? varObs : sourceKind === "radar" ? varRadar : null;

  const groups = gridMode
    ? modelGridGroups(mapModel)
    : sourceKind === "obs" || sourceKind === "sat"
      ? []
      : sourceKind === "radar"
        ? RADAR_GROUPS
        : AROME_GROUPS;
  const frames: MapFrame[] = useMemo(() => {
    if (gridMode) {
      if (!modelGrid || modelGrid.variable !== varArome) return [];
      return modelGrid.times.map((time, hour) => ({
        variable: modelGrid.variable,
        hour,
        timestamp: time,
        valid_time: time,
        filepath: "",
        web_filepath: "",
        web_bounds: modelGrid.bounds,
      }));
    }
    if (sourceKind === "arome") return arome?.maps?.[varArome] ?? [];
    if (sourceKind === "obs") return obs?.maps?.[varObs] ?? [];
    if (sourceKind === "radar") return radar?.maps?.[varRadar] ?? [];
    if (!sat) return [];
    return (sat.layers[varSat] ?? []).map((f) => ({
      variable: varSat,
      hour: 0,
      timestamp: f.time,
      valid_time: "",
      filepath: f.url,
      web_filepath: f.url,
      web_bounds: sat.bounds,
    }));
  }, [gridMode, modelGrid, sourceKind, arome, obs, radar, sat, varArome, varObs, varRadar, varSat]);

  const frame = mountain ? null : frames[index] ?? null;
  const currentModel = gridMode
    ? modelLabel(mapModel)
    : sourceKind === "arome"
      ? arome?.model
      : sourceKind === "obs"
        ? obs?.model
        : sourceKind === "radar"
          ? radar?.model
          : "MTG · EUMETSAT";

  const sourceLabel = gridMode
    ? `${modelLabel(mapModel)} · ${modelGrid?.source ?? "Open-Meteo"}`
    : sourceKind === "arome"
      ? "AROME HD 1,3 km"
      : sourceKind === "obs"
        ? "Estacions"
        : sourceKind === "radar"
          ? "Radar"
          : "MTG · EUMETSAT";

  const variableLabel =
    sourceKind === "obs"
      ? "Estacions"
      : sourceKind === "sat"
        ? { color: "Color", ir: "Infraroig", vis: "Visible" }[varSat]
        : variable
          ? displayLabel(sourceKind, variable)
          : null;

  // Sample the active source (AROME value grid or a coarse model grid).
  const readValueAt = useCallback(
    (lat: number, lon: number) => {
      const data = modelGridRef.current;
      if (gridModeRef.current && data) return sampleModelGrid(data, indexRef.current, lat, lon);
      return gridRef.current && variable ? sampleGrid(gridRef.current, lat, lon) : null;
    },
    [variable]
  );

  // Track theme for map styling.
  useEffect(() => {
    setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
    const observer = new MutationObserver(() =>
      setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light")
    );
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  // Initial data load.
  const loadMaps = useCallback(async () => {
    const headers = { accept: "application/json" };
    const [a, o, r] = await Promise.all([
      fetch("/up/api/arome/maps", { headers }).then((res) => (res.ok ? res.json() : null)).catch(() => null),
      fetch("/up/api/obs/maps", { headers }).then((res) => (res.ok ? res.json() : null)).catch(() => null),
      fetch("/up/api/radar/products", { headers }).then((res) => (res.ok ? res.json() : null)).catch(() => null),
    ]);
    if (a) setArome(a);
    if (o) setObs(o);
    if (r) setRadar(r);
  }, []);

  useEffect(() => {
    loadMaps();
  }, [loadMaps]);

  // Keep refs in sync so map handlers always sample the active source.
  useEffect(() => {
    gridModeRef.current = gridMode;
    modelGridRef.current = modelGrid;
  }, [gridMode, modelGrid]);
  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  // Switching model may leave an unsupported variable selected.
  useEffect(() => {
    const supported =
      mapModel === "arome"
        ? AROME_GROUPS.some((group) => group.variables.includes(varArome))
        : modelSupportsVariable(mapModel, varArome);
    if (!supported) setVarArome("temperature");
  }, [mapModel, varArome]);

  // Lazy gridded forecast for the selected Open-Meteo model.
  useEffect(() => {
    if (!gridMode || !modelSupportsVariable(mapModel, varArome)) {
      setModelGrid(null);
      setModelGridLoading(false);
      return;
    }
    let cancelled = false;
    setModelGrid(null);
    setModelGridLoading(true);
    fetchModelGrid(mapModel, varArome)
      .then((data) => {
        if (!cancelled) setModelGrid(data);
      })
      .finally(() => {
        if (!cancelled) setModelGridLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [gridMode, mapModel, varArome, modelGridTick]);

  useEffect(() => {
    if (obsTab !== "satellite" || sat) return;
    fetch("/up/api/satellite/frames")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setSat(d))
      .catch(() => { });
  }, [obsTab, sat]);

  useEffect(() => {
    if (mode !== "obs" || obsTab !== "stations" || stations.length) return;
    fetch("/up/api/obs/stations")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: StationsResponse | null) => d?.stations && setStations(d.stations))
      .catch(() => { });
  }, [mode, obsTab, stations.length]);

  // Avalanche layers are lazy: only hit the ICGC endpoints when the user asks for them.
  useEffect(() => {
    if (!mountain || !options.avalancheRisk) return;
    let cancelled = false;
    if (!avalancheZones) {
      fetch("/api/mountain/avalanche/zones")
        .then((r) => (r.ok ? r.json() : null))
        .then((data: AvalancheZoneCollection | null) => {
          if (!cancelled && data?.features) setAvalancheZones(data);
        })
        .catch(() => { });
    }
    fetch("/api/mountain/avalanche/bpa")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: AvalancheBulletin | null) => {
        if (cancelled || !data?.zones) return;
        const next: Record<string, number> = {};
        for (const zone of data.zones) next[zone.id] = zone.danger;
        setAvalancheDanger(next);
      })
      .catch(() => { });
    return () => {
      cancelled = true;
    };
  }, [mountain, options.avalancheRisk, avalancheZones]);

  // Daily CLMS snow-cover index: fetched lazily the first time the layer is enabled.
  useEffect(() => {
    if (!mountain || !options.snowCover || snowIndex) return;
    let cancelled = false;
    fetch("/api/mountain/snow")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: SnowCoverIndex | null) => {
        if (!cancelled && data?.available) setSnowIndex(data);
      })
      .catch(() => { });
    return () => {
      cancelled = true;
    };
  }, [mountain, options.snowCover, snowIndex]);

  const snowDays = snowIndex?.days ?? [];
  const snowSelected = snowDays[snowDay] ?? null;
  // PNGs are served `immutable`, so a day that gets re-published (empty -> data)
  // needs a new URL; the index timestamp provides it.
  const snowImage =
    snowSelected && snowIndex
      ? `${proxyUrl(snowSelected.image)}?v=${encodeURIComponent(snowIndex.generated_at)}`
      : null;

  // Start on the newest day that actually has snow in the published set.
  useEffect(() => {
    if (!snowIndex?.days?.length) return;
    const i = snowIndex.days.findIndex((day) => day.date === snowIndex.date);
    setSnowDay(i >= 0 ? i : snowIndex.days.length - 1);
  }, [snowIndex]);

  // Reset the frame index when the frame set changes.
  useEffect(() => {
    setIndex(defaultFrameIndex(frames, sourceKind === "sat" ? "sat" : sourceKind));
    setPlaying(false);
  }, [frames, sourceKind]);

  // Value grid for readouts / labels.
  useEffect(() => {
    setGrid(null);
    gridRef.current = null;
    if (gridMode || !frame || sourceKind === "sat") return;
    let cancelled = false;
    loadValueGrid(frame).then((g) => {
      if (cancelled) return;
      gridRef.current = g;
      setGrid(g);
    });
    return () => {
      cancelled = true;
    };
  }, [frame, sourceKind, gridMode]);

  // Create the map once.
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;
    const instance = new maplibregl.Map({
      container: mapContainer.current,
      style: baseStyle(theme),
      center: [1.75, 41.65],
      zoom: 7,
      minZoom: 4.5,
      maxZoom: 16,
      attributionControl: { compact: true, customAttribution: "© OpenStreetMap · © OpenFreeMap · Límits © ICGC" },
      maxPitch: 75,
      maxTileCacheSize: 80,
      // Tilting the camera (right/ctrl-drag, two-finger drag) is what switches 3D on and off.
      dragRotate: true,
      pitchWithRotate: true,
      touchPitch: true,
    });
    instance.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-left");
    instance.addControl(new maplibregl.ScaleControl({ maxWidth: 80, unit: "metric" }), "bottom-left");

    const fitWidth = () => {
      const width = instance.getContainer().clientWidth || 1200;
      const zoom = Math.log2((width * 360) / (256 * 5.5)) - 0.03;
      instance.jumpTo({ center: [1.75, 41.65], zoom: Math.max(4.8, Math.min(9, zoom)) });
    };

    instance.on("load", () => {
      fitWidth();
      instance.addSource("wx-image", {
        type: "image",
        url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
        coordinates: [
          [-1, 43.5],
          [4.5, 43.5],
          [4.5, 39.8],
          [-1, 39.8],
        ],
      });
      instance.addLayer(
        {
          id: "wx-layer",
          type: "raster",
          source: "wx-image",
          paint: { "raster-opacity": 0.78, "raster-fade-duration": 0, "raster-resampling": "linear" },
        },
        "terrain-hillshade"
      );

      // Close-range base detail (roads, tracks and water) so the map stays usable when zoomed in.
      instance.addSource("detail", { type: "vector", url: "https://tiles.openfreemap.org/planet" });
      const waterColor = theme === "dark" ? "#3f6b8c" : "#4a90c8";
      const roadCase = theme === "dark" ? "#121010" : "#201d1d";
      const roadFill = theme === "dark" ? "#8d8686" : "#fdfcfc";

      instance.addLayer({
        id: "detail-buildings",
        type: "fill",
        source: "detail",
        "source-layer": "building",
        minzoom: 14.5,
        paint: {
          "fill-color": theme === "dark" ? "#3a3535" : "#d8d4d0",
          "fill-opacity": ["interpolate", ["linear"], ["zoom"], 14.5, 0.25, 16, 0.55],
          "fill-outline-color": theme === "dark" ? "#262222" : "#bfbab6",
        },
      });
      instance.addLayer({
        id: "detail-water",
        type: "fill",
        source: "detail",
        "source-layer": "water",
        minzoom: 11,
        paint: { "fill-color": waterColor, "fill-opacity": 0.35 },
      });
      instance.addLayer({
        id: "detail-waterway",
        type: "line",
        source: "detail",
        "source-layer": "waterway",
        minzoom: 11,
        paint: {
          "line-color": waterColor,
          "line-opacity": 0.65,
          "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.7, 14, 1.8, 16, 3.4],
        },
      });
      instance.addLayer({
        id: "detail-roads-casing",
        type: "line",
        source: "detail",
        "source-layer": "transportation",
        minzoom: 11,
        filter: [
          "in",
          ["get", "class"],
          ["literal", ["motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service"]],
        ],
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": roadCase,
          "line-opacity": 0.7,
          "line-width": ["interpolate", ["linear"], ["zoom"], 11, 2, 13, 3.8, 14, 5.4, 16, 12],
        },
      });
      instance.addLayer({
        id: "detail-roads",
        type: "line",
        source: "detail",
        "source-layer": "transportation",
        minzoom: 11,
        filter: [
          "in",
          ["get", "class"],
          ["literal", ["motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service"]],
        ],
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": roadFill,
          "line-opacity": 0.95,
          "line-width": ["interpolate", ["linear"], ["zoom"], 11, 1, 13, 2.2, 14, 3.4, 16, 8],
        },
      });
      instance.addLayer({
        id: "detail-tracks",
        type: "line",
        source: "detail",
        "source-layer": "transportation",
        minzoom: 12.5,
        filter: ["in", ["get", "class"], ["literal", ["track", "path"]]],
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": theme === "dark" ? "#f0a05a" : "#d9762f",
          "line-opacity": 0.95,
          "line-width": ["interpolate", ["linear"], ["zoom"], 12.5, 0.8, 14, 1.5, 16, 2.6],
          "line-dasharray": [2, 1.4],
        },
      });

      instance.addLayer({
        id: "detail-street-labels",
        type: "symbol",
        source: "detail",
        "source-layer": "transportation_name",
        minzoom: 14,
        layout: {
          "text-field": ["coalesce", ["get", "name"], ["get", "ref"]],
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 14, 9.5, 16, 11.5],
          "symbol-placement": "line",
          "text-max-angle": 30,
          "text-padding": 2,
          "text-letter-spacing": 0.02,
        },
        paint: {
          "text-color": theme === "dark" ? "#c9c5c5" : "#5c5855",
          "text-halo-color": theme === "dark" ? "#201d1d" : "#fdfcfc",
          "text-halo-width": 1.5,
        },
      });

      instance.addSource("values-points", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      instance.addLayer({
        id: "values-labels",
        type: "symbol",
        source: "values-points",
        layout: {
          "text-field": ["get", "text"],
          "text-size": 10,
          "text-font": ["Noto Sans Regular"],
          "text-allow-overlap": false,
          "text-padding": 2,
        },
        paint: {
          "text-color": theme === "dark" ? "#fdfcfc" : "#201d1d",
          "text-halo-color": theme === "dark" ? "#201d1d" : "#fdfcfc",
          "text-halo-width": 1.4,
        },
      });

      instance.addSource("coastline", { type: "geojson", data: "/coastline.geojson" });
      instance.addLayer({
        id: "coastline-line",
        type: "line",
        source: "coastline",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#6e6e73",
          "line-opacity": 0.35,
          "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.6, 8, 0.9, 11, 1.4],
        },
      });

      instance.addSource("comarques", { type: "geojson", data: "/comarques.geojson" });
      instance.addLayer({
        id: "comarques-casing",
        type: "line",
        source: "comarques",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#201d1d",
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.55, 9, 0.45, 11, 0.28, 12.5, 0.12, 14, 0],
          "line-width": ["interpolate", ["linear"], ["zoom"], 5, 2.2, 8, 3.2, 11, 4.4],
        },
      });
      instance.addLayer({
        id: "comarques-line",
        type: "line",
        source: "comarques",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#fdfcfc",
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.9, 9, 0.7, 11, 0.42, 12.5, 0.18, 14, 0],
          "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.9, 8, 1.4, 11, 2.2],
        },
      });

      instance.addSource("places", {
        type: "vector",
        url: "https://tiles.openfreemap.org/planet",
      });

      const placeLayers: {
        id: string;
        classes: string[];
        minzoom: number;
        size: [number, number, number, number];
        muted?: boolean;
      }[] = [
          { id: "place-locality", classes: ["locality", "isolated_dwelling"], minzoom: 13, size: [9, 10, 11, 12] },
          { id: "place-hamlet", classes: ["hamlet", "suburb", "quarter", "neighbourhood"], minzoom: 11.5, size: [9.5, 10.5, 11.5, 12.5] },
          { id: "place-village", classes: ["village"], minzoom: 9.2, size: [10, 11, 12.5, 13.5] },
          { id: "place-town", classes: ["town"], minzoom: 7.2, size: [10.5, 12, 13.5, 15] },
          { id: "place-city", classes: ["city"], minzoom: 5.2, size: [11.5, 13, 14.5, 16] },
        ];

      for (const layer of placeLayers) {
        instance.addLayer({
          id: layer.id,
          type: "symbol",
          source: "places",
          "source-layer": "place",
          minzoom: layer.minzoom,
          filter: ["in", ["get", "class"], ["literal", layer.classes]],
          layout: {
            "text-field": ["coalesce", ["get", "name"], ["get", "name:latin"]],
            "text-font": ["Noto Sans Regular"],
            "text-size": [
              "interpolate", ["linear"], ["zoom"],
              layer.minzoom, layer.size[0],
              layer.minzoom + 2, layer.size[1],
              layer.minzoom + 4, layer.size[2],
              layer.minzoom + 6, layer.size[3],
            ],
            "text-anchor": "top",
            "text-offset": [0, 0.3],
            "text-max-width": 7,
            "text-padding": 2,
            "symbol-sort-key": ["coalesce", ["get", "rank"], 0],
          },
          paint: {
            "text-color": theme === "dark" ? "#fdfcfc" : "#201d1d",
            "text-halo-color": theme === "dark" ? "#201d1d" : "#fdfcfc",
            "text-halo-width": 1.4,
          },
        });
      }

      const peakFeatures = CATALAN_PEAKS.map((p) => ({
        type: "Feature" as const,
        properties: { name: p.name, alt: p.alt },
        geometry: { type: "Point" as const, coordinates: [p.lon, p.lat] },
      }));
      instance.addSource("peaks", { type: "geojson", data: { type: "FeatureCollection", features: peakFeatures } });
      instance.addLayer({
        id: "peaks-labels",
        type: "symbol",
        source: "peaks",
        minzoom: 11.6,
        layout: {
          "text-field": ["concat", ["get", "name"], "\n", ["to-string", ["get", "alt"]], " m"],
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 11.6, 10, 13, 11.5, 16, 13],
          "text-line-height": 1.05,
          "text-offset": [0, 0.7],
          "text-max-width": 9,
          "text-padding": 4,
          "symbol-sort-key": ["*", -1, ["get", "alt"]],
        },
        paint: {
          "text-color": theme === "dark" ? "#fdfcfc" : "#201d1d",
          "text-halo-color": theme === "dark" ? "#201d1d" : "#fdfcfc",
          "text-halo-width": 1.6,
        },
      });
      fetch("/peaks.geojson")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data) return;
          (instance.getSource("peaks") as maplibregl.GeoJSONSource | undefined)?.setData(data);
        })
        .catch(() => { });

      instance.addSource("stations", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      instance.addLayer({
        id: "stations-circle",
        type: "circle",
        source: "stations",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 2, 10, 3.5],
          "circle-color": ["get", "color"],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 0.8,
        },
      });
      instance.addLayer({
        id: "stations-label",
        type: "symbol",
        source: "stations",
        minzoom: 7,
        layout: {
          "text-field": ["get", "label"],
          "text-size": 10,
          "text-font": ["Noto Sans Regular"],
          "text-offset": [0, 0.7],
        },
        paint: {
          "text-color": theme === "dark" ? "#fdfcfc" : "#201d1d",
          "text-halo-color": theme === "dark" ? "#201d1d" : "#fdfcfc",
          "text-halo-width": 1.4,
        },
      });

      instance.addSource("selected-point", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      instance.addLayer({
        id: "selected-point-halo",
        type: "circle",
        source: "selected-point",
        paint: { "circle-radius": 10, "circle-color": "rgba(228,87,46,0.22)" },
      });
      instance.addLayer({
        id: "selected-point-dot",
        type: "circle",
        source: "selected-point",
        paint: { "circle-radius": 4.5, "circle-color": "#e4572e", "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 },
      });

      setMap(instance);
    });

    // While dragging/rotating in 3D we drop the heavy vector detail and label layers so the
    // terrain keeps up; they come back as soon as the gesture ends.
    const startMoving = () => setInteracting(true);
    const stopMoving = () => setInteracting(false);
    instance.on("movestart", startMoving);
    instance.on("moveend", stopMoving);

    const onPitch = () => {
      if (pitchIsProgrammaticRef.current) return;
      const pitch = instance.getPitch();
      if (!allow3dRef.current) return;
      if (!terrainOnRef.current && pitch >= 20) setTerrain3d(true);
      else if (terrainOnRef.current && pitch <= 4) setTerrain3d(false);
    };
    instance.on("pitch", onPitch);

    mapRef.current = instance;
    return () => {
      instance.off("movestart", startMoving);
      instance.off("moveend", stopMoving);
      instance.off("pitch", onPitch);
      instance.remove();
      mapRef.current = null;
      setMap(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Never show unpainted areas: zoom-out stops when the raster still covers the
  // viewport, and panning is confined to the raster bounds.
  useEffect(() => {
    if (!map || !frame) return;
    const bounds = frame.web_bounds;
    if (!bounds) return;
    const el = map.getContainer();
    map.setMaxBounds([
      [bounds.west, bounds.south],
      [bounds.east, bounds.north],
    ]);
    const apply = () => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      if (!width || !height) return;
      const min = Math.max(4, coverZoom(bounds, width, height));
      map.setMinZoom(min);
      if (map.getZoom() < min) map.setZoom(min);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => observer.disconnect();
  }, [map, frame]);

  useEffect(() => {
    terrainOnRef.current = terrain3d;
  }, [terrain3d]);

  useEffect(() => {
    allow3dRef.current = options.allow3d;
    if (!options.allow3d) setTerrain3d(false);
  }, [options.allow3d]);

  // Basemap + hillshade + terrain reactivity.
  useEffect(() => {
    if (!map) return;
    const dark = theme === "dark";
    const satellite = options.basemap === "satellit";
    const topo = options.basemap === "topo";
    map.setLayoutProperty("satellite-base", "visibility", satellite ? "visible" : "none");
    map.setLayoutProperty("topo-base", "visibility", topo ? "visible" : "none");
    // The topographic basemap already carries relief, roads, trails and contour lines.
    for (const id of ["detail-water", "detail-waterway", "detail-roads-casing", "detail-roads", "detail-tracks", "detail-street-labels"]) {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", topo ? "none" : "visible");
    }
    if (map.getLayer("detail-buildings")) {
      map.setLayoutProperty("detail-buildings", "visibility", topo || terrain3d ? "none" : "visible");
    }
    map.setPaintProperty("background-land", "background-color", dark ? "#201d1d" : "#fdfcfc");
    const hill = options.hillshade && !satellite && !topo;
    map.setLayoutProperty("terrain-hillshade", "visibility", hill ? "visible" : "none");
    map.setPaintProperty("terrain-hillshade", "hillshade-exaggeration", options.basemap === "relleu" ? 0.45 : dark ? 0.3 : 0.22);
    map.setPaintProperty("terrain-hillshade", "hillshade-shadow-color", dark ? "#000000" : "#646262");
    map.setPaintProperty("terrain-hillshade", "hillshade-highlight-color", dark ? "#3a3535" : "#ffffff");
    if (!options.allow3d) {
      // 3D disabled entirely (slow devices): keep the camera flat and terrain off.
      map.setTerrain(null);
      map.setMaxPitch(0);
      if (map.getPitch() > 0) {
        pitchIsProgrammaticRef.current = true;
        map.easeTo({ pitch: 0, duration: 300 });
        window.setTimeout(() => {
          pitchIsProgrammaticRef.current = false;
        }, 400);
      }
      if (map.getLayer("detail-buildings")) map.setLayoutProperty("detail-buildings", "visibility", topo ? "none" : "visible");
    } else if (terrain3d) {
      map.setTerrain({ source: "dem", exaggeration: 1.3 });
      // A shallower pitch keeps the far horizon (and the tile count it drags in) out of frame.
      map.setMaxPitch(58);
      if (map.getPitch() < 20) {
        pitchIsProgrammaticRef.current = true;
        map.easeTo({ pitch: 50, duration: 700 });
        window.setTimeout(() => {
          pitchIsProgrammaticRef.current = false;
        }, 800);
      }
      map.setLayoutProperty("detail-buildings", "visibility", "none");
    } else {
      map.setTerrain(null);
      map.setMaxPitch(75);
      if (map.getPitch() > 5) {
        pitchIsProgrammaticRef.current = true;
        map.easeTo({ pitch: 0, duration: 500 });
        window.setTimeout(() => {
          pitchIsProgrammaticRef.current = false;
        }, 600);
      }
      if (map.getLayer("detail-buildings")) map.setLayoutProperty("detail-buildings", "visibility", "visible");
    }
    map.setLayoutProperty("comarques-casing", "visibility", options.comarques ? "visible" : "none");
    map.setLayoutProperty("comarques-line", "visibility", options.comarques ? "visible" : "none");
    for (const id of PLACE_LAYER_IDS) {
      map.setLayoutProperty(id, "visibility", options.poblacions ? "visible" : "none");
    }
    map.setLayoutProperty("peaks-labels", "visibility", options.peaks ? "visible" : "none");
    map.setLayoutProperty("values-labels", "visibility", options.values && !playing ? "visible" : "none");
    map.setPaintProperty("values-labels", "text-color", dark ? "#fdfcfc" : "#201d1d");
    map.setPaintProperty("values-labels", "text-halo-color", dark ? "#201d1d" : "#fdfcfc");
    for (const id of PLACE_LAYER_IDS) {
      map.setPaintProperty(id, "text-color", dark ? "#fdfcfc" : "#201d1d");
      map.setPaintProperty(id, "text-halo-color", dark ? "#201d1d" : "#fdfcfc");
      map.setPaintProperty(id, "text-halo-width", 1.4);
    }
    map.setPaintProperty("peaks-labels", "text-color", dark ? "#fdfcfc" : "#201d1d");
    map.setPaintProperty("peaks-labels", "text-halo-color", dark ? "#201d1d" : "#fdfcfc");
    map.setPaintProperty("detail-water", "fill-color", dark ? "#3f6b8c" : "#4a90c8");
    map.setPaintProperty("detail-waterway", "line-color", dark ? "#3f6b8c" : "#4a90c8");
    map.setPaintProperty("detail-roads-casing", "line-color", dark ? "#121010" : "#201d1d");
    map.setPaintProperty("detail-roads", "line-color", dark ? "#8d8686" : "#fdfcfc");
    map.setPaintProperty("detail-tracks", "line-color", dark ? "#f0a05a" : "#d9762f");
    map.setPaintProperty("detail-buildings", "fill-color", dark ? "#3a3535" : "#d8d4d0");
    map.setPaintProperty("detail-buildings", "fill-outline-color", dark ? "#262222" : "#bfbab6");
    map.setPaintProperty("detail-street-labels", "text-color", dark ? "#c9c5c5" : "#5c5855");
    map.setPaintProperty("detail-street-labels", "text-halo-color", dark ? "#201d1d" : "#fdfcfc");
    map.setPaintProperty("stations-label", "text-color", dark ? "#fdfcfc" : "#201d1d");
    map.setPaintProperty("stations-label", "text-halo-color", dark ? "#201d1d" : "#fdfcfc");
    map.setPaintProperty("coastline-line", "line-color", dark ? "#9a9898" : "#6e6e73");
    map.setPaintProperty("comarques-casing", "line-color", dark ? "#201d1d" : "#fdfcfc");
    map.setPaintProperty("comarques-line", "line-color", dark ? "#fdfcfc" : "#201d1d");
  }, [map, theme, options.basemap, options.hillshade, options.allow3d, terrain3d, options.comarques, options.poblacions, options.peaks, options.values, playing]);

  // Declutter only while a gesture is in progress in 3D: cheap visibility flips that never
  // touch the terrain/hillshade setup.
  useEffect(() => {
    if (!map) return;
    const reduce = terrain3d && interacting;
    const topo = options.basemap === "topo";
    for (const id of ["detail-water", "detail-waterway", "detail-roads-casing", "detail-roads", "detail-tracks", "detail-street-labels"]) {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", reduce || topo ? "none" : "visible");
    }
    if (map.getLayer("detail-buildings")) {
      map.setLayoutProperty("detail-buildings", "visibility", reduce || topo || terrain3d ? "none" : "visible");
    }
    if (map.getLayer("peaks-labels")) {
      map.setLayoutProperty("peaks-labels", "visibility", options.peaks && !reduce ? "visible" : "none");
    }
    if (map.getLayer("values-labels")) {
      map.setLayoutProperty("values-labels", "visibility", options.values && !reduce && !playing ? "visible" : "none");
    }
  }, [map, interacting, terrain3d, options.basemap, options.peaks, options.values, playing]);

  // RainViewer radar tiles (self-hosted radar layer).
  useEffect(() => {
    if (!map) return;
    const sourceId = "radar-tiles";
    const layerId = "radar-layer";
    const cleanup = () => {
      if (map.getLayer(layerId)) map.removeLayer(layerId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    };
    cleanup();
    if (sourceKind !== "radar" || !radar?.rainviewer) return;
    const rv = radar.rainviewer.frames[index];
    if (!rv) return;
    map.addSource(sourceId, {
      type: "raster",
      tiles: [`${radar.rainviewer.host}${rv.path}/256/{z}/{x}/{y}/2/1_1.png`],
      tileSize: 256,
      maxzoom: 6,
      attribution: "Radar © RainViewer",
    });
    const before = PLACE_LAYER_IDS.find((id) => map.getLayer(id));
    map.addLayer(
      {
        id: layerId,
        type: "raster",
        source: sourceId,
        paint: { "raster-opacity": options.opacity, "raster-fade-duration": 0 },
      },
      before
    );
    return cleanup;
  }, [map, sourceKind, index, radar, options.opacity]);

  // ICGC avalanche slope classification (WMS raster, CORS-enabled upstream).
  useEffect(() => {
    if (!map) return;
    const sourceId = "avalanche-slopes";
    const layerId = "avalanche-slopes";
    if (map.getLayer(layerId)) map.removeLayer(layerId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);
    if (!mountain || !options.avalancheSlopes) return;
    map.addSource(sourceId, {
      type: "raster",
      tiles: [icgcWmsTileUrl("class_pendents")],
      tileSize: 256,
      maxzoom: 15,
      attribution: "Pendents d'allaus © ICGC",
    });
    map.addLayer(
      {
        id: layerId,
        type: "raster",
        source: sourceId,
        paint: { "raster-opacity": 0.62, "raster-fade-duration": 0, "raster-resampling": "nearest" },
      },
      map.getLayer("detail-buildings") ? "detail-buildings" : undefined
    );
  }, [map, mountain, options.avalancheSlopes]);

  // Copernicus daily snow cover, as a georeferenced image over the terrain.
  useEffect(() => {
    if (!map) return;
    const sourceId = "snow-image";
    const layerId = "snow-layer";
    if (map.getLayer(layerId)) map.removeLayer(layerId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);
    if (!mountain || !options.snowCover || !snowIndex?.available || !snowImage) return;

    const b = snowIndex.bounds;
    map.addSource(sourceId, {
      type: "image",
      url: snowImage,
      coordinates: [
        [b.west, b.north],
        [b.east, b.north],
        [b.east, b.south],
        [b.west, b.south],
      ],
    });
    const before = map.getLayer("avalanche-slopes")
      ? "avalanche-slopes"
      : map.getLayer("detail-buildings")
        ? "detail-buildings"
        : undefined;
    map.addLayer(
      {
        id: layerId,
        type: "raster",
        source: sourceId,
        // The PNG already carries the snow-fraction alpha; don't fade it twice.
        paint: { "raster-opacity": 1, "raster-fade-duration": 0, "raster-resampling": "linear" },
      },
      before
    );
  }, [map, mountain, options.snowCover, snowIndex?.available, snowImage]);

  // Slider: swap the image in place instead of recreating the layer (no flash).
  useEffect(() => {
    if (!map || !snowIndex?.available || !snowImage) return;
    const src = map.getSource("snow-image") as maplibregl.ImageSource | undefined;
    if (!src) return;
    const b = snowIndex.bounds;
    src.updateImage({
      url: snowImage,
      coordinates: [
        [b.west, b.north],
        [b.east, b.north],
        [b.east, b.south],
        [b.west, b.south],
      ],
    });
  }, [map, snowIndex, snowImage]);

  // Daily BPA danger per zone, drawn over the weather raster and under roads/labels.
  useEffect(() => {
    if (!map) return;
    const sourceId = "avalanche-zones";
    for (const id of ["avalanche-zones-label", "avalanche-zones-line", "avalanche-zones-fill"]) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    if (map.getSource(sourceId)) map.removeSource(sourceId);
    if (!mountain || !options.avalancheRisk || !avalancheZones?.features.length) return;

    map.addSource(sourceId, {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: avalancheZones.features.map((feature) => {
          const name = feature.properties.name;
          const danger = avalancheDanger[feature.properties.id] ?? 0;
          return {
            type: "Feature" as const,
            properties: {
              name,
              danger,
              label: danger > 0 ? `${name} · ${dangerMeta(danger).short}` : name,
            },
            geometry: feature.geometry as never,
          };
        }),
      },
    });

    const color = [
      "match",
      ["get", "danger"],
      1, "#59a14f",
      2, "#f2c94c",
      3, "#f29b38",
      4, "#e4572e",
      5, "#b3261e",
      "#9a9898",
    ] as unknown as maplibregl.ExpressionSpecification;
    const before = map.getLayer("detail-buildings") ? "detail-buildings" : undefined;

    map.addLayer(
      { id: "avalanche-zones-fill", type: "fill", source: sourceId, paint: { "fill-color": color, "fill-opacity": 0.14 } },
      before
    );
    map.addLayer(
      {
        id: "avalanche-zones-line",
        type: "line",
        source: sourceId,
        paint: { "line-color": color, "line-width": 1.4, "line-opacity": 0.8, "line-dasharray": [3, 2] },
      },
      before
    );
    map.addLayer(
      {
        id: "avalanche-zones-label",
        type: "symbol",
        source: sourceId,
        layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-padding": 4 },
        paint: {
          "text-color": theme === "dark" ? "#fdfcfc" : "#201d1d",
          "text-halo-color": theme === "dark" ? "#201d1d" : "#fdfcfc",
          "text-halo-width": 1.4,
        },
      },
      before
    );
  }, [map, mountain, options.avalancheRisk, avalancheZones, avalancheDanger, theme]);

  // Overlay image + opacity.
  useEffect(() => {
    if (!map) return;
    if (gridMode) {
      const src = map.getSource("wx-image") as maplibregl.ImageSource | undefined;
      const url = modelGrid ? modelGridImage(modelGrid, index) : null;
      if (!src || !url) {
        map.setPaintProperty("wx-layer", "raster-opacity", 0);
        return;
      }
      const b = modelGrid!.bounds;
      src.updateImage({
        url,
        coordinates: [
          [b.west, b.north],
          [b.east, b.north],
          [b.east, b.south],
          [b.west, b.south],
        ],
      });
      map.setPaintProperty("wx-layer", "raster-opacity", options.opacity);
      return;
    }
    if (!frame) {
      map.setPaintProperty("wx-layer", "raster-opacity", 0);
      return;
    }
    const b = frame.web_bounds;
    const url = proxyUrl(frame.web_filepath);
    if (!url) {
      map.setPaintProperty("wx-layer", "raster-opacity", 0);
      return;
    }
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const apply = (attempt = 0) => {
      if (cancelled) return;
      const src = map.getSource("wx-image") as maplibregl.ImageSource | undefined;
      if (!src) {
        if (attempt < 8) retry = setTimeout(() => apply(attempt + 1), 250);
        return;
      }
      src.updateImage({
        url,
        coordinates: [
          [b.west, b.north],
          [b.east, b.north],
          [b.east, b.south],
          [b.west, b.south],
        ],
      });
    };
    apply();
    // Fade the coarse AROME raster as you zoom in so roads, trails and relief stay readable.
    // Only the topographic basemap needs a lighter weather wash; 3D keeps the same colours as 2D.
    const basemapFactor = options.basemap === "topo" ? 0.6 : 1;
    const fade = (factor: number) => options.opacity * factor * basemapFactor;
    map.setPaintProperty("wx-layer", "raster-opacity", [
      "interpolate",
      ["linear"],
      ["zoom"],
      9,
      fade(1),
      12,
      fade(0.9),
      14,
      fade(0.6),
      16,
      fade(0.32),
    ]);
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
    };
  }, [map, frame, options.opacity, options.basemap, gridMode, modelGrid, index]);

  // Observations / radar visibility + station data.
  useEffect(() => {
    if (!map) return;
    const showStations = sourceKind === "obs";
    map.setLayoutProperty("stations-circle", "visibility", showStations ? "visible" : "none");
    map.setLayoutProperty("stations-label", "visibility", showStations ? "visible" : "none");
  }, [map, sourceKind]);

  useEffect(() => {
    if (!map) return;
    const src = map.getSource("stations") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    const features = stations
      .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon))
      .map((s) => ({
        type: "Feature" as const,
        properties: {
          id: s.id,
          name: s.name,
          label: s.ta != null ? `${Math.round(s.ta)}` : "",
          color: tempColor(s.ta, TEMP_STOPS),
        },
        geometry: { type: "Point" as const, coordinates: [s.lon, s.lat] },
      }));
    src.setData({ type: "FeatureCollection", features });
  }, [map, stations]);

  // Value labels grid.
  useEffect(() => {
    if (!map) return;
    const src = map.getSource("values-points") as maplibregl.GeoJSONSource | undefined;
    if (!grid || !options.values || playing) {
      src?.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const update = () => {
      const src = map.getSource("values-points") as maplibregl.GeoJSONSource | undefined;
      if (!src) return;
      const z = map.getZoom();
      const step = z < 7 ? 0.4 : z < 8 ? 0.3 : z < 9 ? 0.2 : z < 10 ? 0.12 : z < 11 ? 0.08 : 0.04;
      const b = map.getBounds();
      const west = Math.max(b.getWest(), grid.bounds.west);
      const east = Math.min(b.getEast(), grid.bounds.east);
      const south = Math.max(b.getSouth(), grid.bounds.south);
      const north = Math.min(b.getNorth(), grid.bounds.north);
      const features: any[] = [];
      if (variable && west < east && south < north) {
        for (let lat = Math.ceil(south / step) * step; lat <= north && features.length < 500; lat += step) {
          for (let lon = Math.ceil(west / step) * step; lon <= east && features.length < 500; lon += step) {
            const value = sampleGrid(grid, lat, lon);
            const text = compactValue(variable, value);
            if (!text) continue;
            features.push({
              type: "Feature",
              properties: { text },
              geometry: { type: "Point", coordinates: [lon, lat] },
            });
          }
        }
      }
      src.setData({ type: "FeatureCollection", features });
    };
    const debounced = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(update, 120);
    };
    update();
    map.on("moveend", debounced);
    map.on("zoomend", debounced);
    return () => {
      if (timer) clearTimeout(timer);
      map.off("moveend", debounced);
      map.off("zoomend", debounced);
    };
  }, [map, grid, options.values, variable, playing]);

  // Map click → readout + preview.
  useEffect(() => {
    if (!map) return;
    const onClick = (e: maplibregl.MapMouseEvent) => {
      const { lat, lng } = e.lngLat;
      const value = readValueAt(lat, lng);
      const p = map.project(e.lngLat);
      const name = nearestPlaceName(map, lat, lng) ?? nearestCityName(lat, lng) ?? "Punt seleccionat";
      setSelected({ lat, lon: lng, value, x: p.x, y: p.y, name });
      map.getSource("selected-point") &&
        (map.getSource("selected-point") as maplibregl.GeoJSONSource).setData({
          type: "FeatureCollection",
          features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [lng, lat] } }],
        });
    };
    const onMove = () => {
      setSelected((prev) => {
        if (!prev) return prev;
        const p = map.project([prev.lon, prev.lat]);
        return { ...prev, x: p.x, y: p.y };
      });
    };
    map.on("click", onClick);
    map.on("move", onMove);
    map.on("zoom", onMove);
    return () => {
      map.off("click", onClick);
      map.off("move", onMove);
      map.off("zoom", onMove);
    };
  }, [map, readValueAt]);

  // Search results (and geolocation) arrive as URL params: point the map at them instead of leaving the view.
  const searchParams = useSearchParams();
  const qLat = searchParams.get("lat");
  const qLon = searchParams.get("lon");
  const qName = searchParams.get("name");
  useEffect(() => {
    if (!map || !qLat || !qLon) return;
    const lat = Number(qLat);
    const lon = Number(qLon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const name = qName?.trim() || nearestPlaceName(map, lat, lon) || "Punt seleccionat";
    const p = map.project([lon, lat]);
    setSelected({
      lat,
      lon,
      value: readValueAt(lat, lon),
      x: p.x,
      y: p.y,
      name,
    });
    (map.getSource("selected-point") as maplibregl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [lon, lat] } }],
    });
    map.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 10.5), duration: 1000 });
  }, [map, qLat, qLon, qName, readValueAt]);

  // A direct link may arrive before tiles load: fill the settlement name once the map settles.
  const selectedLat = selected?.lat;
  const selectedLon = selected?.lon;
  const selectedName = selected?.name;
  useEffect(() => {
    if (!map || selectedLat == null || selectedLon == null) return;
    if (selectedName && selectedName !== "Punt seleccionat") return;
    const update = () => {
      const name = nearestPlaceName(map, selectedLat, selectedLon);
      if (!name) return;
      setSelected((prev) =>
        prev && prev.lat === selectedLat && prev.lon === selectedLon ? { ...prev, name } : prev
      );
    };
    map.once("idle", update);
    return () => {
      map.off("idle", update);
    };
  }, [map, selectedLat, selectedLon, selectedName]);

  // Keep the readout in sync when a new frame/variable grid loads.
  useEffect(() => {
    if (!grid) return;
    setSelected((prev) => {
      if (!prev) return prev;
      const value = sampleGrid(grid, prev.lat, prev.lon);
      return value === prev.value ? prev : { ...prev, value };
    });
  }, [grid]);

  // Model grids change value with the model, variable, or hour.
  useEffect(() => {
    if (!gridMode || !modelGrid) return;
    setSelected((prev) => {
      if (!prev) return prev;
      const value = sampleModelGrid(modelGrid, index, prev.lat, prev.lon);
      return value === prev.value ? prev : { ...prev, value };
    });
  }, [gridMode, modelGrid, index]);

  // Playback.
  useEffect(() => {
    if (!playing || frames.length <= 1) return;
    const delay = 900 / speed;
    const id = setInterval(() => {
      setIndex((i) => (i + 1 >= frames.length ? 0 : i + 1));
    }, delay);
    return () => clearInterval(id);
  }, [playing, frames.length, speed]);

  const openForecast = useCallback(async () => {
    if (!selected) return;
    const name = selected.name ?? nearestCityName(selected.lat, selected.lon) ?? "Punt seleccionat";
    setForecast({ open: true, loading: true, data: null, name, lat: selected.lat, lon: selected.lon });
    try {
      const res = await fetch(`/api/weather?lat=${selected.lat}&lon=${selected.lon}`);
      const data = await res.json();
      setForecast((f) => ({ ...f, loading: false, data: res.ok ? data : null }));
    } catch {
      setForecast((f) => ({ ...f, loading: false }));
    }
  }, [selected]);

  const locateMe = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        map?.flyTo({ center: [longitude, latitude], zoom: 10, duration: 1200 });
        const p = map?.project([longitude, latitude]);
        setSelected({ lat: latitude, lon: longitude, value: readValueAt(latitude, longitude), x: p?.x ?? 0, y: p?.y ?? 0 });
        setForecast({ open: true, loading: true, data: null, name: nearestCityName(latitude, longitude) ?? "La meva ubicació", lat: latitude, lon: longitude });
        fetch(`/api/weather?lat=${latitude}&lon=${longitude}`)
          .then((r) => r.json())
          .then((data) => setForecast((f) => ({ ...f, loading: false, data })))
          .catch(() => setForecast((f) => ({ ...f, loading: false })));
      },
      () => { },
      { timeout: 8000 }
    );
  };

  const selectMode = (next: "models" | "obs" | "muntanya") => {
    if (next === mode) return;
    if (next === "muntanya") {
      prevBasemapRef.current = options.basemap;
      prevHillshadeRef.current = options.hillshade;
      // The mountain view is about terrain and avalanches: shaded relief, no weather wash.
      setOptions({ basemap: "relleu", hillshade: true, avalancheRisk: true, avalancheSlopes: false, snowCover: true });
    } else if (mode === "muntanya") {
      setOptions({
        basemap: prevBasemapRef.current,
        hillshade: prevHillshadeRef.current,
        avalancheSlopes: false,
        avalancheRisk: false,
        snowCover: false,
      });
    }
    setMode(next);
  };

  const setVariableForSource = (v: string) => {
    if (sourceKind === "arome") setVarArome(v);
    else if (sourceKind === "obs") setVarObs(v);
    else if (sourceKind === "radar") setVarRadar(v);
    setLayersOpen(false);
  };

  const quickMobileVars =
    sourceKind === "radar"
      ? RADAR_GROUPS[0].variables
      : sourceKind === "obs"
        ? ["temperature", "precipitation", "wind_speed", "wind_gust", "humidity"]
        : ["temperature", "precipitation", "precip_accum", "wind_speed", "snow_precipitation", "snow_accum"];

  const legendVariable =
    sourceKind === "sat" || sourceKind === "obs"
      ? null
      : sourceKind === "radar" && (varRadar.startsWith("radar_vel") || varRadar === "radar_ptype" || varRadar === "radar_cmax")
        ? varRadar
        : variable;

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <AppHeader />
      <section
        className="relative min-h-0 w-full flex-1 overflow-hidden"
        style={{ backgroundColor: "var(--background)" }}
      >
        <div
          ref={mapContainer}
          className="absolute inset-0 h-full w-full"
          aria-label="Mapa meteorològic interactiu"
        />

        <div className="pointer-events-none absolute inset-x-0 top-0 z-40 flex justify-center px-2 pt-2 sm:pt-3">
          <div
            className="pointer-events-auto flex items-center gap-1 rounded-md border p-1"
            style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}
          >
            <div role="radiogroup" aria-label="Tipus de mapa" className="flex items-center gap-0.5">
              {([
                ["models", "Models"],
                ["obs", "Observacions"],
                ["muntanya", "Muntanya"],
              ] as const).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  onClick={() => selectMode(m)}
                  className="h-8 rounded border px-1.5 text-[11px] font-medium transition-colors sm:px-2"
                  style={selectionStyle(mode === m)}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="mx-1 h-5 w-px" style={{ backgroundColor: "var(--border)" }} />
            <button
              type="button"
              onClick={locateMe}
              aria-label="Previsió per a la meva ubicació"
              title="La meva ubicació"
              className="grid h-8 w-8 place-items-center rounded hover:text-[color:var(--accent)]"
              style={{ color: "var(--muted-foreground)" }}
            >
              <LocateFixed className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setLayersOpen(true)}
              aria-expanded={layersOpen}
              aria-haspopup="dialog"
              aria-label="Capes i vista del mapa"
              className="flex h-8 items-center gap-1.5 rounded px-2 hover:text-[color:var(--accent)]"
              style={{ color: "var(--muted-foreground)" }}
            >
              <SlidersHorizontal className="h-4 w-4" />
              <span className="text-[11px] font-medium">Capes</span>
            </button>
          </div>
        </div>

        {gridMode && (modelGridLoading || !modelGrid || !modelGrid.hasData) && (
          <div className="pointer-events-none absolute inset-x-0 top-[52px] z-30 flex justify-center px-2">
            <div
              className="rounded-md border px-2.5 py-1 text-[11px]"
              style={{ backgroundColor: "var(--card)", borderColor: "var(--border)", color: "var(--muted-foreground)" }}
            >
              {modelGridLoading
                ? `Carregant ${modelLabel(mapModel)}…`
                : "Sense dades per a aquest model i variable."}
            </div>
          </div>
        )}

        {mountain && (
          <MountainLegend
            className="pointer-events-auto absolute bottom-20 left-2 z-30"
            options={options}
            setOptions={setOptions}
            snowDays={snowDays}
            snowDay={snowDay}
            setSnowDay={setSnowDay}
            snowEmpty={snowSelected?.empty ?? snowIndex?.empty}
          />
        )}

        <WindParticles
          map={map}
          url={sourceKind === "sat" ? null : windFieldUrl(frame ?? undefined)}
          bounds={frame?.web_bounds ?? null}
          enabled={
            !mountain && !gridMode && options.windAnim && !terrain3d && !playing && sourceKind !== "sat" && sourceKind !== "radar"
          }
          frameKey={`${index}-${sourceKind}-${variable}`}
        />

        {/* Mobile quick variables */}
        {!mountain && (sourceKind === "arome" || sourceKind === "radar") && (
          <div
            className="pointer-events-auto absolute left-2 top-[calc(50%-28px)] z-30 flex -translate-y-1/2 flex-col gap-1.5 sm:hidden"
            role="radiogroup"
            aria-label="Variables"
          >
            {quickMobileVars.map((v) => {
              const meta = VAR_META[v];
              if (!meta) return null;
              const Icon = variableIcon(v);
              const active = v === variable;
              return (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={meta.label}
                  onClick={() => setVariableForSource(v)}
                  className="flex h-10 w-10 items-center justify-center rounded-xl border"
                  style={{
                    backgroundColor: active ? "var(--accent)" : "var(--background)",
                    borderColor: active ? "var(--accent)" : "var(--border)",
                    color: active ? "#fff" : "var(--foreground)",
                  }}
                >
                  <Icon className="h-[18px] w-[18px]" />
                </button>
              );
            })}
          </div>
        )}

        {/* Selected point readout */}
        {selected && (
          <div
            className="absolute z-30 -translate-x-1/2 -translate-y-[calc(100%+10px)]"
            style={{ left: Math.max(110, Math.min(selected.x, (map?.getCanvas().clientWidth ?? 800) - 110)), top: selected.y }}
          >
            <div
              className="flex items-center gap-1 rounded-md border px-2 py-1.5 text-[12px] font-medium"
              style={{ backgroundColor: "var(--card)", borderColor: "var(--border)", color: "var(--foreground)" }}
            >
              {selected.name && (
                <span className="max-w-[140px] truncate text-[11px]" title={selected.name}>
                  {selected.name}
                </span>
              )}
              {!mountain && (
                <span className="whitespace-nowrap font-mono">
                  {variable && selected.value != null ? formatValue(variable, selected.value, VAR_META[variable]?.unit) : "—"}
                </span>
              )}
              <button
                type="button"
                onClick={openForecast}
                className="whitespace-nowrap rounded px-1.5 py-0.5 text-white"
                style={{ backgroundColor: "var(--accent)" }}
              >
                Previsió ›
              </button>
              <button
                type="button"
                aria-label="Treu el punt"
                onClick={() => {
                  setSelected(null);
                  (map?.getSource("selected-point") as maplibregl.GeoJSONSource | undefined)?.setData({
                    type: "FeatureCollection",
                    features: [],
                  });
                }}
                className="grid h-5 w-5 place-items-center rounded hover:bg-[color:var(--muted)]"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}

        <ForecastPanel
          open={forecast.open}
          loading={forecast.loading}
          name={forecast.name}
          lat={forecast.lat}
          lon={forecast.lon}
          data={forecast.data}
          onClose={() => setForecast((f) => ({ ...f, open: false }))}
        />

        {mountain ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 px-2 pb-[max(8px,env(safe-area-inset-bottom))] sm:px-3 sm:pb-3">
            <div
              className="pointer-events-auto mx-auto flex max-w-[620px] flex-wrap items-center justify-between gap-2 rounded-2xl border px-3 py-2"
              style={{ backgroundColor: "var(--background)", borderColor: "var(--border)" }}
            >
              <span className="text-[12px]" style={{ color: "var(--muted-foreground)" }}>
                Toca el mapa per seleccionar un punt i veure&apos;n la previsió.
              </span>
              <button
                type="button"
                onClick={() => setLayersOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[12px] font-semibold"
                style={selectionStyle(layersOpen)}
              >
                <MountainSnow className="h-3.5 w-3.5" />
                Capes
              </button>
            </div>
          </div>
        ) : (
          <Timeline
            sourceLabel={sourceLabel}
            time={frame?.timestamp ?? null}
            index={index}
            count={frames.length}
            onIndex={setIndex}
            playing={playing}
            onPlay={() => setPlaying((p) => !p)}
            speed={speed}
            onSpeed={setSpeed}
            variable={legendVariable}
            variableLabel={variableLabel}
            onOpenLayers={() => setLayersOpen(true)}
            times={frames.map((f) => f.timestamp)}
            tabs={
              mode === "obs" ? (
                <div className="px-2 pb-1.5">
                  <div role="radiogroup" aria-label="Observació" className="grid grid-cols-3 gap-1">
                    {([
                      ["stations", "Estacions"],
                      ["radar", "Radar"],
                      ["satellite", "Satèl·lit"],
                    ] as const).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        role="radio"
                        aria-checked={obsTab === id}
                        onClick={() => setObsTab(id)}
                        className="rounded-md border py-1 text-[11px] font-semibold"
                        style={selectionStyle(obsTab === id)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {obsTab === "satellite" && (
                    <div role="radiogroup" aria-label="Imatge satèl·lit" className="mt-1 grid grid-cols-3 gap-1">
                      {([
                        ["color", "Color"],
                        ["ir", "Infraroig"],
                        ["vis", "Visible"],
                      ] as const).map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          role="radio"
                          aria-checked={varSat === id}
                          onClick={() => setVarSat(id)}
                          className="rounded-md border py-1 text-[11px] font-semibold"
                          style={selectionStyle(varSat === id)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : null
            }
          />
        )}

        <LayersPanel
          key={mode}
          open={layersOpen}
          onClose={() => setLayersOpen(false)}
          mode={mode}
          model={mapModel}
          onModel={(id) => {
            setMapModel(id);
            setIndex(0);
          }}
          gridMode={gridMode}
          groups={mountain || sourceKind === "sat" ? [] : groups}
          variable={variable ?? ""}
          onSelect={setVariableForSource}
          options={options}
          setOptions={setOptions}
          modelLabel={
            mountain
              ? "Muntanya · relleu i allaus ICGC"
              : gridMode
                ? `${modelLabel(mapModel)} · ${modelGrid?.source ?? "Open-Meteo"} (${modelGrid ? gridResolution(modelGrid) : "…"}°)`
                : `${currentModel ?? "—"}${sourceKind === "arome" && arome ? ` · run ${arome.run_id.slice(9, 11)}Z` : ""}`
          }
          onRefresh={() => {
            if (gridMode) setModelGridTick((v) => v + 1);
            loadMaps();
            if (obsTab === "satellite") setSat(null);
          }}
        />
      </section>
    </div>
  );
}
