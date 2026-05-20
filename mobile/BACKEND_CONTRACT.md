# Mobile Backend Contract

## Base URL

The native app uses `EXPO_PUBLIC_API_BASE_URL` as the backend origin.

Examples:

- iOS simulator / Android emulator: `http://localhost:3001`
- physical device on local network: `http://192.168.x.x:3001`
- hosted API: `https://api.your-domain.com`

## Health check

`GET /healthz`

Response:

```json
{
  "ok": true,
  "service": "padel-analyzer",
  "uploadsPath": "/uploads",
  "trpcPath": "/api/trpc"
}
```

## Upload contract

`POST /api/upload`

Multipart form field:

- `file`: video file

Success response:

```json
{
  "storageKey": "uploaded-file-name.mp4"
}
```

## tRPC procedures used by mobile v1

### `mobileAnalysis.create`

Input:

```json
{
  "videoFileName": "swing.mp4",
  "videoStorageKey": "stored-video.mp4"
}
```

Output:

- returns the created analysis job row

### `analysis.getById`

Input: `{ "id": <analysisId> }`

The mobile Analysis screen uses this after a job completes. Besides pose fields (`phasesJson`, `landmarksJson`, scores), the server may attach:

- `ballTracking`: `[frameIndex, imageX, imageY, confidence][]` (best-effort; empty if CV artifacts missing)
- `racketTracking`: `[frameIndex, playerId, imageX, imageY, confidence][]` (returned by API; **not rendered on mobile** in the current beta)
- `trackingMeta`: `{ sourceJobId, ballSampleCount, racketSampleCount }` (diagnostics)

Artifacts are loaded from the **latest completed** `analysis_jobs` row for this analysis (`data/analysis-agents/job-{jobId}.json`).

### `mobileAnalysis.getById`

Input:

```json
{
  "id": 123
}
```

Output:

- returns the job row or `null`

Statuses:

- `queued`
- `processing`
- `completed`
- `failed`

### `analysis.list`

Input used by mobile v1:

```json
{
  "limit": 20
}
```

Output:

- paginated list payload `{ items, nextCursor, hasMore }`

## Static asset contract

- Uploaded video playback URL: `/uploads/:storageKey`

The Analysis screen plays in-app video with an SVG skeleton + ball overlay when data is available.

## Server-side analysis runtime contract

The backend expects:

- `python3` available on `PATH`
- dependencies from `scripts/requirements-server-analysis.txt`

Runner path:

- `scripts/analyze_video.py`

Behavior:

- returns an `AnalysisResult`-compatible JSON payload
- failure surfaces through the job `errorMessage`
