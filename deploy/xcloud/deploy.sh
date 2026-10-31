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
#     on /api/health (read with the container's own OUTBOX_SWEEP_TOKEN). If it
#     never does, the live app is not restarted;
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

# /api/health shows the release SHA only to a caller with OUTBOX_SWEEP_TOKEN
# (#1400). The token is read from the container being checked, so it is exactly
# what that app received, and goes to curl on stdin (never argv or the screen).
# No token yet (container not ready) means keep waiting; an image from before
# #1400 ignores the header and still answers with the SHA.
wait_for_release() { # port sha service [compose profile args]
  waited=0
  port="$1"; want="$2"; service="$3"; shift 3
  while [ "$waited" -lt "$HEALTH_SECONDS" ]; do
    token="$(docker compose -f "$COMPOSE" "$@" exec -T "$service" printenv OUTBOX_SWEEP_TOKEN 2>/dev/null </dev/null || true)"
    if [ -n "$token" ] && printf 'Authorization: Bearer %s\n' "$token" \
      | curl -fsS --max-time 5 -H @- "http://127.0.0.1:$port/api/health" 2>/dev/null | grep -q "\"sha\":\"$want\""; then
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
  docker rm -f imsda-prep >/dev/null 2>&1 || true
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
# grep answers 1 for "not found"; anything else is a Docker error.
legacy=0
docker run --rm --entrypoint grep "$IMAGE" -q IMSDA_PREP_ONLY /usr/local/bin/docker-entrypoint.sh || legacy=$?
[ "$legacy" -le 1 ] || fail "Could not inspect $IMAGE (docker exit $legacy). Nothing was changed."
if [ "$legacy" -eq 1 ]; then
  echo "[deploy] $IMAGE predates zero-downtime deploys; restarting the app on it (about a minute offline)."
  move_live_tag
  docker compose -f "$COMPOSE" up -d --no-deps app
  echo "[deploy] Started $SHA (previous version tagged imsda-events:previous)"
else
  docker tag "$IMAGE" imsda-events:next

  echo "[deploy] Applying migrations and syncs for $SHA while the current version keeps serving ..."
  # No terminal (-T, stdin from /dev/null): under `timeout` a run started from
  # an SSH session would otherwise stop waiting for the terminal.
  docker rm -f imsda-prep >/dev/null 2>&1 || true
  if ! IMSDA_PREP_ONLY=1 timeout "$PREP_SECONDS" docker compose -f "$COMPOSE" --profile standby \
    run -T --rm --no-deps --name imsda-prep standby </dev/null; then
    fail "Migrations or syncs for $SHA failed. The live app was not restarted; any migrations that did apply stay applied."
  fi

  echo "[deploy] Starting $SHA on port 8101 ..."
  stop_standby
  IMSDA_SKIP_DB_PREP=1 docker compose -f "$COMPOSE" --profile standby up -d --no-deps standby \
    || fail "Could not start $SHA on port 8101. The live app was not restarted (the database is already migrated)."
  if ! wait_for_release 8101 "$SHA" standby --profile standby; then
    docker compose -f "$COMPOSE" --profile standby logs --tail 50 standby >&2 || true
    fail "$SHA did not become healthy on port 8101. The live app was not restarted (the database is already migrated)."
  fi

  HAD_LIVE=0
  docker image inspect imsda-events:live >/dev/null 2>&1 && HAD_LIVE=1
  PREVIOUS_SHA="$(docker image inspect imsda-events:live \
    --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null || true)"
  move_live_tag
  # A failed `up` is caught by the health wait below, which rolls back.
  IMSDA_SKIP_DB_PREP=1 docker compose -f "$COMPOSE" up -d --no-deps app \
    || echo "[deploy] Restarting the app on $SHA failed." >&2
  if ! wait_for_release 8100 "$SHA" app; then
    echo "[deploy] $SHA did not come up on port 8100; putting the previous version back." >&2
    if [ "$HAD_LIVE" = 1 ]; then
      docker tag imsda-events:previous imsda-events:live
      # The previous version already ran on this schema: skip the preparation.
      IMSDA_SKIP_DB_PREP=1 docker compose -f "$COMPOSE" up -d --no-deps app \
        || echo "[deploy] Restarting the previous version failed." >&2
      # Keep the standby serving (through the nginx fallback) until it is back.
      if [ -n "$PREVIOUS_SHA" ]; then
        wait_for_release 8100 "$PREVIOUS_SHA" app \
          || echo "[deploy] The previous version $PREVIOUS_SHA is not healthy on 8100 either. Check it now." >&2
      else
        sleep 30
      fi
    fi
    fail "Deploy of $SHA failed; live is back on ${PREVIOUS_SHA:-the previous image}."
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
