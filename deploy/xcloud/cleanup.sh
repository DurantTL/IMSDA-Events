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

# Reports each run to the System report (#1382). Best effort: never fails or blocks this script.
HEARTBEAT="${IMSDA_HEARTBEAT:-/usr/local/bin/imsda-heartbeat}"
heartbeat() { if [ -x "$HEARTBEAT" ]; then "$HEARTBEAT" "$@" || true; fi; }

# Runs one at a time with deploy.sh (flock on /run/imsda-deploy.lock). A deploy
# holds the lock and sets IMSDA_LOCK_HELD=1; the daily run waits for it, and
# gives up quietly (exit 0) if the lock never frees. Without flock it just runs.
LOCK="${IMSDA_LOCK_FILE:-/run/imsda-deploy.lock}"
if [ -z "${IMSDA_LOCK_HELD:-}" ] && command -v flock >/dev/null 2>&1; then
  IMSDA_LOCK_HELD=1 flock -w 1500 -E 200 "$LOCK" sh "$0" "$@"
  rc=$?
  if [ "$rc" -eq 200 ]; then
    echo "[cleanup] A deploy held the lock too long; skipping this run."
    heartbeat server-docker-cleanup FAILED result=skipped-lock-busy
  fi
  exit 0
fi

REPO=ghcr.io/duranttl/imsda-events
SITE_ID="${IMSDA_XCLOUD_SITE_ID:-239298}"

# One df reading per line printed; the used percentage for the System report is taken from that same line.
disk_line() { df -h / 2>/dev/null | awk 'NR==2 {print $5 " used, " $4 " free"}'; }
used_pct() {
  pct="${1%%%*}"
  case "$pct" in "" | *[!0-9]*) ;; *) echo "$pct" ;; esac
}
image_count() { docker image ls -q 2>/dev/null | wc -l | tr -dc '0-9'; }
LINE_BEFORE="$(disk_line)"
echo "[cleanup] Disk before: $LINE_BEFORE"
USED_BEFORE="$(used_pct "$LINE_BEFORE")"
IMAGES_BEFORE="$(image_count)"

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

LINE_AFTER="$(disk_line)"
echo "[cleanup] Disk after: $LINE_AFTER"
USED_AFTER="$(used_pct "$LINE_AFTER")"
IMAGES_AFTER="$(image_count)"
DETAILS=""
[ -n "$USED_BEFORE" ] && DETAILS="$DETAILS diskUsedBeforePct=$USED_BEFORE"
[ -n "$USED_AFTER" ] && DETAILS="$DETAILS diskUsedAfterPct=$USED_AFTER"
if [ -n "$IMAGES_BEFORE" ] && [ -n "$IMAGES_AFTER" ]; then
  REMOVED=$((IMAGES_BEFORE - IMAGES_AFTER))
  [ "$REMOVED" -lt 0 ] && REMOVED=0
  DETAILS="$DETAILS imagesRemoved=$REMOVED"
fi
# shellcheck disable=SC2086
heartbeat server-docker-cleanup SUCCEEDED result=cleaned $DETAILS
exit 0
