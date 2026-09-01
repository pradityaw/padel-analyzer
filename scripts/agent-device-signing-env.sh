#!/usr/bin/env bash
# Source before physical-iPhone agent-device runs.
# Usage: source ./scripts/agent-device-signing-env.sh

export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
export AGENT_DEVICE_UDID="${AGENT_DEVICE_UDID:-00008150-000262891A28401C}"
export AGENT_DEVICE_IOS_TEAM_ID="${AGENT_DEVICE_IOS_TEAM_ID:-A4756XP2SB}"
export AGENT_DEVICE_IOS_SIGNING_IDENTITY="${AGENT_DEVICE_IOS_SIGNING_IDENTITY:-Apple Development}"
export AGENT_DEVICE_IOS_BUNDLE_ID="${AGENT_DEVICE_IOS_BUNDLE_ID:-com.praditya.agentdevice.runner}"
# Avoid session-lock vs AGENT_DEVICE_UDID conflict on devices/apps before open.
export AGENT_DEVICE_SESSION_LOCK="${AGENT_DEVICE_SESSION_LOCK:-strip}"

echo "agent-device signing env:"
echo "  DEVELOPER_DIR=$DEVELOPER_DIR"
echo "  AGENT_DEVICE_UDID=$AGENT_DEVICE_UDID"
echo "  AGENT_DEVICE_IOS_TEAM_ID=$AGENT_DEVICE_IOS_TEAM_ID"
echo "  AGENT_DEVICE_IOS_BUNDLE_ID=$AGENT_DEVICE_IOS_BUNDLE_ID"
echo ""
echo "If snapshot fails with 'No Account for Team', open Xcode → Settings → Accounts"
echo "and sign in with the Apple ID that owns team $AGENT_DEVICE_IOS_TEAM_ID."
