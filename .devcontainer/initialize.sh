#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ] && [ -f example.env ]; then
  cp example.env .env
  echo "Created .env from example.env"
fi
