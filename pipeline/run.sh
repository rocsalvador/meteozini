#!/bin/sh
set -e
cd "$(dirname "$0")/.."

# Secrets live outside the repo: .env is gitignored (see .env.example).
if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

if [ ! -f apps/web/public/coastline.geojson ]; then
  pipeline/.venv/bin/python pipeline/fetch_coastline.py
fi

# `--limit`, `--run` and `--force` are AROME-specific smoke/override modes; only
# rebuild IFS in the normal path (and pass --force through when requested).
FORCE=""
SKIP_IFS=""
for arg in "$@"; do
  case "$arg" in
    --limit|--limit=*|--run|--run=*) SKIP_IFS="1" ;;
    --force) FORCE="1" ;;
  esac
done

pipeline/.venv/bin/python pipeline/build_arome.py --hours 48 "$@"

if [ -n "$SKIP_IFS" ]; then
  exit 0
fi

if [ -n "$FORCE" ]; then
  pipeline/.venv/bin/python pipeline/fetch_ifs.py --hours 48 --resolution 0.1 --force
else
  pipeline/.venv/bin/python pipeline/fetch_ifs.py --hours 48 --resolution 0.1
fi

# Daily CLMS snow-cover overlay. A CDSE outage or a missing product must never
# break the weather pipeline, so this step is best-effort.
if [ -n "$FORCE" ]; then
  pipeline/.venv/bin/python pipeline/fetch_snow.py --force || echo "warn: snow overlay not updated"
else
  pipeline/.venv/bin/python pipeline/fetch_snow.py || echo "warn: snow overlay not updated"
fi
