#!/usr/bin/env bash
# Generic physical-iPhone smoke capture for competitor AI video-analysis research.
# Usage:
#   TARGET_APP="Exact App Name or bundle.id" ./scripts/agent-device-competitor-tech-smoke.sh
#   ./scripts/agent-device-competitor-tech-smoke.sh "Exact App Name or bundle.id"

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARTIFACTS="${ARTIFACTS:-$ROOT/docs/agent-device-artifacts/competitor-tech-analysis}"
SESSION="${AGENT_DEVICE_SESSION:-competitor-tech-analysis}"
PLATFORM="${AGENT_DEVICE_PLATFORM:-ios}"
TARGET_APP="${TARGET_APP:-${1:-}}"
# Physical iPhone UDID — required when a simulator is booted (otherwise agent-device targets sim).
UDID="${AGENT_DEVICE_UDID:-00008150-000262891A28401C}"

export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"

# Load signing + UDID defaults when present (physical iPhone).
# shellcheck source=/dev/null
[[ -f "$ROOT/scripts/agent-device-signing-env.sh" ]] && source "$ROOT/scripts/agent-device-signing-env.sh" >/dev/null

mkdir -p "$ARTIFACTS"

device_args() {
  if [[ -n "$UDID" ]]; then
    printf -- '--udid %s' "$UDID"
  fi
}

log() { printf '[competitor-smoke] %s\n' "$*"; }
fail() { printf '[competitor-smoke] ERROR: %s\n' "$*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing command: $1"
}

check_xcode() {
  if [[ ! -d "$DEVELOPER_DIR" ]]; then
    fail "DEVELOPER_DIR not found: $DEVELOPER_DIR"
  fi

  if ! xcodebuild -version >/dev/null 2>&1; then
    fail "Xcode not usable. Run: sudo xcode-select -s /Applications/Xcode.app/Contents/Developer && sudo xcodebuild -license accept"
  fi
}

write_run_notes() {
  {
    printf '\n## Run %s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    printf -- '- **Target app:** %s\n' "${TARGET_APP:-not selected}"
    printf -- '- **Session:** %s\n' "$SESSION"
    printf -- '- **agent-device:** %s\n' "$(agent-device --version 2>/dev/null || printf unknown)"
    printf -- '- **Artifacts:** devices.txt, apps-ios-all.txt'
    if [[ -n "$TARGET_APP" ]]; then
      printf ', snapshot-initial.txt, 01-launch.png'
    fi
    printf '\n'
    printf -- '- **Next:** Pick the exact app from apps-ios-all.txt if no target app was provided; otherwise inspect the initial snapshot and continue the exploration loop.\n'
  } >>"$ARTIFACTS/RUN_NOTES.md"
}

require_cmd agent-device
check_xcode

log "agent-device $(agent-device --version)"
log "artifacts: $ARTIFACTS"
log "session: $SESSION"

log "Checking connected iOS devices..."
# Do not pass --udid before a session is open (conflicts with session-lock policy).
agent-device devices --platform "$PLATFORM" | tee "$ARTIFACTS/devices.txt"
log "physical UDID: ${UDID:-none}"

log "Listing all visible iOS apps..."
# shellcheck disable=SC2046
agent-device apps --platform "$PLATFORM" $(device_args) --all --session-lock strip | tee "$ARTIFACTS/apps-ios-all.txt"

if [[ -z "$TARGET_APP" ]]; then
  write_run_notes
  fail "No target app provided. Choose the exact app name or bundle ID from $ARTIFACTS/apps-ios-all.txt and rerun with TARGET_APP=\"...\""
fi

log "Opening target app: $TARGET_APP"
# shellcheck disable=SC2046
agent-device open "$TARGET_APP" --platform "$PLATFORM" $(device_args) --session "$SESSION"

log "Capturing initial interactive snapshot..."
# shellcheck disable=SC2046
agent-device snapshot -i --platform "$PLATFORM" $(device_args) --session "$SESSION" | tee "$ARTIFACTS/snapshot-initial.txt"

log "Capturing launch screenshot..."
# shellcheck disable=SC2046
agent-device screenshot "$ARTIFACTS/01-launch.png" --platform "$PLATFORM" $(device_args) --session "$SESSION"

write_run_notes

log "Baseline capture complete. Continue with: agent-device snapshot -i --session $SESSION"
log "Close when finished with: agent-device close --session $SESSION"

