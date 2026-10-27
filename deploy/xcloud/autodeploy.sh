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
WINDOW="${IMSDA_DEPLOY_WINDOW:-00-05}"
DEPLOY="${IMSDA_DEPLOY:-/usr/local/bin/imsda-deploy}"

# Git runs as the checkout's owner (u_events), so root never owns files in it.
OWNER="$(stat -c %U "$SITE")"
as_owner() {
  if [ "$(id -un)" = "$OWNER" ]; then "$@"; else runuser -u "$OWNER" -- "$@"; fi
}

if ! as_owner git -C "$SITE" fetch --quiet origin "$BRANCH"; then
  echo "[autodeploy] git fetch of $BRANCH failed; trying again next run." >&2
  exit 0
fi
SHA="$(as_owner git -C "$SITE" rev-parse "origin/$BRANCH")"
LIVE="$(docker image inspect imsda-events:live \
  --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null || true)"

[ "$SHA" = "$LIVE" ] && exit 0

# One leading zero is dropped so "08" is compared as 8.
HOUR="$(TZ=America/Chicago date +%H)"; HOUR="${HOUR#0}"
START="${WINDOW%-*}"; START="${START#0}"
END="${WINDOW#*-}"; END="${END#0}"
if [ "$HOUR" -lt "$START" ] || [ "$HOUR" -ge "$END" ]; then
  exit 0
fi

if ! docker pull --quiet "ghcr.io/duranttl/imsda-events:$SHA" >/dev/null 2>&1; then
  echo "[autodeploy] origin/$BRANCH is $SHA but its image is not published yet; live is ${LIVE:-unknown}"
  exit 0
fi

# Move the checkout only now, when this commit is actually being deployed;
# imsda-deploy deploys whatever the checkout has.
if ! as_owner git -C "$SITE" merge --ff-only --quiet "origin/$BRANCH"; then
  echo "[autodeploy] Could not fast-forward $SITE to $SHA (local changes?). Nothing was deployed." >&2
  exit 1
fi

echo "[autodeploy] Deploying $SHA (live was ${LIVE:-unknown})"
exec "$DEPLOY"
