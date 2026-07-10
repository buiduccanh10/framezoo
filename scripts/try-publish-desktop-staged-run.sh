#!/usr/bin/env sh
set -eu

RUN_KEY="${RUN_KEY:-${1:-}}"
PUBLISHED_AT="${PUBLISHED_AT:-${2:-$(date -u +"%Y-%m-%dT%H:%M:%SZ")}}"
CHANNEL="${DESKTOP_PUBLISH_CHANNEL:-${3:-stable}}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE_PATH="${ENV_FILE_PATH:-.env}"
PROJECT_NAME="${PROJECT_NAME:-$(basename "$(pwd)")}"
STAGING_ROOT="${DESKTOP_PUBLISH_STAGING_ROOT:-$(pwd)/desktop-publish-staging}"
RUN_ROOT="${STAGING_ROOT}/runs/${RUN_KEY}"
SCRIPTS_ROOT="${RUN_ROOT}/scripts"
COMPLETED_ROOT="${STAGING_ROOT}/completed"
LOCKS_ROOT="${STAGING_ROOT}/locks"
COMPLETED_MARKER="${COMPLETED_ROOT}/${RUN_KEY}"
LOCK_DIR="${LOCKS_ROOT}/${RUN_KEY}.lock"

if [ -z "$RUN_KEY" ]; then
  echo "Usage: RUN_KEY=<run-id-attempt> [PUBLISHED_AT=<iso>] [DESKTOP_PUBLISH_CHANNEL=stable] /bin/sh ./scripts/try-publish-desktop-staged-run.sh"
  exit 1
fi

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "Compose file not found: $COMPOSE_FILE"
  exit 1
fi

if [ ! -f "$ENV_FILE_PATH" ]; then
  echo "Env file not found: $ENV_FILE_PATH"
  exit 1
fi

mkdir -p "$COMPLETED_ROOT" "$LOCKS_ROOT"

cleanup_old_staging() {
  find "$COMPLETED_ROOT" -type f -mtime +2 -delete 2>/dev/null || true
  find "${STAGING_ROOT}/runs" -mindepth 1 -maxdepth 1 -type d -mtime +2 -exec rm -rf {} + 2>/dev/null || true
  find "$LOCKS_ROOT" -mindepth 1 -maxdepth 1 -type d -empty -mtime +2 -exec rmdir {} + 2>/dev/null || true
}

cleanup_old_staging

if [ -f "$COMPLETED_MARKER" ]; then
  echo "Desktop publish already completed for ${RUN_KEY}."
  exit 0
fi

for variant in mac-x64 mac-arm64 win-x64 win-arm64; do
  if [ ! -d "${RUN_ROOT}/${variant}" ]; then
    echo "Desktop publish not ready: missing ${variant} for ${RUN_KEY}."
    exit 0
  fi
done

for script_name in create-desktop-release-bundle.js verify-desktop-release-bundle.js desktop-release.js; do
  if [ ! -f "${SCRIPTS_ROOT}/${script_name}" ]; then
    echo "Desktop publish not ready: missing staged script ${script_name} for ${RUN_KEY}."
    exit 0
  fi
done

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "Another runner is already attempting desktop publish for ${RUN_KEY}."
  exit 0
fi

cleanup_lock() {
  rmdir "$LOCK_DIR" 2>/dev/null || true
}

trap cleanup_lock EXIT

if [ -f "$COMPLETED_MARKER" ]; then
  echo "Desktop publish already completed for ${RUN_KEY}."
  exit 0
fi

for variant in mac-x64 mac-arm64 win-x64 win-arm64; do
  if [ ! -d "${RUN_ROOT}/${variant}" ]; then
    echo "Desktop publish became not ready: missing ${variant} for ${RUN_KEY}."
    exit 0
  fi
done

echo "All staged desktop artifacts found for ${RUN_KEY}. Publishing on VPS..."

docker compose \
  --project-name "$PROJECT_NAME" \
  --env-file "$ENV_FILE_PATH" \
  -f "$COMPOSE_FILE" \
  --profile desktop-publisher \
  run --rm -T \
  -e STAGED_INPUT_ROOT="/staging/runs/${RUN_KEY}" \
  -e BUNDLE_SCRIPT_ROOT="/staging/runs/${RUN_KEY}/scripts" \
  -e DESKTOP_PUBLISH_CHANNEL="$CHANNEL" \
  -e PUBLISHED_AT="$PUBLISHED_AT" \
  desktop-publisher /bin/sh /workspace/scripts/publish-desktop-staged-run.sh

mkdir -p "$COMPLETED_ROOT"
touch "$COMPLETED_MARKER"

echo "Desktop publish finished for ${RUN_KEY}."
