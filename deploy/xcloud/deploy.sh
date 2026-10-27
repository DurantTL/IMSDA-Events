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
#  1. a one-off container of the new image applies migrations and syncs. The
#     old code then runs on the new schema, so migrations must be additive
#     (docs/DEPLOY-DOCKER.md, "Deploys without downtime");
#  2. the new version starts as `standby` on port 8101 and must report this SHA
#     on /api/health. If it never does, the live app is not restarted;
#  3. the live tag moves and `app` restarts on 8100 with the preparation
#     skipped, so it answers within seconds. nginx can fail over to 8101 for
#     those seconds;
#  4. if `app` does not come back on the new SHA, the previous image goes back.
HEALTH_SECONDS="${IMSDA_HEALTH_WAIT_SECONDS:-180}"
PREP_SECONDS="${IMSDA_PREP_TIMEOUT_SECONDS:-900}"
# A SHA that failed here is skipped by autodeploy until main moves on.
FAILED_FILE="${IMSDA_FAILED_SHA_FILE:-/var/lib/imsda/failed-sha}"
# Compose reads this from the environment for the standby service.
export IMSDA_STANDBY_TAG=next

wait_for_release() { # port sha
  waited=0
  while [ "$waited" -lt "$HEALTH_SECONDS" ]; do
    if curl -fsS --max-time 5 "http://127.0.0.1:$1/api/health" 2>/dev/null | grep -q "\"sha\":\"$2\""; then
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

fail() { # message
  stop_standby
  mkdir -p "$(dirname "$FAILED_FILE")" 2>/dev/null && echo "$SHA" > "$FAILED_FILE" || true
  echo "[deploy] $1" >&2
  exit 1
}

move_live_tag() {
  # Keep the outgoing version tagged so a rollback is one docker tag away.
  docker image inspect imsda-events:live >/dev/null 2>&1 \
    && docker tag imsda-events:live imsda-events:previous
  docker tag "$IMAGE" imsda-events:live
}

# Images built before #1263 ignore IMSDA_PREP_ONLY (their prep run would start
# the app and never exit), so they get the old stop-and-start switch.
if ! docker run --rm --entrypoint grep "$IMAGE" -q IMSDA_PREP_ONLY /usr/local/bin/docker-entrypoint.sh; then
  echo "[deploy] $IMAGE predates zero-downtime deploys; restarting the app on it (about a minute offline)."
  move_live_tag
  docker compose -f "$COMPOSE" up -d --no-deps app
  echo "[deploy] Started $SHA (previous version tagged imsda-events:previous)"
else
  docker tag "$IMAGE" imsda-events:next

  echo "[deploy] Applying migrations and syncs for $SHA while the current version keeps serving ..."
  if ! IMSDA_PREP_ONLY=1 timeout "$PREP_SECONDS" docker compose -f "$COMPOSE" --profile standby run --rm --no-deps standby; then
    fail "Migrations or syncs for $SHA failed. The live app was not restarted; any migrations that did apply stay applied."
  fi

  echo "[deploy] Starting $SHA on port 8101 ..."
  stop_standby
  IMSDA_SKIP_DB_PREP=1 docker compose -f "$COMPOSE" --profile standby up -d --no-deps standby \
    || fail "Could not start $SHA on port 8101. The live app was not restarted (the database is already migrated)."
  if ! wait_for_release 8101 "$SHA"; then
    docker compose -f "$COMPOSE" --profile standby logs --tail 50 standby >&2 || true
    fail "$SHA did not become healthy on port 8101. The live app was not restarted (the database is already migrated)."
  fi

  PREVIOUS_SHA="$(docker image inspect imsda-events:live \
    --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null || true)"
  move_live_tag
  IMSDA_SKIP_DB_PREP=1 docker compose -f "$COMPOSE" up -d --no-deps app
  if ! wait_for_release 8100 "$SHA"; then
    echo "[deploy] $SHA did not come up on port 8100; putting the previous version back." >&2
    if [ -n "$PREVIOUS_SHA" ]; then
      docker tag imsda-events:previous imsda-events:live
      # The previous version already ran on this schema: skip the preparation.
      IMSDA_SKIP_DB_PREP=1 docker compose -f "$COMPOSE" up -d --no-deps app
      # Keep the standby serving (through the nginx fallback) until it is back.
      wait_for_release 8100 "$PREVIOUS_SHA" \
        || echo "[deploy] The previous version $PREVIOUS_SHA is not healthy on 8100 either. Check it now." >&2
    fi
    fail "Deploy of $SHA failed; live is back on ${PREVIOUS_SHA:-nothing (no previous image)}."
  fi
  stop_standby
  echo "[deploy] Live on $SHA (previous version tagged imsda-events:previous)"
fi
rm -f "$FAILED_FILE" 2>/dev/null || true

# Old release images and xCloud's build cache filled the disk once (#943).
CLEANUP="${IMSDA_CLEANUP:-/usr/local/bin/imsda-cleanup}"
if [ -x "$CLEANUP" ]; then
  IMSDA_LOCK_HELD=1 "$CLEANUP" || echo "[deploy] Cleanup failed; the new version is still live." >&2
fi
