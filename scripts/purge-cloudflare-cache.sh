#!/usr/bin/env sh
set -eu

ENV_FILE_PATH="${1:-}"

if [ -n "$ENV_FILE_PATH" ]; then
  if [ ! -f "$ENV_FILE_PATH" ]; then
    echo "Env file not found: $ENV_FILE_PATH"
    exit 1
  fi

  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE_PATH"
  set +a
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "Skipping Cloudflare purge: curl is not installed."
  exit 0
fi

CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN:-${CF_API_TOKEN:-}}"
CLOUDFLARE_ZONE_ID="${CLOUDFLARE_ZONE_ID:-${CF_ZONE_ID:-}}"
PURGE_DOMAIN="${CLOUDFLARE_PURGE_DOMAIN:-${VITE_APP_DOMAIN:-}}"
PURGE_EXTRA_URLS="${CLOUDFLARE_PURGE_EXTRA_URLS:-}"

missing_vars=""
[ -n "$CLOUDFLARE_API_TOKEN" ] || missing_vars="${missing_vars} CLOUDFLARE_API_TOKEN"
[ -n "$CLOUDFLARE_ZONE_ID" ] || missing_vars="${missing_vars} CLOUDFLARE_ZONE_ID"
[ -n "$PURGE_DOMAIN" ] || missing_vars="${missing_vars} VITE_APP_DOMAIN/CLOUDFLARE_PURGE_DOMAIN"

if [ -n "$missing_vars" ]; then
  echo "Skipping Cloudflare purge: missing${missing_vars}"
  exit 0
fi

PURGE_DOMAIN="${PURGE_DOMAIN%/}"

case "$PURGE_DOMAIN" in
  http://*|https://*) ;;
  *)
    echo "Skipping Cloudflare purge: invalid domain '$PURGE_DOMAIN'"
    exit 0
    ;;
esac

urls_file="$(mktemp)"
trap 'rm -f "$urls_file"' EXIT

{
  printf '%s\n' "$PURGE_DOMAIN/"
  printf '%s\n' "$PURGE_DOMAIN/index.html"
  printf '%s\n' "$PURGE_DOMAIN/sw.js"
  printf '%s\n' "$PURGE_DOMAIN/config.js"
  printf '%s\n' "$PURGE_DOMAIN/manifest.webmanifest"

  if [ -n "$PURGE_EXTRA_URLS" ]; then
    printf '%s\n' "$PURGE_EXTRA_URLS" | tr ', ' '\n\n'
  fi
} | awk 'NF && !seen[$0]++' > "$urls_file"

files_json="$(
  awk '
    NF {
      gsub(/\\/,"\\\\")
      gsub(/"/,"\\\"")
      printf "%s\"%s\"", sep, $0
      sep = ","
    }
  ' "$urls_file"
)"

payload="$(printf '{"files":[%s]}' "$files_json")"
api_url="https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/purge_cache"

response="$(
  curl -fsS -X POST "$api_url" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "$payload"
)"

if ! printf '%s' "$response" | grep -q '"success":true'; then
  echo "Cloudflare purge failed."
  printf '%s\n' "$response"
  exit 1
fi

echo "Cloudflare cache purged:"
cat "$urls_file"
