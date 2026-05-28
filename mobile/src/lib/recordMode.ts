/** Mirrors shared/types RECORD_MODES — mobile does not import shared/. */

export const RECORD_MODES = [
  "match",
  "rally",
  "serve_practice",
  "drill",
] as const;

export type RecordMode = (typeof RECORD_MODES)[number];

export const RECORD_MODE_LABELS: Record<RecordMode, string> = {
  match: "Match",
  rally: "Rally",
  serve_practice: "Serve practice",
  drill: "Drill",
};

export const RECORD_MODE_HINTS: Record<RecordMode, string> = {
  match: "Full match clip — rally trim enabled.",
  rally: "Rally practice — dead time trimmed.",
  serve_practice: "Serve reps — full clip analyzed.",
  drill: "Target drills — full clip analyzed.",
};

export function isRecordMode(value: string): value is RecordMode {
  return (RECORD_MODES as readonly string[]).includes(value);
}
