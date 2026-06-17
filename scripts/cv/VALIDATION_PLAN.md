# CV Validation Plan (Phase 2 — ML/CV accuracy)

Scope: `scripts/cv/` only. This document records (a) what the scoring model
**claims** to do, (b) what is **unvalidated**, (c) the **minimal ground truth**
needed to validate it, and (d) correctness risks in the rally/court/dead-time
modules. It is written by inspection only — no accuracy numbers are invented.

---

## 1. CV health (as of 2026-06-18)

| Check | Command | Result |
|-------|---------|--------|
| Environment doctor | `npm run cv:doctor` | **PASS** (exit 0). mediapipe 0.10.33, opencv, numpy 2.4.4, scipy 1.17.1, onnxruntime 1.24.4, ffmpeg 8.1.1, yt-dlp 2026.03.17 all present. |
| CV unit tests | `npm run test:cv` | **PASS** — 117 passed, 1 skipped. |

Caveat from the doctor output: **`scripts/cv/models/tracknet-v2.onnx` does not
exist** (`exists: false, bytes: 0`). This means TrackNet ball inference cannot
actually run end-to-end today — every code path that loads the model will raise
`FileNotFoundError`. The single skipped pytest is consistent with this. The
ball-tracking harness below handles this and reports it rather than crashing.

---

## 2. Ball-tracking harness

### What exists
- `scripts/cv/tracknet_ball.py` — `TrackNetBallDetector`: wraps the TrackNetV2
  ONNX model. Takes a 3-frame BGR sliding window, returns the single
  current-frame peak (argmax of the heatmap) above `min_confidence` (default
  0.25). Reports (x, y) in source-frame coordinates + confidence.
- `scripts/cv/export_tracknet.py` — exports a PyTorch TrackNetV2 checkpoint to
  the ONNX file above (external repo + weights required).
- `scripts/cv/tests/test_ball_eval.py` — a **single-clip** eval harness that
  reads `data/eval/ball/labels.json`, runs the OpenCV `BallTracker` and the
  TrackNet runner, and reports detection-rate + false positives + mean pixel
  error at 25 px tolerance. Does **not** compute precision/recall over a
  multi-clip set and does not directly drive `TrackNetBallDetector`.

### What was added in Phase 2
- `scripts/cv/eval_ball_tracking.py` — **multi-clip precision/recall harness**
  that drives `TrackNetBallDetector` directly. It walks a directory of clips,
  pairs each `foo.mp4` with a sibling `foo.json` ground-truth file, runs the
  detector over every frame, and computes per-clip and aggregate:
  - TP / FN / FP-visible / FP-invisible
  - **precision** = TP / (TP + FP-visible + FP-invisible)
  - **recall** = TP / (TP + FN)
  - mean pixel error over TPs (default tolerance 25 px, env `PADEL_BALL_TOLERANCE_PX`)
  - `--dry-run` mode reports label coverage without running the detector.
  - The scoring math is unit-checked with a synthetic detector (TP=1, FN=2,
    FPvis=1, FPinvis=1 → precision=recall=1/3, MPE=10 px) and passes.

### Ground truth needed to validate ball tracking
**Status: BLOCKED on missing labels.** `~/padel-ml-dataset` contains 533
`.mp4` clips (organized by shot-type category) but **zero** per-frame ball
annotations — no `.json`/`.csv`/`.pkl`/`.npy` files with frame indices and ball
(x, y), no bbox files, clip filenames encode only time ranges. The only
metadata present is download provenance and a coarse shot-type category label.

Minimal ground truth required:
1. **5–10 coach-annotated clips** sampled across shot types
   (drive / volley / smash / bandeja / lob / vibora).
2. **Per-frame ball labels** in the format documented in
   `eval_ball_tracking.py` (sibling `<stem>.json`): `{frame, x, y, visible}`
   in source-pixel coordinates. ~200–500 labeled frames per clip.
3. **Both visible and not-visible frames**, otherwise precision's false-positive
   pool is empty and the number is uninformative.
4. A **second annotator** on a subset to estimate inter-annotator agreement
   (otherwise we cannot tell detector error from label noise).

Until that data exists, precision/recall **cannot** be measured. The harness
will print a `status: "blocked-on-data"` report and exit 0 (CI stays green).

### Known detector correctness risks (from reading `tracknet_ball.py`)
- **Single-peak only.** `_detection_from_heatmap` returns the global argmax
  only. If two balls are momentarily visible (e.g. a spare ball on court) or
  the heatmap has a secondary peak near a player, only the strongest is kept.
  This is by design but caps recall on ambiguous frames.
- **`peak_normalizer` default 1.0.** Confidence = `peak / peak_normalizer`
  clamped to [0,1]. With the default 1.0, confidence equals the raw heatmap peak
  and the 0.25 threshold has no calibration against any real dataset — it is a
  guess. Validation should also sweep `min_confidence` to produce a
  precision/recall curve, not report a single operating point.
- **No temporal association / no track smoothing.** Each window is scored
  independently; there is no Kalman or nearest-neighbour track continuity. A
  future eval of "track IDA/MOTA" is **not** supported by this harness — it
  measures per-frame detection only.

---

## 3. Scoring audit (`scripts/cv/scoring.py`)

### What the model claims
A lightweight, **ML-free heuristic** state machine that turns rally boundaries
(+ optional ball/shot cues) into padel point events and a running game score
(points/games/sets) with deuce/advantage and a 2-game lead to win a set.

Inputs:
- a list of rally dicts (`start`/`end` seconds, optional `avg_motion`), and
- an optional `ball_tracking` payload whose `shots` list may carry
  `timestamp_sec` and `court_y`/`shot_type`.

Outputs:
- `points[]`: one `PointEvent` per rally longer than `min_rally_duration_sec`
  (default 0.4 s).
- `score`: points/games/sets + a display string.

### What is unvalidated
- **Winning-side inference (`_infer_winning_side`) is the central claim and is
  entirely heuristic, with no accuracy evidence.** In order of fallback:
  1. If the last shot of the rally has a `court_y`, the winner is decided by
     `side_b if court_y >= 10.0 else side_a`. The 10.0 m constant assumes a
     20 m court whose net sits at exactly y=10 **and** that the court
     coordinate system is consistently oriented and calibrated. This is the
     single most fragile assumption in the module.
  2. Else if the last shot's `shot_type` contains `"direction_change"`, parity
     of the rally index decides the winner.
  3. Else `avg_motion > 0` → parity decides.
  4. Else parity decides.
  Steps 2–4 are **coin-flip rules** (alternating by rally index); they have no
  signal content and will be right ~50% of the time. They exist to keep the
  state machine advancing, not to be correct.
- **The point/game/set bookkeeping has not been checked against a real
  scored match.** The deuce branch (`a_pts >= 4 and b_pts >= 4`) and the
  "win set with 6 games + 2 lead" branch are implemented but:
  - There is **no Golden Point / no-advantage** rule (used on the pro tour
    since 2023); the module always plays deuce/advantage.
  - There is **no tiebreak** — a 6–6 set never resolves. `_award_game` only
    closes a set at 6+ games with a 2-game lead; 6-all would just keep adding
    games indefinitely.
  - `sets_to_win=2` is hardcoded; best-of-3 vs best-of-5 is not modelled.
- **`max_rally_gap_sec` / `players_per_side` config fields are declared but
  never read** by any function in the module — dead config.
- **`avg_motion`** (rally-level) is read as a boolean (`> 0`), discarding all
  magnitude information.

### Minimal ground truth to validate scoring
1. **3–5 full matches with an official scoreboard** (WPT/Premier Padel box
   scores or broadcast graphics), each providing the rally-by-rally point
   winner and the final games/sets.
2. For each match, run the full pipeline (rally detection → ball tracking →
   `score_match`) and compare:
   - per-rally **winning_side accuracy** (the real metric this module should be
     judged on), and
   - final **set score** and **point total**.
3. Expected honest outcome given the heuristics above: winning-side accuracy
   near chance unless `court_y` is reliably populated, and set scores that
   drift because there is no tiebreak. Treat those as known gaps to fix, not as
   bugs to be surprised by later.

**Do not ship any "X% scoring accuracy" number until a labeled match has been
scored end-to-end.** This plan asserts none.

---

## 4. Rally / court / dead-time correctness risks

These are **risks identified by reading the source**, not measured failures.
Each is a place where a hard-coded threshold or untested edge case can silently
produce wrong output. None has been validated against labeled data.

### `rally_detector.py`
- **Heavy hard-coded threshold set** (all defaults, none tuned on this
  dataset): `enter_threshold=0.20`, `exit_threshold=0.09`,
  `min_rally_ms=1000`, `max_rally_ms=60000`, `merge_gap_ms=900`,
  `pad_pre_ms=250`, `pad_post_ms=400`, `shake_high_ratio=0.80`,
  `duration_bonus_cap_ms=8000`, and the feature weights
  (`motion_weight=0.45`, `velocity_weight=0.20`, `audio_weight=0.25`,
  `shot_weight=0.10`).
- **`merge_gap_ms=900`** assumes rallies are separated by < 0.9 s of dead time;
  longer natural pauses (slow play, disputes) will **merge two rallies into
  one**, inflating `shot_count` and corrupting point boundaries downstream.
- **Audio band `[800, 8000] Hz` + `peak_min_distance_ms=120`** is tuned for
  ball-impact spectra; off-court audio (commentary, crowd) in the same band can
  fire false shot peaks. `audio_extraction_timeout_sec=60` means a hung ffmpeg
  is killed at 60 s — fine, but a near-60 s extraction silently truncates.
- **`fps = inputs.fps or 30.0`** — a 0/missing fps silently becomes 30; on
  variable-framerate or 60 fps source this skews every ms→frame conversion.

### `court_mapping.py`
- **`grid_width=10.0`, `grid_height=20.0`** are the canonical padel court
  metres, but the net heuristic in scoring (`court_y >= 10.0`) depends on the
  homography mapping the actual net to y=10. **No test verifies the homography
  places the net at y=10** on real footage; if the camera is offset the
  "winning side" flips.
- **`max_association_distance_px=80.0`** for ball→track association: at low
  resolution or high ball speed (>80 px/frame) genuine ball positions are
  dropped as unassociatable → silent recall loss.
- **Ball blob filter** `ball_min_area=6`, `ball_max_area=500`,
  `ball_min_circularity=0.35`: at 1080p a real ball can exceed 500 px² when
  motion-blurred/deflated-circularity <0.35, so it is rejected. Hard-coded to
  one resolution regime.
- **Shot classification** (`cosine < -0.25 → direction_change`,
  `speed_change > 0.55 → velocity_change`) — these thresholds are guesses;
  classification accuracy is unmeasured.
- **Fallback `fps = 30.0`** when `CAP_PROP_FPS` returns 0 — same silent-skew
  risk as in rally_detector.

### `dead_time_trimmer.py`
- **`motion_threshold=0.05`, `active_threshold=0.15`, `dead_threshold=0.08`**
  — the active/dead decision is a two-threshold band; the gap between 0.08 and
  0.15 is a hysteresis region whose behaviour depends on the previous state.
  No labelled active/deed segments back these numbers.
- **`velocity_norm_factor=50.0`** (px/frame saturation) assumes a specific
  camera distance; zoomed footage saturates the velocity term to 1.0 and
  over-weights velocity.
- **`fps = cap.get(CAP_PROP_FPS) or 30.0`** repeated in three places — same
  silent-30-fps fallback.
- **`padding_sec=1.0`** added around every active segment: with many short
  active bursts this can **re-overlap previously trimmed dead time**, inflating
  the kept duration.

### Cross-cutting
- The **0-fps → 30 fallback** appears in `rally_detector.py`, `court_mapping.py`
  (twice), and `dead_time_trimmer.py`. A single shared fps resolver with a
  loud warning would reduce silent skew.
- Every module's thresholds are **class-level defaults with no per-source
  calibration**. The honest validation path is: collect labelled segments for
  (rally start/end, court net position, active/deed) and tune against them —
  none of that data exists yet.

---

## 5. Summary

| Subsystem | Validation status | Blocker |
|-----------|-------------------|---------|
| CV environment + unit tests | **Validated** (doctor pass, 117/1 tests pass) | TrackNet ONNX model file missing — inference cannot run |
| Ball tracking precision/recall | **Blocked on data** | No per-frame ball labels in dataset (0/533 clips labeled); harness built and self-checked, ready to run when labels exist |
| Scoring (winning-side / scoreboard) | **Blocked on data** | No rally-by-rally point-winner ground truth; heuristics (esp. net-at-10 m and parity fallbacks) are unvalidated and likely near-chance |
| Rally / court / dead-time thresholds | **Blocked on data** | Hard-coded thresholds untuned; no labelled active/deed or net-position segments |

**Next actions (data-first, not code-first):**
1. Annotate 5–10 dataset clips with per-frame ball positions → run
   `python scripts/cv/eval_ball_tracking.py --clips <labeled_dir>`.
2. Obtain/export TrackNet ONNX (`npm run cv:doctor` shows the model file is
   absent) so inference actually runs.
3. Label 3–5 full matches with rally winners + final score → exercise
   `score_match` end-to-end and record honest winning-side accuracy.
4. Only after steps 1–3: tune the hard-coded thresholds above against the new
   labels.
