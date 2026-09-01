#!/usr/bin/env bash
# Read-only prerequisite check for local and CI iOS native workflows.
set -euo pipefail

export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
has_failures=0

pass() { printf '  OK   %s\n' "$*"; }
fail() { printf '  FAIL %s\n' "$*"; has_failures=1; }
hint() { printf '  HINT %s\n' "$*"; }

echo "iOS native prerequisite check"
echo "============================="

if command -v xcodebuild >/dev/null 2>&1; then
  pass "xcodebuild found"
  pass "$(xcodebuild -version 2>/dev/null | /usr/bin/sed -n '1p')"
else
  fail "xcodebuild not found"
fi

if [[ -d "$DEVELOPER_DIR" ]]; then
  pass "DEVELOPER_DIR=$DEVELOPER_DIR"
else
  fail "DEVELOPER_DIR points to missing path: $DEVELOPER_DIR"
  hint "export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer"
fi

xcode_select_path="$(xcode-select -p 2>/dev/null || true)"
if [[ -n "$xcode_select_path" ]]; then
  pass "xcode-select -> $xcode_select_path"
  if [[ "$xcode_select_path" != *Xcode.app* ]]; then
    hint "xcode-select is not set to full Xcode; DEVELOPER_DIR override will be used"
  fi
else
  fail "xcode-select unavailable"
fi

if command -v pod >/dev/null 2>&1; then
  pass "pod $(pod --version 2>/dev/null)"
elif command -v cocoapods >/dev/null 2>&1; then
  pass "cocoapods $(cocoapods --version 2>/dev/null)"
else
  fail "CocoaPods not found (pod/cocoapods)"
  hint "brew install cocoapods"
fi

if xcodebuild -version >/dev/null 2>&1; then
  pass "xcodebuild is executable"
else
  fail "xcodebuild cannot run (license not accepted or invalid DEVELOPER_DIR)"
  hint "sudo xcodebuild -license accept"
fi

echo ""
if [[ "$has_failures" -eq 0 ]]; then
  echo "All checks passed."
  exit 0
fi

echo "Fix failures above, then re-run this script."
exit 1
