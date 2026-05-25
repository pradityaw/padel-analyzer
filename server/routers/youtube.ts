import { z } from "zod";
import { router, publicProcedure } from "../_core/trpc.js";
import { mkdirSync, existsSync } from "fs";
import path from "path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getUploadsDir } from "../lib/paths.js";
import {
  YOUTUBE_DOWNLOAD_DEFAULT_TIMEOUT_MS,
  YOUTUBE_MAX_DURATION_SEC,
} from "../../shared/config.js";

const execFileAsync = promisify(execFile);
const YOUTUBE_INFO_TIMEOUT_MS = Number(
  process.env.YOUTUBE_INFO_TIMEOUT_MS || 2 * 60 * 1000
);
const YOUTUBE_MAX_BUFFER_BYTES = 100 * 1024 * 1024;

const uploadsDir = getUploadsDir();
mkdirSync(uploadsDir, { recursive: true });

const YOUTUBE_HOSTS = [
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "music.youtube.com",
];

function isYouTubeUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return YOUTUBE_HOSTS.some(
      (h) => u.hostname === h || u.hostname.endsWith("." + h)
    );
  } catch {
    return false;
  }
}

const ytUrlSchema = z
  .string()
  .min(1, "Please enter a URL")
  .refine((v) => isYouTubeUrl(v), {
    message:
      "Not a valid YouTube URL. Paste a link from youtube.com or youtu.be.",
  });

type VideoInfo = {
  id: string;
  title: string;
  duration: number;
  thumbnail: string;
  uploader: string;
};

function assertWithinDurationLimit(durationSec: number): void {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error(
      "Could not determine the video length. Live streams and unavailable videos are not supported."
    );
  }
  if (durationSec > YOUTUBE_MAX_DURATION_SEC) {
    throw new Error(
      `Video too long. Please use a clip under ${YOUTUBE_MAX_DURATION_SEC / 60} minutes for analysis.`
    );
  }
}

async function getVideoInfo(url: string): Promise<VideoInfo> {
  const { stdout } = await execFileAsync("yt-dlp", [
    "--no-warnings",
    "--dump-json",
    "--no-download",
    url,
  ], {
    maxBuffer: YOUTUBE_MAX_BUFFER_BYTES,
    timeout: YOUTUBE_INFO_TIMEOUT_MS,
  });

  const data = JSON.parse(stdout);
  return {
    id: data.id ?? data.display_id ?? "unknown",
    title: data.title ?? "Untitled",
    duration: typeof data.duration === "number" ? data.duration : 0,
    thumbnail: data.thumbnail ?? "",
    uploader: data.uploader ?? data.channel ?? "",
  };
}

async function downloadVideo(
  url: string,
  outputPath: string
): Promise<void> {
  await execFileAsync(
    "yt-dlp",
    [
      "--no-warnings",
      "-f",
      "best[ext=mp4]/best",
      "--no-playlist",
      "-o",
      outputPath,
      url,
    ],
    {
      maxBuffer: YOUTUBE_MAX_BUFFER_BYTES,
      timeout: Number(
        process.env.YOUTUBE_DOWNLOAD_TIMEOUT_MS || YOUTUBE_DOWNLOAD_DEFAULT_TIMEOUT_MS
      ),
    }
  );
}

export const youtubeRouter = router({
  getInfo: publicProcedure
    .input(z.object({ url: ytUrlSchema }))
    .mutation(async ({ input }) => {
      const info = await getVideoInfo(input.url);
      assertWithinDurationLimit(info.duration);

      return {
        videoId: info.id,
        title: info.title,
        durationSeconds: Math.round(info.duration),
        thumbnailUrl: info.thumbnail,
        author: info.uploader,
      };
    }),

  download: publicProcedure
    .input(z.object({ url: ytUrlSchema }))
    .mutation(async ({ input }) => {
      const info = await getVideoInfo(input.url);
      assertWithinDurationLimit(info.duration);

      const safeTitle = info.title
        .replace(/[^a-zA-Z0-9_\- ]/g, "")
        .slice(0, 60)
        .trim()
        .replace(/\s+/g, "_");

      const fileName = `yt_${info.id}_${safeTitle}.mp4`;
      const filePath = path.join(uploadsDir, fileName);

      if (!existsSync(filePath)) {
        await downloadVideo(input.url, filePath);
      }

      return {
        fileName,
        localUrl: `/uploads/${fileName}`,
        title: info.title,
        durationSeconds: Math.round(info.duration),
      };
    }),
});
