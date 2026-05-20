import type { CvPipelineResult, CvStatus } from "../../shared/schema.js";
import { cvPipelineResultSchema, cvStatusSchema } from "../../shared/schema.js";

export type AnalysisCvFields = {
  cvStatus: CvStatus | null;
  cvResult: CvPipelineResult | null;
};

export function parseCvStatus(value: string | null | undefined): CvStatus | null {
  if (value == null) return null;
  const parsed = cvStatusSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseCvPipelineResult(
  json: string | null | undefined
): CvPipelineResult | null {
  if (!json) return null;
  try {
    const raw = JSON.parse(json) as unknown;
    const parsed = cvPipelineResultSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function enrichAnalysisRow<T extends { cvStatus?: string | null; cvPipelineResultJson?: string | null }>(
  row: T
): T & AnalysisCvFields {
  return {
    ...row,
    cvStatus: parseCvStatus(row.cvStatus ?? null),
    cvResult: parseCvPipelineResult(row.cvPipelineResultJson ?? null),
  };
}
