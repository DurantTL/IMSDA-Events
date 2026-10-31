#!/bin/sh
# Runs every 2 minutes from imsda-autodeploy.timer (docs/DEPLOY-DOCKER.md,
# "xCloud site setup"). xCloud's own deploy-on-push is turned off (#1263): it
# restarted the app on every merge. So this fetches origin/main itself, and
# once GitHub has published that commit's image, and only inside the night
# deploy window, fast-forwards the site checkout and runs imsda-deploy.
# Running imsda-deploy by hand still works at any time.
set -eu

SITE="${XCLOUD_SITE_PATH:-/var/www/events.imsda.org}"
BRANCH="${IMSDA_DEPLOY_BRANCH:-main}"
# Start and end hour (24h, America/Chicago); the end hour is not included.
# A window may cross midnight (22-02).
WINDOW="${IMSDA_DEPLOY_WINDOW:-00-05}"
DEPLOY="${IMSDA_DEPLOY:-/usr/local/bin/imsda-deploy}"
# Written by imsda-deploy when a commit fails; that commit is not retried.
FAILED_FILE="${IMSDA_FAILED_SHA_FILE:-/var/lib/imsda/failed-sha}"
# Reports each run to the System report (#1382). Best effort: never fails or blocks this script.
HEARTBEAT="${IMSDA_HEARTBEAT:-/usr/local/bin/imsda-heartbeat}"
heartbeat() { if [ -x "$HEARTBEAT" ]; then "$HEARTBEAT" "$@" || true; fi; }

# Git runs as the checkout's owner (u_events), so root never owns files in it.
OWNER="$(stat -c %U "$SITE")"
if [ "$OWNER" = "UNKNOWN" ] || ! id -u "$OWNER" >/dev/null 2>&1; then
  echo "[autodeploy] $SITE has no known owner; fix its ownership (u_events)." >&2
  heartbeat server-autodeploy FAILED result=no-owner
  exit 1
fi
as_owner() {
  if [ "$(id -un)" = "$OWNER" ]; then "$@"; else runuser -u "$OWNER" -- "$@"; fi
}

if ! as_owner git -C "$SITE" fetch --quiet origin "$BRANCH"; then
  echo "[autodeploy] git fetch of $BRANCH failed; trying again next run." >&2
  heartbeat server-autodeploy FAILED result=fetch-failed
  exit 0
fi
SHA="$(as_owner git -C "$SITE" rev-parse "origin/$BRANCH")"
LIVE="$(docker image inspect imsda-events:live \
  --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null || true)"

if [ "$SHA" = "$LIVE" ]; then
  heartbeat server-autodeploy SUCCEEDED result=up-to-date
  exit 0
fi
if [ "$SHA" = "$(cat "$FAILED_FILE" 2>/dev/null || true)" ]; then
  heartbeat server-autodeploy FAILED result=failed-commit-held
  exit 0
fi

# One leading zero is dropped so "08" is compared as 8.
HOUR="$(TZ=America/Chicago date +%H)"; HOUR="${HOUR#0}"
START="${WINDOW%-*}"; START="${START#0}"
END="${WINDOW#*-}"; END="${END#0}"
if [ "$START" -le "$END" ]; then
  { [ "$HOUR" -ge "$START" ] && [ "$HOUR" -lt "$END" ]; } \
    || { heartbeat server-autodeploy SUCCEEDED result=outside-window; exit 0; }
else
  { [ "$HOUR" -ge "$START" ] || [ "$HOUR" -lt "$END" ]; } \
    || { heartbeat server-autodeploy SUCCEEDED result=outside-window; exit 0; }
fi

if ! docker pull --quiet "ghcr.io/duranttl/imsda-events:$SHA" >/dev/null 2>&1; then
  echo "[autodeploy] origin/$BRANCH is $SHA but its image is not published yet; live is ${LIVE:-unknown}"
  heartbeat server-autodeploy SUCCEEDED result=image-pending
  exit 0
fi

# Move the checkout only now, when this commit is actually being deployed;
# imsda-deploy deploys whatever the checkout has.
if ! as_owner git -C "$SITE" merge --ff-only --quiet "origin/$BRANCH"; then
  echo "[autodeploy] Could not fast-forward $SITE to $SHA (local changes?). Nothing was deployed." >&2
  heartbeat server-autodeploy FAILED result=fast-forward-failed
  exit 1
fi

echo "[autodeploy] Deploying $SHA (live was ${LIVE:-unknown})"
# Not exec: the result is reported after the deploy, then its exit code is passed on unchanged.
DEPLOY_RC=0
"$DEPLOY" || DEPLOY_RC=$?
if [ "$DEPLOY_RC" -eq 0 ]; then
  heartbeat server-autodeploy SUCCEEDED result=deployed
else
  heartbeat server-autodeploy FAILED result=deploy-failed
fi
exit "$DEPLOY_RC"
