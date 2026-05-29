/**
 * Tiny seeded PRNG (mulberry32). Deterministic and dependency-free so the
 * server and any other host produce identical sequences from the same seed.
 *
 * The authoritative simulation does NOT use this inside `stepWorld` (the step
 * is fully deterministic without randomness). It is available for world
 * creation (e.g. spawn jitter) and for non-authoritative client-side bot AI.
 */

export interface Rng {
  /** Next float in [0, 1). */
  next(): number;
  /** Next float in [min, max). */
  range(min: number, max: number): number;
  /** Next integer in [min, max] inclusive. */
  int(min: number, max: number): number;
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
  };
}
