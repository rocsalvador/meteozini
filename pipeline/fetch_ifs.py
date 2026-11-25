#!/usr/bin/env python3
"""Download IFS HRES 0.25° open data for Catalonia.

IFS HRES open data is available at 0.25° and 0.1°. The full 0.1° run is ~24 GB
(98 files), but each file is accompanied by a `.index` listing byte offsets, so
we range-download only the surface fields we need (~500 MB for 0–72 h), decode
them with ecCodes and keep a tiny Catalonia subset in the same bundle format
used by `/v1/api/model/grid`.

Usage:
    pipeline/.venv/bin/python pipeline/fetch_ifs.py --hours 72 --resolution 0.1
"""
from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import json
import math
import os
import re
import urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo

import eccodes
import numpy as np

BASE = "https://data.ecmwf.int/forecasts"
MODEL = "ecmwf_ifs025"
LABEL = "IFS HRES"
SOURCE = "ECMWF open data"
STEP = 0.25  # overwritten by --resolution
SUBDIR = "0p25"
SUFFIX = "oper-fc"
BOUNDS = {"west": -1.0, "south": 39.8, "east": 4.5, "north": 43.5}

DATA = Path(os.environ.get("MZ_DATA_DIR", Path(__file__).resolve().parent.parent / "data" / "up"))
OUT_DIR = DATA / "api" / "model-grid"

# ECMWF sfc parameter → bundle series key (None when post-processed below).
FIELDS = {
    "2t": "temperature_2m",
    "2d": "dewpoint_2m",
    "msl": "pressure_msl",
    "10u": "wind_u",
    "10v": "wind_v",
    "10fg": "wind_gusts_10m",
    "tp": "precipitation",
    "sf": "snowfall",
    "mucape": "cape",
}
SERIES = [
    "temperature_2m",
    "relative_humidity_2m",
    "pressure_msl",
    "visibility",
    "precipitation",
    "snowfall",
    "freezing_level_height",
    "wind_speed_10m",
    "wind_gusts_10m",
    "cape",
]

LONS = np.array([])
LATS = np.array([])
COUNT = 0
NI, NJ = 1440, 721
J = np.array([], dtype=int)
I = np.array([], dtype=int)


def configure(resolution: float) -> None:
    """Set grid geometry for the chosen open-data resolution."""
    global STEP, SUBDIR, SUFFIX, LONS, LATS, COUNT, NI, NJ, J, I
    STEP = resolution
    SUBDIR = "0p1" if resolution <= 0.1 else "0p25"
    SUFFIX = "oper-fc-sfc" if resolution <= 0.1 else "oper-fc"
    NI, NJ = (3600, 1801) if resolution <= 0.1 else (1440, 721)
    LONS = np.round(np.arange(BOUNDS["west"], BOUNDS["east"] + 1e-9, STEP), 2)
    LATS = np.round(np.arange(BOUNDS["south"], BOUNDS["north"] + 1e-9, STEP), 2)
    COUNT = len(LONS) * len(LATS)
    J = np.round((90.0 - LATS) / STEP).astype(int)
    LON360 = np.mod(LONS, 360.0)
    I = np.round(np.mod(LON360 - 180.0, 360.0) / STEP).astype(int)


def http(url: str, accept: str | None = None, byte_range: tuple[int, int] | None = None) -> bytes:
    headers = {}
    if accept:
        headers["Accept"] = accept
    if byte_range:
        headers["Range"] = f"bytes={byte_range[0]}-{byte_range[1]}"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=120) as res:
        return res.read()


def list_run(run: dt.datetime) -> list[dict] | None:
    url = f"{BASE}/{run:%Y%m%d}/{run:%H}z/ifs/{SUBDIR}/oper/"
    try:
        return json.loads(http(url, accept="application/json").decode())
    except Exception:
        return None


def latest_run(min_hours: int) -> tuple[dt.datetime, list[dict]]:
    now = dt.datetime.now(dt.timezone.utc)
    for back in range(0, 16):
        candidate = (now - dt.timedelta(hours=6 * back)).replace(minute=0, second=0, microsecond=0)
        run = candidate.replace(hour=(candidate.hour // 6) * 6)
        if run + dt.timedelta(hours=6) > now:
            continue
        listing = list_run(run)
        if not listing:
            continue
        steps = set()
        for item in listing:
            match = re.search(rf"-(\d+)h-{SUFFIX}\.grib2$", item["name"])
            if match:
                steps.add(int(match.group(1)))
        if all(step in steps for step in range(0, min_hours + 1, 3)):
            return run, listing
    raise SystemExit("no complete IFS run found")


def parse_index(raw: bytes) -> dict[str, tuple[int, int]]:
    out: dict[str, tuple[int, int]] = {}
    for line in raw.decode().splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        if row.get("levtype") != "sfc" or row.get("param") not in FIELDS:
            continue
        out[row["param"]] = (row["_offset"], row["_length"])
    return out


def subset(message: bytes) -> np.ndarray:
    gid = eccodes.codes_new_from_message(message)
    try:
        values = eccodes.codes_get_values(gid).reshape(NJ, NI)
        return values[np.ix_(J, I)].ravel()
    finally:
        eccodes.codes_release(gid)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hours", type=int, default=72, help="forecast horizon in hours (multiples of 3)")
    parser.add_argument("--resolution", type=float, default=0.1, choices=(0.1, 0.25), help="open-data grid resolution")
    parser.add_argument("--run", help="run as YYYYMMDDHH (UTC); defaults to the latest complete run")
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--force", action="store_true", help="re-download even if this run is already built")
    args = parser.parse_args()

    configure(args.resolution)
    if args.run:
        run = dt.datetime.strptime(args.run, "%Y%m%d%H").replace(tzinfo=dt.timezone.utc)
        listing = list_run(run) or []
    else:
        run, listing = latest_run(args.hours)
    steps = [s for s in range(0, args.hours + 1, 3)]
    names = {item["name"] for item in listing}
    missing = [s for s in steps if f"{run:%Y%m%d%H}0000-{s}h-{SUFFIX}.grib2" not in names]
    if missing:
        raise SystemExit(f"run {run:%Y%m%d %HZ} is missing steps: {missing}")

    print(f"IFS run {run:%Y-%m-%d %HZ} · {len(steps)} steps · {COUNT} cells")

    out = OUT_DIR / f"{MODEL}_{str(STEP).replace('.', 'p')}.json"
    run_iso = run.strftime("%Y-%m-%dT%H:%M:%SZ")
    if not args.force:
        try:
            existing = json.loads(out.read_text())
        except (FileNotFoundError, json.JSONDecodeError):
            existing = None
        if (
            existing
            and existing.get("run") == run_iso
            and existing.get("step") == STEP
            and len(existing.get("times", [])) >= len(steps)
        ):
            print(f"IFS {run_iso} already built ({len(existing.get('times', []))} frames); nothing to download (use --force to rebuild)")
            return

    def index_for(step: int):
        url = f"{BASE}/{run:%Y%m%d}/{run:%H}z/ifs/{SUBDIR}/oper/{run:%Y%m%d%H}0000-{step}h-{SUFFIX}.index"
        return step, parse_index(http(url))

    indices: dict[int, dict[str, tuple[int, int]]] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        for step, index in pool.map(index_for, steps):
            indices[step] = index

    tasks = [(step, param, offset, length) for step in steps for param, (offset, length) in indices[step].items()]

    def fetch(task):
        step, param, offset, length = task
        url = f"{BASE}/{run:%Y%m%d}/{run:%H}z/ifs/{SUBDIR}/oper/{run:%Y%m%d%H}0000-{step}h-{SUFFIX}.grib2"
        return step, param, http(url, byte_range=(offset, offset + length - 1))

    raw: dict[tuple[int, str], bytes] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        for step, param, message in pool.map(fetch, tasks):
            raw[(step, param)] = message
    print(f"  downloaded {len(raw)} fields")

    fields: dict[int, dict[str, np.ndarray]] = {step: {} for step in steps}
    for step in steps:
        for param in FIELDS:
            message = raw.pop((step, param), None)
            if message is None:
                continue
            fields[step][param] = subset(message)

    times: list[str] = []
    tz = ZoneInfo("Europe/Madrid")
    for step in steps:
        moment = (run + dt.timedelta(hours=step)).astimezone(tz)
        times.append(moment.strftime("%Y-%m-%dT%H:%M"))

    series = {key: np.full(len(steps) * COUNT, np.nan) for key in SERIES}
    previous_tp = np.zeros(COUNT)
    previous_sf = np.zeros(COUNT)

    for t, step in enumerate(steps):
        data = fields[step]
        t2m = data["2t"] - 273.15
        dew = data["2d"] - 273.15
        es = 6.112 * np.exp(17.67 * t2m / (t2m + 243.5))
        e = 6.112 * np.exp(17.67 * dew / (dew + 243.5))
        humidity = np.clip(100.0 * e / es, 0.0, 100.0)
        speed = np.hypot(data["10u"], data["10v"]) * 3.6
        gust = data["10fg"] * 3.6
        pressure = data["msl"] / 100.0
        tp = data["tp"] * 1000.0
        sf = data["sf"] * 1000.0
        precipitation = np.clip(tp - previous_tp, 0.0, None)
        # 10:1 snow ratio: 1 mm water equivalent ≈ 1 cm snow.
        snowfall = np.clip(sf - previous_sf, 0.0, None)
        previous_tp = tp
        previous_sf = sf
        cape = np.clip(data["mucape"], 0.0, None)

        def put(key: str, values: np.ndarray) -> None:
            series[key][t * COUNT : (t + 1) * COUNT] = values

        put("temperature_2m", t2m)
        put("relative_humidity_2m", humidity)
        put("pressure_msl", pressure)
        put("wind_speed_10m", speed)
        put("wind_gusts_10m", gust)
        put("precipitation", precipitation)
        put("snowfall", snowfall)
        put("cape", cape)
        # visibility and freezing_level_height are not in ECMWF open data: keep null.

    def clean(values: np.ndarray):
        return [None if not math.isfinite(v) else round(float(v), 2) for v in values]

    bundle = {
        "model": MODEL,
        "label": LABEL,
        "source": SOURCE,
        "run": run_iso,
        "step": STEP,
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "bounds": {
            "west": float(LONS[0]),
            "south": float(LATS[0]),
            "east": float(LONS[-1]),
            "north": float(LATS[-1]),
        },
        "lats": [float(v) for v in LATS],
        "lons": [float(v) for v in LONS],
        "times": times,
        "series": {key: clean(values) for key, values in series.items()},
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(bundle, separators=(",", ":")))
    print(f"wrote {out} ({out.stat().st_size / 1024:.0f} kB)")


if __name__ == "__main__":
    main()
