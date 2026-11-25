"use client";

import maplibregl, { type Map as MapLibreMap, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { dangerMeta, icgcWmsTileUrl, padBounds, trackBounds } from "@meteozini/core";
import { useTheme } from "@/components/theme";
import { AvalancheSlopeLegend } from "./avalanche-slope-legend";

export type MountainSample = { number: number; lat: number; lon: number };

export type AvalancheZoneFeature = {
  type: "Feature";
  properties: { id: string; name: string; danger: number };
  geometry: { type: string; coordinates: unknown };
};

const TOPO_TILE = "https://tile.opentopomap.org/{z}/{x}/{y}.png";
const GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";

const DANGER_COLOR = [
  "match",
  ["get", "danger"],
  1, "#59a14f",
  2, "#f2c94c",
  3, "#f29b38",
  4, "#e4572e",
  5, "#b3261e",
  "#9a9898",
] as unknown as maplibregl.ExpressionSpecification;

function baseStyle(theme: "light" | "dark"): StyleSpecification {
  return {
    version: 8,
    glyphs: GLYPHS,
    sources: {
      topo: {
        type: "raster",
        tiles: [TOPO_TILE],
        tileSize: 256,
        minzoom: 0,
        maxzoom: 17,
        attribution: "© OpenTopoMap (CC-BY-SA)",
      },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": theme === "dark" ? "#201d1d" : "#fdfcfc" } },
      {
        id: "topo-base",
        type: "raster",
        source: "topo",
        paint: { "raster-opacity": theme === "dark" ? 0.55 : 0.9, "raster-saturation": theme === "dark" ? -0.4 : 0 },
      },
    ],
  };
}

export function MountainMap({
  track,
  samples,
  zones,
  showSlopes,
  showZones,
  className = "h-[420px] w-full",
}: {
  track: { lat: number; lon: number }[];
  samples: MountainSample[];
  zones: AvalancheZoneFeature[] | null;
  showSlopes: boolean;
  showZones: boolean;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  const { theme } = useTheme();

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const instance = new maplibregl.Map({
      container: containerRef.current,
      style: baseStyle(theme),
      center: [1.6, 42.55],
      zoom: 9,
      maxZoom: 16,
      attributionControl: {
        compact: true,
        customAttribution: "© OpenStreetMap · © OpenTopoMap · Allaus © ICGC",
      },
    });
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    instance.addControl(new maplibregl.ScaleControl({ maxWidth: 80, unit: "metric" }), "bottom-left");

    instance.on("load", () => {
      instance.addSource("track", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      instance.addLayer({
        id: "track-casing",
        type: "line",
        source: "track",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#ffffff", "line-opacity": 0.9, "line-width": ["interpolate", ["linear"], ["zoom"], 8, 4, 13, 7] },
      });
      instance.addLayer({
        id: "track-line",
        type: "line",
        source: "track",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#e4572e", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 2, 13, 4] },
      });

      instance.addSource("samples", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      instance.addLayer({
        id: "samples-circle",
        type: "circle",
        source: "samples",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 6, 13, 9],
          "circle-color": "#e4572e",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });
      instance.addLayer({
        id: "samples-label",
        type: "symbol",
        source: "samples",
        layout: {
          "text-field": ["get", "number"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 11,
          "text-allow-overlap": true,
        },
        paint: { "text-color": "#ffffff" },
      });

      setReady(true);
    });

    mapRef.current = instance;
    setMap(instance);
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
      instance.remove();
      mapRef.current = null;
      setMap(null);
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track geometry + framing.
  useEffect(() => {
    if (!map || !ready) return;
    const coordinates = track.map((p) => [p.lon, p.lat]);
    const source = map.getSource("track") as maplibregl.GeoJSONSource | undefined;
    source?.setData({
      type: "FeatureCollection",
      features: coordinates.length > 1
        ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } }]
        : [],
    });
    const bounds = trackBounds(track);
    if (bounds) {
      const padded = padBounds(bounds);
      map.fitBounds(
        [
          [padded.west, padded.south],
          [padded.east, padded.north],
        ],
        { padding: { top: 30, bottom: 30, left: 30, right: 30 }, duration: 0, maxZoom: 14 }
      );
    }
  }, [map, ready, track]);

  useEffect(() => {
    if (!map || !ready) return;
    const source = map.getSource("samples") as maplibregl.GeoJSONSource | undefined;
    source?.setData({
      type: "FeatureCollection",
      features: samples.map((sample) => ({
        type: "Feature",
        properties: { number: sample.number },
        geometry: { type: "Point", coordinates: [sample.lon, sample.lat] },
      })),
    });
  }, [map, ready, samples]);

  // Avalanche slope classification (ICGC WMS raster).
  useEffect(() => {
    if (!map || !ready) return;
    const sourceId = "avalanche-slopes";
    const layerId = "avalanche-slopes";
    if (map.getLayer(layerId)) map.removeLayer(layerId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);
    if (!showSlopes) return;
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
      "track-casing"
    );
  }, [map, ready, showSlopes]);

  // BPA danger zones, coloured by the current bulletin.
  useEffect(() => {
    if (!map || !ready) return;
    const sourceId = "avalanche-zones";
    if (map.getLayer("avalanche-zones-line")) map.removeLayer("avalanche-zones-line");
    if (map.getLayer("avalanche-zones-fill")) map.removeLayer("avalanche-zones-fill");
    if (map.getLayer("avalanche-zones-label")) map.removeLayer("avalanche-zones-label");
    if (map.getSource(sourceId)) map.removeSource(sourceId);
    if (!showZones || !zones?.length) return;

    map.addSource(sourceId, {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: zones.map((zone) => ({
          type: "Feature" as const,
          properties: {
            ...zone.properties,
            label: zone.properties.danger > 0
              ? `${zone.properties.name} · ${dangerMeta(zone.properties.danger).short}`
              : zone.properties.name,
          },
          geometry: zone.geometry as never,
        })),
      },
    });
    map.addLayer(
      {
        id: "avalanche-zones-fill",
        type: "fill",
        source: sourceId,
        paint: { "fill-color": DANGER_COLOR, "fill-opacity": 0.16 },
      },
      "track-casing"
    );
    map.addLayer(
      {
        id: "avalanche-zones-line",
        type: "line",
        source: sourceId,
        paint: { "line-color": DANGER_COLOR, "line-width": 1.4, "line-opacity": 0.75, "line-dasharray": [3, 2] },
      },
      "track-casing"
    );
    map.addLayer(
      {
        id: "avalanche-zones-label",
        type: "symbol",
        source: sourceId,
        layout: {
          "text-field": ["get", "label"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 11,
          "text-padding": 4,
        },
        paint: {
          "text-color": theme === "dark" ? "#fdfcfc" : "#201d1d",
          "text-halo-color": theme === "dark" ? "#201d1d" : "#fdfcfc",
          "text-halo-width": 1.4,
        },
      },
      "track-casing"
    );
  }, [map, ready, zones, showZones, theme]);

  return (
    <div className="relative overflow-hidden rounded-md border" style={{ borderColor: "var(--border)" }}>
      <div ref={containerRef} className={className} aria-label="Mapa del recorregut amb capes d'allaus" />
      {showSlopes && (
        <AvalancheSlopeLegend className="pointer-events-none absolute bottom-2 right-2 z-10" />
      )}
    </div>
  );
}
