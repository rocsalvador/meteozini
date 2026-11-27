"use client";

import * as maplibregl from "@/lib/maplibre";
import type { Map as MapLibreMap, StyleSpecification } from "@/lib/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/components/theme";

export type GeoBounds = { west: number; south: number; east: number; north: number };

/** Limits of Catalonia plus a thin margin, used to frame the `/mapes` rasters. */
export const CATALUNYA_BOUNDS: GeoBounds = { west: 0.14, south: 40.5, east: 3.35, north: 42.88 };

const TILE = "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp";

function mercatorY(lat: number) {
  return Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
}

function clampBounds(bounds: GeoBounds, within: GeoBounds): GeoBounds {
  const clamped = {
    west: Math.max(bounds.west, within.west),
    south: Math.max(bounds.south, within.south),
    east: Math.min(bounds.east, within.east),
    north: Math.min(bounds.north, within.north),
  };
  return clamped.west < clamped.east && clamped.south < clamped.north ? clamped : within;
}

function baseStyle(theme: "light" | "dark"): StyleSpecification {
  return {
    version: 8,
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: {
      hillshade: {
        type: "raster-dem",
        tiles: [TILE],
        encoding: "terrarium",
        tileSize: 512,
        maxzoom: 13,
        attribution: "© Mapterhorn",
      },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": theme === "dark" ? "#201d1d" : "#fdfcfc" } },
      {
        id: "hillshade",
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

export function StaticWeatherMap({
  imageUrl,
  bounds,
  focusBounds = null,
  className = "mx-auto aspect-[20/19] max-h-[72vh] w-full max-w-[calc(72vh_*_20_/_19)]",
}: {
  imageUrl: string | null;
  bounds: GeoBounds | null;
  /** Area the view frames; the raster keeps its own `bounds` and is cropped to it. */
  focusBounds?: GeoBounds | null;
  className?: string;
}) {
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    const dark = theme === "dark";
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: baseStyle(theme),
      interactive: false,
      attributionControl: { compact: true, customAttribution: "© OpenStreetMap · Límits © ICGC" },
    });
    mapRef.current = map;

    map.on("load", () => {
      map.addSource("coastline", { type: "geojson", data: "/coastline.geojson" });
      map.addLayer({
        id: "coastline-line",
        type: "line",
        source: "coastline",
        paint: {
          "line-color": dark ? "#9a9898" : "#6e6e73",
          "line-opacity": 0.45,
          "line-width": 0.9,
        },
      });

      map.addSource("comarques", { type: "geojson", data: "/comarques.geojson" });
      map.addLayer({
        id: "comarques-casing",
        type: "line",
        source: "comarques",
        paint: {
          "line-color": dark ? "#201d1d" : "#fdfcfc",
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.55, 9, 0.45, 11, 0.28, 12.5, 0.12, 14, 0],
          "line-width": 3,
        },
      });
      map.addLayer({
        id: "comarques-line",
        type: "line",
        source: "comarques",
        paint: {
          "line-color": dark ? "#fdfcfc" : "#201d1d",
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.9, 9, 0.7, 11, 0.42, 12.5, 0.18, 14, 0],
          "line-width": 1.2,
        },
      });
      setReady(true);
    });

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, [theme]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !bounds || !containerRef.current) return;
    if (!imageUrl) {
      if (map.getLayer("wx-layer")) map.setPaintProperty("wx-layer", "raster-opacity", 0);
      return;
    }
    const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [
      [bounds.west, bounds.north],
      [bounds.east, bounds.north],
      [bounds.east, bounds.south],
      [bounds.west, bounds.south],
    ];
    const src = map.getSource("wx-image") as maplibregl.ImageSource | undefined;
    if (src) {
      src.updateImage({ url: imageUrl, coordinates });
    } else {
      map.addSource("wx-image", { type: "image", url: imageUrl, coordinates });
      map.addLayer(
        {
          id: "wx-layer",
          type: "raster",
          source: "wx-image",
          paint: { "raster-opacity": 0.8, "raster-fade-duration": 0, "raster-resampling": "linear" },
        },
        "coastline-line"
      );
    }
    map.setPaintProperty("wx-layer", "raster-opacity", 0.8);

    const view = focusBounds ? clampBounds(focusBounds, bounds) : bounds;

    const fit = () => {
      const el = containerRef.current;
      if (!el) return;
      const width = el.clientWidth;
      const height = el.clientHeight;
      if (!width || !height) return;
      const lonSpan = Math.max(0.0001, view.east - view.west);
      const ySpan = Math.max(0.0001, mercatorY(view.north) - mercatorY(view.south));
      const zx = Math.log2((width * 360) / (512 * lonSpan));
      const zy = Math.log2((height * 2 * Math.PI) / (512 * ySpan));
      map.jumpTo({
        center: [(view.west + view.east) / 2, (view.south + view.north) / 2],
        zoom: Math.min(zx, zy) - 0.02,
      });
    };
    fit();
    const ro = new ResizeObserver(() => {
      map.resize();
      fit();
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [ready, imageUrl, bounds, focusBounds]);

  return <div ref={containerRef} className={className} aria-label="Mapa amb relleu" />;
}
