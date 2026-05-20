export type RootStackParamList = {
  Home: undefined;
  Record: undefined;
  Upload: undefined;
  History: undefined;
  Compare: { analysisIdA?: number; analysisIdB?: number } | undefined;
  ProCompare: undefined;
  Privacy: undefined;
  Login: undefined;
  JobStatus: { jobId: number };
  Analysis: { analysisId: number };
};
