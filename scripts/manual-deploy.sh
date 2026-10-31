#!/bin/sh
#
# Manual deploy for the xCloud host (docs/DEPLOY-DOCKER.md, "Manual deploy
# script"). Replaces the hand-kept /root/manual-deploy.sh with one checked-in
# script that knows about every startup requirement the app has gained:
#
#   sh scripts/manual-deploy.sh <full commit sha>
#
# 1. checks the server files and decides how the encryption key is supplied
#    (key file mount or SECRET_ENCRYPTION_KEY in .env, never both, #876);
# 2. pulls ghcr.io/duranttl/imsda-events:<sha> (or builds it with
#    IMSDA_DEPLOY_SOURCE=build);
# 3. validates the full production environment inside the NEW image before
#    touching the running app, so a missing or conflicting variable stops here
#    instead of leaving the site down;
# 4. renames the running app to <name>-old, starts the new one wired the same
#    way, waits for /api/health to report this release, and rolls back to the
#    -old container automatically if it does not;
# 5. restarts the imsda-backup container on the same release when
#    .env.backup exists (docs/BACKUPS.md).
#
# Run as root. Secret values are never printed.
set -eu

log() { echo "[manual-deploy] $*"; }
fail() { echo "[manual-deploy] ERROR: $*" >&2; exit 1; }

SHA="${1:-}"
printf '%s' "$SHA" | grep -Eq '^[0-9a-f]{40}$' \
  || fail "usage: sh scripts/manual-deploy.sh <full 40-character commit sha>"
SHORT_SHA="$(printf '%s' "$SHA" | cut -c1-12)"

RUNTIME_DIR="${IMSDA_XCLOUD_RUNTIME_DIR:-/home/u_events/.xcloud}"
# xCloud keeps the production environment beside its generated compose file.
ENV_FILE="${IMSDA_ENV_FILE:-/home/u_events/239298/.env}"
DBURL_FILE="$RUNTIME_DIR/.env.dburl"
BACKUP_ENV_FILE="$RUNTIME_DIR/.env.backup"
APP="${IMSDA_APP_CONTAINER:-xcloud-site-239298-app-1}"
OLD="$APP-old"
SITE_NETWORK="${IMSDA_SITE_NETWORK:-xcloud-site-239298_default}"
PG_NETWORK="${IMSDA_XCLOUD_EXPECTED_NETWORK:-postgresql_9kgaw_239292_xcloud-network}"
PUBLISH="${IMSDA_PUBLISH:-127.0.0.1:8100:3100}"
HEALTH_URL="${IMSDA_HEALTH_URL:-http://127.0.0.1:8100/api/health}"
HEALTH_TIMEOUT="${IMSDA_HEALTH_TIMEOUT:-900}"
ASSETS_VOLUME="${IMSDA_ASSETS_VOLUME:-imsda_events_assets}"
KEY_FILE="${IMSDA_KEY_FILE:-/etc/imsda/secret-encryption-key}"
KEY_TARGET=/run/secrets/encryption-key
REGISTRY="${IMSDA_IMAGE_REPO:-ghcr.io/duranttl/imsda-events}"
SOURCE="${IMSDA_DEPLOY_SOURCE:-ghcr}"
CHECKOUT="${IMSDA_CHECKOUT:-/var/www/events.imsda.org}"

[ "$(id -u)" = 0 ] || [ -n "${IMSDA_DEPLOY_ALLOW_NON_ROOT:-}" ] || fail "run as root"

# --- 1. Server files ---------------------------------------------------------
[ -r "$ENV_FILE" ] || fail "missing or unreadable $ENV_FILE"

has_var() { grep -Eq "^$1=[^[:space:]]" "$2" 2>/dev/null; }

container_exists() { docker inspect "$1" >/dev/null 2>&1; }
container_running() {
  [ "$(docker inspect "$1" --format '{{.State.Running}}' 2>/dev/null || true)" = true ]
}

# DATABASE_URL: .env, or .env.dburl, refreshed from the running container when
# it has one (the value goes straight to an owner-only file, never the screen).
if ! has_var DATABASE_URL "$ENV_FILE"; then
  if container_exists "$APP"; then
    TMP="$(umask 077; mktemp "$DBURL_FILE.XXXXXX")"
    docker inspect "$APP" --format '{{range .Config.Env}}{{println .}}{{end}}' \
      | grep '^DATABASE_URL=postgres' > "$TMP" || true
    if [ -s "$TMP" ]; then
      chmod 600 "$TMP"
      chown --reference="$ENV_FILE" "$TMP" 2>/dev/null || true
      mv "$TMP" "$DBURL_FILE"
    else
      rm -f "$TMP"
    fi
  fi
  grep -q '^DATABASE_URL=postgres' "$DBURL_FILE" 2>/dev/null \
    || fail "DATABASE_URL is in neither $ENV_FILE nor $DBURL_FILE, and the running app has none to copy"
  ENV_ARGS="--env-file $ENV_FILE --env-file $DBURL_FILE"
else
  ENV_ARGS="--env-file $ENV_FILE"
fi

# Encryption key (#876): exactly one of the key file and the plain variable.
KEY_IN_ENV=false
has_var SECRET_ENCRYPTION_KEY "$ENV_FILE" && KEY_IN_ENV=true
KEY_FILE_READY=false
[ -f "$KEY_FILE" ] && [ -s "$KEY_FILE" ] && KEY_FILE_READY=true
if [ "$KEY_IN_ENV" = true ] && [ "$KEY_FILE_READY" = true ]; then
  fail "SECRET_ENCRYPTION_KEY is in $ENV_FILE and $KEY_FILE also exists. The app refuses both. Finish the move: confirm the checksums match (docs/DEPLOY-DOCKER.md), then delete the SECRET_ENCRYPTION_KEY line from $ENV_FILE."
elif [ "$KEY_FILE_READY" = true ]; then
  KEY_ARGS="--mount type=bind,source=$KEY_FILE,target=$KEY_TARGET,readonly -e SECRET_ENCRYPTION_KEY_FILE=$KEY_TARGET"
  log "Encryption key: file $KEY_FILE"
elif [ "$KEY_IN_ENV" = true ]; then
  KEY_ARGS=""
  log "Encryption key: SECRET_ENCRYPTION_KEY in $ENV_FILE"
else
  fail "no encryption key: $KEY_FILE is missing or empty and $ENV_FILE has no SECRET_ENCRYPTION_KEY. Do not generate a new key; restore it from the password manager."
fi
has_var SECRET_ENCRYPTION_KEY_FILE "$ENV_FILE" \
  && fail "remove SECRET_ENCRYPTION_KEY_FILE from $ENV_FILE; this script sets it when it mounts the key file"

docker network inspect "$PG_NETWORK" >/dev/null 2>&1 || fail "database network $PG_NETWORK not found (docker network ls)"
docker network inspect "$SITE_NETWORK" >/dev/null 2>&1 || {
  log "Site network $SITE_NETWORK not found; creating it"
  docker network create "$SITE_NETWORK" >/dev/null
}

# --- 2. Image ----------------------------------------------------------------
if [ "$SOURCE" = build ]; then
  IMAGE="imsda-events:manual-$SHORT_SHA"
  log "Building $IMAGE from $CHECKOUT (about 40 minutes on this server)"
  git -C "$CHECKOUT" fetch --quiet origin
  git -C "$CHECKOUT" checkout --quiet --detach "$SHA"
  docker build --build-arg "APP_RELEASE_SHA=$SHA" -t "$IMAGE" "$CHECKOUT"
else
  IMAGE="$REGISTRY:$SHA"
  log "Pulling $IMAGE"
  docker pull "$IMAGE" \
    || fail "pull failed. Check the Docker image workflow finished for $SHA, and that the package is public or this server ran 'docker login ghcr.io'."
fi

# Every docker run below gets the same runtime wiring.
# shellcheck disable=SC2086 # the *_ARGS strings are deliberately word-split
run_args() {
  printf '%s\n' $ENV_ARGS $KEY_ARGS -e NODE_ENV=production -e PORT=3100 -e "APP_RELEASE_SHA=$SHA"
}

# --- 3. Preflight: validate the environment inside the new image -------------
log "Checking the production environment against the new image"
# shellcheck disable=SC2046
docker run --rm $(run_args) --entrypoint node "$IMAGE" \
  node_modules/.bin/tsx -e '
    import("./lib/env.ts").then((mod) => {
      const { validateServerEnv } = mod.validateServerEnv ? mod : mod.default;
      const result = validateServerEnv(process.env);
      if (result.ok) { console.log("[preflight] environment ok"); return; }
      console.error("[preflight] the app would refuse to start:");
      for (const issue of result.issues) console.error("  - " + issue);
      process.exit(1);
    });' \
  || fail "environment check failed (above). Nothing was changed; the current app is still running."

# --- 4. Swap -----------------------------------------------------------------
if container_exists "$OLD"; then
  container_running "$APP" || fail "$OLD exists and $APP is not running. Sort out which one should run before deploying."
  log "Removing the previous rollback copy $OLD"
  docker rm -f "$OLD" >/dev/null
fi

HAD_OLD=false
if container_exists "$APP"; then
  log "Stopping $APP and keeping it as $OLD"
  docker stop "$APP" >/dev/null
  docker rename "$APP" "$OLD"
  HAD_OLD=true
fi

rollback() {
  echo "[manual-deploy] New container failed; last log lines:" >&2
  docker logs --tail 60 "$APP" >&2 2>&1 || true
  docker rm -f "$APP" >/dev/null 2>&1 || true
  if [ "$HAD_OLD" = true ]; then
    docker rename "$OLD" "$APP"
    docker start "$APP" >/dev/null
    fail "rolled back to the previous container ($APP). Fix the error above and deploy again."
  fi
  fail "no previous container to roll back to."
}

log "Starting $APP from $IMAGE"
# shellcheck disable=SC2046
docker run -d --name "$APP" --restart unless-stopped \
  -p "$PUBLISH" --network "$SITE_NETWORK" \
  -v "$ASSETS_VOLUME:/app/storage/event-assets" \
  $(run_args) "$IMAGE" >/dev/null || rollback
docker network connect "$PG_NETWORK" "$APP" || rollback

# Migrations and the form/lodging syncs run before the server listens.
log "Waiting up to ${HEALTH_TIMEOUT}s for $HEALTH_URL to report $SHORT_SHA"
WAITED=0
while :; do
  container_running "$APP" || rollback
  # /api/health shows the release SHA only to a caller with OUTBOX_SWEEP_TOKEN
  # (#1400). Read it from the container being checked (exactly what the app
  # received), send it on stdin, never on argv or the screen. No token yet keeps
  # waiting; an image from before #1400 ignores the header.
  TOKEN="$(docker exec "$APP" printenv OUTBOX_SWEEP_TOKEN 2>/dev/null </dev/null || true)"
  BODY=""
  if [ -n "$TOKEN" ]; then
    BODY="$(printf 'Authorization: Bearer %s\n' "$TOKEN" | curl -fsS --max-time 10 -H @- "$HEALTH_URL" 2>/dev/null || true)"
  fi
  if printf '%s' "$BODY" | grep -q "\"$SHA\""; then
    printf '%s' "$BODY" | grep -q '"status":"ok"' \
      || log "WARNING: health is not \"ok\"; check $HEALTH_URL (backups or outbox can degrade it without breaking the site)"
    break
  fi
  [ "$WAITED" -ge "$HEALTH_TIMEOUT" ] && rollback
  sleep 10
  WAITED=$((WAITED + 10))
done

# --- 5. Backup container -----------------------------------------------------
if [ -r "$BACKUP_ENV_FILE" ] && [ "${IMSDA_SKIP_BACKUP:-}" != 1 ]; then
  BACKUP_IMAGE="$REGISTRY-backup:$SHA"
  log "Updating imsda-backup to $BACKUP_IMAGE"
  if docker pull "$BACKUP_IMAGE" >/dev/null; then
    docker rm -f imsda-backup >/dev/null 2>&1 || true
    docker run -d --name imsda-backup --restart unless-stopped \
      --network "$PG_NETWORK" --env-file "$BACKUP_ENV_FILE" \
      -v "$ASSETS_VOLUME:/assets:ro" -v imsda_events_backups:/backups \
      "$BACKUP_IMAGE" >/dev/null
  else
    log "WARNING: could not pull $BACKUP_IMAGE; imsda-backup was left as it was"
  fi
fi

log "Deployed $SHA. Check https://events.imsda.org and open one uploaded file."
[ "$HAD_OLD" = true ] && log "Rollback copy kept as $OLD; remove it with 'docker rm $OLD' once you are happy."
exit 0
