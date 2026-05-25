import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import {
  COURT_POINT_LABELS,
  COURT_POINT_ORDER,
  calculateCourtHomography,
  createDefaultCourtCalibration,
  loadCourtCalibration,
  saveCourtCalibration,
  sanitizeVideoId,
  scaleCalibrationToVideoSize,
  updateCalibrationPoint,
  type CourtCalibration,
  type CourtPointId,
  type HomographyMatrix,
  type Point2D,
} from "@/lib/courtCalibration";

type Props = {
  videoId: string;
  videoWidth: number;
  videoHeight: number;
  enabled: boolean;
  editable?: boolean;
  videoRef?: RefObject<HTMLVideoElement | null>;
  onCalibrationChange?: (
    calibration: CourtCalibration,
    homography: HomographyMatrix | null
  ) => void;
};

type DragState = {
  pointId: CourtPointId;
  pointerId: number;
};

type MagnifierState = {
  visible: boolean;
  pointId: CourtPointId;
  videoPoint: Point2D;
  clientPoint: Point2D;
};

const MAGNIFIER_SIZE = 112;
const MAGNIFIER_ZOOM = 3.5;
const MARKER_RADIUS = 8;

function clientPointToVideoPoint(
  clientX: number,
  clientY: number,
  element: HTMLElement,
  videoWidth: number,
  videoHeight: number
): Point2D {
  const rect = element.getBoundingClientRect();
  const x = ((clientX - rect.left) / Math.max(1, rect.width)) * videoWidth;
  const y = ((clientY - rect.top) / Math.max(1, rect.height)) * videoHeight;
  return {
    x: Math.max(0, Math.min(videoWidth, x)),
    y: Math.max(0, Math.min(videoHeight, y)),
  };
}

function videoPointToPercent(point: Point2D, videoWidth: number, videoHeight: number) {
  return {
    left: `${(point.x / Math.max(1, videoWidth)) * 100}%`,
    top: `${(point.y / Math.max(1, videoHeight)) * 100}%`,
  };
}

function polygonPoints(calibration: CourtCalibration): string {
  return COURT_POINT_ORDER.map((id) => {
    const point = calibration.points.find((candidate) => candidate.id === id);
    if (!point) return "0,0";
    return `${point.x},${point.y}`;
  }).join(" ");
}

export default function CourtCalibrationOverlay({
  videoId,
  videoWidth,
  videoHeight,
  enabled,
  editable = true,
  videoRef,
  onCalibrationChange,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const magnifierCanvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const stableVideoId = sanitizeVideoId(videoId);
  const [calibration, setCalibration] = useState<CourtCalibration>(() =>
    createDefaultCourtCalibration(stableVideoId, videoWidth, videoHeight)
  );
  const [hydrated, setHydrated] = useState(false);
  const [magnifier, setMagnifier] = useState<MagnifierState | null>(null);

  useEffect(() => {
    setHydrated(false);
    const restored =
      loadCourtCalibration(stableVideoId, videoWidth, videoHeight) ??
      createDefaultCourtCalibration(stableVideoId, videoWidth, videoHeight);
    setCalibration(restored);
    setHydrated(true);
  }, [stableVideoId, videoWidth, videoHeight]);

  useEffect(() => {
    setCalibration((current) =>
      current.videoId === stableVideoId
        ? scaleCalibrationToVideoSize(current, videoWidth, videoHeight)
        : current
    );
  }, [stableVideoId, videoWidth, videoHeight]);

  const homography = useMemo(
    () => calculateCourtHomography(calibration),
    [calibration]
  );

  useEffect(() => {
    onCalibrationChange?.(calibration, homography);
    if (hydrated && calibration.videoId === stableVideoId) {
      saveCourtCalibration(calibration);
    }
  }, [calibration, homography, hydrated, onCalibrationChange, stableVideoId]);

  const movePoint = useCallback(
    (pointId: CourtPointId, point: Point2D) => {
      setCalibration((current) => updateCalibrationPoint(current, pointId, point));
    },
    []
  );

  const updateMagnifier = useCallback(
    (pointId: CourtPointId, event: Pick<PointerEvent, "clientX" | "clientY">) => {
      const root = rootRef.current;
      if (!root) return;
      setMagnifier({
        visible: true,
        pointId,
        videoPoint: clientPointToVideoPoint(
          event.clientX,
          event.clientY,
          root,
          videoWidth,
          videoHeight
        ),
        clientPoint: { x: event.clientX, y: event.clientY },
      });
    },
    [videoWidth, videoHeight]
  );

  const handlePointerDown = useCallback(
    (pointId: CourtPointId, event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!editable) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = { pointId, pointerId: event.pointerId };
      const root = rootRef.current;
      if (!root) return;
      const nextPoint = clientPointToVideoPoint(
        event.clientX,
        event.clientY,
        root,
        videoWidth,
        videoHeight
      );
      movePoint(pointId, nextPoint);
      updateMagnifier(pointId, event.nativeEvent);
    },
    [editable, movePoint, updateMagnifier, videoWidth, videoHeight]
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      const root = rootRef.current;
      if (!root) return;
      const nextPoint = clientPointToVideoPoint(
        event.clientX,
        event.clientY,
        root,
        videoWidth,
        videoHeight
      );
      movePoint(drag.pointId, nextPoint);
      updateMagnifier(drag.pointId, event.nativeEvent);
    },
    [movePoint, updateMagnifier, videoWidth, videoHeight]
  );

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  }, []);

  const handleKeyboardNudge = useCallback(
    (pointId: CourtPointId, event: KeyboardEvent<HTMLButtonElement>) => {
      if (!editable) return;
      const delta = event.shiftKey ? 10 : 1;
      const movement: Record<string, Point2D> = {
        ArrowLeft: { x: -delta, y: 0 },
        ArrowRight: { x: delta, y: 0 },
        ArrowUp: { x: 0, y: -delta },
        ArrowDown: { x: 0, y: delta },
      };
      const step = movement[event.key];
      if (!step) return;
      event.preventDefault();
      const point = calibration.points.find((candidate) => candidate.id === pointId);
      if (!point) return;
      movePoint(pointId, { x: point.x + step.x, y: point.y + step.y });
    },
    [calibration.points, editable, movePoint]
  );

  useEffect(() => {
    if (!magnifier?.visible) return;
    const canvas = magnifierCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, MAGNIFIER_SIZE, MAGNIFIER_SIZE);
    ctx.fillStyle = "#020617";
    ctx.fillRect(0, 0, MAGNIFIER_SIZE, MAGNIFIER_SIZE);

    const video = videoRef?.current;
    const sourceSize = MAGNIFIER_SIZE / MAGNIFIER_ZOOM;
    const sx = Math.max(
      0,
      Math.min(videoWidth - sourceSize, magnifier.videoPoint.x - sourceSize / 2)
    );
    const sy = Math.max(
      0,
      Math.min(videoHeight - sourceSize, magnifier.videoPoint.y - sourceSize / 2)
    );

    try {
      if (video && video.readyState >= HTMLMediaElement.HAVE_METADATA) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(video, sx, sy, sourceSize, sourceSize, 0, 0, MAGNIFIER_SIZE, MAGNIFIER_SIZE);
      } else {
        throw new Error("Video frame unavailable");
      }
    } catch {
      ctx.strokeStyle = "rgba(148, 163, 184, 0.35)";
      ctx.lineWidth = 1;
      for (let i = 0; i <= MAGNIFIER_SIZE; i += 14) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, MAGNIFIER_SIZE);
        ctx.moveTo(0, i);
        ctx.lineTo(MAGNIFIER_SIZE, i);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(148, 163, 184, 0.9)";
      ctx.font = "10px sans-serif";
      ctx.fillText("preview unavailable", 10, MAGNIFIER_SIZE - 12);
    }

    const center = MAGNIFIER_SIZE / 2;
    ctx.strokeStyle = "#a3e635";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(center, 0);
    ctx.lineTo(center, MAGNIFIER_SIZE);
    ctx.moveTo(0, center);
    ctx.lineTo(MAGNIFIER_SIZE, center);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(center, center, 9, 0, Math.PI * 2);
    ctx.stroke();
  }, [magnifier, videoHeight, videoRef, videoWidth]);

  if (!enabled) return null;

  return (
    <div
      ref={rootRef}
      className="absolute inset-0 z-20 select-none"
      aria-label="Court calibration overlay"
    >
      <svg
        viewBox={`0 0 ${videoWidth} ${videoHeight}`}
        className="absolute inset-0 h-full w-full pointer-events-none"
        preserveAspectRatio="none"
      >
        <polygon
          points={polygonPoints(calibration)}
          fill="rgba(163, 230, 53, 0.08)"
          stroke="rgba(163, 230, 53, 0.9)"
          strokeWidth={Math.max(videoWidth, videoHeight) * 0.003}
        />
        {calibration.points.map((point, index) => {
          const next = calibration.points[(index + 1) % calibration.points.length]!;
          return (
            <line
              key={`${point.id}-guide`}
              x1={point.x}
              y1={point.y}
              x2={next.x}
              y2={next.y}
              stroke="rgba(255,255,255,0.28)"
              strokeDasharray="8 8"
              strokeWidth={Math.max(videoWidth, videoHeight) * 0.0015}
            />
          );
        })}
      </svg>

      <div className="absolute left-3 top-3 max-w-xs rounded-lg border border-padel-border bg-slate-950/80 px-3 py-2 text-xs text-slate-300 shadow-xl backdrop-blur">
        <div className="font-semibold text-padel-green">Court calibration</div>
        <div className="mt-0.5 text-slate-400">
          Drag each corner to the visible 20m × 10m court outline.
        </div>
      </div>

      {calibration.points.map((point) => {
        const position = videoPointToPercent(point, videoWidth, videoHeight);
        return (
          <button
            key={point.id}
            type="button"
            disabled={!editable}
            aria-label={`Move ${COURT_POINT_LABELS[point.id]} court corner`}
            onPointerDown={(event) => handlePointerDown(point.id, event)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onPointerEnter={(event) => updateMagnifier(point.id, event.nativeEvent)}
            onPointerLeave={() => {
              if (!dragRef.current) setMagnifier(null);
            }}
            onKeyDown={(event) => handleKeyboardNudge(point.id, event)}
            className="absolute rounded-full border-2 border-black bg-padel-green text-black shadow-[0_0_18px_rgba(163,230,53,0.65)] focus:outline-none focus:ring-2 focus:ring-white disabled:cursor-not-allowed"
            style={{
              ...position,
              width: MARKER_RADIUS * 2,
              height: MARKER_RADIUS * 2,
              transform: "translate(-50%, -50%)",
              touchAction: "none",
            }}
          >
            <span className="sr-only">{COURT_POINT_LABELS[point.id]}</span>
          </button>
        );
      })}

      {magnifier?.visible && (
        <div
          className="pointer-events-none fixed z-50 rounded-xl border border-padel-green/70 bg-slate-950/95 p-1 shadow-2xl"
          style={{
            left: Math.min(window.innerWidth - MAGNIFIER_SIZE - 18, magnifier.clientPoint.x + 18),
            top: Math.max(8, magnifier.clientPoint.y - MAGNIFIER_SIZE - 18),
          }}
        >
          <canvas
            ref={magnifierCanvasRef}
            width={MAGNIFIER_SIZE}
            height={MAGNIFIER_SIZE}
            className="block rounded-lg"
          />
          <div className="px-1 pt-1 text-[10px] text-slate-400">
            {COURT_POINT_LABELS[magnifier.pointId]} · {Math.round(magnifier.videoPoint.x)},
            {Math.round(magnifier.videoPoint.y)} px
          </div>
        </div>
      )}
    </div>
  );
}
