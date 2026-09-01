#!/usr/bin/env bash
# Stop Swing Vision / agent-device QA: close sessions, kill runners, reset daemon.
# See docs/AGENT_DEVICE_SETUP.md

set -euo pipefail

export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"

log() { printf '[stop-qa] %s\n' "$*"; }

kill_matching() {
  local label="$1"
  local pattern="$2"
  if pids="$(pgrep -f "$pattern" 2>/dev/null || true)"; then
    if [[ -n "$pids" ]]; then
      log "Stopping $label (PIDs: $pids)"
      pkill -f "$pattern" 2>/dev/null || true
      sleep 0.5
      pkill -9 -f "$pattern" 2>/dev/null || true
    fi
  fi
}

close_session() {
  local name="$1"
  if ! command -v agent-device >/dev/null 2>&1; then
    return 0
  fi
  if agent-device close --session "$name" --platform ios 2>/dev/null; then
    log "Closed session: $name"
  fi
}

close_all_sessions() {
  command -v agent-device >/dev/null 2>&1 || { log "agent-device not on PATH; skipping session close"; return 0; }

  local names=()
  if json="$(agent-device session list --json 2>/dev/null || true)"; then
    while IFS= read -r name; do
      [[ -n "$name" ]] && names+=("$name")
    done < <(printf '%s' "$json" | node -e "
      const fs = require('fs');
      try {
        const data = JSON.parse(fs.readFileSync(0, 'utf8'));
        for (const s of data.sessions || []) {
          if (s && s.name) console.log(s.name);
        }
      } catch (_) { process.exit(0); }
    " 2>/dev/null || true)
  fi

  # Known QA session names (smoke + ad-hoc agent runs)
  for fallback in swing-smoke swing-final swing-qa default; do
    names+=("$fallback")
  done

  local seen=""
  for name in "${names[@]}"; do
    [[ -z "$name" ]] && continue
    if [[ "$seen" == *"|$name|"* ]]; then
      continue
    fi
    seen="${seen}|$name|"
    close_session "$name"
  done
}

log "Stopping agent-device QA on iOS"

# 1. Graceful session teardown
close_all_sessions

# 2. Smoke script and in-flight CLI automation (not this script)
kill_matching "smoke script" "agent-device-swing-vision-smoke\\.sh"
kill_matching "agent-device CLI (automation)" "agent-device (open|close|snapshot|press|click|swipe|fill|wait|apps|devices|record|logs|batch|replay|test|find|scroll|type|back|home)"

# 3. Stuck XCTest runner on physical device / simulator
kill_matching "Xcode AgentDeviceRunner" "xcodebuild.*AgentDeviceRunner"
kill_matching "AgentDeviceRunner test bundle" "AgentDeviceRunnerUITests"

# 4. agent-device daemons (restarted on next command)
kill_matching "agent-device daemon" "agent-device/dist/src/internal/daemon"

# 5. Optional stale lock (daemon recreates on next run)
if [[ -f "${HOME}/.agent-device/daemon.lock" ]]; then
  rm -f "${HOME}/.agent-device/daemon.lock" 2>/dev/null || true
  log "Removed stale daemon.lock"
fi

if command -v agent-device >/dev/null 2>&1; then
  remaining="$(agent-device session list --json 2>/dev/null || echo '{}')"
  if [[ "$remaining" == *'"sessions":[]'* ]] || [[ "$remaining" == *'"sessions": []'* ]]; then
    log "No active agent-device sessions"
  else
    log "Remaining sessions (retry or reboot phone): $remaining"
  fi
else
  log "Done (agent-device not installed)"
fi

if pgrep -f "agent-device/dist/src/internal/daemon" >/dev/null 2>&1; then
  log "Note: agent-device daemon may respawn while Cursor MCP (agent-device) is enabled — disable it in Settings → MCP if you want zero background processes"
fi

log "QA stop complete"
