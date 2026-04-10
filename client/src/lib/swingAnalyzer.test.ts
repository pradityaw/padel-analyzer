import { describe, it, expect } from "vitest";
import { detectDominantSide, extractMetrics, detectPhases, getMetricFeedback } from "./swingAnalyzer";
import type { Landmark, FrameLandmarks, PhaseMetrics } from "@shared/types";

// Helpers to generate synthetic landmark data

function makeLandmark(x = 0, y = 0, z = 0, visibility = 1): Landmark {
  return { x, y, z, visibility };
}

/** Creates a 33-landmark array with key joints positioned */
function makeLandmarks(overrides: Partial<Record<number, Landmark>> = {}): Landmark[] {
  const landmarks: Landmark[] = Array.from({ length: 33 }, () =>
    makeLandmark(0.5, 0.5)
  );

  // Set reasonable defaults for key joints
  // Shoulders
  landmarks[11] = makeLandmark(0.4, 0.3); // LEFT_SHOULDER
  landmarks[12] = makeLandmark(0.6, 0.3); // RIGHT_SHOULDER
  // Elbows
  landmarks[13] = makeLandmark(0.35, 0.45); // LEFT_ELBOW
  landmarks[14] = makeLandmark(0.65, 0.45); // RIGHT_ELBOW
  // Wrists
  landmarks[15] = makeLandmark(0.3, 0.55); // LEFT_WRIST
  landmarks[16] = makeLandmark(0.7, 0.55); // RIGHT_WRIST
  // Hips
  landmarks[23] = makeLandmark(0.45, 0.6); // LEFT_HIP
  landmarks[24] = makeLandmark(0.55, 0.6); // RIGHT_HIP
  // Knees
  landmarks[25] = makeLandmark(0.45, 0.75); // LEFT_KNEE
  landmarks[26] = makeLandmark(0.55, 0.75); // RIGHT_KNEE
  // Ankles
  landmarks[27] = makeLandmark(0.45, 0.9); // LEFT_ANKLE
  landmarks[28] = makeLandmark(0.55, 0.9); // RIGHT_ANKLE

  for (const [idx, lm] of Object.entries(overrides)) {
    if (lm) landmarks[Number(idx)] = lm;
  }
  return landmarks;
}

function makeFrame(
  frameIndex: number,
  timestamp: number,
  overrides?: Partial<Record<number, Landmark>>
): FrameLandmarks {
  return { frameIndex, timestamp, landmarks: makeLandmarks(overrides) };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("detectDominantSide", () => {
  it("returns right when right wrist has more movement", () => {
    const frames: FrameLandmarks[] = [
      makeFrame(0, 0),
      makeFrame(1, 100, {
        16: makeLandmark(0.9, 0.55), // RIGHT_WRIST moved significantly
        15: makeLandmark(0.31, 0.55), // LEFT_WRIST barely moved
      }),
    ];
    expect(detectDominantSide(frames)).toBe("right");
  });

  it("returns left when left wrist has more movement", () => {
    const frames: FrameLandmarks[] = [
      makeFrame(0, 0),
      makeFrame(1, 100, {
        15: makeLandmark(0.1, 0.55), // LEFT_WRIST moved significantly
        16: makeLandmark(0.71, 0.55), // RIGHT_WRIST barely moved
      }),
    ];
    expect(detectDominantSide(frames)).toBe("left");
  });

  it("defaults to right when movement is equal", () => {
    const frames: FrameLandmarks[] = [makeFrame(0, 0), makeFrame(1, 100)];
    expect(detectDominantSide(frames)).toBe("right");
  });
});

describe("extractMetrics", () => {
  it("returns a PhaseMetrics object with all required fields", () => {
    const landmarks = makeLandmarks();
    const metrics = extractMetrics(landmarks, "right");

    expect(metrics).toHaveProperty("shoulderRotation");
    expect(metrics).toHaveProperty("hipRotation");
    expect(metrics).toHaveProperty("elbowAngle");
    expect(metrics).toHaveProperty("kneeFlex");
    expect(metrics).toHaveProperty("spineAngle");
    expect(metrics).toHaveProperty("wristVelocity");
  });

  it("returns zero wrist velocity without previous frame", () => {
    const landmarks = makeLandmarks();
    const metrics = extractMetrics(landmarks, "right");
    expect(metrics.wristVelocity).toBe(0);
  });

  it("returns nonzero wrist velocity with previous frame and dt", () => {
    const prev = makeLandmarks();
    const curr = makeLandmarks({
      16: makeLandmark(0.9, 0.55), // move right wrist
    });
    const metrics = extractMetrics(curr, "right", prev, 0.1);
    expect(metrics.wristVelocity).toBeGreaterThan(0);
  });

  it("uses left-side joints when dominant is left", () => {
    const landmarks = makeLandmarks({
      13: makeLandmark(0.2, 0.4), // left elbow in unusual spot
    });
    const metricsLeft = extractMetrics(landmarks, "left");
    const metricsRight = extractMetrics(landmarks, "right");
    // Elbow angle should differ since we moved the left elbow
    expect(metricsLeft.elbowAngle).not.toBeCloseTo(metricsRight.elbowAngle, 0);
  });
});

describe("detectPhases", () => {
  it("returns empty for fewer than 10 frames", () => {
    const frames = Array.from({ length: 5 }, (_, i) => makeFrame(i, i * 100));
    expect(detectPhases(frames, "right")).toEqual([]);
  });

  it("returns 5 phases for valid input", () => {
    // Create a sequence that simulates a swing with velocity peak
    const frames: FrameLandmarks[] = [];
    for (let i = 0; i < 30; i++) {
      // Move right wrist to create velocity pattern:
      // slow -> fast -> peak at frame 15 -> decelerate
      const speed = Math.max(0, 1 - Math.abs(i - 15) / 15);
      const wristX = 0.7 + speed * 0.3 * (i < 15 ? 1 : -1);
      frames.push(
        makeFrame(i, i * 66, {
          16: makeLandmark(wristX, 0.55 - speed * 0.2),
        })
      );
    }

    const phases = detectPhases(frames, "right");
    expect(phases).toHaveLength(5);
    expect(phases.map((p) => p.type)).toEqual([
      "ready",
      "backswing",
      "forwardSwing",
      "contact",
      "followThrough",
    ]);
  });

  it("assigns numeric scores to each phase", () => {
    const frames: FrameLandmarks[] = [];
    for (let i = 0; i < 30; i++) {
      const speed = Math.max(0, 1 - Math.abs(i - 15) / 15);
      frames.push(
        makeFrame(i, i * 66, {
          16: makeLandmark(0.7 + speed * 0.3, 0.55 - speed * 0.2),
        })
      );
    }

    const phases = detectPhases(frames, "right");
    for (const phase of phases) {
      expect(typeof phase.score).toBe("number");
      expect(phase.score).toBeGreaterThanOrEqual(0);
      expect(phase.score).toBeLessThanOrEqual(100);
    }
  });
});

describe("getMetricFeedback", () => {
  it("returns feedback array for a phase", () => {
    const metrics: PhaseMetrics = {
      shoulderRotation: 45,
      hipRotation: 30,
      elbowAngle: 150,
      kneeFlex: 160,
      spineAngle: 10,
      wristVelocity: 2,
    };
    const feedback = getMetricFeedback("contact", metrics);
    expect(feedback.length).toBeGreaterThan(0);
    for (const fb of feedback) {
      expect(fb).toHaveProperty("name");
      expect(fb).toHaveProperty("value");
      expect(fb).toHaveProperty("status");
      expect(fb).toHaveProperty("tip");
      expect(["good", "improve", "issue"]).toContain(fb.status);
    }
  });

  it("marks values within ideal range as good", () => {
    // contact phase: elbowAngle ideal is [140, 165]
    const metrics: PhaseMetrics = {
      shoulderRotation: 50,
      hipRotation: 45,
      elbowAngle: 150,
      kneeFlex: 160,
      spineAngle: 5,
      wristVelocity: 2,
    };
    const feedback = getMetricFeedback("contact", metrics);
    const elbowFb = feedback.find((f) => f.name === "Elbow Angle");
    expect(elbowFb?.status).toBe("good");
  });

  it("marks values far outside ideal range as issue", () => {
    const metrics: PhaseMetrics = {
      shoulderRotation: 50,
      hipRotation: 45,
      elbowAngle: 30, // way below 140-165 range
      kneeFlex: 160,
      spineAngle: 5,
      wristVelocity: 2,
    };
    const feedback = getMetricFeedback("contact", metrics);
    const elbowFb = feedback.find((f) => f.name === "Elbow Angle");
    expect(elbowFb?.status).toBe("issue");
  });
});
