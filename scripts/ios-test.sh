#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MOBILE_DIR="$ROOT_DIR/mobile"
IOS_DIR="$MOBILE_DIR/ios"
DERIVED_DATA_PATH="${IOS_DERIVED_DATA_PATH:-$MOBILE_DIR/.build/ios}"
IOS_DESTINATION="${IOS_DESTINATION:-platform=iOS Simulator,name=iPhone 16}"
TEST_LOG_PATH="${IOS_TEST_LOG_PATH:-$MOBILE_DIR/.build/ios-test.log}"

"$ROOT_DIR/scripts/check-ios-prereqs.sh"

if [[ -f "$MOBILE_DIR/scripts/setup-ios-test-targets.mjs" ]]; then
  echo "Running setup-ios-test-targets hook..."
  node "$MOBILE_DIR/scripts/setup-ios-test-targets.mjs"
fi

if [[ ! -d "$IOS_DIR" ]]; then
  echo "Missing $IOS_DIR. Run: npm run mobile:ios:prebuild"
  exit 1
fi

mkdir -p "$(dirname "$TEST_LOG_PATH")"
cd "$MOBILE_DIR"

workspace_args=()
workspace_candidates=("$IOS_DIR"/*.xcworkspace)
if [[ -e "${workspace_candidates[0]:-}" ]]; then
  workspace_name="$(basename "${workspace_candidates[0]}")"
  workspace_args=(-workspace "ios/$workspace_name")
else
  project_candidates=("$IOS_DIR"/*.xcodeproj)
  if [[ ! -e "${project_candidates[0]:-}" ]]; then
    echo "No .xcworkspace or .xcodeproj found in $IOS_DIR."
    exit 1
  fi
  project_name="$(basename "${project_candidates[0]}")"
  workspace_args=(-project "ios/$project_name")
fi

app_project="$(basename "$(ls -d "$IOS_DIR"/*.xcodeproj | head -1)" .xcodeproj)"
scheme="${IOS_SCHEME:-$app_project}"

# Debug UI tests load JS from Metro; start it when not already running (e.g. GitHub Actions).
# shellcheck source=scripts/ios-metro-for-tests.sh
source "$ROOT_DIR/scripts/ios-metro-for-tests.sh"
ensure_metro_for_ui_tests "$MOBILE_DIR"
trap stop_metro_if_started EXIT

echo "Testing scheme: $scheme"
echo "Destination: $IOS_DESTINATION"
xcodebuild \
  test \
  "${workspace_args[@]}" \
  -scheme "$scheme" \
  -configuration Debug \
  -destination "$IOS_DESTINATION" \
  -derivedDataPath "$DERIVED_DATA_PATH" \
  CODE_SIGNING_ALLOWED=NO | tee "$TEST_LOG_PATH"

/usr/bin/python3 - "$TEST_LOG_PATH" <<'PY'
import pathlib
import sys

log_path = pathlib.Path(sys.argv[1])
content = log_path.read_text(encoding="utf-8", errors="ignore")
zero_test_markers = [
    "Executed 0 tests",
    "0 tests, with 0 failures",
    "No tests were run",
]

if any(marker in content for marker in zero_test_markers):
    print("FAIL: xcodebuild test completed but no tests were executed.")
    print("HINT: Ensure iOS test bundles exist (Fix #1 should generate test targets).")
    sys.exit(1)
PY

echo "xcodebuild tests completed with executed tests."
