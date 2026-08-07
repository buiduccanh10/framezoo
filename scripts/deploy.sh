#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

ACTION="${1:-all}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE_PATH="${ENV_FILE_PATH:-.env}"
PROJECT_NAME="${PROJECT_NAME:-$(basename "$REPO_ROOT")}"
EXTERNAL_LEGACY_VOLUMES="${EXTERNAL_LEGACY_VOLUMES:-false}"
SKIP_CLOUDFLARE_PURGE="${SKIP_CLOUDFLARE_PURGE:-false}"

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "Compose file not found: $COMPOSE_FILE"
  exit 1
fi

if [ ! -f "$ENV_FILE_PATH" ]; then
  echo "Env file not found: $ENV_FILE_PATH"
  exit 1
fi

if [ "$EXTERNAL_LEGACY_VOLUMES" = "false" ] \
  && docker volume inspect framezoo_backend_postgres-data >/dev/null 2>&1 \
  && docker volume inspect framezoo_backend_redis-data >/dev/null 2>&1 \
  && docker volume inspect framezoo_backend_preview-data >/dev/null 2>&1; then
  EXTERNAL_LEGACY_VOLUMES=true
fi

if [ "$EXTERNAL_LEGACY_VOLUMES" = "true" ]; then
  if ! docker volume inspect framezoo_backend_downloads-data >/dev/null 2>&1; then
    echo "Creating missing production downloads volume: framezoo_backend_downloads-data"
    docker volume create framezoo_backend_downloads-data >/dev/null
  fi
fi


compose() {
  ENV_FILE_PATH="$ENV_FILE_PATH" EXTERNAL_LEGACY_VOLUMES="$EXTERNAL_LEGACY_VOLUMES" docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE_PATH" -f "$COMPOSE_FILE" "$@"
}

purge_cloudflare_cache() {
  if [ "$SKIP_CLOUDFLARE_PURGE" = "true" ]; then
    echo "Skipping Cloudflare purge: disabled for this run."
    return 0
  fi

  "$REPO_ROOT/scripts/purge-cloudflare-cache.sh" "$ENV_FILE_PATH"
}

sync_vhost_overrides() {
  VHOST_DIR="$REPO_ROOT/ops/nginx-proxy/vhost.d"
  VHOST_VOLUME="${VHOST_VOLUME:-betakiot_nginx_vhost}"

  if [ ! -d "$VHOST_DIR" ] || [ -z "$(ls -A "$VHOST_DIR" 2>/dev/null)" ]; then
    echo "No vhost.d overrides to sync (skip)."
    return 0
  fi

  if ! docker volume inspect "$VHOST_VOLUME" >/dev/null 2>&1; then
    echo "Vhost volume not found: $VHOST_VOLUME (skip vhost.d sync)."
    return 0
  fi

  echo "Syncing vhost.d overrides into volume $VHOST_VOLUME..."
  docker run --rm \
    -v "$VHOST_VOLUME:/vhost.d" \
    -v "$VHOST_DIR:/src:ro" \
    alpine:3.20 \
    sh -c 'cp -a /src/. /vhost.d/'

  # docker-gen chi regenerate config khi co Docker event va khong watch file,
  # nen restart proxy de apply config moi (client_max_body_size,...).
  if docker inspect nginx-proxy >/dev/null 2>&1; then
    echo "Restarting nginx-proxy to apply vhost.d overrides..."
    docker restart nginx-proxy >/dev/null
  fi
}

case "$ACTION" in
  all)
    echo "Deploy root: $REPO_ROOT"
    echo "Compose file: $COMPOSE_FILE"
    echo "Project name: $PROJECT_NAME"
    compose pull --ignore-pull-failures || true
    compose build --pull
    compose up -d --remove-orphans

    sync_vhost_overrides
    purge_cloudflare_cache
    ;;
  up)
    compose up -d --remove-orphans
    ;;
  down)
    compose down --remove-orphans
    ;;
  restart)
    compose restart
    ;;
  logs)
    compose logs -f --tail=200
    ;;
  ps)
    compose ps
    ;;
  publish-desktop)
    compose --profile desktop-publisher run --rm desktop-publisher
    ;;
  purge-cdn)
    purge_cloudflare_cache
    ;;
  *)
    echo "Usage: ./deploy.sh {all|up|down|restart|logs|ps|publish-desktop|purge-cdn}"
    exit 1
    ;;
esac
