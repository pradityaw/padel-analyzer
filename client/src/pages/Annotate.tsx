/* Hallmark · design-system: design.md · designed-as-app · theme: studied-DNA "Court Flood" (source: image) */
import { useState } from "react";
import { motion } from "framer-motion";
import { Download, CheckCircle, Star } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { trpc } from "@/lib/trpc";
import ScoreCard from "@/components/ScoreCard";
import SkeletonReplay from "@/components/SkeletonReplay";
import type { FrameLandmarks, ShotType } from "@shared/types";
import { SHOT_TYPES, SHOT_TYPE_LABELS, SHOT_TYPE_COLORS } from "@shared/types";

type AnnotateDialogProps = {
  analysis: {
    id: number;
    videoFileName: string;
    overallScore: number;
    dominantSide: string;
    frameCount: number;
    durationMs: number;
    landmarksJson: string;
  };
  onClose: () => void;
};

function AnnotateDialog({ analysis, onClose }: AnnotateDialogProps) {
  const [shotType, setShotType] = useState<ShotType | null>(null);
  const [isProReference, setIsProReference] = useState(false);
  const [notes, setNotes] = useState("");

  const utils = trpc.useUtils();
  const createAnnotation = trpc.annotation.create.useMutation({
    onSuccess: () => {
      utils.annotation.unannotated.invalidate();
      utils.annotation.stats.invalidate();
      utils.annotation.list.invalidate();
      onClose();
    },
  });

  const frames: FrameLandmarks[] = JSON.parse(analysis.landmarksJson);

  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
      <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-surface border border-rule rounded-2xl p-6 w-[90vw] max-w-2xl max-h-[90vh] overflow-y-auto">
        <Dialog.Title className="text-lg font-bold mb-1">
          Label Shot Type
        </Dialog.Title>
        <Dialog.Description className="text-sm text-ink-2 mb-4 tabular-nums">
          {analysis.videoFileName} — {analysis.frameCount} frames,{" "}
          {(analysis.durationMs / 1000).toFixed(1)}s
        </Dialog.Description>

        {/* Skeleton replay */}
        <div className="flex justify-center mb-5">
          <SkeletonReplay frames={frames} width={280} height={360} />
        </div>

        {/* Shot type buttons */}
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-2 mb-2">Shot Type</p>
          <div className="grid grid-cols-4 gap-2">
            {SHOT_TYPES.map((type) => (
              <button
                key={type}
                onClick={() => setShotType(type)}
                className={`px-3 py-2 rounded-full text-sm font-medium transition-all border ${
                  shotType === type
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-rule text-ink-2 hover:border-muted-2 hover:text-ink"
                }`}
              >
                {SHOT_TYPE_LABELS[type]}
              </button>
            ))}
          </div>
        </div>

        {/* Pro reference toggle */}
        <label className="flex items-center gap-2 mb-4 cursor-pointer">
          <div
            onClick={() => setIsProReference((p) => !p)}
            className={`w-10 h-5 rounded-full relative transition-colors ${
              isProReference ? "bg-accent" : "bg-rule"
            }`}
          >
            <div
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                isProReference ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </div>
          <Star className="w-4 h-4 text-sand" />
          <span className="text-sm text-ink-2">Pro player reference</span>
        </label>

        {/* Notes */}
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional notes (e.g., camera angle, skill level)..."
          className="w-full bg-raised border border-rule rounded-xl px-3 py-2 text-sm text-ink placeholder:text-muted-2 mb-4 resize-none h-20"
        />

        {/* Actions */}
        <div className="flex gap-3 justify-end">
          <Dialog.Close asChild>
            <button className="px-4 py-2 rounded-full text-sm text-ink-2 hover:text-ink transition-colors">
              Cancel
            </button>
          </Dialog.Close>
          <button
            disabled={!shotType || createAnnotation.isPending}
            onClick={() => {
              if (!shotType) return;
              createAnnotation.mutate({
                analysisId: analysis.id,
                shotType,
                isProReference,
                notes: notes || undefined,
              });
            }}
            className="px-5 py-2 rounded-full text-sm font-bold bg-cta text-cta-ink hover:bg-white/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            {createAnnotation.isPending ? "Saving..." : "Save Label"}
          </button>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  );
}

export default function Annotate() {
  const [selectedAnalysis, setSelectedAnalysis] = useState<number | null>(null);

  const { data: unannotated, isLoading: loadingUnannotated } =
    trpc.annotation.unannotated.useQuery();
  const { data: stats } = trpc.annotation.stats.useQuery();
  const { data: annotated } = trpc.annotation.list.useQuery();

  const exportMutation = trpc.annotation.exportTrainingData.useQuery(
    undefined,
    { enabled: false }
  );

  const handleExport = async () => {
    const result = await exportMutation.refetch();
    if (result.data) {
      const blob = new Blob([JSON.stringify(result.data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `training_data_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const totalAnnotated = stats?.reduce((s, r) => s + r.count, 0) ?? 0;

  if (loadingUnannotated) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const selected = unannotated?.find((a) => a.id === selectedAnalysis);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="max-w-5xl mx-auto px-4 py-8"
    >
      <div className="flex items-center justify-between mb-8">
        <h1 className="font-display-condensed text-3xl text-ink">Annotate</h1>
        <button
          onClick={handleExport}
          disabled={totalAnnotated === 0}
          className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium border border-white/15 bg-white/10 text-ink hover:bg-white/15 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Download className="w-4 h-4" />
          Export Training Data ({totalAnnotated})
        </button>
      </div>

      {/* Stats overview */}
      {stats && stats.length > 0 && (
        <div className="bg-surface rounded-2xl border border-rule p-4 mb-6">
          <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-2 mb-3">
            Labeled Samples
          </h2>
          <div className="flex flex-wrap gap-2">
            {stats.map((s) => (
              <div
                key={s.shotType}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-rule text-sm"
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{
                    backgroundColor:
                      SHOT_TYPE_COLORS[s.shotType as ShotType] ?? "#6b75a3",
                  }}
                />
                <span className="text-ink-2">
                  {SHOT_TYPE_LABELS[s.shotType as ShotType] ?? s.shotType}
                </span>
                <span className="text-muted-2 tabular-nums">{s.count}</span>
                {s.proCount > 0 && (
                  <span className="text-sand text-xs tabular-nums">
                    ({s.proCount} pro)
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Unannotated analyses */}
      <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-2 mb-3 tabular-nums">
        Needs Labeling ({unannotated?.length ?? 0})
      </h2>

      {!unannotated || unannotated.length === 0 ? (
        <div className="text-center py-12">
          <CheckCircle className="w-12 h-12 text-accent mx-auto mb-4" />
          <p className="text-ink-2 text-lg mb-2">All caught up!</p>
          <p className="text-sm text-muted-2">
            Upload more videos to build your training dataset.
          </p>
        </div>
      ) : (
        <Dialog.Root
          open={selectedAnalysis !== null}
          onOpenChange={(open) => {
            if (!open) setSelectedAnalysis(null);
          }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {unannotated.map((a) => (
              <motion.div
                key={a.id}
                className="bg-surface rounded-2xl border border-rule p-4 cursor-pointer group transition-colors hover:border-accent/40 hover:bg-white/[0.02]"
                onClick={() => setSelectedAnalysis(a.id)}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{a.videoFileName}</p>
                    <p className="text-xs text-muted-2">
                      {new Date(a.createdAt).toLocaleDateString()} —{" "}
                      {a.dominantSide === "right" ? "R" : "L"}-hand
                    </p>
                  </div>
                  <ScoreCard score={a.overallScore} size="sm" />
                </div>
                <span className="text-xs text-muted-2 tabular-nums">
                  {a.frameCount} frames •{" "}
                  {(a.durationMs / 1000).toFixed(1)}s
                </span>
              </motion.div>
            ))}
          </div>

          {selected && (
            <AnnotateDialog
              analysis={selected}
              onClose={() => setSelectedAnalysis(null)}
            />
          )}
        </Dialog.Root>
      )}

      {/* Already annotated */}
      {annotated && annotated.length > 0 && (
        <>
          <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-2 mt-8 mb-3 tabular-nums">
            Labeled ({annotated.length})
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {annotated.map((a) => (
              <div
                key={a.annotation.id}
                className="bg-surface rounded-2xl border border-rule p-3 flex items-center justify-between"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {a.videoFileName}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <span
                      className="px-2 py-0.5 rounded-full text-xs font-medium"
                      style={{
                        backgroundColor: `${SHOT_TYPE_COLORS[a.annotation.shotType as ShotType] ?? "#6b75a3"}20`,
                        color:
                          SHOT_TYPE_COLORS[a.annotation.shotType as ShotType] ??
                          "#6b75a3",
                      }}
                    >
                      {SHOT_TYPE_LABELS[a.annotation.shotType as ShotType] ??
                        a.annotation.shotType}
                    </span>
                    {a.annotation.isProReference && (
                      <Star className="w-3 h-3 text-sand" />
                    )}
                  </div>
                </div>
                <ScoreCard score={a.overallScore} size="sm" />
              </div>
            ))}
          </div>
        </>
      )}
    </motion.div>
  );
}
