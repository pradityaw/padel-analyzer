import { useMemo, useRef } from "react";
import { PanResponder, StyleSheet, View } from "react-native";
import Svg, { Polygon } from "react-native-svg";
import type { CourtCorner, CourtCornersPayload } from "../lib/courtCorners";

type Props = {
  width: number;
  height: number;
  corners: CourtCornersPayload["corners"];
  onChange: (corners: CourtCornersPayload["corners"]) => void;
};

const HANDLE_SIZE = 28;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

export default function CourtAlignmentOverlay({
  width,
  height,
  corners,
  onChange,
}: Props) {
  const dragStartRef = useRef<CourtCornersPayload["corners"]>(corners);

  const panResponders = useMemo(
    () =>
      corners.map((_, index) =>
        PanResponder.create({
          onStartShouldSetPanResponder: () => true,
          onMoveShouldSetPanResponder: () => true,
          onPanResponderGrant: () => {
            dragStartRef.current = corners;
          },
          onPanResponderMove: (_, gesture) => {
            const start = dragStartRef.current[index]!;
            const next: CourtCornersPayload["corners"] = corners.map((c, i) =>
              i === index
                ? {
                    x: clamp01(start.x + gesture.dx / Math.max(1, width)),
                    y: clamp01(start.y + gesture.dy / Math.max(1, height)),
                  }
                : { ...c }
            ) as CourtCornersPayload["corners"];
            onChange(next);
          },
        })
      ),
    [corners, height, onChange, width]
  );

  const polygonPoints = corners
    .map((c) => `${c.x * width},${c.y * height}`)
    .join(" ");

  return (
    <View style={[styles.root, { width, height }]} pointerEvents="box-none">
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Polygon
          points={polygonPoints}
          fill="rgba(236, 72, 153, 0.12)"
          stroke="#ec4899"
          strokeWidth={2}
        />
      </Svg>
      {corners.map((corner, index) => {
        const left = corner.x * width - HANDLE_SIZE / 2;
        const top = corner.y * height - HANDLE_SIZE / 2;
        return (
          <View
            key={index}
            {...panResponders[index]!.panHandlers}
            style={[
              styles.handle,
              {
                width: HANDLE_SIZE,
                height: HANDLE_SIZE,
                left,
                top,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: "absolute",
    left: 0,
    top: 0,
  },
  handle: {
    position: "absolute",
    borderRadius: HANDLE_SIZE / 2,
    borderWidth: 2,
    borderColor: "#ec4899",
    backgroundColor: "rgba(236, 72, 153, 0.85)",
  },
});
