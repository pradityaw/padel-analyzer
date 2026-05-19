/**
 * Skip Slack messages that are unlikely to produce useful PRs.
 * Used at collect time and again at triage (for legacy inbox rows).
 */

const SLASH_COMMAND = /^\/[a-z][a-z0-9_-]*/i;
const INVITE = /^\/invite\b/i;
const TRIVIAL =
  /^(hi|hello|hey|thanks|thank you|thx|ok|okay|yes|no|test|lgtm|done)[\s!.?]*$/i;

/** @param {string | undefined | null} text */
function normalizeSlackText(text) {
  return String(text ?? "")
    .trim()
    .replace(/^`+|`+$/g, "")
    .trim();
}

/** @param {string | undefined | null} text */
export function isSkippableSlackFeedback(text, hasMedia = false) {
  const t = normalizeSlackText(text);
  if (!t && !hasMedia) return true;
  if (!t && hasMedia) return false;

  if (INVITE.test(t)) return true;
  if (SLASH_COMMAND.test(t) && t.length < 120) {
    const looksLikeBug =
      /\b(bug|broken|error|crash|fix|upload|analyze|button|disabled|safari|chrome|ios|android)\b/i.test(
        t
      );
    if (!looksLikeBug) return true;
  }
  if (t.length < 12 && !hasMedia) return true;
  if (TRIVIAL.test(t)) return true;

  return false;
}

/** @param {{ text?: string; media?: unknown[] }} record */
export function shouldSkipSlackRecord(record) {
  const hasMedia = Array.isArray(record?.media) && record.media.length > 0;
  return isSkippableSlackFeedback(record?.text, hasMedia);
}
