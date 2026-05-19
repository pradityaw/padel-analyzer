import { useState, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload as UploadIcon,
  Video,
  Zap,
  BarChart3,
  AlertCircle,
  Link as LinkIcon,
  Search,
  Clock,
  User,
} from "lucide-react";
import { processVideo } from "@/lib/mediapipe";
import { analyzeSwing } from "@/lib/swingAnalyzer";
import { drawSkeleton } from "@/lib/skeleton";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { isProbablyVideoFile } from "@/lib/videoFile";
import type { FrameLandmarks } from "@shared/types";

type Stage = "idle" | "selected" | "yt-preview" | "processing" | "done" | "error";
type Tab = "upload" | "youtube";

type YouTubeInfo = {
  videoId: string;
  title: string;
  durationSeconds: number;
  thumbnailUrl: string;
  author: string;
};

const STEPS = [
  {
    label: "Save video",
    match: (msg: string, done: boolean) =>
      done ? false : msg.includes("Saving"),
  },
  {
    label: "Detect pose",
    match: (msg: string, done: boolean) =>
      done ? false : msg.includes("AI pose") || msg.includes("frames"),
  },
  {
    label: "Classify shot",
    match: (msg: string, done: boolean) =>
      done ? false : msg.includes("classifying") || msg.includes("Analyzing"),
  },
  { label: "Score phases", match: (_msg: string, done: boolean) => done },
] as const;

function ProcessingSteps({ progressMsg, isDone }: { progressMsg: string; isDone: boolean }) {
  let activeStep = -1;
  if (isDone) {
    activeStep = 3;
  } else {
    for (let i = 0; i < STEPS.length; i++) {
      if (STEPS[i].match(progressMsg, isDone)) activeStep = i;
    }
  }

  return (
    <div className="flex items-center justify-between gap-1 w-full max-w-md mx-auto">
      {STEPS.map((step, i) => {
        const completed = i < activeStep || isDone;
        const active = i === activeStep && !isDone;
        return (
          <div key={step.label} className="flex-1 flex flex-col items-center gap-1.5">
            <div
              className={[
                "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all duration-500",
                completed
                  ? "bg-padel-green border-padel-green text-black"
                  : active
                    ? "border-padel-green text-padel-green bg-padel-green/10 animate-pulse"
                    : "border-slate-700 text-slate-600",
              ].join(" ")}
            >
              {completed ? "✓" : i + 1}
            </div>
            <span
              className={[
                "text-[10px] text-center leading-tight hidden sm:block",
                completed || active ? "text-slate-300" : "text-slate-600",
              ].join(" ")}
            >
              {step.label}
            </span>
            {i < STEPS.length - 1 && (
              <div className="absolute" />
            )}
          </div>
        );
      })}
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
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const createAnalysis = trpc.analysis.create.useMutation();
  const getYtInfo = trpc.youtube.getInfo.useMutation();
  const downloadYt = trpc.youtube.download.useMutation();

  // ── helpers ──────────────────────────────────────────────────────────────

  const resetError = () => setError("");

  const runMediaPipeAndSave = useCallback(
    async (videoBlob: Blob, fileName: string) => {
      const videoFile =
        videoBlob instanceof File
          ? videoBlob
          : new File([videoBlob], fileName, { type: "video/mp4" });

      let videoStorageKey: string | undefined;
      if (fileName.startsWith("yt_")) {
        videoStorageKey = fileName;
      } else {
        setProgressMsg("Saving video on server...");
        const fd = new FormData();
        fd.append("file", videoFile, fileName);
        const up = await fetch("/api/upload", { method: "POST", body: fd });
        if (!up.ok) {
          const err = await up.json().catch(() => ({}));
          throw new Error(
            (err as { error?: string }).error ?? "Failed to save video on server"
          );
        }
        const { storageKey } = (await up.json()) as { storageKey: string };
        videoStorageKey = storageKey;
      }

      setProgressMsg("Processing frames with AI pose detection...");
      const frames = await processVideo(
        videoFile,
        (pct: number, frame?: FrameLandmarks) => {
          setProgress(pct);
          if (frame && canvasRef.current) {
            const ctx = canvasRef.current.getContext("2d");
            if (ctx) {
              drawSkeleton(
                ctx,
                frame.landmarks,
                canvasRef.current.width,
                canvasRef.current.height
              );
            }
          }
        }
      );

      setProgressMsg("Analyzing swing & classifying shot...");
      const result = await analyzeSwing(frames);
      setStage("done");

      const saved = await createAnalysis.mutateAsync({
        videoFileName: fileName,
        videoStorageKey,
        overallScore: result.overallScore,
        dominantSide: result.dominantSide,
        durationMs: result.durationMs,
        frameCount: result.frameCount,
        sampleFps: result.sampleFps,
        phasesJson: JSON.stringify(result.phases),
        landmarksJson: JSON.stringify(result.frameLandmarks),
        shotType: result.shotType,
        shotConfidence: result.shotConfidence,
      });

      navigate(`/analysis/${saved.id}`);
    },
    [createAnalysis, navigate]
  );

  // ── file upload flow ──────────────────────────────────────────────────────

  const handleFile = useCallback((f: File) => {
    if (!f.type.startsWith("video/")) {
      setError("Please upload a video file (.mp4, .mov, .webm)");
      return;
    }
    if (f.size > 500 * 1024 * 1024) {
      setError("File too large. Maximum 500 MB.");
      return;
    }
    setFile(f);
    setStage("selected");
    setError("");
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
    setStage("processing");
    setProgress(0);
    try {
      await runMediaPipeAndSave(file, file.name);
    } catch (err) {
      setStage("error");
      setError(err instanceof Error ? err.message : "Analysis failed.");
    }
  }, [file, runMediaPipeAndSave]);

  // ── youtube flow ──────────────────────────────────────────────────────────

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
    setStage("processing");
    setProgress(0);
    try {
      setProgressMsg("Downloading video from YouTube...");
      const result = await downloadYt.mutateAsync({ url: ytUrl.trim() });

      setProgressMsg("Fetching video for analysis...");
      const response = await fetch(result.localUrl);
      const blob = await response.blob();

      await runMediaPipeAndSave(blob, result.fileName);
    } catch (err) {
      setStage("error");
      setError(err instanceof Error ? err.message : "Analysis failed.");
    }
  }, [ytInfo, ytUrl, downloadYt, runMediaPipeAndSave]);

  // ── shared reset ──────────────────────────────────────────────────────────

  const reset = () => {
    setStage("idle");
    setFile(null);
    setYtUrl("");
    setYtInfo(null);
    setError("");
    setProgress(0);
    setProgressMsg("");
  };

  // ── render ────────────────────────────────────────────────────────────────

  const isProcessing = stage === "processing";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="max-w-4xl mx-auto px-4 py-12"
    >
      {/* Hero */}
      <div className="text-center mb-12">
        <h1 className="text-4xl sm:text-5xl font-bold mb-4 bg-gradient-to-r from-padel-green to-emerald-400 bg-clip-text text-transparent">
          Analyze Your Padel Swing
        </h1>
        <p className="text-slate-400 text-lg max-w-xl mx-auto">
          Upload a video or paste a YouTube link to get instant AI-powered
          biomechanical analysis with detailed scoring and coaching tips.
        </p>
      </div>

      {/* How it works */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-12">
        {[
          {
            icon: Video,
            title: "Upload or Link",
            desc: "Record your swing from the side, upload the clip or paste a YouTube URL",
          },
          {
            icon: Zap,
            title: "AI Analysis",
            desc: "MediaPipe tracks 33 body points through every frame",
          },
          {
            icon: BarChart3,
            title: "Get Results",
            desc: "See scores, angles, and coaching tips for each swing phase",
          },
        ].map((step, i) => (
          <div
            key={i}
            className="bg-padel-surface rounded-xl p-5 border border-padel-border text-center"
          >
            <div className="w-10 h-10 rounded-lg bg-padel-green/15 flex items-center justify-center mx-auto mb-3">
              <step.icon className="w-5 h-5 text-padel-green" />
            </div>
            <h3 className="font-semibold mb-1">{step.title}</h3>
            <p className="text-sm text-slate-400">{step.desc}</p>
          </div>
        ))}
      </div>

      {/* Main input card */}
      {!isProcessing && stage !== "done" && (
        <div className="bg-padel-surface rounded-2xl border border-padel-border overflow-hidden">
          {/* Tab bar */}
          <div className="flex border-b border-padel-border">
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
          </div>

          <div className="p-6">
            <AnimatePresence mode="wait">
              {/* ── Upload tab ── */}
              {tab === "upload" && stage === "idle" && (
                <motion.div
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
                  onClick={() => inputRef.current?.click()}
                  className={cn(
                    "border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all",
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
                    .mp4, .mov, .webm — up to 500 MB
                  </p>
                  <input
                    ref={inputRef}
                    type="file"
                    accept="video/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleFile(f);
                    }}
                  />
                </motion.div>
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
                  <p className="text-sm text-slate-400 mb-6">
                    {(file.size / (1024 * 1024)).toFixed(1)} MB
                  </p>
                  <div className="flex gap-3 justify-center">
                    <button
                      onClick={reset}
                      className="px-5 py-2.5 rounded-lg border border-padel-border text-slate-400 hover:text-white hover:border-slate-500 transition-colors"
                    >
                      Change
                    </button>
                    <button
                      onClick={startFileAnalysis}
                      className="px-6 py-2.5 rounded-lg bg-padel-green text-white font-semibold hover:bg-padel-green/90 transition-colors"
                    >
                      Analyze My Swing
                    </button>
                  </div>
                </motion.div>
              )}

              {/* ── YouTube tab ── */}
              {tab === "youtube" && stage === "idle" && (
                <motion.div
                  key="yt-idle"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <p className="text-sm text-slate-400 mb-4">
                    Paste a YouTube URL of your padel swing (max 5 minutes).
                    The video will be downloaded server-side and processed
                    locally — nothing is sent to any AI cloud service.
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="url"
                      value={ytUrl}
                      onChange={(e) => setYtUrl(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleYtLookup()}
                      placeholder="https://www.youtube.com/watch?v=..."
                      className="flex-1 bg-slate-800 border border-padel-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-padel-green placeholder:text-slate-600"
                    />
                    <button
                      onClick={handleYtLookup}
                      disabled={!ytUrl.trim() || getYtInfo.isPending}
                      className="px-4 py-2.5 rounded-lg bg-padel-green text-white font-medium hover:bg-padel-green/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                    >
                      {getYtInfo.isPending ? (
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        <Search className="w-4 h-4" />
                      )}
                      Look up
                    </button>
                  </div>
                  <p className="text-xs text-slate-600 mt-3">
                    Works with any public YouTube video — shorts, regular videos,
                    or direct youtu.be links.
                  </p>
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
                  {/* Thumbnail */}
                  {ytInfo.thumbnailUrl && (
                    <img
                      src={ytInfo.thumbnailUrl}
                      alt="thumbnail"
                      className="w-36 h-24 object-cover rounded-lg shrink-0 bg-slate-800"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-base leading-snug mb-1 truncate">
                      {ytInfo.title}
                    </p>
                    <div className="flex items-center gap-3 text-xs text-slate-400 mb-4">
                      <span className="flex items-center gap-1">
                        <User className="w-3 h-3" />
                        {ytInfo.author}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {Math.floor(ytInfo.durationSeconds / 60)}:
                        {String(ytInfo.durationSeconds % 60).padStart(2, "0")}
                      </span>
                    </div>
                    <div className="flex gap-2">
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
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* Processing overlay */}
      {isProcessing && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="bg-padel-surface rounded-2xl p-8 border border-padel-border"
        >
          <div className="text-center mb-6">
            <p className="font-semibold text-xl mb-1">Analyzing your swing...</p>
            <p className="text-sm text-slate-400">{progressMsg || "Preparing..."}</p>
          </div>

          {/* 4-step indicator */}
          <ProcessingSteps progressMsg={progressMsg} isDone={false} />

          {/* Shimmer progress bar */}
          <div className="w-full bg-slate-800 rounded-full h-3 mb-2 overflow-hidden mt-6">
            <motion.div
              className="h-full rounded-full shimmer-bar"
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ ease: "easeOut", duration: 0.4 }}
            />
          </div>
          <p className="text-center text-sm text-slate-400 mb-6 tabular-nums">
            {progress}% complete
          </p>

          {/* Enlarged skeleton canvas — hero of the processing screen */}
          <div className="flex justify-center">
            <canvas
              ref={canvasRef}
              width={480}
              height={360}
              className="rounded-xl bg-slate-900 border border-padel-border w-full max-w-lg"
            />
          </div>
        </motion.div>
      )}

      {/* Error */}
      {error && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-4 bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-start gap-3"
        >
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <p className="text-red-300 text-sm flex-1">{error}</p>
          <button
            onClick={reset}
            className="text-sm text-red-400 hover:text-red-300 underline shrink-0"
          >
            Try again
          </button>
        </motion.div>
      )}
    </motion.div>
  );
}
