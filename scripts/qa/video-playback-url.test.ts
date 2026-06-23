/**
 * Video playback URL resolution for local vs cloud storage keys.
 * Run: tsx scripts/qa/video-playback-url.test.ts
 */
import { readFileSync } from "fs";
import path from "path";

function assert(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}:`, err);
    process.exitCode = 1;
  }
}

function readSource(relPath: string): string {
  return readFileSync(path.resolve(process.cwd(), relPath), "utf8");
}

assert("resolveVideoPlaybackUrl is exported from videoAccess", () => {
  const source = readSource("server/lib/videoAccess.ts");
  if (!source.includes("export async function resolveVideoPlaybackUrl")) {
    throw new Error("missing resolveVideoPlaybackUrl");
  }
  if (!source.includes("createPresignedGetUrl")) {
    throw new Error("cloud playback must use presigned GET");
  }
});

assert("analysis.getById attaches videoPlaybackUrl", () => {
  const source = readSource("server/routers/analysis.ts");
  if (!source.includes("resolveVideoPlaybackUrl")) {
    throw new Error("analysis router must resolve playback URL");
  }
  if (!source.includes("videoPlaybackUrl")) {
    throw new Error("analysis.getById must return videoPlaybackUrl");
  }
});

assert("web Analysis page prefers videoPlaybackUrl", () => {
  const source = readSource("client/src/pages/Analysis.tsx");
  if (!source.includes("data.videoPlaybackUrl")) {
    throw new Error("Analysis.tsx must use videoPlaybackUrl from server");
  }
});
