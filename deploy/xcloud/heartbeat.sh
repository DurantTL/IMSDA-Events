#!/bin/sh
# Reports one run of a host job to the System report (#1382). Installed as
# /usr/local/bin/imsda-heartbeat. Usage:
#   imsda-heartbeat JOB OUTCOME [key=value ...]
#   imsda-heartbeat server-docker-cleanup SUCCEEDED result=cleaned diskUsedAfterPct=71
#
# Reads IMSDA_HEARTBEAT_TOKEN (and optionally IMSDA_HEARTBEAT_URL) from
# /etc/default/imsda-heartbeat. Only ever talks to the app on this machine. The
# token goes to curl on stdin, so it never shows in `ps`. Prints one line, never
# the token or the URL. ALWAYS exits 0: a heartbeat must never fail or slow the
# job that called it. Deliberately no `set -e`.

JOB="${1:-}"
OUTCOME="${2:-}"
[ "$#" -ge 2 ] && shift 2 || shift "$#"

ENV_FILE="${IMSDA_HEARTBEAT_ENV_FILE:-/etc/default/imsda-heartbeat}"
if [ -r "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  . "$ENV_FILE" 2>/dev/null
fi

TOKEN="${IMSDA_HEARTBEAT_TOKEN:-}"
URL="${IMSDA_HEARTBEAT_URL:-http://127.0.0.1:8100/api/internal/system-jobs/heartbeat}"

if [ -z "$TOKEN" ]; then
  echo "[heartbeat] ${JOB:-unknown} not sent (no token set)"
  exit 0
fi
case "$URL" in
  http://127.0.0.1:* | http://localhost:*) ;;
  *)
    echo "[heartbeat] ${JOB:-unknown} not sent (the address must be this machine)"
    exit 0
    ;;
esac

case "$JOB" in *[!a-z-]* | "") echo "[heartbeat] job name not accepted"; exit 0 ;; esac
case "$OUTCOME" in SUCCEEDED | FAILED) ;; *) echo "[heartbeat] $JOB outcome not accepted"; exit 0 ;; esac

SUMMARY=""
for pair in "$@"; do
  key="${pair%%=*}"
  value="${pair#*=}"
  case "$pair" in *=*) ;; *) echo "[heartbeat] $JOB not sent (bad detail)"; exit 0 ;; esac
  case "$key" in "" | *[!a-zA-Z]*) echo "[heartbeat] $JOB not sent (bad detail)"; exit 0 ;; esac
  case "$value" in
    "") echo "[heartbeat] $JOB not sent (bad detail)"; exit 0 ;;
    *[!0-9]*)
      case "$value" in *[!a-z-]*) echo "[heartbeat] $JOB not sent (bad detail)"; exit 0 ;; esac
      item="\"$key\":\"$value\""
      ;;
    *) item="\"$key\":$value" ;;
  esac
  SUMMARY="${SUMMARY:+$SUMMARY,}$item"
done

BODY="{\"job\":\"$JOB\",\"outcome\":\"$OUTCOME\",\"summary\":{$SUMMARY}}"

STATUS="$(printf 'Authorization: Bearer %s\n' "$TOKEN" | curl --silent --connect-timeout 2 --max-time 5 \
  -o /dev/null -w '%{http_code}' -X POST -H @- -H 'Content-Type: application/json' \
  --data "$BODY" "$URL" 2>/dev/null)"

if [ "$STATUS" = "200" ]; then
  echo "[heartbeat] $JOB $OUTCOME recorded"
else
  echo "[heartbeat] $JOB $OUTCOME not recorded (status ${STATUS:-none})"
fi
exit 0
