# agent-device smoke — Swing Vision (physical iPhone)

Repeatable first-pass verification for the Cursor + agent-device + iPhone stack. Artifacts land in `docs/agent-device-artifacts/` (gitignored binaries).

## Before you run

1. Complete [AGENT_DEVICE_SETUP.md](./AGENT_DEVICE_SETUP.md) (Xcode path, license, paired device).
2. Install **Swing Vision** on the iPhone and sign in if your flow requires it.
3. Connect the phone (USB recommended for first run), unlock, trust the Mac.
4. Note manual blockers separately from app bugs (login, subscription, camera permission, ATT).

## Stop an in-progress QA agent

```bash
./scripts/stop-agent-device-qa.sh
```

Also press **Stop** in the Cursor chat driving QA. If `agent-device` daemon respawns immediately, disable the **agent-device** MCP server in Cursor Settings until you resume testing.

## Quick run

```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
./scripts/agent-device-swing-vision-smoke.sh
```

Or step through manually below.

## Manual smoke steps

```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
ARTIFACTS=docs/agent-device-artifacts
mkdir -p "$ARTIFACTS"

# 1. Device visible
agent-device devices --platform ios | tee "$ARTIFACTS/devices.txt"

# 2. Find Swing Vision bundle / display name
agent-device apps --platform ios | tee "$ARTIFACTS/apps-ios.txt"
# Pick the Swing Vision line; set SWING_VISION_APP below.

# 3. Open app (replace with discovered id from apps output)
export SWING_VISION_APP="${SWING_VISION_APP:-Swing Vision}"
agent-device open "$SWING_VISION_APP" --platform ios --session swing-smoke

# 4. Baseline UI evidence
agent-device snapshot -i --session swing-smoke | tee "$ARTIFACTS/snapshot-initial.txt"
agent-device screenshot "$ARTIFACTS/01-launch.png" --session swing-smoke

# 5. Explore main flow (adjust refs after snapshot -i)
# Example: tap a primary CTA if visible in snapshot output
# agent-device press @e12 --session swing-smoke
# agent-device snapshot -i --session swing-smoke | tee "$ARTIFACTS/snapshot-after-nav.txt"
# agent-device screenshot "$ARTIFACTS/02-after-nav.png" --session swing-smoke

# 6. Optional logs while reproducing issues
# agent-device log start --session swing-smoke
# … reproduce …
# agent-device log stop --session swing-smoke

# 7. Close session
agent-device close --session swing-smoke
```

## Pass criteria

| Check | Pass? |
|-------|-------|
| `agent-device devices --platform ios` lists your iPhone | |
| `apps --platform ios` includes Swing Vision | |
| `open` launches Swing Vision on device | |
| `snapshot -i` returns inspectable refs | |
| Screenshot saved under `docs/agent-device-artifacts/` | |
| Manual blockers documented in `SMOKE_NOTES.md` | |

## Recording observations

After each run, append to `docs/agent-device-artifacts/SMOKE_NOTES.md`:

- Device name / iOS version
- Swing Vision version (from App Store or About screen)
- Account state (logged in / guest / paywall)
- Permission prompts seen
- Whether main capture/import/analyze entry is reachable
- Screenshots paths and one-line UI summary

## Agent iteration loop

For Cursor agents after a code or UX change in **this repo** (Padel Analyzer), use the same CLI loop against **localhost** via `control-ui` for the web app, and this smoke doc when comparing behavior to Swing Vision on device.

Canonical loop:

`open → snapshot -i → act → re-snapshot → verify → screenshot/log → close`

Use `@eN` refs for exploration; convert stable steps to selectors or `.ad` replay when promoting to CI.

## Known environment blockers (padel-analyzer workspace)

If Xcode license or `xcode-select` are not configured, device commands fail with `COMMAND_FAILED` and a license hint. Fix with setup doc steps before re-running smoke.
