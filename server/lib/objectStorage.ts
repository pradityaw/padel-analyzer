import { randomBytes } from "crypto";
import path from "path";
import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { MAX_UPLOAD_BYTES } from "../../shared/config.js";

/**
 * Object storage configuration (AWS S3 or S3-compatible e.g. Cloudflare R2).
 *
 * Required for cloud uploads:
 *   OBJECT_STORAGE_BUCKET
 *   OBJECT_STORAGE_ACCESS_KEY_ID
 *   OBJECT_STORAGE_SECRET_ACCESS_KEY
 *
 * Optional:
 *   OBJECT_STORAGE_REGION          — default "auto" (R2); use e.g. us-east-1 for AWS
 *   OBJECT_STORAGE_ENDPOINT        — custom endpoint (required for R2)
 *   OBJECT_STORAGE_FORCE_PATH_STYLE — "true" for most R2 / MinIO setups
 *   OBJECT_STORAGE_KEY_PREFIX      — default "uploads"
 *   OBJECT_STORAGE_PRESIGN_TTL_SEC — default 3600
 *   OBJECT_STORAGE_MULTIPART_THRESHOLD_BYTES — default 104857600 (100 MiB)
 *   OBJECT_STORAGE_MULTIPART_PART_SIZE_BYTES   — default 10485760 (10 MiB)
 */

const MULTIPART_THRESHOLD_BYTES = Number(
  process.env.OBJECT_STORAGE_MULTIPART_THRESHOLD_BYTES || 100 * 1024 * 1024
);
const MULTIPART_PART_SIZE_BYTES = Number(
  process.env.OBJECT_STORAGE_MULTIPART_PART_SIZE_BYTES || 32 * 1024 * 1024
);
const PRESIGN_TTL_SEC = Number(process.env.OBJECT_STORAGE_PRESIGN_TTL_SEC || 3600);

let cachedClient: S3Client | null = null;

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function getObjectStorageKeyPrefix(): string {
  const prefix = readEnv("OBJECT_STORAGE_KEY_PREFIX") || "uploads";
  return prefix.replace(/^\/+|\/+$/g, "");
}

export function isObjectStorageConfigured(): boolean {
  return Boolean(
    readEnv("OBJECT_STORAGE_BUCKET") &&
      readEnv("OBJECT_STORAGE_ACCESS_KEY_ID") &&
      readEnv("OBJECT_STORAGE_SECRET_ACCESS_KEY")
  );
}

export function isCloudStorageKey(storageKey: string): boolean {
  if (!isObjectStorageConfigured()) return false;
  const prefix = getObjectStorageKeyPrefix();
  return storageKey.startsWith(`${prefix}/`);
}

function getS3Client(): S3Client {
  if (cachedClient) return cachedClient;

  const region = readEnv("OBJECT_STORAGE_REGION") || "auto";
  const endpoint = readEnv("OBJECT_STORAGE_ENDPOINT");
  const forcePathStyle =
    readEnv("OBJECT_STORAGE_FORCE_PATH_STYLE")?.toLowerCase() === "true";

  cachedClient = new S3Client({
    region,
    endpoint,
    forcePathStyle: forcePathStyle || Boolean(endpoint),
    credentials: {
      accessKeyId: readEnv("OBJECT_STORAGE_ACCESS_KEY_ID")!,
      secretAccessKey: readEnv("OBJECT_STORAGE_SECRET_ACCESS_KEY")!,
    },
  });
  return cachedClient;
}

function getBucket(): string {
  const bucket = readEnv("OBJECT_STORAGE_BUCKET");
  if (!bucket) {
    throw new Error("OBJECT_STORAGE_BUCKET is not configured.");
  }
  return bucket;
}

function sanitizeExtension(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  if (/^\.(mp4|m4v|mov|webm|mkv|avi|mts|m2ts|mpg|mpeg|wmv)$/.test(ext)) {
    return ext;
  }
  return ".mp4";
}

export function buildObjectStorageKey(fileName: string): string {
  const prefix = getObjectStorageKeyPrefix();
  const ext = sanitizeExtension(fileName);
  const id = randomBytes(16).toString("hex");
  return `${prefix}/${id}${ext}`;
}

export type PresignedSingleUpload = {
  mode: "single";
  storageKey: string;
  uploadUrl: string;
  method: "PUT";
  headers: Record<string, string>;
};

export type PresignedMultipartUpload = {
  mode: "multipart";
  storageKey: string;
  uploadId: string;
  partSize: number;
  parts: Array<{ partNumber: number; uploadUrl: string }>;
};

export type PresignedUploadPlan = PresignedSingleUpload | PresignedMultipartUpload;

function assertContentLength(contentLength: number): void {
  if (!Number.isFinite(contentLength) || contentLength <= 0) {
    throw new Error("contentLength must be a positive number.");
  }
  if (contentLength > MAX_UPLOAD_BYTES) {
    throw new Error(`Video exceeds the ${MAX_UPLOAD_BYTES} byte upload limit.`);
  }
}

export async function createPresignedUploadPlan(input: {
  fileName: string;
  contentType: string;
  contentLength: number;
}): Promise<PresignedUploadPlan> {
  if (!isObjectStorageConfigured()) {
    throw new Error("Object storage is not configured.");
  }

  assertContentLength(input.contentLength);

  const storageKey = buildObjectStorageKey(input.fileName);
  const contentType = input.contentType || "application/octet-stream";
  const client = getS3Client();
  const bucket = getBucket();

  if (input.contentLength <= MULTIPART_THRESHOLD_BYTES) {
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: storageKey,
      ContentType: contentType,
      ContentLength: input.contentLength,
    });
    const uploadUrl = await getSignedUrl(client, command, {
      expiresIn: PRESIGN_TTL_SEC,
    });
    return {
      mode: "single",
      storageKey,
      uploadUrl,
      method: "PUT",
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(input.contentLength),
      },
    };
  }

  const create = await client.send(
    new CreateMultipartUploadCommand({
      Bucket: bucket,
      Key: storageKey,
      ContentType: contentType,
    })
  );
  const uploadId = create.UploadId;
  if (!uploadId) {
    throw new Error("Multipart upload could not be started.");
  }

  const partCount = Math.ceil(input.contentLength / MULTIPART_PART_SIZE_BYTES);
  const partNumbers = Array.from({ length: partCount }, (_, i) => i + 1);
  const parts = await Promise.all(
    partNumbers.map(async (partNumber) => {
      const command = new UploadPartCommand({
        Bucket: bucket,
        Key: storageKey,
        UploadId: uploadId,
        PartNumber: partNumber,
      });
      const uploadUrl = await getSignedUrl(client, command, {
        expiresIn: PRESIGN_TTL_SEC,
      });
      return { partNumber, uploadUrl };
    })
  );
  parts.sort((a, b) => a.partNumber - b.partNumber);

  return {
    mode: "multipart",
    storageKey,
    uploadId,
    partSize: MULTIPART_PART_SIZE_BYTES,
    parts,
  };
}

export async function completeMultipartUpload(input: {
  storageKey: string;
  uploadId: string;
  parts: Array<{ partNumber: number; etag: string }>;
}): Promise<void> {
  const client = getS3Client();
  const bucket = getBucket();
  await client.send(
    new CompleteMultipartUploadCommand({
      Bucket: bucket,
      Key: input.storageKey,
      UploadId: input.uploadId,
      MultipartUpload: {
        Parts: input.parts
          .slice()
          .sort((a, b) => a.partNumber - b.partNumber)
          .map((part) => ({
            PartNumber: part.partNumber,
            ETag: part.etag,
          })),
      },
    })
  );
}

export async function headObject(storageKey: string): Promise<{
  size: number;
  contentType?: string;
}> {
  const client = getS3Client();
  const bucket = getBucket();
  const result = await client.send(
    new HeadObjectCommand({
      Bucket: bucket,
      Key: storageKey,
    })
  );
  return {
    size: Number(result.ContentLength ?? 0),
    contentType: result.ContentType,
  };
}

export async function assertObjectExists(
  storageKey: string,
  expectedSize?: number
): Promise<void> {
  const meta = await headObject(storageKey);
  if (meta.size <= 0) {
    throw new Error("Uploaded object is empty.");
  }
  if (
    typeof expectedSize === "number" &&
    expectedSize > 0 &&
    meta.size !== expectedSize
  ) {
    throw new Error(
      `Uploaded object size mismatch (expected ${expectedSize}, got ${meta.size}).`
    );
  }
}

export async function createPresignedGetUrl(
  storageKey: string,
  expiresSec = PRESIGN_TTL_SEC
): Promise<string> {
  const client = getS3Client();
  const bucket = getBucket();
  const getCommand = new GetObjectCommand({
    Bucket: bucket,
    Key: storageKey,
  });
  return getSignedUrl(client, getCommand, { expiresIn: expiresSec });
}
