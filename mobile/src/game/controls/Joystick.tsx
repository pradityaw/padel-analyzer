/**
 * A virtual thumbstick. The normalized direction is written to the provided
 * Reanimated shared values (`moveX`/`moveY`, each in [-1, 1]) entirely on the
 * UI thread, so the game loop can read `.value` every tick without triggering
 * React re-renders. The knob follows the finger and springs back on release.
 */

import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

const SIZE = 132;
const KNOB = 56;
const RADIUS = (SIZE - KNOB) / 2;

interface Props {
  moveX: SharedValue<number>;
  moveY: SharedValue<number>;
}

export default function Joystick({ moveX, moveY }: Props) {
  const knobX = useSharedValue(0);
  const knobY = useSharedValue(0);

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      "worklet";
      let dx = e.translationX;
      let dy = e.translationY;
      const dist = Math.hypot(dx, dy);
      if (dist > RADIUS) {
        dx = (dx / dist) * RADIUS;
        dy = (dy / dist) * RADIUS;
      }
      knobX.value = dx;
      knobY.value = dy;
      moveX.value = dx / RADIUS;
      moveY.value = dy / RADIUS;
    })
    .onFinalize(() => {
      "worklet";
      knobX.value = withTiming(0, { duration: 90 });
      knobY.value = withTiming(0, { duration: 90 });
      moveX.value = 0;
      moveY.value = 0;
    });

  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: knobX.value }, { translateY: knobY.value }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <View style={styles.base}>
        <Animated.View style={[styles.knob, knobStyle]} />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  base: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    backgroundColor: "#1e293b",
    borderWidth: 2,
    borderColor: "#334155",
    alignItems: "center",
    justifyContent: "center",
  },
  knob: {
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    backgroundColor: "#a3e635",
  },
});
