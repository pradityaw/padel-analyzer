#!/usr/bin/env bash
# Swing Vision physical-iPhone smoke for agent-device + Cursor.
# See docs/AGENT_DEVICE_SMOKE.md

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARTIFACTS="${ARTIFACTS:-$ROOT/docs/agent-device-artifacts}"
SESSION="${AGENT_DEVICE_SESSION:-swing-smoke}"
PLATFORM=ios
APP_NAME="${SWING_VISION_APP:-Swing Vision}"

export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"

mkdir -p "$ARTIFACTS"
NOTES="$ARTIFACTS/SMOKE_NOTES.md"

log() { printf '[smoke] %s\n' "$*"; }
fail() { printf '[smoke] ERROR: %s\n' "$*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing command: $1"
}

check_xcode() {
  if [[ ! -d "$DEVELOPER_DIR" ]]; then
    fail "DEVELOPER_DIR not found: $DEVELOPER_DIR (install Xcode or set DEVELOPER_DIR)"
  fi
  if ! xcodebuild -version >/dev/null 2>&1; then
    fail "Xcode not usable. Run: sudo xcode-select -s /Applications/Xcode.app/Contents/Developer && sudo xcodebuild -license accept"
  fi
}

require_cmd agent-device
check_xcode

log "agent-device $(agent-device --version)"
log "artifacts: $ARTIFACTS"
log "session: $SESSION"
log "target app: $APP_NAME"

agent-device devices --platform "$PLATFORM" | tee "$ARTIFACTS/devices.txt"

log "Listing iOS apps (grep for Swing Vision)…"
agent-device apps --platform "$PLATFORM" | tee "$ARTIFACTS/apps-ios.txt"

if ! grep -qi 'swing' "$ARTIFACTS/apps-ios.txt" 2>/dev/null; then
  log "WARN: no 'swing' match in apps list — set SWING_VISION_APP to the exact id from apps-ios.txt"
fi

log "Opening app…"
agent-device open "$APP_NAME" --platform "$PLATFORM" --session "$SESSION"

log "Interactive snapshot…"
agent-device snapshot -i --session "$SESSION" | tee "$ARTIFACTS/snapshot-initial.txt"

log "Screenshot…"
agent-device screenshot "$ARTIFACTS/01-launch.png" --session "$SESSION"

log "Closing session…"
agent-device close --session "$SESSION" || true

if [[ ! -f "$NOTES" ]]; then
  cat >"$NOTES" <<EOF
# Swing Vision smoke notes

Append one block per run.

## Template

- **Date:**
- **Device:**
- **iOS version:**
- **Swing Vision version:**
- **Account / blockers:**
- **Screenshots:**
- **Summary:**

EOF
fi

{
  echo ""
  echo "## Run $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "- **App:** $APP_NAME"
  echo "- **Session:** $SESSION"
  echo "- **agent-device:** $(agent-device --version 2>/dev/null || echo unknown)"
  echo "- **Artifacts:** snapshot-initial.txt, 01-launch.png, devices.txt, apps-ios.txt"
  echo "- **Next:** Inspect snapshot-initial.txt; press refs for main flow; re-run with manual steps in AGENT_DEVICE_SMOKE.md"
} >>"$NOTES"

log "Done. Review $ARTIFACTS and update $NOTES with device version and blockers."
