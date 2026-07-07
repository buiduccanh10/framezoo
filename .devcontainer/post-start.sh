#!/usr/bin/env bash
set -euo pipefail

cd /workspaces/betamovie

if [ ! -d node_modules ]; then
  exit 0
fi

for _ in $(seq 1 30); do
  if pg_isready -h postgres -U "${PG_USER:-betamovie}" -d "${PG_DB:-betamovie_backend}" >/dev/null 2>&1; then
    pnpm --filter betamovie-be exec prisma migrate deploy
    exit 0
  fi

  sleep 2
done

echo "Postgres did not become ready in time; skipping Prisma migrations for this start."
