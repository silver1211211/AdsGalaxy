#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${ADSGALAXY_APP_DIR:-/www/wwwroot/bots/AdsFusion}"
JOB_ID="${1:?job id is required}"
TARGET="${2:?route or command is required}"
TIMEOUT_SECONDS="${3:-240}"
LOCK_NAME="${4:-$JOB_ID}"
OFFSET_SECONDS="${5:-0}"
LOG_NAME="${6:-cron-${JOB_ID}.jsonl}"
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$-${RANDOM}"
START_EPOCH="$(date +%s)"
LOG_DIR="${ADSGALAXY_CRON_LOG_DIR:-$APP_DIR/tmp/cron}"
LOCK_DIR="${ADSGALAXY_CRON_LOCK_DIR:-$APP_DIR/tmp/cron-locks}"
mkdir -p "$LOG_DIR" "$LOCK_DIR"

json_log() {
  local status="$1" exit_code="$2" http_status="$3" summary="$4"
  local end_epoch duration
  end_epoch="$(date +%s)"
  duration="$((end_epoch - START_EPOCH))"
  JOB_ID="$JOB_ID" RUN_ID="$RUN_ID" STATUS="$status" EXIT_CODE="$exit_code" HTTP_STATUS="$http_status" \
    DURATION="$duration" SUMMARY="$summary" LOCK_NAME="$LOCK_NAME" node -e '
      const clean = v => String(v || "").replace(/[\r\n]+/g, " ").slice(0, 1000);
      process.stdout.write(JSON.stringify({timestamp:new Date().toISOString(),job:process.env.JOB_ID,run_id:process.env.RUN_ID,status:process.env.STATUS,exit_code:Number(process.env.EXIT_CODE),http_status:process.env.HTTP_STATUS||null,duration_seconds:Number(process.env.DURATION),lock:process.env.LOCK_NAME,summary:clean(process.env.SUMMARY)})+"\n");
    ' >> "$LOG_DIR/$LOG_NAME"
}

exec 9>"$LOCK_DIR/${LOCK_NAME}.lock"
if ! flock -n 9; then
  json_log "skipped_locked" 0 "" "another run owns the lock"
  exit 0
fi

if (( OFFSET_SECONDS > 0 )); then sleep "$OFFSET_SECONDS"; fi
cd "$APP_DIR"

if [[ "$TARGET" == /api/* ]]; then
  set -a
  . "$APP_DIR/.env"
  set +a
  if [[ -z "${CRON_SECRET:-}" ]]; then
    json_log "failed" 78 "" "CRON_SECRET is missing"
    exit 78
  fi
  body_file="$(mktemp "$LOG_DIR/${JOB_ID}.${RUN_ID}.XXXXXX")"
  trap 'rm -f "$body_file"' EXIT
  set +e
  http_status="$(curl --silent --show-error --output "$body_file" --write-out '%{http_code}' \
    --connect-timeout 5 --max-time "$TIMEOUT_SECONDS" -H "x-cron-secret: $CRON_SECRET" \
    "${ADSGALAXY_CRON_BASE_URL:-http://127.0.0.1:3007}${TARGET}")"
  curl_exit=$?
  set -e
  summary="$(head -c 1000 "$body_file" | tr '\r\n' ' ')"
  if (( curl_exit != 0 )); then
    json_log "failed_transport" "$curl_exit" "$http_status" "$summary"
    exit "$curl_exit"
  fi
  if [[ ! "$http_status" =~ ^2[0-9][0-9]$ ]]; then
    json_log "failed_http" 22 "$http_status" "$summary"
    exit 22
  fi
  json_log "completed" 0 "$http_status" "$summary"
  exit 0
fi

set +e
output="$(timeout "$TIMEOUT_SECONDS" /bin/bash -lc "cd '$APP_DIR' && $TARGET" 2>&1)"
command_exit=$?
set -e
if (( command_exit != 0 )); then
  json_log "failed_command" "$command_exit" "" "$output"
  exit "$command_exit"
fi
json_log "completed" 0 "" "$output"

