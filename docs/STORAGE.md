# Object Storage

> Phase 1.3 — local-vs-S3 abstraction review. Verified 2026-06-18.

## TL;DR

The storage layer already supports a clean **local-disk vs S3/R2** switch with
zero code changes — you flip environment variables. The abstraction is sound
and the contract test (`scripts/qa/object-storage.test.ts`, run via
`npm run test:contracts`) passes. To go live on S3/R2 you only need to provide
the four `OBJECT_STORAGE_*` env vars and create a bucket.

---

## How it works

Two storage modes, selected automatically at runtime:

| Mode | When | Where files live |
|---|---|---|
| **local** (default) | `OBJECT_STORAGE_BUCKET` (etc.) unset | `data/uploads/` on disk; key = multer filename |
| **cloud** | bucket + creds set | S3/R2 object; key = `<prefix>/<random>.<ext>` |

The switch is a single predicate: `isObjectStorageConfigured()` in
[`server/lib/objectStorage.ts`](../server/lib/objectStorage.ts). Every code path
that reads/writes a video branches on it, so nothing else needs to change.

### Upload path

- **Local:** client `POST /api/upload` (multipart) → multer writes to disk →
  returns `{ storageKey }`. Router: [`objectStorageRouter.getCapabilities`](../server/routers/objectStorage.ts)
  advertises `mode: "local"`, `uploadUrl: "/api/upload"`.
- **Cloud:** client calls `objectStorage.initiateUpload` → server returns a
  **presigned PUT** (single-part for ≤100 MiB) or a **multipart plan**
  (`createMultipartUpload` + per-part presigned PUTs) for large clips. Client
  uploads directly to S3/R2, then calls `objectStorage.completeUpload` → server
  verifies via `HeadObject` (`assertObjectExists`) and optionally checks size.

### Processing path (cloud → local)

The Python CV pipeline needs a local filesystem path. For cloud objects,
[`resolveVideoUriForProcessing`](../server/lib/videoAccess.ts) delegates to
[`ensureLocalVideoPath`](../server/lib/videoProcessingCache.ts), which:

1. Generates a presigned GET URL (`createPresignedGetUrl`).
2. Downloads the object once into `data/processing-cache/` (atomic `.part` →
   `rename`).
3. Reuses the cached file on subsequent runs of the same `storageKey`.

Local mode skips all of this and reads the file straight from `data/uploads/`.

### Key-format invariants (covered by the contract test)

- Cloud keys are always `<prefix>/<id>.<ext>` (`buildObjectStorageKey`), default
  prefix `uploads`.
- `isCloudStorageKey()` only returns true when cloud is configured **and** the
  key starts with the prefix — so legacy local keys (e.g. `upload_*.mp4`) are
  never misread as cloud objects after you enable S3.
- Unknown extensions fall back to `.mp4`.

---

## What's needed to enable S3 / R2

Set these on the server (Fly secrets, `.env`, etc.):

```
OBJECT_STORAGE_BUCKET=<bucket-name>
OBJECT_STORAGE_ACCESS_KEY_ID=<key>
OBJECT_STORAGE_SECRET_ACCESS_KEY=<secret>
# Optional but usually required for non-AWS providers:
OBJECT_STORAGE_ENDPOINT=<https://....r2.cloudflarestorage.com | MinIO URL>
OBJECT_STORAGE_FORCE_PATH_STYLE=true        # R2 / MinIO
OBJECT_STORAGE_REGION=auto                  # R2; use e.g. us-east-1 for AWS
```

Optional tuning (sensible defaults shown):

```
OBJECT_STORAGE_KEY_PREFIX=uploads
OBJECT_STORAGE_PRESIGN_TTL_SEC=3600
OBJECT_STORAGE_MULTIPART_THRESHOLD_BYTES=104857600   # 100 MiB
OBJECT_STORAGE_MULTIPART_PART_SIZE_BYTES=33554432     # 32 MiB
```

### Smoke check

```bash
npm run test:contracts      # runs object-storage.test.ts (no creds needed)
```

For a live-bucket smoke test, set the creds and run an end-to-end upload +
`getById` against the server. There is no dedicated live-bucket test in the
repo today — **deferred**: add one (e.g. a `scripts/qa/cloud-storage-live.test.ts`)
before pointing beta traffic at S3.

---

## Verified sound (2026-06-18)

- Local ↔ cloud branching is centralized in one predicate — no scattered
  `if (cloud)` duplication.
- Presigning handles both single-part and multipart correctly; completion sorts
  parts by number and maps ETags as S3 requires.
- Cloud download caches atomically and reuses — no re-download per analysis run.
- Credentials, tokens, and secret keys are redacted by the Pino logger
  (`server/lib/logger.ts` redact paths).
