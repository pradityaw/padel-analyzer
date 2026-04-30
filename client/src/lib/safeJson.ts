/**
 * Client-side JSON parsing with graceful fallbacks (no throws from corrupt DB strings).
 */

export type ParseResult<T> = { ok: true; value: T } | { ok: false };

export function tryParseJson<T>(raw: string): ParseResult<T> {
  try {
    return { ok: true, value: JSON.parse(raw) as T };
  } catch {
    return { ok: false };
  }
}

export function parseJsonArray<T>(raw: string, fallback: T[] = []): T[] {
  const r = tryParseJson<T[]>(raw);
  if (!r.ok || !Array.isArray(r.value)) return fallback;
  return r.value;
}
