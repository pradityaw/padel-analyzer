import { router } from "../_core/trpc.js";
import { analysisRouter } from "./analysis.js";
import { youtubeRouter } from "./youtube.js";
import { annotationRouter } from "./annotation.js";
import { proCompareRouter } from "./proCompare.js";
import { mobileAnalysisRouter } from "./mobileAnalysis.js";

export const appRouter = router({
  analysis: analysisRouter,
  youtube: youtubeRouter,
  annotation: annotationRouter,
  proCompare: proCompareRouter,
  mobileAnalysis: mobileAnalysisRouter,
});

export type AppRouter = typeof appRouter;
