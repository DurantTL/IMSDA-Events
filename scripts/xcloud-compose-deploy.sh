#!/bin/sh
#
# Deploy Script for the events.imsda.org xCloud "Docker Compose" site
# (docs/DEPLOY-DOCKER.md, "xCloud Docker Compose site"). In the site's Git
# settings, set the Deploy Script to:
#
#   sh "$XCLOUD_SITE_PATH/scripts/xcloud-compose-deploy.sh"
#
# It runs the image GitHub built for the pulled commit (waiting for the Docker
# image workflow if it is still running), building on the server only when that
# image never appears. It never runs `down`: `up -d` replaces the containers
# only once the new image is ready, so the site stays up while it waits.
set -eu

log() { echo "[xcloud-compose-deploy] $*"; }

SITE_DIR="${XCLOUD_SITE_PATH:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"
cd "$SITE_DIR"
COMPOSE_FILE_PATH="${IMSDA_COMPOSE_FILE:-$SITE_DIR/docker-compose.xcloud.yml}"
IMAGE_WAIT_SECONDS="${IMSDA_IMAGE_WAIT_SECONDS:-1200}"

[ -r .env ] || { echo "[xcloud-compose-deploy] ERROR: $SITE_DIR/.env is missing" >&2; exit 1; }
grep -q '^DATABASE_URL=postgres' .env \
  || { echo "[xcloud-compose-deploy] ERROR: .env has no DATABASE_URL for the existing database" >&2; exit 1; }

APP_RELEASE_SHA="$(git rev-parse HEAD)"
IMSDA_APP_IMAGE="${IMSDA_IMAGE_REPO:-ghcr.io/duranttl/imsda-events}:$APP_RELEASE_SHA"
export APP_RELEASE_SHA IMSDA_APP_IMAGE

compose() { docker compose -f "$COMPOSE_FILE_PATH" "$@"; }

compose config --quiet

# GitHub publishes the image about 10 minutes after a merge; push-to-deploy
# starts sooner, so wait for it.
WAITED=0
until compose pull --quiet app 2>/dev/null; do
  if [ "$WAITED" -ge "$IMAGE_WAIT_SECONDS" ]; then
    log "Image $IMSDA_APP_IMAGE did not appear; building on this server (about 40 minutes)"
    compose build app
    break
  fi
  log "Waiting for $IMSDA_APP_IMAGE (Docker image workflow on GitHub)..."
  sleep 30
  WAITED=$((WAITED + 30))
done

log "Starting release $APP_RELEASE_SHA"
compose up -d --no-build --remove-orphans --wait --wait-timeout 900
log "Deployed $APP_RELEASE_SHA"
