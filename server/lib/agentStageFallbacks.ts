type JsonRecord = Record<string, unknown>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown stage failure.";
}

export function isAgentStageSoftFailure(payload: unknown): boolean {
  if (typeof payload !== "object" || payload == null) return false;
  const summary = (payload as { summary?: JsonRecord }).summary;
  return summary?.reason === "stage_failed";
}

export function courtCalibrationFallback(error: unknown) {
  return {
    agent: "courtCalibration",
    court: {
      grid_width: 10,
      grid_height: 20,
      homography: null,
      source_points: [],
      destination_points: [],
      confidence: 0,
    },
    summary: {
      confidence: 0,
      has_homography: false,
      reason: "stage_failed",
      error_message: errorMessage(error),
    },
  };
}

export function ballTrajectoryFallback(error: unknown) {
  return {
    agent: "ballTrajectory",
    court: null,
    ball_track: [],
    shots: [],
    summary: {
      frames_processed: 0,
      track_points: 0,
      shot_count: 0,
      backend: "unavailable",
      reason: "stage_failed",
      error_message: errorMessage(error),
    },
  };
}
