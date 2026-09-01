# Ball Evaluation Workflow

This workflow keeps labeled videos in the local dataset and commits only the
small JSON labels or docs. Do not commit source clips, extracted frames, local
SQLite files, or runtime artifacts under `data/`.

## 1. Pick a Clip

Use a short clip in the private dataset, ideally 6-10 seconds with a mix of:

- visible ball frames
- not-visible or occluded frames
- typical padel motion for drive, volley, lob, smash, bandeja, or vibora

Example:

```bash
CLIP="$HOME/padel-ml-dataset/clips/manual/jHhql43o7uE_Bratislava_clip001_11m40s-11m48s.mp4"
OUT="$HOME/padel-ml-dataset/labels/ball/jHhql43o7uE_Bratislava_clip001_11m40s-11m48s"
```

## 2. Extract Frames

```bash
.venv/bin/python3 scripts/cv/tools/label_ball.py extract "$CLIP" "$OUT"
```

The extractor writes full-resolution JPEGs plus `manifest.json`. These are
local annotation artifacts and should stay out of git.

## 3. Label Frames

```bash
.venv/bin/python3 scripts/cv/tools/label_ball.py serve "$OUT"
```

Open the printed loopback URL. Click the ball center for visible frames; press
`n` when the ball is not visible; press `d` to clear a frame.

The labeler writes:

- a sibling JSON next to the source clip: `$CLIP` with `.json`
- a working copy at `$OUT/labels.json`

New labels store `"video": "<clip filename>"`, so they can be moved between the
dataset and repo fixture without hard-coding a local absolute path.

## 4. Run Headline Accuracy

The multi-clip TrackNet harness is the source of truth for ball-tracking
precision and recall:

```bash
.venv/bin/python3 scripts/cv/eval_ball_tracking.py \
  --clips "$HOME/padel-ml-dataset/clips/manual"
```

Useful sweeps:

```bash
for c in 0.25 0.35 0.45 0.55; do
  .venv/bin/python3 scripts/cv/eval_ball_tracking.py \
    --clips "$HOME/padel-ml-dataset/clips/manual" \
    --min-confidence "$c"
done

for t in 15 25 35; do
  .venv/bin/python3 scripts/cv/eval_ball_tracking.py \
    --clips "$HOME/padel-ml-dataset/clips/manual" \
    --tolerance-px "$t"
done
```

Track these headline fields: `precision`, `recall`, `mean_pixel_error`, `TP`,
`FN`, `FP_visible`, and `FP_invisible`.

## 5. Optional Backend Comparison

`scripts/cv/tests/test_ball_eval.py` compares OpenCV and TrackNet on the repo
fixture at `data/eval/ball/labels.json`. It is mainly a side-by-side backend
sanity check, not the headline accuracy number.

When the fixture JSON points at a local-only clip, either set a direct override:

```bash
PADEL_BALL_FIXTURE_VIDEO="$CLIP" .venv/bin/python3 scripts/cv/tests/test_ball_eval.py
```

or let the resolver search the dataset:

```bash
PADEL_BALL_DATASET_ROOT="$HOME/padel-ml-dataset" \
  .venv/bin/python3 scripts/cv/tests/test_ball_eval.py
```

Under pytest, the fixture test skips cleanly when the labels or video are not
present. This lets CI stay green without committing video fixtures.

## 6. Commit Hygiene

Good candidates to commit:

- code changes under `scripts/cv/`
- workflow docs
- small label fixtures when explicitly intended

Keep local:

- `*.mp4`, `*.mov`, extracted frame JPEGs
- `data/uploads/`, `data/rallies/`, `data/landmarks/`, `data/analysis-*`
- `data/padel.db*`

