/**
 * Video playback URL helper — no server required.
 * Run: tsx scripts/qa/video-playback.test.ts
 */
import { buildVideoPlaybackUrl } from "../../shared/videoPlayback.js";

function assert(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}:`, err);
    process.exitCode = 1;
  }
}

assert("local upload keys use /api/video without double uploads prefix", () => {
  const url = buildVideoPlaybackUrl("upload_abc123.mp4");
  if (url !== "/api/video/upload_abc123.mp4") {
    throw new Error(`unexpected url: ${url}`);
  }
});

assert("cloud object keys encode slash in single path segment", () => {
  const url = buildVideoPlaybackUrl("uploads/deadbeef.mp4");
  if (url !== "/api/video/uploads%2Fdeadbeef.mp4") {
    throw new Error(`unexpected url: ${url}`);
  }
});

assert("empty key returns empty url", () => {
  if (buildVideoPlaybackUrl("  ") !== "") {
    throw new Error("expected empty string for blank key");
  }
});

if (process.exitCode) {
  process.exit(process.exitCode);
}
console.log("All video playback unit checks passed.");
