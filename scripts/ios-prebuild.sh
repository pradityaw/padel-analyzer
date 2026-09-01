#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MOBILE_DIR="$ROOT_DIR/mobile"

bash "$ROOT_DIR/scripts/check-ios-prereqs.sh"

cd "$MOBILE_DIR"

echo "Running Expo prebuild for iOS..."
npx expo prebuild --platform ios --non-interactive "$@"
echo "Expo prebuild complete."
