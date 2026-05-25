import { useCallback, useEffect, useRef, useState } from "react";
import type { FrameLandmarks } from "@shared/types";
import type { FrameSyncIndex } from "@/lib/frameSync";
import { MIN_BALL_SPEED_CONFIDENCE } from "@/lib/ballTracking";
import {
  calculateSpeedKmhBetweenPixels,
  type HomographyMatrix,
  type Point2D,
} from "@/lib/courtCalibration";

export type PlaybackSpeedDisplay = {
  ballKmh: number | null;
  racketKmh: number | null;
};

type DominantSide = "left" | "right";

type TrackedPoint = {
  frameIndex: number;
  point: Point2D;
};

type UsePlaybackSpeedsOptions = {
  homography: HomographyMatrix | null;
  fps: number;
  dimensions: { w: number; h: number };
  dominantSide?: DominantSide;
  /** Optional normalized ball x,y pairs aligned to the frame array. */
  ballPositions?: Float32Array;
  /** Per-frame ball confidence aligned to the frame array (from CV tracker). */
  ballConfidences?: Float32Array;
  /**
   * Optional normalized racket-head x,y pairs aligned to the frame
   * array (Phase 2 server-side tracker). When provided the speed
   * calculator uses these instead of the wrist landmark; when
   * undefined (older sessions) the calculator falls back to the
   * dominant wrist position as a racket proxy.
   */
  racketPositions?: Float32Array;
  smoothingWindow?: number;
  displayThrottleMs?: number;
};

export type RacketSpeedSource = "racket-tracker" | "wrist-proxy" | "none";

const LEFT_WRIST_LANDMARK = 15;
const RIGHT_WRIST_LANDMARK = 16;
const MIN_WRIST_VISIBILITY = 0.3;
const DEFAULT_SMOOTHING_WINDOW = 4;
const DEFAULT_DISPLAY_THROTTLE_MS = 125;
const MAX_TRACK_GAP_FRAMES = 5;

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pushRollingAverage(
  values: number[],
  value: number,
  maxLength: number
): number | null {
  values.push(value);
  while (values.length > maxLength) values.shift();
  return average(values);
}

function roundedDisplayValue(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.round(value));
}

function formatComparable(display: PlaybackSpeedDisplay): string {
  return `${display.ballKmh ?? "--"}:${display.racketKmh ?? "--"}`;
}

function getPackedPoint(
  positions: Float32Array | undefined,
  arrayIdx: number,
  dimensions: { w: number; h: number }
): Point2D | null {
  if (!positions || arrayIdx < 0 || positions.length < (arrayIdx + 1) * 2) {
    return null;
  }

  const x = positions[arrayIdx * 2]!;
  const y = positions[arrayIdx * 2 + 1]!;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  return {
    x: x * dimensions.w,
    y: y * dimensions.h,
  };
}

function getBallPoint(
  ballPositions: Float32Array | undefined,
  ballConfidences: Float32Array | undefined,
  arrayIdx: number,
  dimensions: { w: number; h: number }
): Point2D | null {
  const point = getPackedPoint(ballPositions, arrayIdx, dimensions);
  if (!point) return null;
  if (ballConfidences && arrayIdx >= 0 && arrayIdx < ballConfidences.length) {
    const confidence = ballConfidences[arrayIdx]!;
    if (
      !Number.isFinite(confidence) ||
      confidence < MIN_BALL_SPEED_CONFIDENCE
    ) {
      return null;
    }
  }
  return point;
}

function getDominantWristPoint(
  frame: FrameLandmarks,
  dimensions: { w: number; h: number },
  dominantSide: DominantSide
): Point2D | null {
  // Used only as a fallback when the server-side racket tracker has no
  // sample for this frame (older sessions, or low-confidence anchors).
  const wristIndex =
    dominantSide === "left" ? LEFT_WRIST_LANDMARK : RIGHT_WRIST_LANDMARK;
  const wrist = frame.landmarks[wristIndex];
  if (!wrist || wrist.visibility < MIN_WRIST_VISIBILITY) return null;
  if (!Number.isFinite(wrist.x) || !Number.isFinite(wrist.y)) return null;

  return {
    x: wrist.x * dimensions.w,
    y: wrist.y * dimensions.h,
  };
}

function getRacketHeadPoint(
  racketPositions: Float32Array | undefined,
  arrayIdx: number,
  dimensions: { w: number; h: number }
): Point2D | null {
  return getPackedPoint(racketPositions, arrayIdx, dimensions);
}

function calculateTrackedSpeedKmh(
  previous: TrackedPoint | null,
  current: TrackedPoint,
  fps: number,
  homography: HomographyMatrix
): number | null {
  if (!previous) return null;
  const frameDelta = current.frameIndex - previous.frameIndex;
  if (
    !Number.isFinite(frameDelta) ||
    frameDelta <= 0 ||
    frameDelta > MAX_TRACK_GAP_FRAMES
  ) {
    return null;
  }
  return calculateSpeedKmhBetweenPixels(
    previous.point,
    current.point,
    fps,
    homography,
    frameDelta
  );
}

export function usePlaybackSpeeds({
  homography,
  fps,
  dimensions,
  dominantSide = "right",
  ballPositions,
  ballConfidences,
  racketPositions,
  smoothingWindow = DEFAULT_SMOOTHING_WINDOW,
  displayThrottleMs = DEFAULT_DISPLAY_THROTTLE_MS,
}: UsePlaybackSpeedsOptions) {
  const [display, setDisplay] = useState<PlaybackSpeedDisplay>({
    ballKmh: null,
    racketKmh: null,
  });
  const [racketSpeedSource, setRacketSpeedSource] =
    useState<RacketSpeedSource>("none");

  const optionsRef = useRef({
    homography,
    fps,
    dimensions,
    dominantSide,
    ballPositions,
    ballConfidences,
    racketPositions,
    smoothingWindow,
    displayThrottleMs,
  });
  optionsRef.current = {
    homography,
    fps,
    dimensions,
    dominantSide,
    ballPositions,
    ballConfidences,
    racketPositions,
    smoothingWindow,
    displayThrottleMs,
  };

  const previousBallRef = useRef<TrackedPoint | null>(null);
  const previousRacketRef = useRef<TrackedPoint | null>(null);
  const ballWindowRef = useRef<number[]>([]);
  const racketWindowRef = useRef<number[]>([]);
  const latestDisplayRef = useRef<PlaybackSpeedDisplay>({
    ballKmh: null,
    racketKmh: null,
  });
  const lastDisplayKeyRef = useRef(formatComparable(latestDisplayRef.current));
  const lastDisplayUpdateRef = useRef(0);

  const publishDisplay = useCallback((next: PlaybackSpeedDisplay, force = false) => {
    const rounded = {
      ballKmh: roundedDisplayValue(next.ballKmh),
      racketKmh: roundedDisplayValue(next.racketKmh),
    };
    latestDisplayRef.current = rounded;

    const nextKey = formatComparable(rounded);
    if (nextKey === lastDisplayKeyRef.current) return;

    const now = performance.now();
    if (!force && now - lastDisplayUpdateRef.current < optionsRef.current.displayThrottleMs) {
      return;
    }

    lastDisplayKeyRef.current = nextKey;
    lastDisplayUpdateRef.current = now;
    setDisplay(rounded);
  }, []);

  const reset = useCallback(() => {
    previousBallRef.current = null;
    previousRacketRef.current = null;
    ballWindowRef.current = [];
    racketWindowRef.current = [];
    publishDisplay({ ballKmh: null, racketKmh: null }, true);
  }, [publishDisplay]);

  useEffect(() => {
    reset();
  }, [
    ballPositions,
    ballConfidences,
    racketPositions,
    dimensions.h,
    dimensions.w,
    fps,
    homography,
    reset,
  ]);

  const processFrame = useCallback(
    (arrayIdx: number, sync: FrameSyncIndex) => {
      const frame = sync.frames[arrayIdx];
      const {
        homography: currentHomography,
        fps: currentFps,
        dimensions: currentDimensions,
        dominantSide: currentDominantSide,
        ballPositions: currentBallPositions,
        ballConfidences: currentBallConfidences,
        racketPositions: currentRacketPositions,
        smoothingWindow: currentSmoothingWindow,
      } = optionsRef.current;

      if (!frame || !currentHomography || currentFps <= 0) {
        reset();
        return;
      }

      let nextBallKmh = latestDisplayRef.current.ballKmh;
      const ballPoint = getBallPoint(
        currentBallPositions,
        currentBallConfidences,
        arrayIdx,
        currentDimensions
      );
      if (ballPoint) {
        const currentBall = { frameIndex: frame.frameIndex, point: ballPoint };
        const ballSpeed = calculateTrackedSpeedKmh(
          previousBallRef.current,
          currentBall,
          currentFps,
          currentHomography
        );
        previousBallRef.current = currentBall;
        if (ballSpeed != null) {
          nextBallKmh = pushRollingAverage(
            ballWindowRef.current,
            ballSpeed,
            currentSmoothingWindow
          );
        }
      } else {
        previousBallRef.current = null;
        ballWindowRef.current = [];
        nextBallKmh = null;
      }

      // Prefer the server-side racket-head sample when present; fall
      // back to the dominant wrist proxy for older sessions that don't
      // yet have the new artifact.
      let nextRacketKmh = latestDisplayRef.current.racketKmh;
      let nextRacketSource: RacketSpeedSource = "none";
      const trackedRacketPoint = getRacketHeadPoint(
        currentRacketPositions,
        arrayIdx,
        currentDimensions
      );
      const racketPoint =
        trackedRacketPoint ??
        getDominantWristPoint(frame, currentDimensions, currentDominantSide);

      if (racketPoint) {
        nextRacketSource = trackedRacketPoint ? "racket-tracker" : "wrist-proxy";
        const currentRacket = {
          frameIndex: frame.frameIndex,
          point: racketPoint,
        };
        const racketSpeed = calculateTrackedSpeedKmh(
          previousRacketRef.current,
          currentRacket,
          currentFps,
          currentHomography
        );
        previousRacketRef.current = currentRacket;
        if (racketSpeed != null) {
          nextRacketKmh = pushRollingAverage(
            racketWindowRef.current,
            racketSpeed,
            currentSmoothingWindow
          );
        }
      } else {
        previousRacketRef.current = null;
        racketWindowRef.current = [];
        nextRacketKmh = null;
      }

      publishDisplay({
        ballKmh: nextBallKmh,
        racketKmh: nextRacketKmh,
      });
      setRacketSpeedSource((prev) =>
        prev === nextRacketSource ? prev : nextRacketSource
      );
    },
    [publishDisplay, reset]
  );

  return {
    display,
    racketSpeedSource,
    processFrame,
    reset,
  };
}
