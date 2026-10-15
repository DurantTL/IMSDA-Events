#!/bin/sh
# Frees disk on the xCloud server (#943). Installed as /usr/local/bin/imsda-cleanup;
# deploy.sh runs it after each deploy and imsda-cleanup.timer runs it daily,
# because xCloud's own deploy still builds the Dockerfile (an unused
# xcloud-site-*-app image plus gigabytes of build cache) even though the site
# runs the GitHub-built imsda-events:live. On Oct 15, 2026 old release images
# and build cache had filled the 123 GB disk to 99%.
#
# Removes only: old release tags, unused build cache, untagged images and
# xCloud's unused build images. Never touches containers or volumes (database,
# uploads, backups) and never forces a removal: Docker refuses an image any
# container uses, and an image also tagged imsda-events:live or :previous only
# loses its release tag. Every step may fail without failing the caller.
set -u

REPO="${IMSDA_IMAGE_REPO:-ghcr.io/duranttl/imsda-events}"

echo "[cleanup] Disk before: $(df -h / | awk 'NR==2 {print $5 " used, " $4 " free"}')"

docker image ls "$REPO" --format '{{.Repository}}:{{.Tag}}' 2>/dev/null \
  | while read -r ref; do
      [ "${ref##*:}" = "<none>" ] && continue
      docker image rm "$ref" >/dev/null 2>&1 || true
    done

docker image ls --filter 'reference=xcloud-site-*-app' --format '{{.Repository}}:{{.Tag}}' 2>/dev/null \
  | while read -r ref; do
      docker image rm "$ref" >/dev/null 2>&1 || true
    done

docker image prune -f >/dev/null 2>&1 || true
docker builder prune -a -f >/dev/null 2>&1 || true

echo "[cleanup] Disk after: $(df -h / | awk 'NR==2 {print $5 " used, " $4 " free"}')"
exit 0
