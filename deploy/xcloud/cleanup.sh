#!/bin/sh
# Frees disk on the xCloud server (#943). Installed as /usr/local/bin/imsda-cleanup;
# deploy.sh runs it after each deploy and imsda-cleanup.timer runs it daily,
# because xCloud's own deploy still builds the Dockerfile (an unused
# xcloud-site-239298-app image plus gigabytes of build cache) even though the site
# runs the GitHub-built imsda-events:live. On Oct 15, 2026 old release images
# and build cache had filled the 123 GB disk to 99%.
#
# Removes only: every ghcr.io/duranttl/imsda-events:<sha> tag (the live and
# previous versions keep their imsda-events:* tags), unused build cache older
# than a day, untagged images and this site's unused xcloud-site-239298-app
# image. Never touches containers or volumes (database, uploads, backups) and
# never forces a removal: Docker refuses an image any container uses, and an
# image also tagged imsda-events:live or :previous only loses its release tag.
# Every step may fail without failing the caller.
set -u

# Runs one at a time with deploy.sh (flock on /run/imsda-deploy.lock). A deploy
# holds the lock and sets IMSDA_LOCK_HELD=1; the daily run waits for it, and
# gives up quietly (exit 0) if the lock never frees. Without flock it just runs.
LOCK="${IMSDA_LOCK_FILE:-/run/imsda-deploy.lock}"
if [ -z "${IMSDA_LOCK_HELD:-}" ] && command -v flock >/dev/null 2>&1; then
  IMSDA_LOCK_HELD=1 flock -w 1500 -E 200 "$LOCK" sh "$0" "$@"
  rc=$?
  [ "$rc" -eq 200 ] && echo "[cleanup] A deploy held the lock too long; skipping this run."
  exit 0
fi

REPO=ghcr.io/duranttl/imsda-events
SITE_ID="${IMSDA_XCLOUD_SITE_ID:-239298}"

echo "[cleanup] Disk before: $(df -h / | awk 'NR==2 {print $5 " used, " $4 " free"}')"

docker image ls "$REPO" --format '{{.Repository}}:{{.Tag}}' 2>/dev/null \
  | while read -r ref; do
      case "${ref##*:}" in live | previous | "<none>") continue ;; esac
      docker image rm "$ref" >/dev/null 2>&1 || true
    done

docker image ls --filter "reference=xcloud-site-${SITE_ID}-app" --format '{{.Repository}}:{{.Tag}}' 2>/dev/null \
  | while read -r ref; do
      docker image rm "$ref" >/dev/null 2>&1 || true
    done

# -f only skips the confirmation prompt; nothing is force-removed.
docker image prune -f >/dev/null 2>&1 || true
# Keeps the last day's cache so xCloud's next build is not fully cold, and makes
# pruning in the middle of a running build less likely.
docker builder prune -a -f --filter until=24h >/dev/null 2>&1 || true

echo "[cleanup] Disk after: $(df -h / | awk 'NR==2 {print $5 " used, " $4 " free"}')"
exit 0
