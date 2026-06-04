/** Mirrors shared/types RECORD_MODES — mobile does not import shared/. */

import AsyncStorage from "@react-native-async-storage/async-storage";

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

const LAST_MODE_KEY = "@padel/last-record-mode/v1";

export function recordModeLabel(mode: string | null | undefined): string | null {
  if (!mode || !isRecordMode(mode)) return null;
  return RECORD_MODE_LABELS[mode];
}

export async function loadLastRecordMode(): Promise<RecordMode> {
  try {
    const raw = await AsyncStorage.getItem(LAST_MODE_KEY);
    if (raw && isRecordMode(raw)) return raw;
  } catch {
    /* ignore */
  }
  return "rally";
}

export async function saveLastRecordMode(mode: RecordMode): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_MODE_KEY, mode);
  } catch {
    /* non-critical — must not block upload or navigation */
  }
}
