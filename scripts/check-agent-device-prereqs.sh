#!/usr/bin/env bash
# Read-only prerequisite check for agent-device + physical iPhone.
set -euo pipefail

export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
ok=0
warn=0

pass() { printf '  OK   %s\n' "$*"; }
fail() { printf '  FAIL %s\n' "$*"; ok=1; }
hint() { printf '  HINT %s\n' "$*"; }

echo "agent-device prerequisite check"
echo "=============================="

if command -v node >/dev/null; then
  v="$(node --version | sed 's/^v//')"
  major="${v%%.*}"
  if [[ "$major" -ge 22 ]]; then pass "Node $v"; else fail "Node $v (need 22+)"; fi
else
  fail "node not found"
fi

if command -v agent-device >/dev/null; then
  pass "agent-device $(agent-device --version 2>/dev/null || echo '?')"
else
  fail "agent-device not on PATH (npm install -g agent-device@latest)"
fi

if [[ -d /Applications/Xcode.app ]]; then
  pass "Xcode.app installed"
else
  fail "Xcode.app not found in /Applications"
fi

sel="$(xcode-select -p 2>/dev/null || true)"
if [[ "$sel" == *Xcode.app* ]]; then
  pass "xcode-select -> $sel"
else
  fail "xcode-select -> ${sel:-unknown} (want Xcode.app)"
  hint "sudo xcode-select -s /Applications/Xcode.app/Contents/Developer"
fi

if xcodebuild -version >/dev/null 2>&1; then
  pass "xcodebuild: $(xcodebuild -version 2>/dev/null | head -1)"
else
  fail "xcodebuild not usable (license or DEVELOPER_DIR)"
  hint "export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer"
  hint "sudo xcodebuild -license accept"
fi

devicectl_err="$(xcrun devicectl list devices 2>&1)" || true
if [[ "$devicectl_err" == *"agreed to the Xcode license"* ]]; then
  fail "Xcode license not accepted"
  hint "sudo xcodebuild -license accept"
elif xcrun devicectl list devices >/dev/null 2>&1; then
  pass "devicectl available"
  echo ""
  echo "Connected devices:"
  xcrun devicectl list devices 2>/dev/null | sed 's/^/    /' || true
else
  fail "devicectl failed"
fi

echo ""
if [[ "$ok" -eq 0 ]]; then
  echo "All checks passed. Run: ./scripts/agent-device-swing-vision-smoke.sh"
  exit 0
else
  echo "Fix failures above, then re-run this script."
  exit 1
fi
