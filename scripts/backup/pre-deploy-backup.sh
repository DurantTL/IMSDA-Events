#!/bin/sh
# Database copy taken just before a deploy (#1790).
#
#   pre-deploy-backup.sh <commit sha being deployed>
#
# The deploy scripts (deploy/xcloud/deploy.sh and scripts/manual-deploy.sh) run
# this in the backup image before any migration, and stop the deploy when it
# exits non-zero. It writes one pg_dump custom-format file named with the UTC
# date and time and the version being deployed:
#
#   ${BACKUP_DIR}/pre-deploy/imsda-predeploy-20261115T060012Z-<sha12>.pgdump
#
# The ".pgdump" ending is deliberate: the nightly scripts, the restore
# rehearsal and the app's read-only R2 check all look for "*.dump", so a
# pre-deploy copy is never mistaken for the newest nightly backup.
#
# It is stored the same way as the nightly dumps: in the imsda_events_backups
# volume, then copied off the host with BACKUP_OFFSITE_COMMAND (the image runs
# offsite-r2.sh, the same bucket-scoped R2 token), under
# "${R2_PREFIX:-imsda-events}/pre-deploy/". With BACKUP_REQUIRE_OFFSITE=true
# (the image default) a failed or missing off-site copy fails the step.
#
# Copies older than PREDEPLOY_RETENTION_DAYS (14) are deleted, locally and in
# R2, keeping the newest BACKUP_KEEP_MIN (3) however old.
#
# Environment:
#   PGHOST, PGUSER, PGPASSWORD, PGDATABASE   connection (the .env.backup file)
#   BACKUP_DIR                 default /backups
#   PREDEPLOY_DIR              default ${BACKUP_DIR}/pre-deploy
#   PREDEPLOY_RETENTION_DAYS   default 14
#   BACKUP_OFFSITE_COMMAND     run with the dump path as $1
#   BACKUP_REQUIRE_OFFSITE     true: no off-site copy means failure
#   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PREFIX
#                              used to prune old copies in R2
#
# Nothing here prints a credential.
set -eu

. "$(dirname "$0")/prune-lib.sh"

SHA="${1:-}"
printf '%s' "${SHA}" | grep -Eq '^[0-9a-f]{7,40}$' || {
  echo "[pre-deploy-backup] usage: pre-deploy-backup.sh <commit sha being deployed>" >&2
  exit 2
}
SHORT_SHA="$(printf '%s' "${SHA}" | cut -c1-12)"

BACKUP_DIR="${BACKUP_DIR:-/backups}"
PREDEPLOY_DIR="${PREDEPLOY_DIR:-${BACKUP_DIR}/pre-deploy}"
RETENTION_DAYS="${PREDEPLOY_RETENTION_DAYS:-14}"
printf '%s' "${RETENTION_DAYS}" | grep -Eq '^[1-9][0-9]*$' || {
  echo "[pre-deploy-backup] PREDEPLOY_RETENTION_DAYS must be a whole number of days from 1." >&2
  exit 2
}
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="imsda-predeploy-${STAMP}-${SHORT_SHA}.pgdump"
TARGET="${PREDEPLOY_DIR}/${NAME}"
R2_BASE="${R2_PREFIX:-imsda-events}"
R2_PREDEPLOY_PREFIX="${R2_BASE%/}/pre-deploy"

mkdir -p "${PREDEPLOY_DIR}"

# Prune first so a full disk is not what stops the copy, and clear any
# half-written file a killed run left behind.
find "${PREDEPLOY_DIR}" -name 'imsda-predeploy-*.pgdump.partial' -type f -print -delete
prune_backups "${PREDEPLOY_DIR}" 'imsda-predeploy-*.pgdump' "${RETENTION_DAYS}"

trap 'rm -f "${TARGET}.partial"' EXIT

echo "[pre-deploy-backup] $(date -u +%FT%TZ) copying ${PGDATABASE:-the database} to ${TARGET} before deploying ${SHORT_SHA}"
pg_dump --format=custom --compress=6 --file="${TARGET}.partial"

SIZE="$(wc -c < "${TARGET}.partial")"
if [ "${SIZE}" -lt 1024 ]; then
  echo "[pre-deploy-backup] Refusing a ${SIZE}-byte copy; something is wrong." >&2
  exit 1
fi
# Read the table of contents back so an unreadable file never counts as a copy.
if ! pg_restore --list "${TARGET}.partial" >/dev/null; then
  echo "[pre-deploy-backup] The copy could not be read back." >&2
  exit 1
fi
mv "${TARGET}.partial" "${TARGET}"
chmod 600 "${TARGET}"
echo "[pre-deploy-backup] wrote ${SIZE} bytes to ${TARGET}"

if [ -n "${BACKUP_OFFSITE_COMMAND:-}" ]; then
  echo "[pre-deploy-backup] copying off-host"
  # offsite-r2.sh files it under R2_PREFIX; the pre-deploy copies get their own folder.
  if ! R2_PREFIX="${R2_PREDEPLOY_PREFIX}" sh -c "${BACKUP_OFFSITE_COMMAND}" _ "${TARGET}"; then
    echo "[pre-deploy-backup] OFF-SITE COPY FAILED; the copy exists only on this host." >&2
    if [ "${BACKUP_REQUIRE_OFFSITE:-false}" = true ]; then
      exit 1
    fi
  fi
elif [ "${BACKUP_REQUIRE_OFFSITE:-false}" = true ]; then
  echo "[pre-deploy-backup] BACKUP_REQUIRE_OFFSITE=true but no BACKUP_OFFSITE_COMMAND is set." >&2
  exit 1
fi

prune_backups "${PREDEPLOY_DIR}" 'imsda-predeploy-*.pgdump' "${RETENTION_DAYS}"

# Old copies in R2: the key names carry the UTC stamp, so compare names, not
# dates the listing reports. A failed prune is reported but does not stop the
# deploy; the copy it was asked for is already safe.
prune_r2() {
  for name in R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET; do
    eval "value=\${${name}:-}"
    [ -n "${value}" ] || return 0
  done
  command -v aws >/dev/null 2>&1 || return 0
  AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}"
  AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}"
  AWS_DEFAULT_REGION=auto
  AWS_REQUEST_CHECKSUM_CALCULATION=when_required
  AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
  export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_DEFAULT_REGION \
    AWS_REQUEST_CHECKSUM_CALCULATION AWS_RESPONSE_CHECKSUM_VALIDATION
  endpoint="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
  # Stamps compare as 14-digit numbers once the T and Z are dropped.
  cutoff="$(date -u -d "@$(( $(date -u +%s) - RETENTION_DAYS * 86400 ))" +%Y%m%d%H%M%S)"
  listing="$(aws s3 ls "s3://${R2_BUCKET}/${R2_PREDEPLOY_PREFIX}/" --endpoint-url "${endpoint}")" || return 1
  # Newest first; the newest BACKUP_KEEP_MIN are always kept.
  printf '%s\n' "${listing}" | awk '{print $NF}' \
    | grep -E '^imsda-predeploy-[0-9]{8}T[0-9]{6}Z-[0-9a-f]+\.pgdump$' \
    | sort -r | tail -n +"$((${BACKUP_KEEP_MIN:-3} + 1))" \
    | while read -r key; do
        stamp="$(printf '%s' "${key}" | cut -d- -f3 | tr -d TZ)"
        if [ "${stamp}" -lt "${cutoff}" ]; then
          echo "[pre-deploy-backup] removing ${R2_PREDEPLOY_PREFIX}/${key} from R2"
          aws s3 rm "s3://${R2_BUCKET}/${R2_PREDEPLOY_PREFIX}/${key}" \
            --endpoint-url "${endpoint}" --only-show-errors || exit 1
        fi
      done
}
prune_r2 || echo "[pre-deploy-backup] WARNING: could not prune old pre-deploy copies in R2; remove them by hand (docs/BACKUPS.md)." >&2

echo "[pre-deploy-backup] $(date -u +%FT%TZ) complete: ${NAME}"
