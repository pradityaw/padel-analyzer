import { describe, it, expect, vi } from "vitest";
import { SHOT_TYPES, SHOT_TYPE_LABELS } from "@shared/types";
import type { ShotType } from "@shared/types";

describe("SHOT_TYPES labels mapping", () => {
  it("has a label for every shot type", () => {
    for (const type of SHOT_TYPES) {
      expect(SHOT_TYPE_LABELS[type]).toBeDefined();
      expect(typeof SHOT_TYPE_LABELS[type]).toBe("string");
      expect(SHOT_TYPE_LABELS[type].length).toBeGreaterThan(0);
    }
  });

  it("has exactly 8 shot types", () => {
    expect(SHOT_TYPES).toHaveLength(8);
  });

  it("includes all expected padel shot types", () => {
    const expected = [
      "bandeja",
      "vibora",
      "smash",
      "volley",
      "drive",
      "lob",
      "bajada",
      "other",
    ];
    expect([...SHOT_TYPES]).toEqual(expected);
  });
});

describe("softmax (inline test)", () => {
  // Replicate the softmax function from the classifier
  function softmax(logits: Float32Array): Float32Array {
    const max = Math.max(...logits);
    const exps = logits.map((v) => Math.exp(v - max));
    const sum = exps.reduce((a, b) => a + b, 0);
    return exps.map((v) => v / sum) as Float32Array;
  }

  it("sums to 1", () => {
    const logits = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const probs = softmax(logits);
    const sum = probs.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 5);
  });

  it("highest logit gets highest probability", () => {
    const logits = new Float32Array([1, 5, 2, 0, 0, 0, 0, 0]);
    const probs = softmax(logits);
    let bestIdx = 0;
    for (let i = 1; i < probs.length; i++) {
      if (probs[i] > probs[bestIdx]) bestIdx = i;
    }
    expect(bestIdx).toBe(1); // index of logit 5
  });

  it("equal logits give uniform distribution", () => {
    const logits = new Float32Array([3, 3, 3, 3]);
    const probs = softmax(logits);
    for (const p of probs) {
      expect(p).toBeCloseTo(0.25, 5);
    }
  });

  it("handles negative logits", () => {
    const logits = new Float32Array([-10, -5, 0, 5]);
    const probs = softmax(logits);
    const sum = probs.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 5);
    // Each subsequent logit should have higher probability
    for (let i = 1; i < probs.length; i++) {
      expect(probs[i]).toBeGreaterThan(probs[i - 1]);
    }
  });
});

describe("shot type index mapping", () => {
  it("SHOT_TYPES indices match expected classifier output mapping", () => {
    // The classifier outputs logits where index i maps to SHOT_TYPES[i]
    // This test ensures the ordering hasn't drifted
    expect(SHOT_TYPES[0]).toBe("bandeja");
    expect(SHOT_TYPES[1]).toBe("vibora");
    expect(SHOT_TYPES[2]).toBe("smash");
    expect(SHOT_TYPES[3]).toBe("volley");
    expect(SHOT_TYPES[4]).toBe("drive");
    expect(SHOT_TYPES[5]).toBe("lob");
    expect(SHOT_TYPES[6]).toBe("bajada");
    expect(SHOT_TYPES[7]).toBe("other");
  });
});

describe("isModelAvailable", () => {
  it("returns false when fetch fails", async () => {
    // Mock fetch to simulate model not available
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("not found"));

    // Dynamically import to test
    const { isModelAvailable } = await import("./shotClassifier");
    const available = await isModelAvailable();
    expect(available).toBe(false);

    globalThis.fetch = originalFetch;
  });
});
