import type { SwingPhase } from "@shared/types";
import { generateDemoSwingFrames } from "@/lib/demoLandmarks";

export const DEMO_ANALYSIS_ID = "demo";

export type DemoAnalysisRow = {
  id: number;
  videoFileName: string;
  videoStorageKey: string | null;
  thumbnailPath: string | null;
  createdAt: string;
  overallScore: number;
  dominantSide: "left" | "right";
  durationMs: number;
  frameCount: number;
  sampleFps: number;
  phasesJson: string;
  landmarksJson: string;
  landmarksPath: string | null;
  poseDetectionRate: number | null;
  cameraAngle: string | null;
  captureMetadataJson: string | null;
  shotType: string | null;
  shotConfidence: number | null;
  skillLabel: string | null;
  skillConfidence: number | null;
  qualityScore: number | null;
  prHighlightsJson: string | null;
};

const DEMO_PHASES: SwingPhase[] = [
  {
    type: "ready",
    startFrame: 0,
    endFrame: 8,
    score: 78,
    metrics: {
      shoulderRotation: 12,
      hipRotation: 8,
      elbowAngle: 145,
      kneeFlex: 22,
      spineAngle: 18,
      wristVelocity: 0.2,
    },
  },
  {
    type: "backswing",
    startFrame: 9,
    endFrame: 20,
    score: 72,
    metrics: {
      shoulderRotation: 42,
      hipRotation: 28,
      elbowAngle: 118,
      kneeFlex: 28,
      spineAngle: 22,
      wristVelocity: 1.1,
    },
  },
  {
    type: "forwardSwing",
    startFrame: 21,
    endFrame: 32,
    score: 81,
    metrics: {
      shoulderRotation: 68,
      hipRotation: 52,
      elbowAngle: 95,
      kneeFlex: 32,
      spineAngle: 20,
      wristVelocity: 4.2,
    },
  },
  {
    type: "contact",
    startFrame: 33,
    endFrame: 36,
    score: 85,
    metrics: {
      shoulderRotation: 72,
      hipRotation: 58,
      elbowAngle: 88,
      kneeFlex: 30,
      spineAngle: 19,
      wristVelocity: 8.5,
    },
  },
  {
    type: "followThrough",
    startFrame: 37,
    endFrame: 47,
    score: 79,
    metrics: {
      shoulderRotation: 55,
      hipRotation: 40,
      elbowAngle: 102,
      kneeFlex: 26,
      spineAngle: 17,
      wristVelocity: 2.8,
    },
  },
];

export function getDemoAnalysisData(): DemoAnalysisRow {
  const frames = generateDemoSwingFrames(48);
  return {
    id: 0,
    videoFileName: "Sample swing (demo)",
    videoStorageKey: null,
    thumbnailPath: null,
    createdAt: new Date().toISOString(),
    overallScore: 79,
    dominantSide: "right",
    durationMs: 3200,
    frameCount: frames.length,
    sampleFps: 15,
    phasesJson: JSON.stringify(DEMO_PHASES),
    landmarksJson: JSON.stringify(frames),
    landmarksPath: null,
    poseDetectionRate: 0.96,
    cameraAngle: "backCourtWide",
    captureMetadataJson: JSON.stringify({
      cameraAngle: "backCourtWide",
      referenceStandard: "padelableBackCourtWideV1",
      cameraHeight: "elevated",
      framing: "fullCourt",
      stability: "fixed",
      orientation: "landscape",
    }),
    shotType: "bandeja",
    shotConfidence: 0.82,
    skillLabel: "intermediate",
    skillConfidence: 0.74,
    qualityScore: 76,
    prHighlightsJson: null,
  };
}

export function isDemoAnalysisId(id: string | undefined): boolean {
  return id === DEMO_ANALYSIS_ID;
}
