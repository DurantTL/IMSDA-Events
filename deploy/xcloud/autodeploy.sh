#!/bin/sh
# Runs every 2 minutes from imsda-autodeploy.timer (docs/DEPLOY-DOCKER.md,
# "xCloud site setup"). xCloud's own deploy pulls main into the site checkout
# and then only runs `down` / `up` on the base compose file, which restarts the
# image already tagged imsda-events:live. This moves the live image to the
# checked-out commit once GitHub has published that commit's image.
set -eu

SITE="${XCLOUD_SITE_PATH:-/var/www/events.imsda.org}"
SHA="$(git -C "$SITE" rev-parse HEAD)"
LIVE="$(docker image inspect imsda-events:live \
  --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null || true)"

[ "$SHA" = "$LIVE" ] && exit 0

if ! docker pull --quiet "ghcr.io/duranttl/imsda-events:$SHA" >/dev/null 2>&1; then
  echo "[autodeploy] $SHA is checked out but its image is not published yet; live is ${LIVE:-unknown}"
  exit 0
fi

echo "[autodeploy] Deploying $SHA (live was ${LIVE:-unknown})"
exec /usr/local/bin/imsda-deploy
