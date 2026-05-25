import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line } from "react-native-svg";
import { generateDemoSwingFrames } from "../lib/demoLandmarks";
import { SKELETON_CONNECTIONS } from "../lib/skeletonConnections";

const FRAMES = generateDemoSwingFrames(48);

export default function SkeletonPreview() {
  const [idx, setIdx] = useState(0);
  const landmarks = FRAMES[idx]?.landmarks ?? [];

  useEffect(() => {
    const id = setInterval(() => {
      setIdx((i) => (i + 1) % FRAMES.length);
    }, 66);
    return () => clearInterval(id);
  }, []);

  const lines = useMemo(
    () =>
      SKELETON_CONNECTIONS.map(([a, b], i) => {
        const la = landmarks[a];
        const lb = landmarks[b];
        if (!la || !lb || la.visibility < 0.3 || lb.visibility < 0.3) return null;
        return (
          <Line
            key={`l-${i}`}
            x1={la.x}
            y1={la.y}
            x2={lb.x}
            y2={lb.y}
            stroke="#a3e635"
            strokeWidth={0.004}
            strokeOpacity={0.85}
          />
        );
      }),
    [landmarks]
  );

  const dots = useMemo(
    () =>
      landmarks.map((lm, i) => {
        if (lm.visibility < 0.3) return null;
        return (
          <Circle
            key={`p-${i}`}
            cx={lm.x}
            cy={lm.y}
            r={0.012}
            fill="#f8fafc"
            fillOpacity={0.85}
          />
        );
      }),
    [landmarks]
  );

  return (
    <View style={styles.wrap}>
      <Svg width="100%" height="100%" viewBox="0 0 1 1" preserveAspectRatio="xMidYMid meet">
        {lines}
        {dots}
      </Svg>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>AI pose preview</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    height: 220,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#14532d",
    borderWidth: 1,
    borderColor: "#334155",
  },
  badge: {
    position: "absolute",
    bottom: 8,
    left: 8,
    backgroundColor: "#0f172acc",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  badgeText: {
    color: "#a3e635",
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
});
