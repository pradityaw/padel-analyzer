/**
 * Hold-to-fire attack button. Writes the held state into a ref so the game
 * loop can read it each tick (the simulation's cooldown gates the actual fire
 * rate). Kept as a ref rather than state to avoid per-press re-renders.
 */

import { useState, type MutableRefObject } from "react";
import { Pressable, StyleSheet, Text } from "react-native";

interface Props {
  fireRef: MutableRefObject<boolean>;
}

export default function AttackButton({ fireRef }: Props) {
  const [held, setHeld] = useState(false);

  return (
    <Pressable
      onPressIn={() => {
        fireRef.current = true;
        setHeld(true);
      }}
      onPressOut={() => {
        fireRef.current = false;
        setHeld(false);
      }}
      style={[styles.button, held && styles.held]}
    >
      <Text style={styles.label}>FIRE</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: "#f472b6",
    alignItems: "center",
    justifyContent: "center",
  },
  held: {
    backgroundColor: "#ec4899",
    transform: [{ scale: 0.94 }],
  },
  label: {
    color: "#0b1120",
    fontWeight: "800",
    fontSize: 18,
  },
});
