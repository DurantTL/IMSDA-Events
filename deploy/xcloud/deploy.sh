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

# Switch without downtime (#1263). The old version keeps serving while:
#  1. a one-off container of the new image applies migrations and syncs
#     (migrations are additive, so the old code keeps working);
#  2. the new version starts as `standby` on port 8101 and must report this SHA
#     on /api/health. If it never does, the live version is left untouched.
#  3. the live tag moves and `app` restarts on 8100 with the preparation
#     skipped, so it answers within seconds. nginx can fail over to 8101 for
#     those seconds (docs/DEPLOY-DOCKER.md, "Deploys without downtime").
#  4. if `app` does not come back on the new SHA, the previous image goes back.
HEALTH_SECONDS="${IMSDA_HEALTH_WAIT_SECONDS:-180}"
# Compose reads these from the environment for the standby service.
export IMSDA_STANDBY_TAG=next

wait_for_release() { # port
  waited=0
  while [ "$waited" -lt "$HEALTH_SECONDS" ]; do
    if curl -fsS --max-time 5 "http://127.0.0.1:$1/api/health" 2>/dev/null | grep -q "\"sha\":\"$SHA\""; then
      return 0
    fi
    sleep 3
    waited=$((waited + 3))
  done
  return 1
}

stop_standby() {
  docker compose -f "$COMPOSE" --profile standby rm -sf standby >/dev/null 2>&1 || true
}

docker tag "$IMAGE" imsda-events:next

echo "[deploy] Applying migrations and syncs for $SHA while the current version keeps serving ..."
IMSDA_PREP_ONLY=1 docker compose -f "$COMPOSE" --profile standby run --rm --no-deps standby

echo "[deploy] Starting $SHA on port 8101 ..."
stop_standby
IMSDA_SKIP_DB_PREP=1 docker compose -f "$COMPOSE" --profile standby up -d --no-deps standby
if ! wait_for_release 8101; then
  docker compose -f "$COMPOSE" --profile standby logs --tail 50 standby >&2 || true
  stop_standby
  echo "[deploy] $SHA did not become healthy on port 8101. The live version was not changed." >&2
  exit 1
fi

# Keep the outgoing version tagged so a rollback is one docker tag away.
docker image inspect imsda-events:live >/dev/null 2>&1 \
  && docker tag imsda-events:live imsda-events:previous
docker tag "$IMAGE" imsda-events:live
IMSDA_SKIP_DB_PREP=1 docker compose -f "$COMPOSE" up -d --no-deps app
if ! wait_for_release 8100; then
  echo "[deploy] $SHA did not come up on port 8100; putting the previous version back." >&2
  if docker image inspect imsda-events:previous >/dev/null 2>&1; then
    docker tag imsda-events:previous imsda-events:live
    docker compose -f "$COMPOSE" up -d --no-deps app
  fi
  stop_standby
  exit 1
fi
stop_standby
echo "[deploy] Live on $SHA (previous version tagged imsda-events:previous)"

# Old release images and xCloud's build cache filled the disk once (#943).
CLEANUP="${IMSDA_CLEANUP:-/usr/local/bin/imsda-cleanup}"
if [ -x "$CLEANUP" ]; then
  IMSDA_LOCK_HELD=1 "$CLEANUP" || echo "[deploy] Cleanup failed; the new version is still live." >&2
fi
