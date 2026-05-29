import {
  Component,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload as UploadIcon,
  Video,
  BarChart3,
  AlertCircle,
  Link as LinkIcon,
  Search,
  Clock,
  User,
  Server,
  CheckCircle2,
  WifiOff,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { uploadVideoForAnalysis } from "@/lib/mobileUpload";
import {
  flushTrackingQueue,
  subscribeTrackingSyncStatus,
  type TrackingSyncStatus,
} from "@/lib/trackingSyncQueue";
import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_MB,
  YOUTUBE_MAX_DURATION_SEC,
} from "@shared/config";
import type { AnalysisJobPayload } from "@shared/schema";
import {
  estimateProcessingTime,
  formatElapsedVsEstimate,
  probeVideoFileDuration,
  type ProcessingTimeEstimate,
} from "@/lib/processingTimeEstimate";

type Stage =
  | "idle"
  | "selected"
  | "yt-preview"
  | "processing"
  | "done"
  | "error";
type Tab = "upload" | "youtube";
type UploadMode = "stream" | "xhr" | "cloud-single" | "cloud-multipart";

type YouTubeInfo = {
  videoId: string;
  title: string;
  durationSeconds: number;
  thumbnailUrl: string;
  author: string;
};

class UploadErrorBoundary extends Component<
  { children: ReactNode; onReset: () => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[upload] Render failure", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="mx-auto max-w-2xl rounded-2xl border border-red-500/30 bg-red-500/10 p-5 text-center">
        <AlertCircle className="mx-auto mb-3 h-8 w-8 text-red-300" />
        <p className="text-lg font-semibold text-red-100">
          Upload screen hit an error
        </p>
        <p className="mt-2 text-sm text-red-200">
          {this.state.error.message ||
            "Refresh the upload flow and try the clip again."}
        </p>
        <button
          onClick={() => {
            this.setState({ error: null });
            this.props.onReset();
          }}
          className="mt-4 min-h-11 rounded-lg bg-red-400 px-5 font-semibold text-slate-950"
        >
          Reset upload
        </button>
      </div>
    );
  }
}

const VIDEO_FILENAME_RE =
  /\.(mp4|m4v|mov|qt|webm|mkv|avi|mts|m2ts|mpg|mpeg|wmv|3gp|3g2|ts|f4v|ogv)$/i;

function isLikelyVideoFile(f: File): boolean {
  // Prefer filename: mobile OS pickers often send empty MIME, octet-stream, or
  // vendor-specific labels (e.g. application/mp4) that fail a strict video/* check.
  if (VIDEO_FILENAME_RE.test(f.name)) return true;
  if (f.type.startsWith("video/")) return true;
  if (
    f.type === "application/mp4" ||
    f.type === "application/quicktime" ||
    f.type === "application/x-matroska"
  ) {
    return true;
  }
  return false;
}

const STEPS = [
  "Upload video",
  "Extract pose",
  "Score swing",
  "Complete",
] as const;

function stepIndexFromJob(progress: number, status: string): number {
  if (status === "completed") return 3;
  if (progress < 20) return 0;
  if (progress < 85) return 1;
  return 2;
}

function ProcessingTimeBanner({
  estimate,
  elapsedSec,
  compact = false,
}: {
  estimate: ProcessingTimeEstimate;
  elapsedSec?: number;
  compact?: boolean;
}) {
  const tierStyles =
    estimate.tier === "long"
      ? "border-amber-500/35 bg-amber-500/10 text-amber-100"
      : estimate.tier === "moderate"
        ? "border-sky-500/30 bg-sky-500/10 text-sky-100"
        : "border-padel-green/30 bg-padel-green/10 text-emerald-100";

  return (
    <div
      className={cn(
        "rounded-xl border p-4 text-left",
        tierStyles,
        compact ? "mt-4" : "mt-5"
      )}
    >
      <div className="flex items-start gap-3">
        <Clock className="h-5 w-5 shrink-0 mt-0.5 opacity-90" />
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-snug">{estimate.headline}</p>
          <p className="mt-1.5 text-xs leading-relaxed opacity-90">{estimate.detail}</p>
          {elapsedSec != null && elapsedSec > 0 ? (
            <p className="mt-2 text-xs font-medium tabular-nums opacity-95">
              {formatElapsedVsEstimate(elapsedSec, estimate)}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ProcessingSteps({
  progress,
  status,
}: {
  progress: number;
  status: string;
}) {
  const activeStep = stepIndexFromJob(progress, status);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex items-center justify-between gap-1 w-full max-w-md mx-auto"
    >
      {STEPS.map((step, i) => {
        const completed = i < activeStep;
        const active = i === activeStep && status !== "completed";
        return (
          <div
            key={step}
            className="flex-1 flex flex-col items-center gap-1.5"
          >
            <motion.div
              animate={
                active
                  ? { scale: [1, 1.08, 1], opacity: [0.85, 1, 0.85] }
                  : { scale: 1, opacity: 1 }
              }
              transition={
                active
                  ? { duration: 1.2, repeat: Infinity, ease: "easeInOut" }
                  : { duration: 0.3 }
              }
              className={cn(
                "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2",
                completed
                  ? "bg-padel-green border-padel-green text-black"
                  : active
                    ? "border-padel-green text-padel-green bg-padel-green/10"
                    : "border-slate-700 text-slate-600"
              )}
            >
              {completed ? "✓" : i + 1}
            </motion.div>
            <span
              className={cn(
                "text-[10px] text-center leading-tight hidden sm:block",
                completed || active ? "text-slate-300" : "text-slate-600"
              )}
            >
              {step}
            </span>
          </div>
        );
      })}
    </motion.div>
  );
}

function StageBreakdown({
  stages,
}: {
  stages: NonNullable<AnalysisJobPayload["stages"]>;
}) {
  return (
    <div className="mt-6 grid gap-2">
      {stages.map((stage) => (
        <div
          key={stage.id}
          className="rounded-xl border border-padel-border bg-slate-900/40 p-3"
        >
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium text-slate-200">{stage.label}</span>
            <span
              className={cn(
                "text-xs capitalize",
                stage.status === "completed"
                  ? "text-padel-green"
                  : stage.status === "failed"
                    ? "text-red-300"
                    : stage.status === "running"
                      ? "text-amber-300"
                      : "text-slate-500"
              )}
            >
              {stage.status}
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
            <motion.div
              className={cn(
                "h-full rounded-full",
                stage.status === "failed" ? "bg-red-400" : "bg-padel-green"
              )}
              animate={{ width: `${stage.progress}%` }}
              transition={{ ease: "easeOut", duration: 0.35 }}
            />
          </div>
          {stage.message || stage.errorMessage ? (
            <p
              className={cn(
                "mt-1 text-xs",
                stage.errorMessage ? "text-red-300" : "text-slate-500"
              )}
            >
              {stage.errorMessage || stage.message}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function MobileProcessingProgress({
  uploadProgress,
  uploadMode,
  jobProgress,
  jobStatus,
  progressMsg,
  syncStatus,
}: {
  uploadProgress: number;
  uploadMode: UploadMode | null;
  jobProgress: number;
  jobStatus: string;
  progressMsg: string;
  syncStatus: TrackingSyncStatus;
}) {
  const uploadDone = uploadProgress >= 100;
  const processingDone = jobStatus === "completed";
  const syncDone = syncStatus.pendingTuples === 0 && !syncStatus.syncing;

  const rows = [
    {
      label: "Upload",
      value: uploadDone
        ? "Saved in storage"
        : uploadProgress > 0
          ? `${uploadProgress}% via ${
              uploadMode === "cloud-single" || uploadMode === "cloud-multipart"
                ? "cloud"
                : uploadMode === "stream"
                  ? "stream"
                  : "mobile fallback"
            }`
          : "Waiting to start",
      done: uploadDone,
      warn: false,
    },
    {
      label: "Processing",
      value:
        progressMsg ||
        (jobProgress < 30
          ? "Uploading / preparing video..."
          : `${jobProgress}% complete`),
      done: processingDone,
      warn: false,
    },
    {
      label: "Tracking sync",
      value: syncStatus.online
        ? syncStatus.syncing
          ? "Syncing cached tuples..."
          : syncDone
            ? "Synced"
            : `${syncStatus.pendingTuples} tuples pending`
        : `${syncStatus.pendingTuples} tuples cached offline`,
      done: syncDone,
      warn: !syncStatus.online || Boolean(syncStatus.lastError),
    },
  ];

  return (
    <div className="mt-6 rounded-2xl border border-padel-border bg-slate-950/50 p-4 text-left">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">Mobile QA progress</p>
          <p className="text-xs text-slate-500">
            Keep this screen open until upload, processing, and tracking sync finish.
          </p>
        </div>
        {!syncStatus.online ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-300">
            <WifiOff className="h-3.5 w-3.5" />
            Offline
          </span>
        ) : null}
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {rows.map((row) => (
          <div
            key={row.label}
            className={cn(
              "min-h-24 rounded-xl border p-3",
              row.warn
                ? "border-amber-500/30 bg-amber-500/10"
                : row.done
                  ? "border-padel-green/30 bg-padel-green/10"
                  : "border-slate-800 bg-slate-900/70"
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                {row.label}
              </span>
              {row.done ? (
                <CheckCircle2 className="h-4 w-4 text-padel-green" />
              ) : null}
            </div>
            <p
              className={cn(
                "mt-2 text-sm leading-snug",
                row.warn ? "text-amber-200" : "text-slate-200"
              )}
            >
              {row.value}
            </p>
          </div>
        ))}
      </div>

      {syncStatus.lastError ? (
        <p className="mt-3 text-xs text-amber-200">
          Tracking sync error: {syncStatus.lastError}. It will retry automatically.
        </p>
      ) : null}
    </div>
  );
}

export default function Upload() {
  const [, navigate] = useLocation();
  const [tab, setTab] = useState<Tab>("upload");
  const [stage, setStage] = useState<Stage>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [ytUrl, setYtUrl] = useState("");
  const [ytInfo, setYtInfo] = useState<YouTubeInfo | null>(null);
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadMode, setUploadMode] = useState<UploadMode | null>(null);
  const [trackingSyncStatus, setTrackingSyncStatus] =
    useState<TrackingSyncStatus>({
      online: typeof navigator === "undefined" ? true : navigator.onLine,
      syncing: false,
      pendingBatches: 0,
      pendingTuples: 0,
    });
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [jobId, setJobId] = useState<number | null>(null);
  const [failedJobId, setFailedJobId] = useState<number | null>(null);
  const [fileDurationSec, setFileDurationSec] = useState<number | null>(null);
  const [processingEstimate, setProcessingEstimate] =
    useState<ProcessingTimeEstimate | null>(null);
  const [processingStartedAt, setProcessingStartedAt] = useState<number | null>(
    null
  );
  const [elapsedSec, setElapsedSec] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const createJob = trpc.mobileAnalysis.create.useMutation();
  const retryJob = trpc.mobileAnalysis.retry.useMutation();
  const getYtInfo = trpc.youtube.getInfo.useMutation();
  const downloadYt = trpc.youtube.download.useMutation();

  const jobQuery = trpc.mobileAnalysis.getProgress.useQuery(
    { id: jobId! },
    {
      enabled: jobId != null && stage === "processing",
      refetchInterval: (q) => {
        const job = q.state.data;
        if (!job) return 1500;
        if (job.status === "completed" || job.status === "failed") {
          return false;
        }
        return 2500;
      },
    }
  );

  useEffect(() => {
    const unsubscribe = subscribeTrackingSyncStatus(setTrackingSyncStatus);
    void flushTrackingQueue();
    return unsubscribe;
  }, []);

  useEffect(() => {
    const job = jobQuery.data;
    if (!job || stage !== "processing") return;

    setProgress(job.progress);
    setProgressMsg(job.statusMessage ?? "Working...");

    if (job.status === "completed" && job.analysisId) {
      setStage("done");
      navigate(`/analysis/${job.analysisId}`);
    }

    if (job.status === "failed") {
      setStage("error");
      setFailedJobId(job.id);
      setError(
        job.errorMessage ??
          "Analysis failed on the server. Check that Python and MediaPipe are installed."
      );
    }
  }, [jobQuery.data, stage, navigate]);

  useEffect(() => {
    if (stage !== "processing" || processingStartedAt == null) {
      setElapsedSec(0);
      return;
    }
    const tick = () => {
      setElapsedSec(Math.floor((Date.now() - processingStartedAt) / 1000));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [stage, processingStartedAt]);

  const uploadFileEstimate = useMemo(() => {
    if (!file) return null;
    return estimateProcessingTime({
      durationSec: fileDurationSec,
      source: "upload",
      fileSizeMb: file.size / (1024 * 1024),
    });
  }, [file, fileDurationSec]);

  const youtubeEstimate = useMemo(() => {
    if (!ytInfo) return null;
    return estimateProcessingTime({
      durationSec: ytInfo.durationSeconds,
      source: "youtube",
    });
  }, [ytInfo]);

  const resetError = () => setError("");

  const startAnalysisJob = useCallback(
    async (videoFileName: string, videoStorageKey: string) => {
      setStage("processing");
      setProgress(0);
      setUploadProgress(100);
      setProgressMsg("Queued for server analysis...");
      setFailedJobId(null);
      setError("");

      const job = await createJob.mutateAsync({
        videoFileName,
        videoStorageKey,
      });
      setJobId(job.id);
    },
    [createJob]
  );

  const handleFile = useCallback((f: File) => {
    if (!isLikelyVideoFile(f)) {
      setError(
        "That file does not look like a video (need a known extension such as .mp4, .mov, or .3gp, or a video/* type from your device)."
      );
      return;
    }
    if (f.size > MAX_UPLOAD_BYTES) {
      setError(`File too large. Maximum ${MAX_UPLOAD_MB} MB.`);
      return;
    }
    setFile(f);
    setFileDurationSec(null);
    setStage("selected");
    setError("");
    void probeVideoFileDuration(f).then((duration) => {
      setFileDurationSec(duration);
    });
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files[0];
      if (f) handleFile(f);
    },
    [handleFile]
  );

  const startFileAnalysis = useCallback(async () => {
    if (!file) return;
    try {
      const estimate = estimateProcessingTime({
        durationSec: fileDurationSec,
        source: "upload",
        fileSizeMb: file.size / (1024 * 1024),
      });
      setProcessingEstimate(estimate);
      setProcessingStartedAt(Date.now());
      setStage("processing");
      setProgress(0);
      setUploadProgress(0);
      setUploadMode(null);
      setProgressMsg("Uploading video (streaming, no full-file buffer)...");
      const storageKey = await uploadVideoForAnalysis(file, {
        onProgress: (upload) => {
          setUploadMode(upload.mode);
          setUploadProgress(upload.percent);
          setProgress(Math.max(1, Math.round(upload.percent * 0.25)));
          setProgressMsg(
            `Uploading video (${upload.percent}%)${
              upload.mode === "stream" ? " via streaming" : ""
            }...`
          );
        },
      });
      await startAnalysisJob(file.name, storageKey);
    } catch (err) {
      setStage("error");
      setError(err instanceof Error ? err.message : "Analysis failed.");
    }
  }, [file, fileDurationSec, startAnalysisJob]);

  const handleYtLookup = useCallback(async () => {
    if (!ytUrl.trim()) return;
    resetError();
    try {
      const info = await getYtInfo.mutateAsync({ url: ytUrl.trim() });
      setYtInfo(info);
      setStage("yt-preview");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not fetch video info."
      );
    }
  }, [ytUrl, getYtInfo]);

  const startYtAnalysis = useCallback(async () => {
    if (!ytInfo) return;
    if (ytInfo.durationSeconds > YOUTUBE_MAX_DURATION_SEC) {
      setError(
        `Video too long. Please use a clip under ${YOUTUBE_MAX_DURATION_SEC / 60} minutes for analysis.`
      );
      return;
    }
    try {
      setProcessingEstimate(
        estimateProcessingTime({
          durationSec: ytInfo.durationSeconds,
          source: "youtube",
        })
      );
      setProcessingStartedAt(Date.now());
      setStage("processing");
      setProgress(0);
      setUploadProgress(100);
      setUploadMode(null);
      setProgressMsg("Downloading video from YouTube...");
      const result = await downloadYt.mutateAsync({ url: ytUrl.trim() });
      await startAnalysisJob(result.fileName, result.fileName);
    } catch (err) {
      setStage("error");
      setError(err instanceof Error ? err.message : "Analysis failed.");
    }
  }, [ytInfo, ytUrl, downloadYt, startAnalysisJob]);

  const handleRetry = useCallback(async () => {
    if (!failedJobId) {
      reset();
      return;
    }
    try {
      setStage("processing");
      setError("");
      const job = await retryJob.mutateAsync({ id: failedJobId });
      setJobId(job.id);
      setFailedJobId(null);
    } catch (err) {
      setStage("error");
      setError(err instanceof Error ? err.message : "Could not retry analysis.");
    }
  }, [failedJobId, retryJob]);

  const reset = () => {
    setStage("idle");
    setFile(null);
    setFileDurationSec(null);
    setYtUrl("");
    setYtInfo(null);
    setError("");
    setProgress(0);
    setUploadProgress(0);
    setUploadMode(null);
    setProgressMsg("");
    setJobId(null);
    setFailedJobId(null);
    setProcessingEstimate(null);
    setProcessingStartedAt(null);
    setElapsedSec(0);
  };

  const isProcessing = stage === "processing";
  const jobStatus = jobQuery.data?.status ?? "processing";

  return (
    <UploadErrorBoundary onReset={reset}>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        className="max-w-4xl mx-auto px-4 py-12"
      >
      <motion.div
        className="text-center mb-12"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
      >
        <h1 className="display text-5xl sm:text-6xl mb-4 text-white">
          Analyze Your <span className="text-padel-green">Padel Swing</span>
        </h1>
        <p className="text-slate-400 text-lg max-w-xl mx-auto">
          Upload a video or paste a YouTube link. Analysis runs on the server
          with MediaPipe — same pipeline as the mobile app.
        </p>
      </motion.div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-12">
        {[
          {
            icon: Video,
            title: "Upload or Link",
            desc: "Side-view swing clip or YouTube URL",
          },
          {
            icon: Server,
            title: "Server analysis",
            desc: "Pose extraction and phase scoring on your machine",
          },
          {
            icon: BarChart3,
            title: "Get Results",
            desc: "Scores, phases, and coaching tips",
          },
        ].map((step, i) => (
          <motion.div
            key={step.title}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 * i, duration: 0.4 }}
            className="bg-padel-surface rounded-xl p-5 border border-padel-border text-center"
          >
            <motion.div
              className="w-10 h-10 rounded-lg bg-padel-green/15 flex items-center justify-center mx-auto mb-3"
              whileHover={{ scale: 1.06 }}
              transition={{ type: "spring", stiffness: 400, damping: 18 }}
            >
              <step.icon className="w-5 h-5 text-padel-green" />
            </motion.div>
            <h3 className="font-semibold mb-1">{step.title}</h3>
            <p className="text-sm text-slate-400">{step.desc}</p>
          </motion.div>
        ))}
      </div>

      {!isProcessing && stage !== "done" && (
        <div className="bg-padel-surface rounded-2xl border border-padel-border overflow-hidden">
          <motion.div
            className="flex border-b border-padel-border"
            layout
          >
            {(["upload", "youtube"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => {
                  setTab(t);
                  reset();
                }}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 py-3.5 text-sm font-medium transition-colors border-b-2",
                  tab === t
                    ? "border-padel-green text-padel-green"
                    : "border-transparent text-slate-400 hover:text-white"
                )}
              >
                {t === "upload" ? (
                  <>
                    <UploadIcon className="w-4 h-4" />
                    Upload Video
                  </>
                ) : (
                  <>
                    <LinkIcon className="w-4 h-4" />
                    YouTube Link
                  </>
                )}
              </button>
            ))}
          </motion.div>

          <motion.div className="p-6" layout>
            <AnimatePresence mode="wait">
              {tab === "upload" && stage === "idle" && (
                <motion.label
                  key="upload-idle"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  onClick={(e) => {
                    // Explicit open: some WebViews / Framer-motion labels miss native label→input activation.
                    if (e.target === inputRef.current) return;
                    e.preventDefault();
                    inputRef.current?.click();
                  }}
                  className={cn(
                    "relative block cursor-pointer border-2 border-dashed rounded-xl p-12 text-center transition-all",
                    dragOver
                      ? "border-padel-green bg-padel-green/10 scale-[1.02]"
                      : "border-padel-border hover:border-slate-500 hover:bg-white/[0.02]"
                  )}
                >
                  <UploadIcon className="w-12 h-12 text-slate-500 mx-auto mb-4" />
                  <p className="text-lg font-medium mb-1">
                    Drop your video here or click to browse
                  </p>
                  <p className="text-sm text-slate-500">
                    .mp4, .mov, .webm, phone clips (.3gp) — up to {MAX_UPLOAD_MB}{" "}
                    MB
                  </p>
                  <input
                    ref={inputRef}
                    type="file"
                    accept="video/*,.mp4,.mov,.webm,.m4v,.mkv,.3gp,.3g2,.avi,.mts,.m2ts"
                    aria-label="Choose video file"
                    className="sr-only"
                    onChange={(e) => {
                      const picked = e.target.files?.[0];
                      if (picked) handleFile(picked);
                      e.target.value = "";
                    }}
                  />
                </motion.label>
              )}

              {tab === "upload" && stage === "selected" && file && (
                <motion.div
                  key="upload-selected"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="text-center py-6"
                >
                  <Video className="w-10 h-10 text-padel-green mx-auto mb-3" />
                  <p className="font-semibold text-lg mb-1">{file.name}</p>
                  <p className="text-sm text-slate-400 mb-2">
                    {(file.size / (1024 * 1024)).toFixed(1)} MB
                    {fileDurationSec != null
                      ? ` · ${Math.floor(fileDurationSec / 60)}:${String(
                          Math.floor(fileDurationSec % 60)
                        ).padStart(2, "0")}`
                      : " · reading duration…"}
                  </p>
                  {uploadFileEstimate ? (
                    <ProcessingTimeBanner estimate={uploadFileEstimate} />
                  ) : null}
                  <motion.div
                    className="flex gap-3 justify-center mt-6"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    <button
                      onClick={reset}
                      className="px-5 py-2.5 rounded-lg border border-padel-border text-slate-400 hover:text-white hover:border-slate-500 transition-colors"
                    >
                      Change
                    </button>
                    <motion.button
                      onClick={startFileAnalysis}
                      disabled={createJob.isPending}
                      className="px-6 py-2.5 rounded-lg bg-padel-green text-white font-semibold hover:bg-padel-green/90 transition-colors disabled:opacity-60"
                      whileTap={{ scale: 0.98 }}
                    >
                      Analyze My Swing
                    </motion.button>
                  </motion.div>
                </motion.div>
              )}

              {tab === "youtube" && stage === "idle" && (
                <motion.div
                  key="yt-idle"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <p className="text-sm text-slate-400 mb-4">
                    Paste a YouTube URL (max {YOUTUBE_MAX_DURATION_SEC / 60}{" "}
                    minutes). The video downloads on the server, then analysis
                    runs locally.
                  </p>
                  <motion.div className="flex gap-2">
                    <input
                      type="url"
                      value={ytUrl}
                      onChange={(e) => setYtUrl(e.target.value)}
                      onKeyDown={(e) =>
                        e.key === "Enter" && handleYtLookup()
                      }
                      placeholder="https://www.youtube.com/watch?v=..."
                      className="flex-1 bg-slate-800 border border-padel-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-padel-green placeholder:text-slate-600"
                    />
                    <button
                      onClick={handleYtLookup}
                      disabled={!ytUrl.trim() || getYtInfo.isPending}
                      className="px-4 py-2.5 rounded-lg bg-padel-green text-white font-medium hover:bg-padel-green/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                    >
                      {getYtInfo.isPending ? (
                        <motion.div
                          className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full"
                          animate={{ rotate: 360 }}
                          transition={{
                            duration: 0.8,
                            repeat: Infinity,
                            ease: "linear",
                          }}
                        />
                      ) : (
                        <Search className="w-4 h-4" />
                      )}
                      Look up
                    </button>
                  </motion.div>
                </motion.div>
              )}

              {tab === "youtube" && stage === "yt-preview" && ytInfo && (
                <motion.div
                  key="yt-preview"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex gap-4"
                >
                  {ytInfo.thumbnailUrl && (
                    <img
                      src={ytInfo.thumbnailUrl}
                      alt="thumbnail"
                      className="w-36 h-24 object-cover rounded-lg shrink-0 bg-slate-800"
                    />
                  )}
                  <motion.div
                    className="flex-1 min-w-0"
                    initial={{ opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                  >
                    <p className="font-semibold text-base leading-snug mb-1 truncate">
                      {ytInfo.title}
                    </p>
                    <motion.div className="flex items-center gap-3 text-xs text-slate-400 mb-3">
                      <span className="flex items-center gap-1">
                        <User className="w-3 h-3" />
                        {ytInfo.author}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {Math.floor(ytInfo.durationSeconds / 60)}:
                        {String(ytInfo.durationSeconds % 60).padStart(2, "0")}
                      </span>
                    </motion.div>
                    {youtubeEstimate ? (
                      <ProcessingTimeBanner estimate={youtubeEstimate} compact />
                    ) : null}
                    <div className="flex gap-2 mt-4">
                      <button
                        onClick={reset}
                        className="px-4 py-2 rounded-lg border border-padel-border text-slate-400 hover:text-white text-sm transition-colors"
                      >
                        Change
                      </button>
                      <button
                        onClick={startYtAnalysis}
                        className="px-5 py-2 rounded-lg bg-padel-green text-white font-semibold text-sm hover:bg-padel-green/90 transition-colors"
                      >
                        Analyze This Video
                      </button>
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </div>
      )}

      {isProcessing && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="bg-padel-surface rounded-2xl p-8 border border-padel-border"
        >
          <div className="text-center mb-6">
            <p className="font-semibold text-xl mb-1">
              Analyzing your swing on the server...
            </p>
            <p className="text-sm text-slate-400">
              {progressMsg || "Preparing..."}
            </p>
          </div>

          {processingEstimate ? (
            <ProcessingTimeBanner
              estimate={processingEstimate}
              elapsedSec={elapsedSec}
            />
          ) : null}

          <ProcessingSteps progress={progress} status={jobStatus} />

          <div className="w-full bg-slate-800 rounded-full h-3 mb-2 overflow-hidden mt-6">
            <motion.div
              className="h-full rounded-full shimmer-bar"
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ ease: "easeOut", duration: 0.4 }}
            />
          </div>
          <p className="text-center text-sm text-slate-400 tabular-nums">
            {progress}% complete
          </p>

          <MobileProcessingProgress
            uploadProgress={uploadProgress}
            uploadMode={uploadMode}
            jobProgress={progress}
            jobStatus={jobStatus}
            progressMsg={progressMsg}
            syncStatus={trackingSyncStatus}
          />

          {jobQuery.data?.stages?.length ? (
            <StageBreakdown stages={jobQuery.data.stages} />
          ) : null}

          <p className="text-center text-xs text-slate-500 mt-6 max-w-md mx-auto">
            Requires Python 3 with MediaPipe and OpenCV on this machine (
            <code className="text-slate-400">scripts/analyze_video.py</code>).
          </p>
        </motion.div>
      )}

      {error && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-4 bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-start gap-3"
        >
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <p className="text-red-300 text-sm flex-1">{error}</p>
          <button
            onClick={failedJobId ? handleRetry : reset}
            className="text-sm text-red-400 hover:text-red-300 underline shrink-0"
          >
            {failedJobId ? "Retry analysis" : "Try again"}
          </button>
        </motion.div>
      )}
      </motion.div>
    </UploadErrorBoundary>
  );
}
