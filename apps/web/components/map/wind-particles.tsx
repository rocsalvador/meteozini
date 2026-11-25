"use client";

import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef } from "react";
import type { Bounds } from "@meteozini/core";

type Props = {
  map: MapLibreMap | null;
  url: string | null;
  bounds: Bounds | null;
  enabled: boolean;
  frameKey: string;
};

type Field = { data: Uint8ClampedArray; width: number; height: number };

const MAX_PARTICLES = 480;

export function WindParticles({ map, url, bounds, enabled, frameKey }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fieldRef = useRef<Field | null>(null);
  const particlesRef = useRef<Float32Array | null>(null);

  useEffect(() => {
    fieldRef.current = null;
    if (!url) return;
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      fieldRef.current = {
        data: ctx.getImageData(0, 0, img.width, img.height).data,
        width: img.width,
        height: img.height,
      };
      particlesRef.current = null;
    };
    img.src = url;
    return () => {
      cancelled = true;
    };
  }, [url, frameKey]);

  useEffect(() => {
    if (!map || !enabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      particlesRef.current = null;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let raf = 0;
    let last = performance.now();
    let moving = false;

    const pause = () => {
      moving = true;
      particlesRef.current = null;
      const rect = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, rect.width, rect.height);
      canvas.style.opacity = "0";
    };
    const resume = () => {
      moving = false;
      particlesRef.current = null;
      last = performance.now();
      canvas.style.opacity = enabled ? "1" : "0";
    };

    const initParticles = () => {
      const arr = new Float32Array(MAX_PARTICLES * 3);
      const { width, height } = canvas.getBoundingClientRect();
      for (let i = 0; i < MAX_PARTICLES; i += 1) {
        arr[i * 3] = Math.random() * width;
        arr[i * 3 + 1] = Math.random() * height;
        arr[i * 3 + 2] = 12 + Math.random() * 40;
      }
      particlesRef.current = arr;
    };

    const sample = (lon: number, lat: number) => {
      const field = fieldRef.current;
      if (!field || !bounds) return null;
      const { west, east, south, north } = bounds;
      if (lon < west || lon > east || lat < south || lat > north) return null;
      const x = Math.min(field.width - 1, Math.max(0, Math.floor(((lon - west) / (east - west)) * field.width)));
      const y = Math.min(field.height - 1, Math.max(0, Math.floor(((north - lat) / (north - south)) * field.height)));
      const p = (y * field.width + x) * 4;
      const u = (field.data[p] - 128) / 127;
      const v = (field.data[p + 1] - 128) / 127;
      return { u, v };
    };

    const tick = (time: number) => {
      if (moving) {
        last = time;
        raf = requestAnimationFrame(tick);
        return;
      }
      const dt = Math.min(3, (time - last) / 16.67);
      last = time;
      const rect = canvas.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      ctx.globalCompositeOperation = "destination-in";
      ctx.fillStyle = `rgba(0,0,0,${0.9 - Math.min(0.5, dt * 0.02)})`;
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = "source-over";

      const particles = particlesRef.current ?? (initParticles(), particlesRef.current!);
      const isDark = document.documentElement.classList.contains("dark");
      ctx.strokeStyle = isDark ? "rgba(225,240,248,0.4)" : "rgba(18,38,52,0.26)";
      ctx.lineWidth = 1;
      ctx.beginPath();

      for (let i = 0; i < MAX_PARTICLES; i += 1) {
        const px = particles[i * 3];
        const py = particles[i * 3 + 1];
        const life = particles[i * 3 + 2];
        const ll = map.unproject([px, py]);
        const vec = sample(ll.lng, ll.lat);
        if (!vec) {
          particles[i * 3] = Math.random() * width;
          particles[i * 3 + 1] = Math.random() * height;
          particles[i * 3 + 2] = 20 + Math.random() * 40;
          continue;
        }
        const speed = Math.hypot(vec.u, vec.v);
        const k = 0.95 * dt * 7;
        const nx = px + vec.u * k;
        const ny = py - vec.v * k;
        if (life <= 0 || speed < 0.015 || nx < 0 || ny < 0 || nx > width || ny > height) {
          particles[i * 3] = Math.random() * width;
          particles[i * 3 + 1] = Math.random() * height;
          particles[i * 3 + 2] = 20 + Math.random() * 40;
          continue;
        }
        ctx.moveTo(px, py);
        ctx.lineTo(nx, ny);
        particles[i * 3] = nx;
        particles[i * 3 + 1] = ny;
        particles[i * 3 + 2] = life - 0.85 * dt;
      }
      ctx.stroke();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    map.on("movestart", pause);
    map.on("zoomstart", pause);
    map.on("moveend", resume);
    map.on("zoomend", resume);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      map.off("movestart", pause);
      map.off("zoomstart", pause);
      map.off("moveend", resume);
      map.off("zoomend", resume);
    };
  }, [map, enabled, bounds, frameKey]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full transition-opacity duration-300"
      style={{ opacity: enabled ? 1 : 0 }}
    />
  );
}
