/**
 * Court Flood UI colours for runtime canvas/SVG drawing (design.md § Theme).
 *
 * Single source of truth for every `ctx.strokeStyle` / overlay hex on the web
 * client. Brand tokens live in `index.css` for CSS; this module mirrors the
 * ones drawing code needs, plus high-visibility overlay colours chosen for
 * contrast against real video footage (data encodings, not brand accents).
 */

/** Brand tokens (mirror of index.css @theme — keep in sync via design.md). */
export const UI = {
  paper: "#0a0f2e",
  surface: "#131a40",
  raised: "#070b22",
  rule: "#28315e",
  flood: "#2b3fbd",
  flood2: "#2336a8",
  ink: "#f4f6ff",
  ink2: "#aab3d6",
  muted: "#6b75a3",
  accent: "#5b8cff",
  ctaInk: "#0a0f2e",
  sand: "#e8c468",
} as const;

/**
 * Overlay drawing colours — picked for legibility on top of video, not for
 * brand. Skeleton joints/limbs need to survive grass, blue court, and glass
 * reflections alike.
 */
export const OVERLAY = {
  /** Pose skeleton limbs. */
  skeleton: "#5b8cff",
  /** Pose joints. */
  joint: "#ffffff",
  /** Active/highlighted joint or segment. */
  highlight: "#e8c468",
  /** Ball trajectory path. */
  ball: "#ffd24a",
  /** Racket tracking. */
  racket: "#7ef0d4",
  /** Court calibration lines / homography grid. */
  courtLine: "#5b8cff",
  /** Court calibration handle fill. */
  courtHandle: "#ffffff",
  /** Semi-transparent scrims behind on-video text. */
  scrim: "rgba(7, 11, 34, 0.72)",
  /** On-video text. */
  text: "#f4f6ff",
} as const;
