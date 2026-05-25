/** Which overlay layers the worker should render when visible. */
export type OverlayLayerFlags = {
  skeleton: boolean;
  ball: boolean;
};

/** Packed landmark positions for zero-copy transfer to the overlay worker. */
export type PackedOverlayPayload = {
  frameCount: number;
  landmarkCount: number;
  /** Flat [frame][landmark] → x, y, visibility */
  positions: Float32Array;
  frameIndices: Int32Array;
  timestampsMs: Float32Array;
  /** Optional normalized x,y per frame; NaN when absent */
  ballPositions?: Float32Array;
};

export type OverlayWorkerInitMessage = {
  type: "init";
  width: number;
  height: number;
  canvas: OffscreenCanvas;
};

export type OverlayWorkerSetPayloadMessage = {
  type: "setPayload";
  payload: PackedOverlayPayload;
  layers: OverlayLayerFlags;
};

export type OverlayWorkerPaintMessage = {
  type: "paint";
  arrayIdx: number;
  visible: boolean;
  highlightContact: boolean;
};

export type OverlayWorkerResizeMessage = {
  type: "resize";
  width: number;
  height: number;
};

export type OverlayWorkerDisposeMessage = {
  type: "dispose";
};

export type OverlayWorkerInboundMessage =
  | OverlayWorkerInitMessage
  | OverlayWorkerSetPayloadMessage
  | OverlayWorkerPaintMessage
  | OverlayWorkerResizeMessage
  | OverlayWorkerDisposeMessage;

export type OverlayWorkerReadyMessage = {
  type: "ready";
};

export type OverlayWorkerPaintedMessage = {
  type: "painted";
  arrayIdx: number;
};

export type OverlayWorkerErrorMessage = {
  type: "error";
  code: string;
  message: string;
};

export type OverlayWorkerOutboundMessage =
  | OverlayWorkerReadyMessage
  | OverlayWorkerPaintedMessage
  | OverlayWorkerErrorMessage;
