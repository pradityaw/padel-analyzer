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

### `analysis.getById`

Input:

```json
{
  "id": 456
}
```

Output:

- full analysis row including `phasesJson` and `landmarksJson`

## Static asset contract

- Uploaded video playback URL: `/uploads/:storageKey`

The mobile app currently opens the stored upload URL externally instead of rendering a native overlay replay.

## Server-side analysis runtime contract

The backend expects:

- `python3` available on `PATH`
- dependencies from `scripts/requirements-server-analysis.txt`

Runner path:

- `scripts/analyze_video.py`

Behavior:

- returns an `AnalysisResult`-compatible JSON payload
- failure surfaces through the job `errorMessage`
