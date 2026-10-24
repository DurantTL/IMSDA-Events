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

if [ "${RUN_DB_SEED}" = "true" ]; then
  echo "[entrypoint] RUN_DB_SEED is no longer supported. Fictitious demo data is local-only;" >&2
  echo "[entrypoint] use 'npm run admin:create' to create a real administrator." >&2
  exit 1
fi

echo "[entrypoint] Starting: $*"
exec "$@"
