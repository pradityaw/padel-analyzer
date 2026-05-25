import type { TrackingSyncInput, TrackingSyncTuple } from "@shared/schema";

const DB_NAME = "padel-tracking-sync";
const DB_VERSION = 1;
const STORE_NAME = "batches";
const MAX_BATCH_SIZE = 250;

type QueuedTrackingBatch = TrackingSyncInput & {
  id: string;
  createdAt: number;
  attempts: number;
  lastError?: string;
};

export type TrackingSyncStatus = {
  online: boolean;
  syncing: boolean;
  pendingBatches: number;
  pendingTuples: number;
  lastError?: string;
};

type TrackingSyncListener = (status: TrackingSyncStatus) => void;

const listeners = new Set<TrackingSyncListener>();
let dbPromise: Promise<IDBDatabase> | null = null;
let flushPromise: Promise<TrackingSyncStatus> | null = null;
let status: TrackingSyncStatus = {
  online: typeof navigator === "undefined" ? true : navigator.onLine,
  syncing: false,
  pendingBatches: 0,
  pendingTuples: 0,
};

function canUseIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

function emit(next: Partial<TrackingSyncStatus>): void {
  status = { ...status, ...next };
  listeners.forEach((listener) => listener(status));
}

function openDb(): Promise<IDBDatabase> {
  if (!canUseIndexedDb()) {
    return Promise.reject(new Error("IndexedDB is unavailable in this browser."));
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onerror = () =>
      reject(request.error ?? new Error("Could not open tracking sync queue."));
    request.onsuccess = () => resolve(request.result);
  });

  return dbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed."));
    request.onsuccess = () => resolve(request.result);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, mode);
  return requestToPromise(fn(tx.objectStore(STORE_NAME)));
}

async function getAllBatches(): Promise<QueuedTrackingBatch[]> {
  const batches = await withStore("readonly", (store) => store.getAll());
  return (batches as QueuedTrackingBatch[]).sort(
    (a, b) => a.createdAt - b.createdAt
  );
}

async function deleteBatch(id: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(id));
}

async function putBatch(batch: QueuedTrackingBatch): Promise<void> {
  await withStore("readwrite", (store) => store.put(batch));
}

async function refreshQueueStats(): Promise<TrackingSyncStatus> {
  if (!canUseIndexedDb()) return status;
  const batches = await getAllBatches();
  const pendingTuples = batches.reduce(
    (sum, batch) => sum + batch.tuples.length,
    0
  );
  emit({
    online: navigator.onLine,
    pendingBatches: batches.length,
    pendingTuples,
    lastError: batches.find((batch) => batch.lastError)?.lastError,
  });
  return status;
}

async function postTrackingBatch(batch: QueuedTrackingBatch): Promise<void> {
  const input: TrackingSyncInput = {
    sessionId: batch.sessionId,
    source: batch.source,
    sequence: batch.sequence,
    tuples: batch.tuples,
    clientCreatedAt: batch.clientCreatedAt,
  };
  const response = await fetch("/api/trpc/mobileAnalysis.syncTracking?batch=1", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ "0": { json: input } }),
  });

  if (!response.ok) {
    throw new Error(`Tracking sync failed with HTTP ${response.status}.`);
  }

  const body = (await response.json()) as Array<{
    error?: { message?: string };
  }>;
  const error = body[0]?.error?.message;
  if (error) throw new Error(error);
}

export function subscribeTrackingSyncStatus(
  listener: TrackingSyncListener
): () => void {
  listeners.add(listener);
  listener(status);
  void refreshQueueStats().catch((err) => {
    emit({ lastError: err instanceof Error ? err.message : "Queue unavailable." });
  });
  return () => listeners.delete(listener);
}

export async function enqueueTrackingTuples(input: {
  sessionId: string;
  source: TrackingSyncInput["source"];
  tuples: TrackingSyncTuple[];
  sequence?: number;
}): Promise<TrackingSyncStatus> {
  if (!input.tuples.length) return refreshQueueStats();
  const chunks: TrackingSyncTuple[][] = [];
  for (let i = 0; i < input.tuples.length; i += MAX_BATCH_SIZE) {
    chunks.push(input.tuples.slice(i, i + MAX_BATCH_SIZE));
  }

  const now = Date.now();
  for (const [idx, tuples] of chunks.entries()) {
    await putBatch({
      id: `${input.sessionId}:${input.sequence ?? now}:${idx}`,
      sessionId: input.sessionId,
      source: input.source,
      sequence: (input.sequence ?? now) + idx,
      tuples,
      clientCreatedAt: new Date(now).toISOString(),
      createdAt: now + idx,
      attempts: 0,
    });
  }

  const next = await refreshQueueStats();
  if (navigator.onLine) void flushTrackingQueue();
  return next;
}

export async function flushTrackingQueue(): Promise<TrackingSyncStatus> {
  if (flushPromise) return flushPromise;

  flushPromise = (async () => {
    if (!canUseIndexedDb()) return status;
    if (!navigator.onLine) {
      emit({ online: false });
      return refreshQueueStats();
    }

    emit({ online: true, syncing: true, lastError: undefined });
    const batches = await getAllBatches();

    for (const batch of batches) {
      try {
        await postTrackingBatch(batch);
        await deleteBatch(batch.id);
      } catch (err) {
        const lastError =
          err instanceof Error ? err.message : "Could not sync tracking data.";
        await putBatch({
          ...batch,
          attempts: batch.attempts + 1,
          lastError,
        });
        emit({ syncing: false, lastError });
        return refreshQueueStats();
      }
    }

    emit({ syncing: false, lastError: undefined });
    return refreshQueueStats();
  })().finally(() => {
    flushPromise = null;
  });

  return flushPromise;
}

export function frameToTrackingTuple(
  frameIndex: number,
  x: number,
  y: number,
  pose: TrackingSyncTuple[3] = "detected"
): TrackingSyncTuple {
  return [frameIndex, x, y, pose];
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    emit({ online: true });
    void flushTrackingQueue();
  });
  window.addEventListener("offline", () => emit({ online: false }));
}
