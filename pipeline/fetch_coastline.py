#!/usr/bin/env python3
"""Build public/coastline.geojson from OpenStreetMap natural=coastline ways.

The interactive map draws this as a thin outline over the weather raster, so it
needs real OSM detail (harbours, beaches, islets) instead of a hand-drawn line.
Data © OpenStreetMap contributors, ODbL. Re-run occasionally to refresh.
"""
import json
import math
import urllib.parse
import urllib.request
from pathlib import Path

BBOX = "39.15,-1.7,44.3,5.3"  # south,west,north,east around Catalonia
TOLERANCE = 0.00005  # degrees (~5 m): full OSM detail, still light to ship
OUT = Path(__file__).parent.parent / "apps" / "web" / "public" / "coastline.geojson"

ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]

QUERY = f"""
[out:json][timeout:300];
way["natural"="coastline"]({BBOX});
out geom;
"""


def fetch() -> dict:
    last_error: Exception | None = None
    for endpoint in ENDPOINTS:
        try:
            body = urllib.parse.urlencode({"data": QUERY}).encode()
            request = urllib.request.Request(
                endpoint, data=body, headers={"User-Agent": "meteozini/0.1 (coastline dataset)"}
            )
            with urllib.request.urlopen(request, timeout=600) as response:
                return json.loads(response.read())
        except Exception as exc:  # noqa: BLE001 - try the next mirror
            last_error = exc
            print(f"fail {endpoint}: {exc}")
    raise SystemExit(f"no Overpass endpoint responded: {last_error}")


def perpendicular_distance(point, start, end):
    (x, y), (x1, y1), (x2, y2) = point, start, end
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(x - x1, y - y1)
    t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    return math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))


def simplify(points: list[list[float]], tolerance: float) -> list[list[float]]:
    if len(points) <= 2:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        start, end = stack.pop()
        if end <= start + 1:
            continue
        index, distance = 0, 0.0
        for i in range(start + 1, end):
            d = perpendicular_distance(points[i], points[start], points[end])
            if d > distance:
                index, distance = i, d
        if distance > tolerance:
            keep[index] = True
            stack.append((start, index))
            stack.append((index, end))
    return [point for point, kept in zip(points, keep) if kept]


def main() -> None:
    data = fetch()
    features = []
    vertices = 0
    for element in data["elements"]:
        if element.get("type") != "way" or "geometry" not in element:
            continue
        points = [[round(p["lon"], 5), round(p["lat"], 5)] for p in element["geometry"]]
        line = simplify(points, TOLERANCE)
        if len(line) < 2:
            continue
        vertices += len(line)
        features.append(
            {
                "type": "Feature",
                "properties": {},
                "geometry": {"type": "LineString", "coordinates": line},
            }
        )

    OUT.write_text(
        json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False, separators=(",", ":"))
    )
    print(f"wrote {OUT} ({len(features)} ways, {vertices} vertices, {OUT.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
