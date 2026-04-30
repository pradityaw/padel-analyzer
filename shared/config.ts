/**
 * Central configuration for all padel analysis constants.
 *
 * Every hardcoded threshold, limit, and scoring parameter lives here.
 * Both server and client import from this single source of truth.
 */

import type { SwingPhaseType } from "./types";

// ── Swing phases ────────────────────────────────────────────────────────────

/** Canonical iteration and display order (matches pipeline phase segmentation). */
export const PHASE_ORDER: readonly SwingPhaseType[] = [
  "ready",
  "backswing",
  "forwardSwing",
  "contact",
  "followThrough",
];

// ── Video pipeline ──────────────────────────────────────────────────────────

export const SAMPLE_FPS = 15;

export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500 MB
export const MAX_UPLOAD_MB = MAX_UPLOAD_BYTES / (1024 * 1024);

export const YOUTUBE_MAX_DURATION_SEC = 300; // 5 minutes

// ── ML thresholds ───────────────────────────────────────────────────────────

export const SHOT_CONFIDENCE_THRESHOLD = 0.3;

export const POSE_MIN_DETECTION_CONFIDENCE = 0.5;
export const POSE_MIN_TRACKING_CONFIDENCE = 0.5;

/** Wrist velocity must exceed this fraction of peak to count as "active". */
export const VELOCITY_THRESHOLD_RATIO = 0.15;

/** Contact zone half-width in frames around peak wrist velocity. */
export const CONTACT_ZONE_FRAMES = 3;

/** Minimum frames required to attempt phase detection. */
export const MIN_FRAMES_FOR_PHASES = 10;

// ── ONNX classifier ────────────────────────────────────────────────────────

export const ONNX_MAX_FRAMES = 64;
export const NUM_LANDMARKS = 33;
export const LANDMARK_DIMS = 4;

// ── Scoring ranges ──────────────────────────────────────────────────────────

export type MetricRange = { range: [number, number]; weight: number };

export const GENERIC_RANGES: Record<
  SwingPhaseType,
  Record<string, MetricRange>
> = {
  ready: {
    kneeFlex: { range: [150, 170], weight: 0.4 },
    spineAngle: { range: [0, 15], weight: 0.3 },
    shoulderRotation: { range: [0, 20], weight: 0.3 },
  },
  backswing: {
    shoulderRotation: { range: [30, 60], weight: 0.4 },
    hipRotation: { range: [15, 35], weight: 0.3 },
    elbowAngle: { range: [70, 110], weight: 0.3 },
  },
  forwardSwing: {
    shoulderRotation: { range: [20, 50], weight: 0.35 },
    hipRotation: { range: [25, 50], weight: 0.35 },
    elbowAngle: { range: [90, 140], weight: 0.3 },
  },
  contact: {
    elbowAngle: { range: [140, 165], weight: 0.3 },
    shoulderRotation: { range: [40, 60], weight: 0.25 },
    hipRotation: { range: [35, 55], weight: 0.2 },
    kneeFlex: { range: [150, 170], weight: 0.15 },
    spineAngle: { range: [0, 15], weight: 0.1 },
  },
  followThrough: {
    shoulderRotation: { range: [50, 80], weight: 0.4 },
    elbowAngle: { range: [100, 160], weight: 0.3 },
    spineAngle: { range: [0, 20], weight: 0.3 },
  },
};

/**
 * Derived metric weights per phase — extracted from GENERIC_RANGES so that
 * gap analysis, scoring, and feedback all use the same weights.
 */
export const METRIC_WEIGHTS: Record<SwingPhaseType, Record<string, number>> =
  Object.fromEntries(
    Object.entries(GENERIC_RANGES).map(([phase, metrics]) => [
      phase,
      Object.fromEntries(
        Object.entries(metrics).map(([key, { weight }]) => [key, weight])
      ),
    ])
  ) as Record<SwingPhaseType, Record<string, number>>;

/**
 * Range spans for gap-analysis normalization.
 * A 20deg gap in elbow angle (span 50) is less alarming than
 * 20deg in spine angle (span 20).
 */
export const METRIC_RANGE_SPANS: Record<string, number> = {
  shoulderRotation: 40,
  hipRotation: 30,
  elbowAngle: 50,
  kneeFlex: 30,
  spineAngle: 20,
  wristVelocity: 0.5,
};

// ── Feedback status thresholds ──────────────────────────────────────────────

export const SCORE_GOOD_THRESHOLD = 80;
export const SCORE_IMPROVE_THRESHOLD = 50;

export const GAP_GOOD_THRESHOLD = 0.25;
export const GAP_IMPROVE_THRESHOLD = 0.6;

// ── MediaPipe landmark indices ──────────────────────────────────────────────

export const LM = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
} as const;
