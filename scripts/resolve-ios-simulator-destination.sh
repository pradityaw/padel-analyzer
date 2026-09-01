#!/usr/bin/env bash
# Pick an available iPhone simulator for xcodebuild (CI + local).
# Prints a -destination value, e.g. platform=iOS Simulator,id=...
set -euo pipefail

export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"

# Warm simctl cache (GitHub Actions runners sometimes omit devices until listed).
xcrun simctl list devices available >/dev/null

DEST="$(
  /usr/bin/python3 - <<'PY'
import json
import subprocess
import sys

data = json.loads(
    subprocess.check_output(
        ["xcrun", "simctl", "list", "devices", "available", "-j"],
        text=True,
    )
)

candidates = []
for runtime, devices in data.get("devices", {}).items():
    for device in devices:
        if not device.get("isAvailable", True):
            continue
        name = device.get("name") or ""
        udid = device.get("udid") or ""
        if "iPhone" in name and udid:
            candidates.append((runtime, name, udid))

if not candidates:
    print("No available iPhone simulator found.", file=sys.stderr)
    sys.exit(1)

# Prefer newest iOS runtime, then stable name order (Pro / standard before SE).
candidates.sort(key=lambda item: (item[0], item[1]), reverse=True)
runtime, name, udid = candidates[0]
print(f"platform=iOS Simulator,id={udid}", end="")
print(f" # {name} ({runtime})", file=sys.stderr)
PY
)"

if [[ -n "${GITHUB_ENV:-}" ]]; then
  echo "IOS_DESTINATION=$DEST" >>"$GITHUB_ENV"
fi

printf '%s\n' "$DEST"
