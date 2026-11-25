#!/usr/bin/env python3
"""Build public/peaks.geojson from OpenStreetMap natural=peak nodes (Overpass API).

Used by the interactive map to label summits only at close zoom levels.
Re-run occasionally to refresh the dataset.
"""
import json
import urllib.parse
import urllib.request
from pathlib import Path

BBOX = "39.7,-1.1,43.6,4.6"  # south,west,north,east around Catalonia
MIN_ALT = 800
OUT = Path(__file__).parent.parent / "apps" / "web" / "public" / "peaks.geojson"

ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]

QUERY = f"""
[out:json][timeout:180];
node["natural"="peak"]({BBOX});
out body;
"""


def fetch() -> dict:
    last_error: Exception | None = None
    for endpoint in ENDPOINTS:
        try:
            body = urllib.parse.urlencode({"data": QUERY}).encode()
            request = urllib.request.Request(
                endpoint, data=body, headers={"User-Agent": "meteozini/0.1 (peaks dataset)"}
            )
            with urllib.request.urlopen(request, timeout=240) as response:
                return json.loads(response.read())
        except Exception as exc:  # noqa: BLE001 - try the next mirror
            last_error = exc
            print(f"fail {endpoint}: {exc}")
    raise SystemExit(f"no Overpass endpoint responded: {last_error}")


def main() -> None:
    data = fetch()
    features = []
    seen = set()
    for element in data["elements"]:
        tags = element.get("tags") or {}
        name = tags.get("name")
        elevation = tags.get("ele")
        if not name or not elevation:
            continue
        try:
            alt = float(str(elevation).replace(",", ".").split()[0])
        except ValueError:
            continue
        if alt < MIN_ALT:
            continue
        lon, lat = round(element["lon"], 5), round(element["lat"], 5)
        key = (round(lat, 3), round(lon, 3), name)
        if key in seen:
            continue
        seen.add(key)
        features.append(
            {
                "type": "Feature",
                "properties": {"name": name, "alt": round(alt)},
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
            }
        )

    features.sort(key=lambda f: -f["properties"]["alt"])
    OUT.write_text(
        json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False, separators=(",", ":"))
    )
    print(f"wrote {OUT} ({len(features)} peaks)")


if __name__ == "__main__":
    main()
