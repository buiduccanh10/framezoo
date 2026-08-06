#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$ROOT_DIR/.venv/bin/python" "$ROOT_DIR/libtorrent_sidecar.py"
