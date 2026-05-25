# Telegram feedback → Cursor SDK PR pipeline

Tester feedback lands in a Telegram group; a daily job drains messages, groups them into threads, runs **cloud** Cursor SDK agents (one PR per actionable thread), and posts PR links back to the group.

This is **development tooling** — not part of the production app runtime.

## Prerequisites

- [Cursor API key](https://cursor.com/dashboard/cloud-agents) with cloud agents enabled — set as `CURSOR_API_KEY`.
- GitHub repo URL must match where you want PRs opened (default in code: `https://github.com/pradityaw/padel-analyzer.git`). Override with `FEEDBACK_REPO_URL` if you fork or rename.

## One-time: Telegram bot & group

### 1. Create the bot

1. Open Telegram, talk to [@BotFather](https://t.me/BotFather).
2. Send `/newbot` and follow prompts. Save the **HTTP API token** — this is `TELEGRAM_BOT_TOKEN`.

### 2. Privacy mode (required for group ingest)

By default bots only see commands and mentions in groups. For feedback capture you need **all** messages:

1. Talk to [@BotFather](https://t.me/BotFather).
2. Send `/mybots` → pick your bot → **Bot Settings** → **Group Privacy** → **Turn off** (Disable).

Alternatively send `/setprivacy` → pick bot → **Disable**.

### 3. Create the group and add the bot

1. Create a group (e.g. “Padel testers”).
2. Add your bot as a member (and optionally make it admin if you want fewer Telegram-side restrictions — not strictly required for reading messages once privacy is off).

### 4. Get the group `chat_id`

1. Send any message in the group (after the bot joined).
2. Call (replace `TOKEN`):

   ```bash
   curl -s "https://api.telegram.org/botTOKEN/getUpdates" | jq .
   ```

3. Find `message.chat.id` for your group (often negative, e.g. `-1001234567890`). Set `TELEGRAM_FEEDBACK_CHAT_ID` to that value (string is fine).

### 5. Allowlist (recommended)

Only listed Telegram user IDs can produce inbox rows (extra random members won’t trigger PRs):

1. Users can message [@userinfobot](https://t.me/userinfobot) to learn their numeric `id`.
2. Set `TELEGRAM_ALLOWLIST_USER_IDS` to a comma-separated list, e.g. `123456789,987654321`.

If unset, **all** senders in the configured chat are accepted (not recommended for public groups).

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | From BotFather |
| `TELEGRAM_FEEDBACK_CHAT_ID` | Yes | Target group chat id |
| `TELEGRAM_ALLOWLIST_USER_IDS` | No | Comma-separated Telegram user ids |
| `CURSOR_API_KEY` | Yes for triage | Cursor cloud agents |
| `FEEDBACK_REPO_URL` | No | Git clone URL for cloud agent (default: padel-analyzer GitHub) |
| `FEEDBACK_MAX_MESSAGES_PER_RUN` | No | Default `100` |
| `FEEDBACK_MAX_PRS_PER_RUN` | No | Default `3` |
| `FEEDBACK_MODEL` | No | Cursor model id for cloud agent (default `composer-2`) |

Optional local file: **`.env.feedback`** at repo root — parsed as `KEY=value` lines (same keys as above). Do not commit it.

## Commands

```bash
# Drain Telegram → qa-artifacts/feedback/inbox.jsonl (run manually or via triage)
npm run feedback:collect

# Dry-run: group threads, print bundles, no SDK / no Telegram send
npm run feedback:dry-run

# Full triage: collect → bundle → cloud Cursor agents → Telegram summary
npm run feedback:triage
```

## GitHub Actions

Workflow [.github/workflows/feedback-triage.yml](../../.github/workflows/feedback-triage.yml) runs triage on a schedule (UTC). Add repository **Secrets**:

- `CURSOR_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_FEEDBACK_CHAT_ID`
- `TELEGRAM_ALLOWLIST_USER_IDS` (optional but recommended)

Adjust the cron in the workflow if you want a different local time.

## Artifacts (gitignored under `qa-artifacts/`)

- `qa-artifacts/feedback/state.json` — last Telegram `update_id`, consumed watermark, etc.
- `qa-artifacts/feedback/inbox.jsonl` — one JSON object per captured message
- `qa-artifacts/feedback/media/` — downloaded photos / videos referenced from inbox lines
- `.cursor-sdk-runs/feedback/` — triage run logs

## Safety notes

- **PRs are opened by the cloud agent** — by default you review and merge manually.
- **Auto-merge:** PRs on branches `feat/feedback-*` or `cursor/feedback-*` targeting the **default branch** are squash-merged when [.github/workflows/feedback-auto-merge.yml](../../.github/workflows/feedback-auto-merge.yml) runs (`npm run typecheck` must pass). Set `FEEDBACK_AUTO_MERGE=1` and `GITHUB_TOKEN` in `.env.feedback` to merge immediately from `feedback:triage-slack` after the agent opens a PR.
- **Daily caps** limit Cursor API spend (`FEEDBACK_MAX_PRS_PER_RUN`, etc.).
- **Allowlist** prevents strangers added to the group from generating PRs.

See also [scripts/cursor-sdk/README.md](../cursor-sdk/README.md) for the Cursor SDK runner and manual `feedback-implement` task.

---

# Slack feedback → Cursor SDK PR pipeline

Same flow as Telegram, but messages come from a **Slack channel**. Telegram scripts are unchanged; Slack uses separate state/inbox files.

## One-time: Slack app & channel

### 1. Create a Slack app

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**.
2. Name it (e.g. `Padel Feedback Bot`) and pick your workspace.

### 2. OAuth scopes (Bot Token)

Under **OAuth & Permissions** → **Scopes** → **Bot Token Scopes**, add:

- `channels:history` — read messages in public channels
- `groups:history` — read private channels (if you use a private feedback channel)
- `channels:read`
- `reactions:write` — add :eyes: on captured messages
- `chat:write` — post triage summaries and clarification replies
- `files:read` — download screenshots / attachments

### 3. Install to workspace

**Install App** → copy the **Bot User OAuth Token** (`xoxb-...`) → `SLACK_BOT_TOKEN`.

### 4. Create channel and invite the bot

1. Create a channel (e.g. `#padel-testers`).
2. `/invite @YourBotName` so the bot can read and post.

### 5. Channel ID

Right-click the channel → **View channel details** → scroll to the bottom for **Channel ID** (`C...`), or:

```bash
curl -s -H "Authorization: Bearer xoxb-YOUR_TOKEN" \
  "https://slack.com/api/conversations.list?types=public_channel,private_channel&limit=200" \
  | python3 -m json.tool | grep -A2 '"name": "padel'
```

Set `SLACK_FEEDBACK_CHANNEL_ID` to the raw conversation ID only:

- Public channel: `C...`
- Private channel: `G...`

The scripts also tolerate a copied Slack `/archives/C...` URL or `<#C...|name>` mention, but repository secrets should store the raw ID. Do not store `#channel-name`, the channel display name, or a generic Slack client URL.

### 6. Allowlist (recommended)

Each tester: Slack profile → **⋯** → copy member ID (`U...`), or use `users.list` API.

Set `SLACK_ALLOWLIST_USER_IDS` to comma-separated IDs, e.g. `U01ABC,U02DEF`.

If unset, all human messages in the channel are ingested.

## Slack environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SLACK_BOT_TOKEN` | Yes | Bot token `xoxb-...` |
| `SLACK_FEEDBACK_CHANNEL_ID` | Yes | Channel id `C...` |
| `SLACK_ALLOWLIST_USER_IDS` | No | Comma-separated `U...` ids |
| `CURSOR_API_KEY` | Yes for triage | Cursor cloud agents |
| `FEEDBACK_REPO_URL` | No | Git clone URL (default: padel-analyzer GitHub) |
| `FEEDBACK_MAX_MESSAGES_PER_RUN` | No | Default `100` |
| `FEEDBACK_MAX_PRS_PER_RUN` | No | Default `3` |
| `FEEDBACK_MODEL` | No | Default `composer-2` |
| `FEEDBACK_AGENT_TIMEOUT_MS` | No | Max wait per agent run (default `1200000` = 20 min) |

Add these to **`.env.feedback`** alongside Telegram vars if you use both.

Validate the Slack/Cursor setup before spending Cursor runs:

```bash
npm run feedback:verify-slack
```

If the verifier reports `conversations.info failed: invalid_arguments`, the Slack token is valid but the channel value is not usable by Slack's API. Reset `SLACK_FEEDBACK_CHANNEL_ID` to the raw `C...` or `G...` ID from Slack channel details, invite the bot to that channel, then rerun the verifier.

## Slack commands

```bash
npm run feedback:collect-slack   # safe — no Cursor API spend
npm run feedback:dry-run-slack   # safe — bundles only, no PRs
npm run feedback:triage-slack    # costs Cursor API; may open GitHub PR(s)
npm run feedback:test-slack-utils # local validation for Slack helpers / JSONL parsing
```

Copy [`.env.feedback.example`](../../.env.feedback.example) to `.env.feedback` and set keys. For testing, use `FEEDBACK_MAX_PRS_PER_RUN=1` and `FEEDBACK_MAX_MESSAGES_PER_RUN=20`.

**Noise filter:** collect and triage skip setup chatter (`/invite`, bare slash commands, very short greetings). Legacy rows already in `slack-inbox.jsonl` are marked processed on the next triage run without starting an agent.

### Slack message → Cursor SDK → PR (how it actually works)

Posting in Slack does **not** instantly start an agent. There is no Slack Events webhook in this repo. The pipeline is **poll-based**:

1. **Collect** — GitHub Actions (or `npm run feedback:collect-slack`) reads new messages from the feedback channel into `slack-inbox.jsonl`.
2. **Triage** — `feedback:triage-slack` groups unprocessed messages into threads and starts a **cloud** Cursor SDK agent per thread (up to `FEEDBACK_MAX_PRS_PER_RUN`, default 3).
3. **Agent** — Opens a GitHub PR when the feedback is classified as `bug`, `ux`, or `feature`.
4. **Summary** — The bot posts a `Daily triage: …` message in the same Slack channel.

**When triage runs:** daily at **02:30 UTC** (scheduled), or when you click **Run workflow** on [Feedback triage (Slack)](../../.github/workflows/feedback-triage-slack.yml) (`workflow_dispatch`). After posting feedback, run the workflow manually if you do not want to wait for the schedule.

**Message must qualify:** at least ~12 characters (or an attachment), not a trivial greeting, and your Slack user id must be in `SLACK_ALLOWLIST_USER_IDS` if that secret is set. Example that works: `Upload fails on Safari when I tap Analyze — spinner never stops`.

**Preflight:** `npm run feedback:verify-slack` (also runs in CI before triage).

## Slack GitHub Actions

Workflow [.github/workflows/feedback-triage-slack.yml](../../.github/workflows/feedback-triage-slack.yml) runs `npm run feedback:triage-slack` on a schedule (default `02:30` UTC, 30 min after Telegram). Add secrets:

- `CURSOR_API_KEY`
- `SLACK_BOT_TOKEN`
- `SLACK_FEEDBACK_CHANNEL_ID`
- `SLACK_ALLOWLIST_USER_IDS` (optional)

## Slack artifacts

- `qa-artifacts/feedback/slack-state.json` — `oldest_ts` poll cursor, `processed_message_ids`
- `qa-artifacts/feedback/slack-inbox.jsonl` — one JSON object per message (`slack_ts` is the stable id)
- `qa-artifacts/feedback/media/` — shared with Telegram downloads
- `.cursor-sdk-runs/feedback/*-triage-slack.jsonl` — agent run logs

**Note:** GitHub Actions runners do not persist `slack-inbox.jsonl` between runs unless you add artifact/cache storage. For CI, prefer `workflow_dispatch` after messages were collected on a machine with persistent `qa-artifacts/`, or extend the workflow to upload/download state artifacts later.
