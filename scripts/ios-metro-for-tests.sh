#!/usr/bin/env bash
# Start Metro for Debug iOS UI tests when it is not already running (CI + local).
set -euo pipefail

METRO_PORT="${RCT_METRO_PORT:-8081}"
METRO_LOG_PATH="${IOS_METRO_LOG_PATH:-}"
METRO_STARTED_BY_SCRIPT=0
METRO_PID=""

metro_status_url() {
  printf 'http://127.0.0.1:%s/status' "$METRO_PORT"
}

metro_is_running() {
  curl -sf "$(metro_status_url)" 2>/dev/null | grep -q 'packager-status:running'
}

ensure_metro_for_ui_tests() {
  local mobile_dir="$1"

  if metro_is_running; then
    echo "Metro already running on :${METRO_PORT}"
    return 0
  fi

  mkdir -p "$mobile_dir/.build"
  METRO_LOG_PATH="${METRO_LOG_PATH:-$mobile_dir/.build/metro-ci.log}"

  echo "Starting Metro on :${METRO_PORT} for iOS UI smoke tests..."
  (
    cd "$mobile_dir"
    export CI="${CI:-true}"
    export EXPO_NO_TELEMETRY=1
    npx expo start --localhost --port "$METRO_PORT"
  ) >"$METRO_LOG_PATH" 2>&1 &
  METRO_PID=$!
  METRO_STARTED_BY_SCRIPT=1

  local deadline=$((SECONDS + 180))
  while (( SECONDS < deadline )); do
    if metro_is_running; then
      echo "Metro ready ($(metro_status_url))."
      return 0
    fi
    if ! kill -0 "$METRO_PID" 2>/dev/null; then
      echo "Metro exited before becoming ready. Last log lines:"
      tail -n 40 "$METRO_LOG_PATH" || true
      return 1
    fi
    sleep 2
  done

  echo "Metro did not become ready within 180s. Last log lines:"
  tail -n 40 "$METRO_LOG_PATH" || true
  return 1
}

stop_metro_if_started() {
  if [[ "$METRO_STARTED_BY_SCRIPT" != 1 ]] || [[ -z "$METRO_PID" ]]; then
    return 0
  fi
  echo "Stopping Metro (pid $METRO_PID) started for UI tests..."
  kill "$METRO_PID" 2>/dev/null || true
  wait "$METRO_PID" 2>/dev/null || true
}
