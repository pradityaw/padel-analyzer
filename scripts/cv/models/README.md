# TrackNet ball-detection model

`tracknet-v2.onnx` is the TrackNet **V2** ball-detection model used by
`scripts/cv/tracknet_ball.py` (`TrackNetBallDetector`).

## Model I/O contract

| | tensor name | shape | notes |
|---|---|---|---|
| Input  | `frames`    | `[N, 9, 288, 512]` (NCHW) | 3 consecutive BGR frames → RGB → resized to 512×288 → `/255` → channels-first, concatenated (`scripts/cv/tracknet_ball.py:_preprocess`) |
| Output | `activation_18` | `[N, 3, 288, 512]` | 3 sigmoid heatmaps; the detector takes the **last** channel as the current frame (`_extract_current_heatmap`). Peak → ball pixel. |

## Provenance

- **Architecture + weights:** NYCU/NCTU TrackNetV2, `3_in_3_out` variant, checkpoint
  `model906_30` — the **original authors'** canonical release.
- **Source:** <https://gitlab.nol.cs.nycu.edu.tw/open-source/TrackNetv2> (`3_in_3_out/`)
- **Obtained:** 2026-06-18.
- **Export path:** the upstream model is a Keras (HDF5, `channels_first`) full model. It was
  converted to ONNX (opset 13, NCHW I/O preserved) with `tf2onnx` from an isolated Python ≤3.13
  venv (TensorFlow can't run `channels_first` MaxPool on CPU, and doesn't support the repo's
  Python 3.14, so the one-time export is done outside this repo). The conversion is *symbolic*
  — no inference at export time — and the resulting ONNX was validated with `onnx.checker` and
  `onnxruntime`.

## ⚠️ License — read this before distributing anything

**The NYCU TrackNetV2 source has NO explicit license file** (verified via the GitLab project API:
`license: null`; the repository tree contains no `LICENSE`). Default copyright therefore applies
("all rights reserved"). It is an **academic research release** by the original authors, published
openly by the university lab for the research community — it is **not** cleared for commercial use.

Treat `tracknet-v2.onnx` accordingly:

- ✅ **Allowed:** server-side / internal / personal / research use (this is how the app uses it:
  TrackNet runs on the server; the weights never reach end-user clients).
- ❌ **Not allowed without permission:** distributing the ONNX, baking it into a shipped Docker
  image or any published/downloadable artifact, or using it in a commercial product.
- **Before any commercial distribution:** obtain an explicit license from the NYCU TrackNet
  maintainers, or replace these weights with a cleanly-licensed alternative (e.g. weights
  self-trained on permissively-licensed code such as `mareksubocz/TrackNet`, MIT).

> Note: an earlier assessment called these weights "GPL-3.0". That was an **unverified** claim —
> no GPL license exists in the source. The accurate status is "no explicit license" as above.

## Git

The model is **not committed**. `models/.gitignore` (`*`, `!.gitignore`) excludes it, so the
~43 MB ONNX stays local and out of version history.
