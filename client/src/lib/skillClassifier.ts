import type { QualityBand, ShotType, SwingPhase } from "@shared/types";
import { QUALITY_BANDS, SHOT_TYPES } from "@shared/types";
import { PHASE_ORDER } from "@shared/config";
const METRIC_ORDER = [
  "shoulderRotation",
  "hipRotation",
  "elbowAngle",
  "kneeFlex",
  "spineAngle",
  "wristVelocity",
] as const;
const SKILL_INPUT_DIM = PHASE_ORDER.length * METRIC_ORDER.length + SHOT_TYPES.length;

let sessionPromise: Promise<any> | null = null;

async function getSession() {
  if (sessionPromise) return sessionPromise;

  sessionPromise = (async () => {
    const ort = await import("onnxruntime-web");
    ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/";
    const session = await ort.InferenceSession.create("/models/skill_classifier.onnx");
    return { ort, session };
  })();

  return sessionPromise;
}

function softmax(logits: Float32Array): Float32Array {
  const max = Math.max(...logits);
  const exps = logits.map((value) => Math.exp(value - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((value) => value / sum) as Float32Array;
}

function buildFeatureVector(phases: SwingPhase[], shotType: ShotType): Float32Array {
  const phasesByType = new Map(phases.map((phase) => [phase.type, phase]));
  const result = new Float32Array(SKILL_INPUT_DIM);

  let cursor = 0;
  for (const phaseType of PHASE_ORDER) {
    const phase = phasesByType.get(phaseType);
    for (const metric of METRIC_ORDER) {
      result[cursor] = phase?.metrics[metric] ?? 0;
      cursor += 1;
    }
  }

  const shotIdx = SHOT_TYPES.indexOf(shotType);
  if (shotIdx >= 0) {
    result[cursor + shotIdx] = 1;
  }

  return result;
}

export type SkillClassificationResult = {
  skillLabel: QualityBand;
  confidence: number;
  qualityScore: number;
  allProbabilities: Record<QualityBand, number>;
};

export async function classifySkillBand(
  phases: SwingPhase[],
  shotType: ShotType
): Promise<SkillClassificationResult | null> {
  try {
    const { ort, session } = await getSession();
    const features = buildFeatureVector(phases, shotType);
    const tensor = new ort.Tensor("float32", features, [1, SKILL_INPUT_DIM]);
    const results = await session.run({ features: tensor });
    const logits = results.logits.data as Float32Array;
    const probabilities = softmax(logits);

    let bestIdx = 0;
    let bestProb = probabilities[0];
    let expectedScore = 0;
    const bandScores = [25, 50, 75, 100];

    const allProbabilities = {} as Record<QualityBand, number>;
    for (let i = 0; i < QUALITY_BANDS.length; i++) {
      const band = QUALITY_BANDS[i];
      const prob = probabilities[i];
      allProbabilities[band] = Math.round(prob * 1000) / 1000;
      expectedScore += prob * bandScores[i];
      if (prob > bestProb) {
        bestProb = prob;
        bestIdx = i;
      }
    }

    return {
      skillLabel: QUALITY_BANDS[bestIdx],
      confidence: Math.round(bestProb * 1000) / 1000,
      qualityScore: Math.round(expectedScore),
      allProbabilities,
    };
  } catch (error) {
    console.warn("[pipeline] Skill classification unavailable:", error);
    return null;
  }
}

export async function isSkillModelAvailable(): Promise<boolean> {
  try {
    const response = await fetch("/models/skill_classifier.onnx", { method: "HEAD" });
    return response.ok;
  } catch {
    return false;
  }
}
