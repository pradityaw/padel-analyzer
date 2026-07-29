# Find bugs automation — pause, dedupe, re-enable

Stops the daily `#live-feedback-sdk` / draft-PR spam loop from
[Find bugs](https://cursor.com/automations/95f71ec6-e12a-459e-bcce-d4f99f476bae)
(`95f71ec6-e12a-459e-bcce-d4f99f476bae`).

Cloud agents can only **read** automation metadata. Pause and prompt edits
must be done in the Cursor dashboard by the automation owner.

## 1. Pause now (do this first)

1. Open https://cursor.com/automations/95f71ec6-e12a-459e-bcce-d4f99f476bae
2. Disable / pause the automation so it does not run overnight.
3. Confirm `enabled: false` on the next dashboard refresh.

Fingerprint for the known fix set: `critical-bugs-server-core-v1`
(YouTube TOCTOU, job recovery, cloud playback, cloud rally path, Slack Events
mount, CV stdout settled guard).

## 2. Land one fix PR, close twins

Keep a single open PR with those fixes (canonical:
[#77](https://github.com/pradityaw/padel-analyzer/pull/77); older twins such as
#76 were closed as duplicates). After merge to `main`, leave no open
`cursor/critical-bug-investigation-*` drafts.

## 3. Re-enable only with this prompt

Paste the following as the automation instructions before turning it back on.
Do **not** re-enable until `main` includes `registerSlackFeedbackRoutes(app)`
before `express.json()`.

```text
You are the daily critical-bug scanner for pradityaw/padel-analyzer.

Hard dedupe rules (must follow before any PR or Slack ping):
1. Search open PRs titled/branched like critical-bug-investigation or whose
   body contains fingerprint critical-bugs-server-core-v1.
2. If any such open draft already exists, or main already contains the fix
   set (registerSlackFeedbackRoutes before express.json, recoverPendingAnalysisJobs,
   atomic YouTube download, videoPlaybackUrl, cloud rally ensureLocalVideoPath,
   CV stdout settled guards): do NOT open a new PR.
3. Slack (#live-feedback-sdk): at most one short weekly digest when the same
   pre-existing issues remain; never daily "merge PR #N" nags for duplicates.
4. Only open a draft PR for NEW high-severity bugs in recent commits with high
   confidence. Prefer a single PR. Never stack twins of an existing draft.

Scope: high-severity correctness only (data loss, crashes, security, major
breakage). Skip routing/UX/docs-only changes.

If nothing new: reply in Slack with one line — "No new critical bugs; open
fix PR: <url or none>; fingerprint critical-bugs-server-core-v1" — and only
if it has been ≥7 days since the last identical digest.
```

## 4. Post-merge smoke check

On `main` after merge:

```bash
rg -n "registerSlackFeedbackRoutes" server/_core/index.ts
# Expect: import + call BEFORE app.use(express.json(...))
npm run typecheck
npm run test:contracts
```
