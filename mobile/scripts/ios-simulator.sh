#!/usr/bin/env bash
# Use full Xcode (not Command Line Tools only) so xcrun simctl works for Expo.
# If `xcode-select -p` shows CommandLineTools, either run once:
#   sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
# or rely on DEVELOPER_DIR below (no sudo).
set -euo pipefail
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
cd "$(dirname "$0")/.."
exec npx expo start --ios "$@"
