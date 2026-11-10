#!/bin/sh
# Container entrypoint: bring the schema up to date, then run the app.
# `depends_on: condition: service_healthy` in docker-compose ensures Postgres is
# accepting connections before this runs.
#
# There is deliberately no seed step. `prisma/seed.ts` writes fictitious events,
# people, registrations, payments and a refund, and gives every account one
# shared password — it refuses to run outside a local database. The supported
# way to reach a first real administrator is:
#
#   docker compose exec app npm run admin:create -- --email you@imsda.org --name "Your Name"
set -e

# The app runs as the unprivileged `node` user (#1798). Before anything touches
# the database, make sure this user can use what an earlier root container may
# still own: the uploads folder and the encryption key file. Stopping here, with
# the fix named, lets a deploy fail while the current version keeps serving.
# Exit 78 is the conventional "configuration error".
preflight_fail() {
  echo "[entrypoint] $1" >&2
  echo "[entrypoint] See docs/DEPLOY-DOCKER.md, \"Running as the node user\". Nothing was changed." >&2
  exit 78
}
if [ "$(id -u)" != "0" ]; then
  # The app uses this folder when ASSET_STORAGE_DIR is unset or empty (modules/events/asset-storage.ts).
  uploads_dir="${ASSET_STORAGE_DIR:-/app/storage/event-assets}"
  if [ -d "$uploads_dir" ]; then
    # Every folder must be writable and every file readable, not only the top one:
    # files a root container wrote are 0640 root:root and would not open. Links
    # are skipped; the app stores none.
    blocked="$(find "$uploads_dir" ! -type l \( \( -type d ! -writable \) -o \( ! -readable \) \) 2>/dev/null | head -n 1)"
    if [ -n "$blocked" ]; then
      preflight_fail "The uploads folder ${uploads_dir} holds files this container's user (uid $(id -u)) cannot use, for example ${blocked}. Hand the uploads volume to uid $(id -u)."
    fi
  fi
  for key_variable in SECRET_ENCRYPTION_KEY_FILE SECRET_ENCRYPTION_PREVIOUS_KEY_FILE; do
    eval "key_file=\${${key_variable}:-}"
    if [ -n "$key_file" ] && [ -e "$key_file" ] && [ ! -r "$key_file" ]; then
      preflight_fail "The key file named by ${key_variable} is not readable by this container's user (uid $(id -u)). Change the file's owner on the server to uid $(id -u); keep its mode 0400."
    fi
  done
fi

# scripts/manual-deploy.sh runs only the check above in a one-off container,
# with the uploads volume and key files mounted, before it stops the live app.
if [ "${IMSDA_PREFLIGHT_ONLY:-}" = "1" ]; then
  echo "[entrypoint] The uploads folder and key files are usable by uid $(id -u)."
  exit 0
fi

# deploy/xcloud/deploy.sh runs the preparation below in a one-off container
# (IMSDA_PREP_ONLY=1) while the old version keeps serving, then starts the new
# version with IMSDA_SKIP_DB_PREP=1 so it answers within seconds (#1263).
if [ "${IMSDA_SKIP_DB_PREP:-}" = "1" ]; then
  echo "[entrypoint] Database preparation already done by the deploy; starting: $*"
  exec "$@"
fi

# Until the app starts, answer every request with a short 503 "updating"
# response (JSON for /api/*) instead of leaving nginx to show a 502 page.
HOLDER_PID=""
stop_holder() {
  if [ -n "$HOLDER_PID" ]; then
    kill "$HOLDER_PID" 2>/dev/null || true
    wait "$HOLDER_PID" 2>/dev/null || true
    HOLDER_PID=""
  fi
}
if [ "${IMSDA_PREP_ONLY:-}" != "1" ] && [ -f /app/deploy/startup-holding-server.mjs ]; then
  node /app/deploy/startup-holding-server.mjs &
  HOLDER_PID=$!
  trap stop_holder EXIT
fi

echo "[entrypoint] Applying database migrations (prisma migrate deploy)..."
npx prisma migrate deploy

# Bring the club form templates (#610) to this release's version, re-sealing
# existing answers for any field that became sensitive, before the app serves
# a request. A version that would make a sensitive answer readable again is
# refused: the script exits non-zero, `set -e` stops the container, and the
# deploy fails loudly instead of running with a stale template.
echo "[entrypoint] Syncing club form templates (npm run club-forms:sync)..."
npm run club-forms:sync

# Bring the lodging property templates (#198) to this release's version. It only
# adds or updates facility inventory and never touches an event's own lodging state.
echo "[entrypoint] Syncing lodging property templates (npm run lodging:sync)..."
npm run lodging:sync

# Bring the form templates (#153, #1064) to this release's version: every
# template in code, the seeded Women's Retreat, Camp Meeting and Spring Camporee
# and the rest. It only adds or updates the template rows, never one a system
# administrator edited in the app; no event, registration form or published form
# version is touched.
echo "[entrypoint] Syncing form templates (npm run form-templates:sync)..."
npm run form-templates:sync

# Bring the seeded event content (#919) to this release's version: the Camp
# Meeting meal preset and cancellation rule preset. It only adds or updates the
# content rows; no event, meal service, plan or cancellation rule is touched.
echo "[entrypoint] Syncing seeded event content (npm run event-content:sync)..."
npm run event-content:sync

# Make sure the three conference-supplied patches and pins (#1688) are in the club supply
# catalog. It only adds a missing item and never changes a price staff set.
echo "[entrypoint] Syncing conference supply items (npm run conference-supplies:sync)..."
npm run conference-supplies:sync

if [ "${RUN_DB_SEED}" = "true" ]; then
  echo "[entrypoint] RUN_DB_SEED is no longer supported. Fictitious demo data is local-only;" >&2
  echo "[entrypoint] use 'npm run admin:create' to create a real administrator." >&2
  exit 1
fi

if [ "${IMSDA_PREP_ONLY:-}" = "1" ]; then
  echo "[entrypoint] Database preparation finished (IMSDA_PREP_ONLY)."
  exit 0
fi

stop_holder
trap - EXIT
echo "[entrypoint] Starting: $*"
exec "$@"
