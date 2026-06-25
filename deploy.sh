#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$SCRIPT_DIR"

ACTION="${1:-all}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE_PATH="${ENV_FILE_PATH:-.env}"
PROJECT_NAME="${PROJECT_NAME:-$(basename "$SCRIPT_DIR")}"
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
  && docker volume inspect betamovie_backend_postgres-data >/dev/null 2>&1 \
  && docker volume inspect betamovie_backend_redis-data >/dev/null 2>&1 \
  && docker volume inspect betamovie_backend_preview-data >/dev/null 2>&1; then
  EXTERNAL_LEGACY_VOLUMES=true
fi

if [ "$EXTERNAL_LEGACY_VOLUMES" = "true" ]; then
  if ! docker volume inspect betamovie_backend_downloads-data >/dev/null 2>&1; then
    echo "Creating missing production downloads volume: betamovie_backend_downloads-data"
    docker volume create betamovie_backend_downloads-data >/dev/null
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

  "$SCRIPT_DIR/scripts/purge-cloudflare-cache.sh" "$ENV_FILE_PATH"
}

case "$ACTION" in
  all)
    echo "Deploy root: $SCRIPT_DIR"
    echo "Compose file: $COMPOSE_FILE"
    echo "Project name: $PROJECT_NAME"
    compose pull --ignore-pull-failures || true
    compose build --pull
    compose up -d --remove-orphans
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
  purge-cdn)
    purge_cloudflare_cache
    ;;
  *)
    echo "Usage: ./deploy.sh {all|up|down|restart|logs|ps|purge-cdn}"
    exit 1
    ;;
esac
