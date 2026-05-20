import { useCallback, useEffect, useRef } from "react";
import type { RallyWindow } from "@shared/schema";
import type { FrameSyncIndex } from "@/lib/frameSync";
import { resolveFrameAtTime } from "@/lib/frameSync";

type VideoFrameRequestFn = (
  callback: (now: DOMHighResTimeStamp, metadata: VideoFrameCallbackMetadata) => void
) => number;

type VideoFrameCancelFn = (handle: number) => void;

function locateRallyForTime(rallies: RallyWindow[] | undefined, timeSec: number) {
  if (!rallies || rallies.length === 0) {
    return { current: null as RallyWindow | null, next: null as RallyWindow | null };
  }
  const tMs = timeSec * 1000;
  let current: RallyWindow | null = null;
  let next: RallyWindow | null = null;
  for (const rally of rallies) {
    if (tMs >= rally.startMs && tMs <= rally.endMs) {
      current = rally;
    } else if (tMs < rally.startMs && (next == null || rally.startMs < next.startMs)) {
      next = rally;
    }
  }
  return { current, next };
}

export type VideoFrameSyncCallbacks = {
  onFrameIndex: (arrayIdx: number, sync: FrameSyncIndex, timeSec: number) => void;
  /** Called on seek/pause and throttled during playback for UI that needs timeSec. */
  onTimeSec?: (timeSec: number) => void;
};

type UseVideoFrameSyncOptions = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  frameSyncRef: React.RefObject<FrameSyncIndex>;
  playing: boolean;
  onlyRallies?: boolean;
  rallies?: RallyWindow[];
  callbacks: VideoFrameSyncCallbacks;
  /** Throttle UI time updates during playback (ms). Default 100. */
  timeUiThrottleMs?: number;
};

export function useVideoFrameSync({
  videoRef,
  frameSyncRef,
  playing,
  onlyRallies = false,
  rallies,
  callbacks,
  timeUiThrottleMs = 100,
}: UseVideoFrameSyncOptions) {
  const onlyRalliesRef = useRef(onlyRallies);
  onlyRalliesRef.current = onlyRallies;

  const ralliesRef = useRef(rallies);
  ralliesRef.current = rallies;

  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const rvfcHandleRef = useRef<number | null>(null);
  const lastReportedIdxRef = useRef(-1);
  const lastTimeUiUpdateRef = useRef(0);
  const currentTimeSecRef = useRef(0);

  const enforceOnlyRallies = useCallback(() => {
    if (!onlyRalliesRef.current) return;
    const list = ralliesRef.current;
    if (!list || list.length === 0) return;
    const video = videoRef.current;
    if (!video) return;

    const { current, next } = locateRallyForTime(list, video.currentTime);
    if (current) return;

    const TOLERANCE_SEC = 0.05;
    if (next) {
      const target = Math.max(0, next.startMs / 1000);
      if (target - video.currentTime > TOLERANCE_SEC) {
        video.currentTime = target + 0.001;
      }
      return;
    }

    if (!video.paused) {
      video.pause();
    }
  }, [videoRef]);

  const maybeReportTimeSec = useCallback(
    (timeSec: number, force: boolean) => {
      currentTimeSecRef.current = timeSec;
      const onTimeSec = callbacksRef.current.onTimeSec;
      if (!onTimeSec) return;

      if (force) {
        lastTimeUiUpdateRef.current = performance.now();
        onTimeSec(timeSec);
        return;
      }

      const now = performance.now();
      if (now - lastTimeUiUpdateRef.current >= timeUiThrottleMs) {
        lastTimeUiUpdateRef.current = now;
        onTimeSec(timeSec);
      }
    },
    [timeUiThrottleMs]
  );

  const syncToCurrentTime = useCallback(
    (options?: { forceTimeUi?: boolean }) => {
      const video = videoRef.current;
      if (!video) return;

      const sync = frameSyncRef.current;
      const arrayIdx = resolveFrameAtTime(sync, video.currentTime);
      const timeSec = video.currentTime;

      if (arrayIdx !== lastReportedIdxRef.current) {
        lastReportedIdxRef.current = arrayIdx;
        callbacksRef.current.onFrameIndex(arrayIdx, sync, timeSec);
      }

      maybeReportTimeSec(timeSec, Boolean(options?.forceTimeUi));
    },
    [frameSyncRef, maybeReportTimeSec, videoRef]
  );

  const resetSyncCache = useCallback(() => {
    lastReportedIdxRef.current = -1;
  }, []);

  const cancelRvfc = useCallback(() => {
    const video = videoRef.current;
    if (!video || rvfcHandleRef.current == null) return;
    const cancel = (video as HTMLVideoElement & {
      cancelVideoFrameCallback?: VideoFrameCancelFn;
    }).cancelVideoFrameCallback;
    cancel?.call(video, rvfcHandleRef.current);
    rvfcHandleRef.current = null;
  }, [videoRef]);

  const scheduleRvfc = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.paused) return;

    const request = (video as HTMLVideoElement & {
      requestVideoFrameCallback?: VideoFrameRequestFn;
    }).requestVideoFrameCallback;

    if (!request) return;

    cancelRvfc();
    rvfcHandleRef.current = request.call(video, () => {
      syncToCurrentTime();
      enforceOnlyRallies();
      scheduleRvfc();
    });
  }, [cancelRvfc, enforceOnlyRallies, syncToCurrentTime, videoRef]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playing) return;

    const hasRvfc = "requestVideoFrameCallback" in video;
    if (hasRvfc) {
      scheduleRvfc();
      return () => cancelRvfc();
    }

    let rafId = 0;
    const tick = () => {
      syncToCurrentTime();
      enforceOnlyRallies();
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [playing, scheduleRvfc, cancelRvfc, syncToCurrentTime, enforceOnlyRallies, videoRef]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onSeeked = () => syncToCurrentTime({ forceTimeUi: true });
    const onTimeUpdate = () => {
      enforceOnlyRallies();
      if (video.paused) syncToCurrentTime({ forceTimeUi: true });
    };
    const onPause = () => {
      cancelRvfc();
      syncToCurrentTime({ forceTimeUi: true });
    };

    video.addEventListener("seeked", onSeeked);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("pause", onPause);

    return () => {
      cancelRvfc();
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("pause", onPause);
    };
  }, [cancelRvfc, enforceOnlyRallies, syncToCurrentTime, videoRef]);

  useEffect(() => {
    if (!onlyRallies) return;
    enforceOnlyRallies();
  }, [onlyRallies, rallies, enforceOnlyRallies]);

  return {
    syncToCurrentTime,
    resetSyncCache,
    cancelFrameLoop: cancelRvfc,
    currentTimeSecRef,
  };
}
