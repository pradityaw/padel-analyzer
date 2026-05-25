import type { APIRequestContext } from "@playwright/test";

export type SeedAnalysisOptions = {
  videoFileName?: string;
  overallScore?: number;
  shotType?: string;
  shotConfidence?: number;
};

/**
 * Seeds a synthetic analysis row via the tRPC HTTP endpoint and returns its id.
 *
 * The fixture creates a minimal but valid analysis: 5 swing phases (one per type)
 * each with a full PhaseMetrics block, plus a small set of frame landmark stubs.
 * Video playback won't work (the storage key references nothing), but the
 * Analysis page UI should render fully — score card, shot badge, coaching
 * tips, phase timeline, metrics panel, and the "Next steps" actions.
 */
export async function seedAnalysis(
  request: APIRequestContext,
  options: SeedAnalysisOptions = {}
): Promise<number> {
  const phases = [
    {
      type: "ready",
      startFrame: 0,
      endFrame: 5,
      score: 80,
      metrics: {
        shoulderRotation: 30,
        hipRotation: 20,
        elbowAngle: 90,
        kneeFlex: 25,
        spineAngle: 10,
        wristVelocity: 1,
      },
    },
    {
      type: "backswing",
      startFrame: 6,
      endFrame: 12,
      score: 75,
      metrics: {
        shoulderRotation: 80,
        hipRotation: 45,
        elbowAngle: 100,
        kneeFlex: 35,
        spineAngle: 15,
        wristVelocity: 5,
      },
    },
    {
      type: "forwardSwing",
      startFrame: 13,
      endFrame: 18,
      score: 70,
      metrics: {
        shoulderRotation: 90,
        hipRotation: 60,
        elbowAngle: 130,
        kneeFlex: 30,
        spineAngle: 12,
        wristVelocity: 18,
      },
    },
    {
      type: "contact",
      startFrame: 19,
      endFrame: 21,
      score: 85,
      metrics: {
        shoulderRotation: 100,
        hipRotation: 65,
        elbowAngle: 165,
        kneeFlex: 28,
        spineAngle: 10,
        wristVelocity: 22,
      },
    },
    {
      type: "followThrough",
      startFrame: 22,
      endFrame: 30,
      score: 78,
      metrics: {
        shoulderRotation: 110,
        hipRotation: 70,
        elbowAngle: 150,
        kneeFlex: 32,
        spineAngle: 14,
        wristVelocity: 8,
      },
    },
  ];

  // Three landmark frames are enough for the timeline + metrics to render.
  const stubLandmarks = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 1,
  }));
  const frames = [0, 15, 30].map((frameIndex) => ({
    frameIndex,
    timestamp: frameIndex * (1000 / 30),
    landmarks: stubLandmarks,
  }));

  const input = {
    videoFileName: options.videoFileName ?? `e2e-fixture-${Date.now()}.mp4`,
    videoStorageKey: "e2e-fixture-missing.mp4",
    overallScore: options.overallScore ?? 76,
    dominantSide: "right" as const,
    durationMs: 1000,
    frameCount: 31,
    sampleFps: 30,
    phasesJson: JSON.stringify(phases),
    landmarksJson: JSON.stringify(frames),
    cameraAngle: "backCourtWide",
    captureMetadataJson: JSON.stringify({
      cameraAngle: "backCourtWide",
      referenceStandard: "padelableBackCourtWideV1",
      cameraHeight: "elevated",
      framing: "fullCourt",
      stability: "fixed",
      orientation: "landscape",
    }),
    shotType: options.shotType ?? "drive",
    shotConfidence: options.shotConfidence ?? 0.92,
  };

  // tRPC httpBatchLink format with superjson transformer.
  const response = await request.post("/api/trpc/analysis.create?batch=1", {
    data: { "0": { json: input } },
    headers: { "content-type": "application/json" },
  });
  if (!response.ok()) {
    throw new Error(
      `seedAnalysis: tRPC create returned ${response.status()} — ${await response.text()}`
    );
  }
  const body = (await response.json()) as Array<{
    result?: { data?: { json?: { id: number } } };
    error?: unknown;
  }>;
  const id = body?.[0]?.result?.data?.json?.id;
  if (typeof id !== "number") {
    throw new Error(
      `seedAnalysis: could not extract id from response: ${JSON.stringify(body)}`
    );
  }
  return id;
}

export async function deleteAnalysis(
  request: APIRequestContext,
  id: number
): Promise<void> {
  // Best-effort cleanup; we don't fail the test if the row is already gone.
  await request.post("/api/trpc/analysis.delete?batch=1", {
    data: { "0": { json: { id } } },
    headers: { "content-type": "application/json" },
  });
}
