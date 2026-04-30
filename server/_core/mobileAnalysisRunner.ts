import path from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { analysisResultSchema } from "../../shared/schema.js";

const exec = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const analyzeScript = path.join(rootDir, "scripts/analyze_video.py");
const venvPython = path.join(rootDir, ".venv/bin/python3");

function resolvePython(): string {
  const fromEnv = process.env.MOBILE_ANALYSIS_PYTHON?.trim();
  if (fromEnv) return fromEnv;
  if (existsSync(venvPython)) return venvPython;
  return "python3";
}

export async function runMobileAnalysis(videoPath: string) {
  const pythonBin = resolvePython();
  const { stdout } = await exec(
    pythonBin,
    [analyzeScript, videoPath],
    {
      cwd: rootDir,
      timeout: 5 * 60 * 1000,
      maxBuffer: 50 * 1024 * 1024,
    }
  );

  const parsed = JSON.parse(stdout);
  return analysisResultSchema.parse(parsed);
}
