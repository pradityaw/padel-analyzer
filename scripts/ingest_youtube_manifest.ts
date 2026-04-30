import { execFile as execFileCb } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";
import { z } from "zod";
import { appRouter } from "../server/routers/index.js";
import {
  buildSafeTitle,
  downloadYouTubeToUploads,
  getVideoInfo,
  ytUrlSchema,
} from "../server/routers/youtube.js";
import { SHOT_TYPES } from "../shared/types.js";

const execFile = promisify(execFileCb);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const clipConfigSchema = z.object({
  threshold: z.number().positive().optional(),
  minDuration: z.number().positive().optional(),
  maxDuration: z.number().positive().optional(),
  minGap: z.number().nonnegative().optional(),
  sampleFps: z.number().int().positive().optional(),
});

const manifestEntrySchema = z.object({
  url: ytUrlSchema,
  shotType: z.enum(SHOT_TYPES as unknown as [string, ...string[]]),
  label: z.string().min(1).optional(),
  notes: z.string().max(2_000).optional(),
  clipConfig: clipConfigSchema.optional(),
});

const manifestSchema = z.object({
  manifestName: z.string().min(1).optional(),
  defaults: clipConfigSchema.optional(),
  entries: z.array(manifestEntrySchema).min(1),
});

type Manifest = z.infer<typeof manifestSchema>;
type ClipConfig = z.infer<typeof clipConfigSchema>;

type ParsedArgs = {
  manifest: string;
  outputRoot: string;
  pythonBin: string;
  db: string;
  train: boolean;
  dryRun: boolean;
  device: string;
};

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    manifest: "",
    outputRoot: path.join(rootDir, "data", "youtube-amateur"),
    pythonBin: existsSync(path.join(rootDir, ".venv", "bin", "python"))
      ? path.join(rootDir, ".venv", "bin", "python")
      : "python3",
    db: path.join(rootDir, "data", "padel.db"),
    train: false,
    dryRun: false,
    device: "auto",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--manifest") {
      args.manifest = argv[++i] ?? "";
    } else if (arg === "--output-root") {
      args.outputRoot = path.resolve(argv[++i] ?? args.outputRoot);
    } else if (arg === "--python-bin") {
      args.pythonBin = argv[++i] ?? args.pythonBin;
    } else if (arg === "--db") {
      args.db = path.resolve(argv[++i] ?? args.db);
    } else if (arg === "--device") {
      args.device = argv[++i] ?? args.device;
    } else if (arg === "--train") {
      args.train = true;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.manifest) {
    throw new Error("Usage: npx tsx scripts/ingest_youtube_manifest.ts --manifest <file> [--train]");
  }

  args.manifest = path.resolve(args.manifest);
  return args;
}

function mergeClipConfig(defaults: ClipConfig | undefined, entry: ClipConfig | undefined) {
  return {
    threshold: entry?.threshold ?? defaults?.threshold ?? 0.015,
    minDuration: entry?.minDuration ?? defaults?.minDuration ?? 1.5,
    maxDuration: entry?.maxDuration ?? defaults?.maxDuration ?? 6.0,
    minGap: entry?.minGap ?? defaults?.minGap ?? 1.0,
    sampleFps: entry?.sampleFps ?? defaults?.sampleFps ?? 15,
  };
}

function bumpCount(map: Record<string, number>, key: string, value = 1) {
  map[key] = (map[key] ?? 0) + value;
}

async function runLogged(command: string, args: string[], cwd = rootDir) {
  const rendered = [command, ...args].join(" ");
  console.log(`\n$ ${rendered}`);
  const result = await execFile(command, args, {
    cwd,
    maxBuffer: 50 * 1024 * 1024,
  });
  if (result.stdout.trim()) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr.trim()) {
    process.stderr.write(result.stderr);
  }
  return result;
}

async function exportTrainingJson() {
  const caller = appRouter.createCaller({});
  const shot = await caller.annotation.exportTrainingData();
  const skill = await caller.annotation.exportSkillTrainingData();
  const trainingDir = path.join(rootDir, "training", "data");
  mkdirSync(trainingDir, { recursive: true });
  writeFileSync(path.join(trainingDir, "training_data.json"), JSON.stringify(shot, null, 0));
  writeFileSync(
    path.join(trainingDir, "skill_training_data.json"),
    JSON.stringify(skill, null, 0)
  );
  return {
    shotSamples: shot.samples.length,
    skillSamples: skill.samples.length,
  };
}

async function retrainArtifacts(pythonBin: string, device: string) {
  const exportStats = await exportTrainingJson();
  await runLogged(pythonBin, [
    "training/train.py",
    "--data",
    "training/data/training_data.json",
    "--device",
    device,
  ]);
  await runLogged(pythonBin, ["training/export_onnx.py"]);
  await runLogged(pythonBin, [
    "training/compute_ranges.py",
    "--data",
    "training/data/training_data.json",
    "--export-benchmarks",
  ]);
  await runLogged(pythonBin, [
    "training/train_skill.py",
    "--data",
    "training/data/skill_training_data.json",
    "--device",
    device,
  ]);
  await runLogged(pythonBin, ["training/export_skill_onnx.py"]);
  return exportStats;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifestRaw = JSON.parse(readFileSync(args.manifest, "utf8"));
  const manifest = manifestSchema.parse(manifestRaw) as Manifest;
  const manifestName =
    manifest.manifestName ?? buildSafeTitle(path.basename(args.manifest, path.extname(args.manifest)));
  const ingestRoot = path.join(args.outputRoot, manifestName);
  mkdirSync(ingestRoot, { recursive: true });

  console.log(`Manifest: ${args.manifest}`);
  console.log(`Entries: ${manifest.entries.length}`);
  console.log(`Output root: ${ingestRoot}`);
  console.log(`Python: ${args.pythonBin}`);
  console.log(`Database: ${args.db}`);

  const aggregate = {
    processed: 0,
    failed: 0,
    shotCounts: {} as Record<string, number>,
    referenceTierCounts: {} as Record<string, number>,
    qualityBandCounts: {} as Record<string, number>,
    reviewCandidates: [] as string[],
    entries: [] as Array<Record<string, unknown>>,
  };

  for (const [index, entry] of manifest.entries.entries()) {
    const clipConfig = mergeClipConfig(manifest.defaults, entry.clipConfig);
    const dryRunLabel =
      entry.label ?? `${index + 1}_${entry.shotType}_${buildSafeTitle(manifestName).slice(0, 24)}`;
    let info:
      | {
          id: string;
          title: string;
          duration: number;
        }
      | undefined;
    let entryLabel = dryRunLabel;

    if (!args.dryRun) {
      info = await getVideoInfo(entry.url);
      entryLabel =
        entry.label ?? `${index + 1}_${info.id}_${buildSafeTitle(info.title).slice(0, 32)}`;
    }

    const entryDir = path.join(ingestRoot, entryLabel);
    const clipDir = path.join(entryDir, "clips");
    const bulkReportPath = path.join(entryDir, "bulk_report.json");
    mkdirSync(entryDir, { recursive: true });
    mkdirSync(clipDir, { recursive: true });

    console.log(`\n=== [${index + 1}/${manifest.entries.length}] ${entryLabel} ===`);
    console.log(`URL: ${entry.url}`);
    console.log(`Shot type: ${entry.shotType}`);
    if (info) {
      console.log(`Duration: ${Math.round(info.duration)}s`);
    }

    if (args.dryRun) {
      aggregate.entries.push({
        label: entryLabel,
        url: entry.url,
        shotType: entry.shotType,
        clipConfig,
        dryRun: true,
      });
      continue;
    }

    const download = await downloadYouTubeToUploads(entry.url, { allowLongVideos: true });
    const note = [
      `manifest:${manifestName}`,
      `entry:${entryLabel}`,
      "labelSource:heuristic_bootstrap",
      entry.notes?.trim() || "",
    ]
      .filter(Boolean)
      .join(" | ");

    await runLogged(args.pythonBin, [
      "scripts/extract_clips.py",
      download.filePath,
      "--output-dir",
      clipDir,
      "--threshold",
      String(clipConfig.threshold),
      "--min-duration",
      String(clipConfig.minDuration),
      "--max-duration",
      String(clipConfig.maxDuration),
      "--min-gap",
      String(clipConfig.minGap),
      "--prefix",
      buildSafeTitle(entryLabel).slice(0, 40),
    ]);

    await runLogged(args.pythonBin, [
      "scripts/bulk_process.py",
      clipDir,
      "--db",
      args.db,
      "--reference-tier",
      "amateur_curated",
      "--shot-type",
      entry.shotType,
      "--source-type",
      "youtube",
      "--source-url",
      entry.url,
      "--sample-fps",
      String(clipConfig.sampleFps),
      "--quality-band-mode",
      "heuristic",
      "--notes",
      note,
      "--report-json",
      bulkReportPath,
    ]);

    const bulkReport = JSON.parse(readFileSync(bulkReportPath, "utf8")) as {
      processed: number;
      failed: number;
      shotCounts: Record<string, number>;
      referenceTierCounts: Record<string, number>;
      qualityBandCounts: Record<string, number>;
      reviewCandidates: string[];
      analysisIds: number[];
    };

    aggregate.processed += bulkReport.processed;
    aggregate.failed += bulkReport.failed;
    Object.entries(bulkReport.shotCounts).forEach(([key, value]) =>
      bumpCount(aggregate.shotCounts, key, value)
    );
    Object.entries(bulkReport.referenceTierCounts).forEach(([key, value]) =>
      bumpCount(aggregate.referenceTierCounts, key, value)
    );
    Object.entries(bulkReport.qualityBandCounts).forEach(([key, value]) =>
      bumpCount(aggregate.qualityBandCounts, key, value)
    );
    aggregate.reviewCandidates.push(...bulkReport.reviewCandidates);
    aggregate.entries.push({
      label: entryLabel,
      shotType: entry.shotType,
      url: entry.url,
      videoId: info!.id,
      title: info!.title,
      durationSeconds: Math.round(info!.duration),
      clipConfig,
      ...bulkReport,
    });
  }

  const sparseBands = Object.entries(aggregate.qualityBandCounts)
    .filter(([, count]) => count < 15)
    .map(([band]) => band);

  const report = {
    manifest: args.manifest,
    manifestName,
    generatedAt: new Date().toISOString(),
    outputRoot: ingestRoot,
    totals: {
      processed: aggregate.processed,
      failed: aggregate.failed,
      shotCounts: aggregate.shotCounts,
      referenceTierCounts: aggregate.referenceTierCounts,
      qualityBandCounts: aggregate.qualityBandCounts,
    },
    manualReview: {
      sparseBands,
      lowConfidenceClipCount: aggregate.reviewCandidates.length,
      lowConfidenceClips: aggregate.reviewCandidates,
    },
    entries: aggregate.entries,
  };

  const reportsDir = path.join(rootDir, "data", "reports");
  mkdirSync(reportsDir, { recursive: true });
  const reportPath = path.join(
    reportsDir,
    `youtube_amateur_ingest_${Date.now()}.json`
  );
  writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log("\n=== Ingest Summary ===");
  console.log(`Processed clips: ${aggregate.processed}`);
  console.log(`Failed clips: ${aggregate.failed}`);
  console.log(`Shot counts: ${JSON.stringify(aggregate.shotCounts)}`);
  console.log(`Reference tier counts: ${JSON.stringify(aggregate.referenceTierCounts)}`);
  console.log(`Quality band counts: ${JSON.stringify(aggregate.qualityBandCounts)}`);
  if (aggregate.reviewCandidates.length > 0) {
    console.log(
      `Manual review suggested for ${aggregate.reviewCandidates.length} low-confidence clips.`
    );
  }
  if (sparseBands.length > 0) {
    console.log(`Sparse quality bands to review: ${sparseBands.join(", ")}`);
  }
  console.log(`Report written to ${reportPath}`);

  if (args.train && !args.dryRun) {
    console.log("\n=== Retraining Artifacts ===");
    const exportStats = await retrainArtifacts(args.pythonBin, args.device);
    console.log(
      `Exported ${exportStats.shotSamples} shot samples and ${exportStats.skillSamples} skill samples.`
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
