#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MOBILE_DIR="$ROOT_DIR/mobile"
IOS_DIR="$MOBILE_DIR/ios"
DERIVED_DATA_PATH="${IOS_DERIVED_DATA_PATH:-$MOBILE_DIR/.build/ios}"
IOS_DESTINATION="${IOS_DESTINATION:-platform=iOS Simulator,name=iPhone 16}"

"$ROOT_DIR/scripts/check-ios-prereqs.sh"

if [[ ! -d "$IOS_DIR" ]]; then
  echo "Missing $IOS_DIR. Run: npm run mobile:ios:prebuild"
  exit 1
fi

cd "$MOBILE_DIR"

workspace_args=()
workspace_candidates=("$IOS_DIR"/*.xcworkspace)
if [[ -e "${workspace_candidates[0]:-}" ]]; then
  workspace_path="${workspace_candidates[0]}"
  workspace_name="$(basename "$workspace_path")"
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

echo "Building scheme: $scheme"
echo "Destination: $IOS_DESTINATION"
xcodebuild \
  clean build \
  "${workspace_args[@]}" \
  -scheme "$scheme" \
  -configuration Debug \
  -destination "$IOS_DESTINATION" \
  -derivedDataPath "$DERIVED_DATA_PATH" \
  CODE_SIGNING_ALLOWED=NO
