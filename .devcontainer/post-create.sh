#!/usr/bin/env bash
set -euo pipefail

cd /workspaces/betamovie

if [ ! -f .env ] && [ -f example.env ]; then
  cp example.env .env
  echo "Created .env from example.env"
fi

pnpm install --frozen-lockfile
pnpm run prepare:be
