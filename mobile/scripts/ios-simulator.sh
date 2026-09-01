#!/usr/bin/env bash
# Open the app in the iOS Simulator via Expo Go.
# Reuses PM2 Metro on :8081 when present (avoids a second bundler on :8082).
set -euo pipefail

export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
cd "$(dirname "$0")/.."

METRO_PORT="${RCT_METRO_PORT:-8081}"
METRO_URL="http://127.0.0.1:${METRO_PORT}"
EXPO_URL="exp://127.0.0.1:${METRO_PORT}"
DEFAULT_SIMULATOR="${EXPO_IOS_SIMULATOR:-iPhone 16e}"

metro_running() {
  curl -sf "${METRO_URL}/status" >/dev/null 2>&1
}

booted_udid() {
  xcrun simctl list devices booted -j 2>/dev/null \
    | node -e "
      const d = JSON.parse(require('fs').readFileSync(0, 'utf8')).devices;
      for (const group of Object.values(d)) {
        for (const dev of group) {
          if (dev.state === 'Booted') {
            process.stdout.write(dev.udid);
            process.exit(0);
          }
        }
      }
    " 2>/dev/null || true
}

ensure_simulator_booted() {
  if [[ -n "$(booted_udid)" ]]; then
    return 0
  fi

  echo "Booting ${DEFAULT_SIMULATOR}…"
  xcrun simctl boot "${DEFAULT_SIMULATOR}" 2>/dev/null || true
  open -a Simulator
  xcrun simctl bootstatus booted -b
}

open_in_simulator() {
  ensure_simulator_booted

  echo "Opening ${EXPO_URL} in Expo Go…"
  if ! xcrun simctl openurl booted "${EXPO_URL}"; then
    echo "Retrying after launching Expo Go…" >&2
    xcrun simctl launch booted host.exp.Exponent >/dev/null 2>&1 || true
    sleep 4
    xcrun simctl openurl booted "${EXPO_URL}"
  fi
}

if metro_running; then
  echo "Metro already running on port ${METRO_PORT} — reusing it."
  open_in_simulator
  exit 0
fi

exec npx expo start --ios --localhost --port "${METRO_PORT}" "$@"
