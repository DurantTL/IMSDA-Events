#!/bin/sh
# xCloud Deploy Script for events.imsda.org (docs/DEPLOY-DOCKER.md, "xCloud site
# setup"). Runs the image GitHub built for the pulled commit; never builds.
#
#   sh "$XCLOUD_SITE_PATH/deploy/xcloud/deploy.sh"
set -eu

# One deploy or cleanup at a time (flock on /run/imsda-deploy.lock). Re-run this
# script under the lock; if it is not free in time, carry on without it rather
# than fail the deploy. Without flock it just runs.
LOCK="${IMSDA_LOCK_FILE:-/run/imsda-deploy.lock}"
if [ -z "${IMSDA_LOCK_HELD:-}" ] && command -v flock >/dev/null 2>&1; then
  rc=0
  IMSDA_LOCK_HELD=1 flock -w 1200 -E 200 "$LOCK" sh "$0" "$@" || rc=$?
  [ "$rc" -ne 200 ] && exit "$rc"
  echo "[deploy] Could not take $LOCK; continuing without it." >&2
fi

SITE="${XCLOUD_SITE_PATH:-/var/www/events.imsda.org}"
COMPOSE="${XCLOUD_COMPOSE_FILE:-/home/u_events/239298/docker-compose.yml}"
# The checkout belongs to u_events; root (systemd) needs it marked safe.
SHA="$(git -c safe.directory="$SITE" -C "$SITE" rev-parse HEAD)"
IMAGE="${IMSDA_IMAGE_REPO:-ghcr.io/duranttl/imsda-events}:$SHA"
WAIT_SECONDS="${IMSDA_IMAGE_WAIT_SECONDS:-1200}"

grep -q 'imsda-events:live' "$COMPOSE" || {
  echo "[deploy] $COMPOSE is not the IMSDA version (xCloud regenerated it?). Copy deploy/xcloud/docker-compose.yml over it first." >&2
  exit 1
}

# GitHub publishes the image about 10 minutes after a merge.
WAITED=0
until docker pull --quiet "$IMAGE"; do
  if [ "$WAITED" -ge "$WAIT_SECONDS" ]; then
    echo "[deploy] $IMAGE was not published; check the Docker image workflow on GitHub. Nothing was changed." >&2
    exit 1
  fi
  echo "[deploy] Waiting for $IMAGE ..."
  sleep 30
  WAITED=$((WAITED + 30))
done

# Keep the outgoing version tagged so a rollback is one docker tag away.
docker image inspect imsda-events:live >/dev/null 2>&1 \
  && docker tag imsda-events:live imsda-events:previous
docker tag "$IMAGE" imsda-events:live
docker compose -f "$COMPOSE" up -d app
echo "[deploy] Started $SHA (previous version tagged imsda-events:previous)"

# Old release images and xCloud's build cache filled the disk once (#943).
CLEANUP="${IMSDA_CLEANUP:-/usr/local/bin/imsda-cleanup}"
if [ -x "$CLEANUP" ]; then
  IMSDA_LOCK_HELD=1 "$CLEANUP" || echo "[deploy] Cleanup failed; the new version is still live." >&2
fi
