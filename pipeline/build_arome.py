#!/usr/bin/env python3
"""Build self-hosted AROME 1.3 km map products from Meteo-France open data.

Downloads SP1/SP2 GRIB2 packages, crops them to Catalonia, renders the overlay
PNG, encoded wind field and value grid in the format the meteozini frontend
already understands, and writes the catalogue JSON.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import re
import shutil
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import eccodes
import numpy as np
import requests
from PIL import Image, ImageFilter

DATASET_API = "https://www.data.gouv.fr/api/1/datasets/paquets-arome-resolution-0-01deg/"
BOUNDS = {"west": -1.0, "south": 39.8, "east": 4.5, "north": 43.5}
GRID = {"west": -12.0, "north": 55.4, "step": 0.01}
CACHE = Path(__file__).parent / "cache"
DATA = Path(os.environ.get("MZ_DATA_DIR", Path(__file__).parent.parent / "data" / "up"))

VARIABLES = [
    "temperature", "humidity", "wind_speed", "precipitation", "precip_accum",
    "snow_precipitation", "snow_accum", "graupel", "cape", "pressure_msl", "temp_wind",
]

# value ranges and colour stops (hex at evenly spaced values unless noted)
PALETTES = {
    "temperature": (-10, 40, ["1d87e7","36a9ff","4fc9ff","8de7ff","a3faf9","2cc9bd","029693","116b6a","165e4b","2b763b","408c40","60a747","85c152","a8d868","d6ec87","fff1bd","fcd273","f7b45b","f1954a","ea793f","e25b39","d43c37","c42b3e","a41554","a64093"]),
    "humidity": (0, 100, ["8c510a","dfc27d","f5f5f5","80cdc1","2b8cbe","2f63b0","4a3593"]),
    "wind_speed": (0, 150, ["f0f0f0","d0e8f0","a0d0e8","70b8e0","50a0d0","3088c0","a6dc8a","6cc04a","2f9a3a","fff176","ffbb30","ff9900","ff6600","ff3300","dd0000","990044","860088"]),
    "precipitation": (0, 150, ["a8e0f5","4cb0ee","1f62d6","7ddc5f","24a63c","f3e33b","f8a31c","e5411d","a9142e","df3fd6"]),
    "precip_accum": (0, 500, ["d4f4fa","8fd3f2","4fb3ea","2f7fdc","1f4fc8","11877a","2fa64c","93c83e","f2e23a","f8b22c","f37a20","e2321f","a8141e","d23ea0","9b2fae","4f3a9e"]),
    "snow_precipitation": (0, 150, ["d6f3ff","62c4f5","2e9be8","2a62d4","3a3bb8","7b2fa8","7a2a7c"]),
    "snow_accum": (0, 100, ["eaf8ff","c6edff","96dcf8","62c6ee","37aade","1f88c8","2a62d4","3a3bb8","7b2fa8","7a2a7c"]),
    "graupel": (0, 150, ["a8e0f5","4cb0ee","1f62d6","7ddc5f","24a63c","f3e33b","f8a31c","e5411d","a9142e","df3fd6"]),
    "cape": (0, 5000, ["f4f9ec","c4e6a2","9ad46c","f3e65b","f08a2a","c2272d","8a1c6f"]),
    "pressure_msl": (980, 1040, ["67001f","d73027","fdae61","ffffbf","a6d96a","1a9850"]),
    "temp_wind": (-10, 40, ["1d87e7","36a9ff","4fc9ff","8de7ff","a3faf9","2cc9bd","029693","116b6a","165e4b","2b763b","408c40","60a747","85c152","a8d868","d6ec87","fff1bd","fcd273","f7b45b","f1954a","ea793f","e25b39","d43c37","c42b3e","a41554","a64093"]),
}
# Meteociel AROME precipitation palette (mm): discrete thresholds shared by rain
# and snow, instant and accumulated.
PRECIP_STEPS = [
    (0, "ffffff"), (0.1, "97e6ff"), (0.2, "33ccff"), (0.5, "0099ff"),
    (1, "00ff99"), (2, "33cc66"), (3, "66cc33"), (4, "66ff00"),
    (5, "a4f22f"), (6, "b7cf0e"), (7, "d6f017"), (8, "cc9900"),
    (9, "ff9900"), (10, "ff9966"), (15, "cc9999"), (20, "cc6633"),
    (25, "cc3333"), (30, "ff0d0d"), (40, "c60000"), (50, "800000"),
    (60, "800050"), (70, "a00077"), (100, "cc00cc"), (200, "ff00ff"),
]
STEP_PALETTES = {
    # Drop the white 0 mm block for rasters: transparent pixels keep a pale-blue
    # RGB so bilinear filtering doesn't create white halos on the edges.
    variable: PRECIP_STEPS[1:]
    for variable in ("precipitation", "precip_accum", "snow_precipitation", "snow_accum", "graupel")
}
# Soft alpha ramp for precipitation: (transparent below, fully opaque from).
SOFT_ALPHA = {
    variable: (0.05, 0.30)
    for variable in ("precipitation", "precip_accum", "snow_precipitation", "snow_accum", "graupel")
}
BLUR_RADIUS = 0.8

MIN_ALPHA: dict[str, float] = {}
UNITS = {
    "temperature": "°C", "humidity": "%", "wind_speed": "km/h",
    "precipitation": "mm", "precip_accum": "mm", "snow_precipitation": "mm", "snow_accum": "mm",
    "graupel": "mm", "cape": "J/kg", "pressure_msl": "hPa", "temp_wind": "°C",
}
LABELS = {
    "temperature": "Temperatura a 2 m", "humidity": "Humitat relativa a 2 m",
    "wind_speed": "Vent mitjà a 10 m", "precipitation": "Precipitació 1 h",
    "precip_accum": "Precipitació acumulada", "snow_precipitation": "Neu 1 h", "snow_accum": "Neu acumulada",
    "graupel": "Calamarsa 1 h", "cape": "Energia convectiva (CAPE)",
    "pressure_msl": "Pressió (MSL)", "temp_wind": "Temperatura i vent",
}


def parse_run(resources: list[dict]) -> dict[str, dict[int, dict[str, str]]]:
    runs: dict[str, dict[int, dict[str, str]]] = {}
    for r in resources:
        m = re.match(r"arome__001__(SP1|SP2)__(\d+)H__(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ)\.grib2", r["title"])
        if not m:
            continue
        pkg, hour, run = m.group(1), int(m.group(2)), m.group(3)
        runs.setdefault(run, {}).setdefault(hour, {})[pkg] = r["url"]
    if not runs:
        raise SystemExit("No AROME SP1/SP2 resources found")
    return runs


def fetch(url: str, dest: Path) -> Path:
    if dest.exists() and dest.stat().st_size > 1000:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    with requests.get(url, stream=True, timeout=180) as r:
        r.raise_for_status()
        with open(tmp, "wb") as fh:
            for chunk in r.iter_content(1 << 20):
                fh.write(chunk)
    tmp.replace(dest)
    return dest


def crop_index():
    i0 = round((BOUNDS["west"] - GRID["west"]) / GRID["step"])
    i1 = round((BOUNDS["east"] - GRID["west"]) / GRID["step"])
    j0 = round((GRID["north"] - BOUNDS["north"]) / GRID["step"])
    j1 = round((GRID["north"] - BOUNDS["south"]) / GRID["step"])
    return j0, j1, i0, i1


def read_fields(path: Path) -> dict[str, np.ndarray]:
    """Return cropped arrays keyed by shortName."""
    j0, j1, i0, i1 = crop_index()
    out: dict[str, np.ndarray] = {}
    with open(path, "rb") as fh:
        while True:
            gid = eccodes.codes_grib_new_from_file(fh)
            if gid is None:
                break
            try:
                short = eccodes.codes_get(gid, "shortName")
                ni = eccodes.codes_get(gid, "Ni")
                nj = eccodes.codes_get(gid, "Nj")
                flat = eccodes.codes_get_array(gid, "values").reshape(nj, ni)
                out[short] = flat[j0:j1 + 1, i0:i1 + 1].astype("float64")
            finally:
                eccodes.codes_release(gid)
    return out


def make_lut(spec) -> tuple[float, float, np.ndarray]:
    lo, hi, colors = spec
    rgb = np.array([tuple(int(c[i:i + 2], 16) for i in (0, 2, 4)) for c in colors], dtype=np.float64)
    x = np.linspace(0, len(rgb) - 1, 1024)
    lut = np.stack([np.interp(x, np.arange(len(rgb)), rgb[:, k]) for k in range(3)], axis=1)
    return lo, hi, lut


def render_overlay(values: np.ndarray, variable: str) -> Image.Image:
    steps = STEP_PALETTES.get(variable)
    if steps is not None:
        thresholds = np.array([value for value, _ in steps], dtype="float64")
        colors = np.array(
            [tuple(int(color[i:i + 2], 16) for i in (0, 2, 4)) for _, color in steps],
            dtype="uint8",
        )
        v = np.nan_to_num(values, nan=0.0)
        idx = np.clip(np.searchsorted(thresholds, v, side="right") - 1, 0, len(steps) - 1)
        rgb = colors[idx]
    else:
        lo, hi, lut = make_lut(PALETTES[variable])
        v = np.nan_to_num(values, nan=lo)
        idx = np.clip(((v - lo) / max(1e-6, hi - lo)) * 1023, 0, 1023).astype("uint16")
        rgb = lut[idx].astype("uint8")
    alpha = np.full(values.shape, 255, dtype="uint8")
    nan_mask = ~np.isfinite(values)
    alpha[nan_mask] = 0
    soft = SOFT_ALPHA.get(variable)
    if soft is not None:
        low, high = soft
        ramp = np.clip((np.nan_to_num(values, nan=low) - low) / (high - low), 0.0, 1.0)
        alpha = (ramp * 255).astype("uint8")
        alpha[nan_mask] = 0
    floor = MIN_ALPHA.get(variable)
    if floor is not None:
        alpha[values < floor] = 0
    image = Image.fromarray(np.dstack([rgb, alpha]), "RGBA")
    if soft is not None:
        # Feather threshold edges to remove the pixel staircase ("saw-tooths").
        image = image.filter(ImageFilter.GaussianBlur(BLUR_RADIUS))
    return image


def encode_values(values: np.ndarray, variable: str, vdir: Path, base: str) -> dict:
    finite = values[np.isfinite(values)]
    vmin = float(np.floor(finite.min())) if finite.size else 0.0
    vmax = float(np.ceil(finite.max())) if finite.size else 1.0
    if variable in ("precipitation", "precip_accum", "snow_precipitation", "graupel"):
        vmin = 0.0
    if vmax - vmin < 1e-6:
        vmax = vmin + 1.0
    step = (vmax - vmin) / 65000.0
    q = np.zeros(values.shape, dtype="uint32")
    ok = np.isfinite(values)
    q[ok] = np.clip(np.round((values[ok] - vmin) / step), 0, 65535).astype("uint32")
    rgb = np.zeros(values.shape + (4,), dtype="uint8")
    rgb[..., 0] = (q >> 8) & 255
    rgb[..., 1] = q & 255
    rgb[..., 3] = np.where(ok, 255, 0)
    filename = f"{base}.values.png"
    Image.fromarray(rgb, "RGBA").save(vdir / filename)
    return {
        "min": round(vmin, 4), "step": step, "shape": [values.shape[0], values.shape[1]],
        "bounds": BOUNDS, "unit": UNITS[variable], "file": filename,
    }


def prune_old(run_id: str) -> None:
    """Drop cached GRIBs and rendered frames from previous runs (space for automation)."""
    for base in (CACHE, DATA / "static" / "live-map" / "arome"):
        if not base.is_dir():
            continue
        for child in base.iterdir():
            if child.is_dir() and child.name != run_id:
                if base == CACHE:
                    shutil.rmtree(child, ignore_errors=True)
                else:
                    shutil.rmtree(child, ignore_errors=True)


def build(hours: int, limit: int | None, run_override: str | None, force: bool = False):
    meta = requests.get(DATASET_API, timeout=60).json()
    runs = parse_run(meta["resources"])
    run = run_override or max(runs, key=lambda s: dt.datetime.fromisoformat(s.replace("Z", "+00:00")))
    files = runs.get(run)
    if not files:
        raise SystemExit(f"AROME run {run} not found")
    run_dt = dt.datetime.fromisoformat(run.replace("Z", "+00:00"))
    run_id = run_dt.strftime("%Y%m%d_%H")
    print(f"run {run} ({run_id})")

    max_hour = max(files)
    wanted = sorted(h for h in files if h <= hours)
    if limit:
        wanted = wanted[:limit]

    out = DATA / "api" / "arome" / "maps"
    run_dir = DATA / "static" / "live-map" / "arome" / run_id
    if not force and wanted and not run_override:
        try:
            existing = json.loads(out.read_text())
        except (FileNotFoundError, json.JSONDecodeError):
            existing = None
        built = int(existing.get("num_frames") or 0) if existing else 0
        if existing and existing.get("run_id") == run_id and built >= len(wanted) and run_dir.is_dir():
            print(f"AROME {run_id} already built ({built} frames); nothing to download (use --force to rebuild)")
            return

    cache_dir = CACHE / run_id
    with ThreadPoolExecutor(max_workers=4) as pool:
        jobs = []
        for h in wanted:
            for pkg in ("SP1", "SP2"):
                url = files[h].get(pkg)
                if url:
                    jobs.append(pool.submit(fetch, url, cache_dir / f"{pkg}_{h:02d}.grib2"))
        for job in jobs:
            job.result()

    var_dir = DATA / "static" / "live-map" / "arome" / run_id
    catalog_vars: dict[str, list] = {v: [] for v in VARIABLES}
    accum = {"precipitation": None, "snow_precipitation": None, "graupel": None}
    lat_c = BOUNDS["north"]
    lon_c = BOUNDS["west"]

    for h in wanted:
        sp1 = read_fields(cache_dir / f"SP1_{h:02d}.grib2")
        sp2_path = cache_dir / f"SP2_{h:02d}.grib2"
        sp2 = read_fields(sp2_path) if sp2_path.exists() else {}
        t2m = sp1.get("2t")
        if t2m is None:
            continue
        temp = t2m - 273.15
        rh = sp1.get("2r", np.full_like(temp, np.nan))
        u = sp1.get("10u", np.zeros_like(temp))
        v = sp1.get("10v", np.zeros_like(temp))
        wind = np.hypot(u, v) * 3.6
        pressure = sp2.get("sp", np.full_like(temp, np.nan)) / 100.0
        cape = sp2.get("CAPE_INS", np.full_like(temp, np.nan))
        tirf = sp2.get("tirf")
        tsnow = sp2.get("tsnowp")
        tgrp = sp2.get("tgrp")

        fields = {
            "temperature": temp, "humidity": rh, "wind_speed": wind,
            "pressure_msl": pressure, "cape": cape, "temp_wind": temp,
        }
        # accumulated fields -> hourly amounts
        for key, arr in (("precipitation", tirf), ("snow_precipitation", tsnow), ("graupel", tgrp)):
            if arr is None:
                fields[key] = np.full_like(temp, np.nan)
                accum[key] = None
                continue
            prev = accum[key]
            if prev is None:
                hourly = np.zeros_like(arr)
            else:
                hourly = np.clip(arr - prev, 0, None)
            accum[key] = arr.copy()
            fields[key] = hourly
        fields["precip_accum"] = (tirf if tirf is not None else np.full_like(temp, np.nan))
        fields["snow_accum"] = (tsnow if tsnow is not None else np.full_like(temp, np.nan))

        ts = run_dt + dt.timedelta(hours=h)
        stamp = ts.strftime("%Y%m%d_%H%M")
        for var in VARIABLES:
            values = fields[var]
            vdir = var_dir / var
            vdir.mkdir(parents=True, exist_ok=True)
            base = f"{var}_{stamp}"
            overlay_name = f"{base}.png"
            render_overlay(values, var).save(vdir / overlay_name)
            meta = encode_values(values, var, vdir, base)
            (vdir / f"{base}.values.json").write_text(json.dumps(meta))
            # wind field for particles (one per frame, same directory layout as upstream)
            if var == "temperature":
                wdir = var_dir / "wind_uv"
                wdir.mkdir(parents=True, exist_ok=True)
                uu = np.clip(u / 30.0, -1, 1)
                vv = np.clip(v / 30.0, -1, 1)
                wind_img = np.zeros(temp.shape + (4,), dtype="uint8")
                wind_img[..., 0] = (uu * 127 + 128).astype("uint8")
                wind_img[..., 1] = (vv * 127 + 128).astype("uint8")
                wind_img[..., 3] = 255
                Image.fromarray(wind_img, "RGBA").save(wdir / f"wind_uv_{stamp}.png")
            catalog_vars[var].append({
                "variable": var,
                "hour": h,
                "timestamp": ts.isoformat().replace("+00:00", "Z"),
                "valid_time": ts.strftime("%d %b %H:%M UTC"),
                "filepath": f"/static/live-map/arome/{run_id}/{var}/{overlay_name}",
                "web_filepath": f"/static/live-map/arome/{run_id}/{var}/{overlay_name}",
                "web_bounds": BOUNDS,
                "unit": UNITS[var],
            })
        print(f"  frame {h:02d} {stamp}")

    catalog = {
        "run_time": run,
        "run_id": run_id,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
        "model": "AROME HD 1.3 km",
        "source": "Météo-France open data",
        "credit": "AROME 1.3 km. Météo-France. meteozini.",
        "variables": [v for v in VARIABLES if catalog_vars[v]],
        "num_frames": len(wanted),
        "bounds": BOUNDS,
        "maps": {v: catalog_vars[v] for v in VARIABLES if catalog_vars[v]},
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(catalog, separators=(",", ":")))
    print(f"wrote {out} ({len(catalog['variables'])} variables, {len(wanted)} frames)")
    prune_old(run_id)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--hours", type=int, default=48)
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--run", default=None)
    ap.add_argument("--force", action="store_true", help="rebuild even if this run is already published")
    args = ap.parse_args()
    build(args.hours, args.limit, args.run, args.force)
