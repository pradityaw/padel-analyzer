import { router } from "../_core/trpc.js";
import { analysisRouter } from "./analysis.js";
import { youtubeRouter } from "./youtube.js";
import { annotationRouter } from "./annotation.js";
import { proCompareRouter } from "./proCompare.js";
import { authRouter } from "./auth.js";

export const appRouter = router({
  analysis: analysisRouter,
  youtube: youtubeRouter,
  annotation: annotationRouter,
  proCompare: proCompareRouter,
  auth: authRouter,
});

export type AppRouter = typeof appRouter;
