import type { TrackPoint } from "@meteozini/core";

export type ParsedGpx = {
  name: string;
  points: TrackPoint[];
  source: "traça" | "ruta" | "punts";
};

const MAX_POINTS = 40_000;

function readPoint(element: Element): TrackPoint | null {
  const lat = Number(element.getAttribute("lat"));
  const lon = Number(element.getAttribute("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const ele = Number(element.querySelector("ele")?.textContent);
  const time = element.querySelector("time")?.textContent?.trim() || null;
  return { lat, lon, ele: Number.isFinite(ele) ? ele : null, time };
}

/**
 * Parse a GPX file in the browser. Prefers a recorded track, then a route, then
 * standalone waypoints. Returns `null` when there is nothing usable.
 */
export function parseGpx(xml: string, fallbackName = "Recorregut"): ParsedGpx | null {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) return null;

  let source: ParsedGpx["source"] = "traça";
  let nodes = Array.from(doc.querySelectorAll("trkseg > trkpt"));
  if (!nodes.length) {
    nodes = Array.from(doc.querySelectorAll("rte > rtept"));
    source = "ruta";
  }
  if (!nodes.length) {
    nodes = Array.from(doc.querySelectorAll("wpt"));
    source = "punts";
  }
  if (!nodes.length) return null;

  const points = nodes.slice(0, MAX_POINTS).map(readPoint).filter((p): p is TrackPoint => p !== null);
  if (points.length < 2) return null;

  const name =
    doc.querySelector("trk > name")?.textContent?.trim() ||
    doc.querySelector("rte > name")?.textContent?.trim() ||
    doc.querySelector("metadata > name")?.textContent?.trim() ||
    fallbackName.replace(/\.gpx$/i, "");

  return { name, points, source };
}
