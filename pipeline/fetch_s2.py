#!/usr/bin/env python3
"""Copernicus Sentinel-2 true-colour mosaic for Catalonia, as map tiles.

The weather tab shows a "recent" Sentinel-2 view. Asking the CDSE Process API for
that view on demand cannot be both sharp and seamless: a single response is capped
at 2500x2500 px, and every extra tile picks its own least-cloudy scene, so
neighbouring tiles end up on different acquisition dates and the mosaic shows hard
seams. So the mosaic is built here instead:

  1. one STAC query says which acquisition day is newest over Catalonia (free, no
     processing units), and the run is skipped when that day is already published;
  2. each day of the window is rendered as `--grid` x `--grid` Process API frames.
     Every frame of a day is the same date, so the frames of one day join without
     seams;
  3. the days are composited locally, newest first, with the SCL scene
     classification masking clouds, shadows and no-data;
  4. the mosaic is cut into WebP tiles for the zoom range the mosaic can fill.

Day frames are kept on disk, so a rebuild only pays for the days that appeared
since the last run. That is the quota guard: the free CDSE account allows 10 000
processing units and 10 000 Sentinel Hub requests per month, and one 2500 px frame
already costs ~22 PU (1 PU = 512x512 px), so a full refetch must not happen on a
schedule — only when STAC reports a new acquisition.

Outputs, under data/up/static/s2:

    <run>/<z>/<x>/<y>.webp   tiles, transparent where there is no clear pixel
    index.json               run date, bounds, tile template, zoom range
    frames/<date>/<gy>x<gx>.webp   per-day source frames (reused across runs)

Run it from `pipeline/run.sh`, or by hand when a new pass is published:

    pipeline/.venv/bin/python pipeline/fetch_s2.py               # skip if current
    pipeline/.venv/bin/python pipeline/fetch_s2.py --days 14 --grid 4 --force
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import shutil
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests
from PIL import Image

TOKEN_URL = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token"
PROCESS_URL = "https://sh.dataspace.copernicus.eu/api/v1/process"
STAC_URL = "https://catalogue.dataspace.copernicus.eu/stac/search"

# The AROME/snow frame, so every overlay on the map ends on the same edge.
BOUNDS = {"west": -1.0, "south": 39.8, "east": 4.5, "north": 43.5}

EARTH_RADIUS = 6_378_137.0

# Process API hard limit per response. The mosaic resolution follows from this.
MAX_CELL = 2500
TILE_SIZE = 512
# The map can zoom out to 4.5, so the pyramid has to start below that or the layer
# simply vanishes when the view is wider than Catalonia.
TILE_MIN_ZOOM = 4
# The mosaic is ~60 m per pixel, so z11 (38 m/px at 512 px tiles) is the deepest
# level worth cutting; MapLibre upscales from there and the layer fades with zoom.
TILE_MAX_ZOOM = 11
QUALITY = 82
ATTRIBUTION = "Sentinel-2 © Copernicus"

DATA = Path(os.environ.get("MZ_DATA_DIR", Path(__file__).parent.parent / "data" / "up"))
OUT_DIR = DATA / "static" / "s2"
# Frames are cached per frame extent: changing BOUNDS changes every cell, so the
# old cache must not be reused.
FRAME_ROOT = OUT_DIR / "frames"
FRAME_KEY = hashlib.md5(json.dumps(BOUNDS, sort_keys=True).encode()).hexdigest()[:8]
FRAME_DIR = FRAME_ROOT / FRAME_KEY

# Sentinel Hub caps S2 L2A at 1500 m/px; the offline product wants far less.
MAX_PIXEL_SIZE = 1500

EVALSCRIPT = """//VERSION=3
function setup() { return { input: ["B02", "B03", "B04", "SCL"], output: { bands: 4 } }; }
function evaluatePixel(s) {
  // SCL: 0 no data, 1 saturated, 2 dark, 3 cloud shadow, 4 vegetation, 5 soil,
  // 6 water, 7 unclassified, 8 cloud medium, 9 cloud high, 10 thin cirrus,
  // 11 snow. Snow is real weather and stays; the rest of the bad classes go.
  const scl = s.SCL;
  if (scl === 0 || scl === 1 || scl === 3 || scl === 8 || scl === 9 || scl === 10) return [0, 0, 0, 0];
  const max = 0.42, gamma = 2.2;
  const rgb = [s.B04, s.B03, s.B02].map((v) => Math.pow(Math.max(0, Math.min(1, v / max)), 1 / gamma));
  return [rgb[0], rgb[1], rgb[2], 1];
}"""


def mercator(lon: float, lat: float) -> tuple[float, float]:
    return (
        math.radians(lon) * EARTH_RADIUS,
        math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * EARTH_RADIUS,
    )


X0, Y0 = mercator(BOUNDS["west"], BOUNDS["south"])
X1, Y1 = mercator(BOUNDS["east"], BOUNDS["north"])


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


def latest_acquisition(session: requests.Session) -> date | None:
    """Newest Sentinel-2 L2A day over the bbox, or None when the search fails."""
    query = {
        "collections": ["sentinel-2-l2a"],
        "bbox": [BOUNDS["west"], BOUNDS["south"], BOUNDS["east"], BOUNDS["north"]],
        "datetime": f"{(date.today() - timedelta(days=45)).isoformat()}T00:00:00Z/"
        f"{date.today().isoformat()}T23:59:59Z",
        "limit": 20,
        "sortby": [{"field": "properties.datetime", "direction": "desc"}],
    }
    try:
        response = session.post(STAC_URL, json=query, timeout=90)
        response.raise_for_status()
        features = response.json().get("features") or []
    except Exception as exc:  # noqa: BLE001 - a STAC hiccup must not stop a forced run
        print(f"s2: STAC lookup failed ({exc})", file=sys.stderr)
        return None

    days = []
    for feature in features:
        stamp = (feature.get("properties") or {}).get("datetime")
        if not stamp:
            continue
        try:
            days.append(datetime.fromisoformat(stamp.replace("Z", "+00:00")).date())
        except ValueError:
            continue
    return max(days) if days else None


def published_run() -> str | None:
    try:
        return json.loads((OUT_DIR / "index.json").read_text()).get("run")
    except Exception:  # noqa: BLE001 - no usable index means "not published"
        return None


def cell_grid(grid: int) -> list[tuple[int, int, float, float, float, float]]:
    """Split the bbox into `grid` x `grid` cells, north-west first."""
    cells = []
    dx = (X1 - X0) / grid
    dy = (Y1 - Y0) / grid
    for gy in range(grid):
        for gx in range(grid):
            west = X0 + gx * dx
            east = west + dx
            north = Y1 - gy * dy
            cells.append((gy, gx, west, north - dy, east, north))
    return cells


def cell_size(grid: int) -> tuple[int, int]:
    width = min(MAX_CELL, round((X1 - X0) / grid / 10))
    height = min(MAX_CELL, round(width * (Y1 - Y0) / (X1 - X0)))
    return max(64, width), max(64, height)


def frame_path(day: date, grid: int, gy: int, gx: int, size: tuple[int, int]) -> Path:
    """Cached per day, grid and cell: a different --grid covers different boxes."""
    return FRAME_DIR / day.isoformat() / f"{size[0]}x{size[1]}-g{grid}-{gy}x{gx}.png"


def request_frame(
    token: str, day: date, bbox: tuple[float, float, float, float], size: tuple[int, int], attempts: int = 3
) -> bytes:
    payload = {
        "input": {
            "bounds": {"bbox": list(bbox), "properties": {"crs": "http://www.opengis.net/def/crs/EPSG/0/3857"}},
            "data": [
                {
                    "type": "sentinel-2-l2a",
                    "dataFilter": {
                        "timeRange": {
                            "from": f"{day.isoformat()}T00:00:00Z",
                            "to": f"{day.isoformat()}T23:59:59Z",
                        },
                        "mosaickingOrder": "leastCC",
                    },
                }
            ],
        },
        "output": {
            "width": size[0],
            "height": size[1],
            "responses": [{"identifier": "default", "format": {"type": "image/png"}}],
        },
        "evalscript": EVALSCRIPT,
    }
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            response = requests.post(
                PROCESS_URL,
                json=payload,
                headers={"Authorization": f"Bearer {token}"},
                timeout=240,
            )
            if response.status_code == 200:
                return response.content
            if response.status_code < 500 and response.status_code != 429:
                raise SystemExit(f"s2: process API {response.status_code}: {response.text[:300]}")
            last = RuntimeError(f"process API {response.status_code}")
        except requests.RequestException as exc:
            last = exc
        if attempt + 1 < attempts:
            time.sleep(1.5 * (attempt + 1))
    raise SystemExit(f"s2: giving up on {day}: {last}")


def day_mosaic(token: str, day: date, grid: int, size: tuple[int, int], refetch: bool) -> Image.Image:
    """One day as a single RGBA image; the cells are the same date, so they join cleanly."""
    mosaic = Image.new("RGBA", (size[0] * grid, size[1] * grid), (0, 0, 0, 0))
    for gy, gx, west, south, east, north in cell_grid(grid):
        path = frame_path(day, grid, gy, gx, size)
        path.parent.mkdir(parents=True, exist_ok=True)
        if refetch or not path.is_file():
            path.write_bytes(request_frame(token, day, (west, south, east, north), size))
        mosaic.paste(Image.open(path).convert("RGBA"), (gx * size[0], gy * size[1]))
    return mosaic


def tile_bbox(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    span = 2 * math.pi * EARTH_RADIUS / 2**z
    west = -math.pi * EARTH_RADIUS + x * span
    north = math.pi * EARTH_RADIUS - y * span
    return west, north - span, west + span, north


def cut_tile(mosaic: Image.Image, z: int, tx: int, ty: int) -> Image.Image:
    """Crop the tile out of the mosaic, pasting it into its place on a 512 canvas."""
    canvas = Image.new("RGBA", (TILE_SIZE, TILE_SIZE), (0, 0, 0, 0))
    west, south, east, north = tile_bbox(z, tx, ty)
    iw, ie = max(west, X0), min(east, X1)
    iss, inn = max(south, Y0), min(north, Y1)
    if ie <= iw or inn <= iss:
        return canvas
    width, height = mosaic.size
    box = (
        (iw - X0) / (X1 - X0) * width,
        (Y1 - inn) / (Y1 - Y0) * height,
        (ie - X0) / (X1 - X0) * width,
        (Y1 - iss) / (Y1 - Y0) * height,
    )
    piece = mosaic.crop(tuple(round(v) for v in box))
    span = east - west
    left = round((iw - west) / span * TILE_SIZE)
    top = round((north - inn) / span * TILE_SIZE)
    size = (max(1, round((ie - iw) / span * TILE_SIZE)), max(1, round((inn - iss) / span * TILE_SIZE)))
    canvas.paste(piece.resize(size, Image.LANCZOS), (left, top))
    return canvas


def write_tiles(mosaic: Image.Image, out_dir: Path) -> int:
    count = 0
    for z in range(TILE_MIN_ZOOM, TILE_MAX_ZOOM + 1):
        span = 2 * math.pi * EARTH_RADIUS / 2**z
        half = math.pi * EARTH_RADIUS
        tx0 = math.floor((X0 + half) / span)
        tx1 = math.floor((X1 + half) / span)
        ty0 = math.floor((half - Y1) / span)
        ty1 = math.floor((half - Y0) / span)
        for tx in range(tx0, tx1 + 1):
            for ty in range(ty0, ty1 + 1):
                # Empty tiles are written too: a 404 per missing tile would be
                # re-requested on every pan, and the map treats 404 as a failed tile.
                tile = cut_tile(mosaic, z, tx, ty)
                path = out_dir / str(z) / str(tx) / f"{ty}.webp"
                path.parent.mkdir(parents=True, exist_ok=True)
                tile.save(path, "WEBP", quality=QUALITY, method=4)
                count += 1
    return count


def prune(current: str) -> None:
    for old in OUT_DIR.iterdir():
        if old.is_dir() and old.name not in (current, "frames"):
            shutil.rmtree(old, ignore_errors=True)
    for old in FRAME_ROOT.iterdir():
        if old.is_dir() and old.name != FRAME_KEY:
            shutil.rmtree(old, ignore_errors=True)
    keep = date.today() - timedelta(days=20)
    for old in FRAME_DIR.glob("*"):
        try:
            if date.fromisoformat(old.name) < keep:
                shutil.rmtree(old, ignore_errors=True)
        except ValueError:
            continue


def write_index(run: str, days: list[str], size: tuple[int, int], grid: int) -> None:
    pixel = (X1 - X0) / (size[0] * grid)
    ground = pixel * math.cos(math.radians((BOUNDS["south"] + BOUNDS["north"]) / 2))
    index = {
        "run": run,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "source": "Sentinel-2 L2A · Copernicus Data Space Ecosystem",
        "attribution": ATTRIBUTION,
        "bounds": BOUNDS,
        "tiles": f"/up/static/s2/{run}/{{z}}/{{x}}/{{y}}.webp",
        "tile_size": TILE_SIZE,
        "min_zoom": TILE_MIN_ZOOM,
        "max_zoom": TILE_MAX_ZOOM,
        "days": days,
        "mosaic": {
            "width": size[0] * grid,
            "height": size[1] * grid,
            "metres_per_pixel": round(ground),
        },
    }
    (OUT_DIR / "index.json").write_text(json.dumps(index, separators=(",", ":")))


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the Sentinel-2 mosaic tiles for Catalonia")
    parser.add_argument("--days", type=int, default=10, help="acquisition days composited (newest wins)")
    parser.add_argument("--grid", type=int, default=3, help="cells per axis; resolution = 2500*grid px across")
    parser.add_argument("--force", action="store_true", help="rebuild even when that run is already published")
    parser.add_argument("--refetch", action="store_true", help="also ignore the cached day frames")
    args = parser.parse_args()

    grid = max(1, args.grid)
    days = max(1, args.days)
    size = cell_size(grid)
    pixel = (X1 - X0) / (size[0] * grid)
    if pixel > MAX_PIXEL_SIZE:
        raise SystemExit(f"s2: {pixel:.0f} m per pixel is too coarse for the Process API")

    with requests.Session() as session:
        newest = latest_acquisition(session)
        current = published_run()
        run = (newest or date.today()).isoformat()
        # The whole point of the change check: no new pass, no Process API spend.
        # A missing run directory means the last publish was interrupted, so rebuild.
        if (
            not args.force
            and not args.refetch
            and current
            and (OUT_DIR / current).is_dir()
            and newest
            and newest <= date.fromisoformat(current)
        ):
            print(f"s2: no acquisition newer than {current}, skipping")
            return

        end = newest or date.today()
        window = [end - timedelta(days=offset) for offset in range(days)]
        token = access_token()

        mosaic = Image.new("RGBA", (size[0] * grid, size[1] * grid), (0, 0, 0, 0))
        used: list[str] = []
        # Oldest first, so each newer day paints over the older one wherever it has
        # a cloud-free pixel; the older days only fill what the new ones had in cloud.
        for day in sorted(window):
            frame = day_mosaic(token, day, grid, size, args.refetch)
            if frame.getchannel("A").getbbox() is None:
                print(f"s2: {day} has no clear pixels, skipping")
                continue
            mosaic = Image.alpha_composite(mosaic, frame)
            used.append(day.isoformat())

        if not used:
            raise SystemExit("s2: nothing fetched")

        out_dir = OUT_DIR / run
        # Start clean: a previous run may have written other zoom levels.
        shutil.rmtree(out_dir, ignore_errors=True)
        out_dir.mkdir(parents=True, exist_ok=True)
        tiles = write_tiles(mosaic, out_dir)
        write_index(run, list(reversed(used)), size, grid)
        prune(run)
        ground = pixel * math.cos(math.radians((BOUNDS["south"] + BOUNDS["north"]) / 2))
        print(
            f"s2: published {run} from {len(used)} day(s), {size[0] * grid}x{size[1] * grid} px "
            f"(~{ground:.0f} m/px), {tiles} tiles"
        )


if __name__ == "__main__":
    main()
