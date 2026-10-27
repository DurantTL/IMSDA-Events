#!/bin/sh
# Runs every 2 minutes from imsda-autodeploy.timer (docs/DEPLOY-DOCKER.md,
# "xCloud site setup"). It pulls main into the site checkout itself (#1263), so
# xCloud's own deploy, which also restarts the app on every merge, can be turned
# off. Then it moves the live image to the checked-out commit once GitHub has
# published that commit's image.
set -eu

SITE="${XCLOUD_SITE_PATH:-/var/www/events.imsda.org}"
BRANCH="${IMSDA_DEPLOY_BRANCH:-main}"

# Fast-forward only, as the checkout's owner (u_events) so root never owns files
# in it. A failed pull only logs; the checked-out commit is still deployed.
if [ "${IMSDA_GIT_PULL:-1}" = "1" ]; then
  OWNER="$(stat -c %U "$SITE")"
  if ! runuser -u "$OWNER" -- git -C "$SITE" pull --ff-only --quiet origin "$BRANCH"; then
    echo "[autodeploy] git pull of $BRANCH failed; deploying what is checked out." >&2
  fi
fi

# The checkout belongs to u_events; root (systemd) needs it marked safe.
SHA="$(git -c safe.directory="$SITE" -C "$SITE" rev-parse HEAD)"
LIVE="$(docker image inspect imsda-events:live \
  --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null || true)"

[ "$SHA" = "$LIVE" ] && exit 0

if ! docker pull --quiet "ghcr.io/duranttl/imsda-events:$SHA" >/dev/null 2>&1; then
  echo "[autodeploy] $SHA is checked out but its image is not published yet; live is ${LIVE:-unknown}"
  exit 0
fi

echo "[autodeploy] Deploying $SHA (live was ${LIVE:-unknown})"
exec /usr/local/bin/imsda-deploy
