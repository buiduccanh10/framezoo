#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$SCRIPT_DIR"

ACTION="${1:-all}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE_PATH="${ENV_FILE_PATH:-.env}"
PROJECT_NAME="${PROJECT_NAME:-$(basename "$SCRIPT_DIR")}"

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "Compose file not found: $COMPOSE_FILE"
  exit 1
fi

if [ ! -f "$ENV_FILE_PATH" ]; then
  echo "Env file not found: $ENV_FILE_PATH"
  exit 1
fi

compose() {
  ENV_FILE_PATH="$ENV_FILE_PATH" docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE_PATH" -f "$COMPOSE_FILE" "$@"
}

case "$ACTION" in
  all)
    echo "Deploy root: $SCRIPT_DIR"
    echo "Compose file: $COMPOSE_FILE"
    echo "Project name: $PROJECT_NAME"
    compose pull --ignore-pull-failures || true
    compose build --pull
    compose up -d --remove-orphans
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
  *)
    echo "Usage: ./deploy.sh {all|up|down|restart|logs|ps}"
    exit 1
    ;;
esac
