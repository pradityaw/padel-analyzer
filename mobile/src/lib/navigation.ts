import type { CourtCornersPayload } from "./courtCorners";
import type { RecordMode } from "./recordMode";

export type RootStackParamList = {
  Home: undefined;
  Setup: undefined;
  Record:
    | {
        mode?: RecordMode;
        courtCorners?: CourtCornersPayload;
        alignedInWizard?: boolean;
      }
    | undefined;
  Upload: undefined;
  History: undefined;
  Compare: { analysisIdA?: number; analysisIdB?: number } | undefined;
  ProCompare: undefined;
  Privacy: undefined;
  Login: undefined;
  JobStatus: { jobId: number };
  Analysis: { analysisId: number };
};
