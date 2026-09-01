import { router } from "../_core/trpc.js";
import { analysisRouter } from "./analysis.js";
import { authRouter } from "./auth.js";
import { youtubeRouter } from "./youtube.js";
import { annotationRouter } from "./annotation.js";
import { proCompareRouter } from "./proCompare.js";
import { mobileAnalysisRouter } from "./mobileAnalysis.js";
import { objectStorageRouter } from "./objectStorage.js";
import { feedbackRouter } from "./feedback.js";

export const appRouter = router({
  analysis: analysisRouter,
  auth: authRouter,
  youtube: youtubeRouter,
  annotation: annotationRouter,
  proCompare: proCompareRouter,
  mobileAnalysis: mobileAnalysisRouter,
  objectStorage: objectStorageRouter,
  feedback: feedbackRouter,
});

export type AppRouter = typeof appRouter;
