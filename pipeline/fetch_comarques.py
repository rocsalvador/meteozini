#!/usr/bin/env python3
"""Build public/comarques.geojson from the ICGC administrative divisions WFS.

Source: ICGC divisions administratives, comarques at 1:50 000
(https://geoserveis.icgc.cat/servei/catalunya/divisions-administratives/wfs).
Data © ICGC, licensed CC BY 4.0.
"""
import json
import math
import urllib.parse
import urllib.request
from pathlib import Path

WFS = "https://geoserveis.icgc.cat/servei/catalunya/divisions-administratives/wfs"
LAYER = "divisions_administratives_wfs:divisions_administratives_comarques_50000"
TOLERANCE = 0.00012  # degrees (~12 m): full 1:50k detail, still light to ship
OUT = Path(__file__).parent.parent / "apps" / "web" / "public" / "comarques.geojson"


def fetch() -> dict:
    query = urllib.parse.urlencode(
        {
            "service": "WFS",
            "version": "2.0.0",
            "request": "GetFeature",
            "typeNames": LAYER,
            "outputFormat": "GEOJSON",
            "srsName": "EPSG:4326",
        }
    )
    request = urllib.request.Request(f"{WFS}?{query}", headers={"User-Agent": "meteozini/0.1"})
    with urllib.request.urlopen(request, timeout=300) as response:
        return json.loads(response.read())


def perpendicular_distance(point, start, end):
    (x, y), (x1, y1), (x2, y2) = point, start, end
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(x - x1, y - y1)
    t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    return math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))


def simplify(points: list[list[float]], tolerance: float) -> list[list[float]]:
    if len(points) <= 3:
        return points
    closed = points[0] == points[-1]
    ring = points[:-1] if closed else points
    if len(ring) <= 3:
        return points

    def douglas_peucker(pts: list[list[float]]) -> list[list[float]]:
        if len(pts) <= 2:
            return pts
        start, end = pts[0], pts[-1]
        index, distance = 0, 0.0
        for i in range(1, len(pts) - 1):
            d = perpendicular_distance(pts[i], start, end)
            if d > distance:
                index, distance = i, d
        if distance <= tolerance:
            return [start, end]
        left = douglas_peucker(pts[: index + 1])
        right = douglas_peucker(pts[index:])
        return left[:-1] + right

    result = douglas_peucker(ring)
    if closed:
        result = result + [result[0]]
    return result if len(result) >= 4 else points


def round_ring(ring: list[list[float]]) -> list[list[float]]:
    return [[round(x, 5), round(y, 5)] for x, y in ring]


def main() -> None:
    data = fetch()
    features = []
    for feature in data["features"]:
        props = feature["properties"]
        geometry = feature["geometry"]
        polygons = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
        out_polygons = []
        for polygon in polygons:
            rings = []
            for ring in polygon:
                simplified = simplify(round_ring(ring), TOLERANCE)
                if len(simplified) >= 4:
                    rings.append(simplified)
            if rings:
                out_polygons.append(rings)
        if not out_polygons:
            continue
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "nom_comar": props.get("NOMCOMAR"),
                    "comarca": props.get("CODICOMAR"),
                    "cap_comar": props.get("CAPCOMAR"),
                },
                "geometry": {"type": "MultiPolygon", "coordinates": out_polygons},
            }
        )

    features.sort(key=lambda f: f["properties"]["comarca"] or "")
    OUT.write_text(
        json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False, separators=(",", ":"))
    )
    vertices = sum(len(r) for f in features for p in f["geometry"]["coordinates"] for r in p)
    print(f"wrote {OUT} ({len(features)} comarques, {vertices} vertices, {OUT.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
