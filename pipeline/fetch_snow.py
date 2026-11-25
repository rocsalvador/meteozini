#!/usr/bin/env python3
"""Copernicus CLMS daily snow cover for Catalonia, as a map overlay PNG.

Source: Copernicus Land Monitoring Service, High Resolution Water, Snow and Ice
(HR-WSI). Two products are supported:

  sce   Snow Cover Extent, Europe, 500 m, daily (default)
  gfsc  Gap-filled Fractional Snow Cover, Europe, 60 m, daily

Both are Sentinel Hub BYOC collections on the Copernicus Data Space Ecosystem,
so this needs a free CDSE account. Provide the OAuth client either in the
environment or in the repo-root `.env` (which `run.sh` sources):

    CDSE_CLIENT_ID=...
    CDSE_CLIENT_SECRET=...

Outputs, under data/up/static/snow:

    <product>-YYYY-MM-DD.png   transparent where there is no snow/no data
    index.json                 metadata + the `days` list the slider walks

Run daily. Only days that are missing from disk are requested, so a normal run
issues one Process API call for the new day; the rest is served from the files
kept here (KEEP_DAYS). A day stored as empty is retried for a couple of days,
because "no snow" and "not published yet" look identical in the product.
"""

from __future__ import annotations

import argparse
import io
import json
import math
import os
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests
from PIL import Image

try:
    from zoneinfo import ZoneInfo

    MADRID = ZoneInfo("Europe/Madrid")
except Exception:  # noqa: BLE001 - very old Python or missing tzdata
    MADRID = timezone.utc

TOKEN_URL = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token"
PROCESS_URL = "https://sh.dataspace.copernicus.eu/api/v1/process"

# Same frame as the AROME products so the overlay lines up with the weather rasters.
BOUNDS = {"west": -1.0, "south": 39.8, "east": 4.5, "north": 43.5}

# Sentinel Hub BYOC collection ids (Copernicus Data Space Ecosystem docs).
COLLECTIONS = {
    "sce": "4b3fe9bb-77d8-4699-b50c-02136939ed0c",
    "gfsc": "0b5265f5-3664-44c2-96ab-e91aba67b0c3",
}
RESOLUTION = {"sce": 500, "gfsc": 60}
MAX_SIDE = 2048
KEEP_DAYS = 14

DATA = Path(os.environ.get("MZ_DATA_DIR", Path(__file__).parent.parent / "data" / "up"))
OUT_DIR = DATA / "static" / "snow"

EARTH_RADIUS = 6_378_137.0

# Colour ramp, mirrored by SNOW_COVER_STOPS in packages/core/src/mountain.ts.
RAMP = [
    (0.01, (168, 208, 242)),
    (0.25, (128, 190, 236)),
    (0.50, (86, 168, 224)),
    (0.75, (42, 112, 190)),
    (1.00, (18, 60, 140)),
]


def _ramp_js() -> str:
    stops = ", ".join(f"[{p}, [{r}, {g}, {b}]]" for p, (r, g, b) in RAMP)
    return stops


EVALSCRIPTS = {
    "sce": f"""//VERSION=3
function setup() {{
  return {{ input: ["SCE"], output: {{ bands: 4 }} }};
}}
function evaluatePixel(s) {{
  const v = s.SCE;
  // The BYOC store delivers SCE with a +100 offset: 100 = 0 %, 200 = 100 %,
  // 255 = no data. Values outside 101..200 are not snow.
  if (v <= 100 || v > 200) return [0, 0, 0, 0];
  const f = Math.min(1, (v - 100) / 100);
  const stops = [{_ramp_js()}];
  let i = 0;
  while (i < stops.length - 2 && f > stops[i + 1][0]) i++;
  const lo = stops[i], hi = stops[i + 1];
  const t = (f - lo[0]) / (hi[0] - lo[0]);
  const c = [0, 1, 2].map((k) => (lo[1][k] + (hi[1][k] - lo[1][k]) * t) / 255);
  // Capped well below 1 so the relief, roads and slope shading stay readable
  // even under 100 % snow.
  return [c[0], c[1], c[2], Math.min(0.60, 0.34 + 0.26 * f)];
}}""",
    # GF: 0-100 %, 205 cloud/shadow, 210 inland water.
    "gfsc": f"""//VERSION=3
function setup() {{
  return {{ input: ["GF"], output: {{ bands: 4 }} }};
}}
function evaluatePixel(s) {{
  const v = s.GF;
  if (!(v > 0) || v > 100) return [0, 0, 0, 0];
  const f = Math.min(1, v / 100);
  const stops = [{_ramp_js()}];
  let i = 0;
  while (i < stops.length - 2 && f > stops[i + 1][0]) i++;
  const lo = stops[i], hi = stops[i + 1];
  const t = (f - lo[0]) / (hi[0] - lo[0]);
  const c = [0, 1, 2].map((k) => (lo[1][k] + (hi[1][k] - lo[1][k]) * t) / 255);
  return [c[0], c[1], c[2], Math.min(0.60, 0.34 + 0.26 * f)];
}}""",
}


def access_token() -> str:
    client_id = os.environ.get("CDSE_CLIENT_ID")
    client_secret = os.environ.get("CDSE_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise SystemExit(
            "CDSE_CLIENT_ID / CDSE_CLIENT_SECRET are not set. "
            "Put them in the repo-root .env (see .env.example) or export them."
        )
    response = requests.post(
        TOKEN_URL,
        data={
            "grant_type": "client_credentials",
            "client_id": client_id,
            "client_secret": client_secret,
        },
        timeout=60,
    )
    response.raise_for_status()
    return response.json()["access_token"]


def mercator(lon: float, lat: float) -> tuple[float, float]:
    x = math.radians(lon) * EARTH_RADIUS
    y = math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * EARTH_RADIUS
    return x, y


def image_size(product: str) -> tuple[int, int]:
    x0, y0 = mercator(BOUNDS["west"], BOUNDS["south"])
    x1, y1 = mercator(BOUNDS["east"], BOUNDS["north"])
    width = (x1 - x0) / RESOLUTION[product]
    height = (y1 - y0) / RESOLUTION[product]
    scale = min(1.0, MAX_SIDE / max(width, height))
    return max(256, round(width * scale)), max(256, round(height * scale))


class ProcessError(RuntimeError):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(f"process API {status}: {detail[:300]}")
        self.status = status


def fetch_png(token: str, product: str, day: date, width: int, height: int) -> bytes:
    x0, y0 = mercator(BOUNDS["west"], BOUNDS["south"])
    x1, y1 = mercator(BOUNDS["east"], BOUNDS["north"])
    payload = {
        "input": {
            "bounds": {
                "bbox": [x0, y0, x1, y1],
                "properties": {"crs": "http://www.opengis.net/def/crs/EPSG/0/3857"},
            },
            "data": [
                {
                    "type": f"byoc-{COLLECTIONS[product]}",
                    "dataFilter": {
                        "timeRange": {
                            "from": f"{day.isoformat()}T00:00:00Z",
                            "to": f"{day.isoformat()}T23:59:59Z",
                        },
                    },
                }
            ],
        },
        "output": {
            "width": width,
            "height": height,
            "responses": [{"identifier": "default", "format": {"type": "image/png"}}],
        },
        "evalscript": EVALSCRIPTS[product],
    }
    response = requests.post(
        PROCESS_URL,
        json=payload,
        headers={"Authorization": f"Bearer {token}"},
        timeout=180,
    )
    if response.status_code != 200:
        raise ProcessError(response.status_code, response.text)
    return response.content


def fetch_png_retry(token: str, product: str, day: date, width: int, height: int, attempts: int = 3) -> bytes:
    """CDSE answers 502/503 fairly often; retry those (but not 4xx) with a short backoff."""
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            return fetch_png(token, product, day, width, height)
        except ProcessError as exc:
            last = exc
            if exc.status < 500 and exc.status != 429:
                raise
            if attempt + 1 < attempts:
                time.sleep(1.5 * (attempt + 1))
    assert last is not None
    raise last


def has_snow(data: bytes) -> bool:
    try:
        alpha = Image.open(io.BytesIO(data)).convert("RGBA").getchannel("A")
    except Exception:  # noqa: BLE001 - a broken PNG is treated as no data
        return False
    return alpha.getbbox() is not None and alpha.getextrema()[1] > 0


def prune(product: str, keep: set[Path]) -> None:
    cutoff = date.today() - timedelta(days=KEEP_DAYS)
    for old in OUT_DIR.glob(f"{product}-*.png"):
        if old in keep:
            continue
        try:
            old_day = date.fromisoformat(old.stem.split("-", 1)[1])
        except ValueError:
            continue
        if old_day < cutoff:
            old.unlink(missing_ok=True)


def day_entry(day: date, path: Path, empty: bool) -> dict:
    return {"date": day.isoformat(), "image": f"/static/snow/{path.name}", "empty": empty}


def write_index(product: str, width: int, height: int, days: list[dict]) -> None:
    """Publish the per-day list; `date`/`image` stay on the newest snowy day."""
    if not days:
        raise SystemExit("snow: nothing fetched")
    current = next((d for d in reversed(days) if not d["empty"]), days[-1])
    index = {
        "product": "SCE" if product == "sce" else "GFSC",
        "source": "Copernicus Land Monitoring Service (CLMS), High Resolution Water, Snow and Ice",
        "attribution": "© European Union, Copernicus Land Monitoring Service",
        "url": "https://land.copernicus.eu/en/products/snow",
        "date": current["date"],
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "bounds": BOUNDS,
        "file": current["image"].rsplit("/", 1)[-1],
        "image": current["image"],
        "width": width,
        "height": height,
        "unit": "%",
        "empty": current["empty"],
        "days": days,
    }
    (OUT_DIR / "index.json").write_text(json.dumps(index, separators=(",", ":")))


def is_fresh(max_age_hours: float, days_expected: int) -> bool:
    try:
        index = json.loads((OUT_DIR / "index.json").read_text())
        generated = datetime.fromisoformat(index["generated_at"].replace("Z", "+00:00"))
        age = (datetime.now(timezone.utc) - generated).total_seconds() / 3600
        complete = len(index.get("days") or []) >= days_expected
        return age < max_age_hours and complete and (OUT_DIR / index["file"]).is_file()
    except Exception:  # noqa: BLE001 - missing/corrupt index means "not fresh"
        return False


def previous_empty_days(product: str) -> set[str]:
    """Dates the last run stored as empty; those may simply not have been published yet."""
    try:
        index = json.loads((OUT_DIR / "index.json").read_text())
        if index.get("product") != ("SCE" if product == "sce" else "GFSC"):
            return set()
        return {day["date"] for day in index.get("days") or [] if day.get("empty")}
    except Exception:  # noqa: BLE001 - no usable previous index
        return set()


# A day that came back empty is retried for this many days: "no snow" and
# "not published yet" look identical, and early-morning runs usually hit the latter.
EMPTY_RETRY_DAYS = 2


def main() -> None:
    parser = argparse.ArgumentParser(description="Download CLMS snow cover for Catalonia")
    parser.add_argument("--product", choices=sorted(COLLECTIONS), default="gfsc")
    parser.add_argument("--date", help="YYYY-MM-DD of the newest day; defaults to today (Europe/Madrid)")
    parser.add_argument("--days", type=int, default=6, help="days of history to publish (slider)")
    parser.add_argument("--max-age-hours", type=float, default=3.0)
    parser.add_argument("--force", action="store_true", help="re-download days already on disk")
    args = parser.parse_args()

    if not args.force and is_fresh(args.max_age_hours, max(1, args.days)):
        print(f"snow: index is younger than {args.max_age_hours:g} h, skipping")
        return

    start = date.fromisoformat(args.date) if args.date else datetime.now(MADRID).date()
    width, height = image_size(args.product)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # Only the days that are missing, forced, or recently empty cost an API call;
    # everything else is served from disk.
    retry_empty = previous_empty_days(args.product)
    offsets = range(max(1, args.days) - 1, -1, -1)
    pending = [
        start - timedelta(days=offset)
        for offset in offsets
        if args.force
        or not (OUT_DIR / f"{args.product}-{(start - timedelta(days=offset)).isoformat()}.png").is_file()
        or (
            (start - timedelta(days=offset)).isoformat() in retry_empty
            and offset < EMPTY_RETRY_DAYS
        )
    ]
    token = access_token() if pending else None

    days: list[dict] = []
    kept: set[Path] = set()
    for offset in range(max(1, args.days) - 1, -1, -1):
        day = start - timedelta(days=offset)
        path = OUT_DIR / f"{args.product}-{day.isoformat()}.png"
        if day in pending:
            try:
                data = fetch_png_retry(token, args.product, day, width, height)
            except Exception as exc:  # noqa: BLE001 - a bad day must not kill the run
                print(f"snow: {day} unavailable ({exc})")
                if path.is_file():  # keep an older copy rather than dropping the day
                    days.append(day_entry(day, path, not has_snow(path.read_bytes())))
                    kept.add(path)
                continue
            path.write_bytes(data)
            print(f"snow: {day} downloaded ({width}x{height})")
        else:
            print(f"snow: {day} cached")
        days.append(day_entry(day, path, not has_snow(path.read_bytes())))
        kept.add(path)

    write_index(args.product, width, height, days)
    prune(args.product, kept)
    snowy = [d["date"] for d in days if not d["empty"]]
    print(f"snow: {len(days)} days published, newest with snow: {snowy[-1] if snowy else 'none'}")


if __name__ == "__main__":
    try:
        main()
    except requests.RequestException as exc:
        sys.exit(f"snow: request failed: {exc}")
