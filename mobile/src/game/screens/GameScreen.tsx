/**
 * Single-device "vs bots" battle (Phase 1 / offline mode). Runs the shared
 * authoritative simulation locally: the human is p1 (driven by the joystick +
 * fire button), the rest are client-side bots. A fixed-timestep accumulator
 * advances the sim at TICK_RATE while rendering every animation frame.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSharedValue } from "react-native-reanimated";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  DEFAULT_WORLD_CONFIG,
  TICK_RATE,
} from "../../../../shared/game/sim/constants";
import { createWorld, stepWorld } from "../../../../shared/game/sim/world";
import type {
  InputCommand,
  PlayerSeed,
  WorldState,
} from "../../../../shared/game/sim/types";
import ArenaCanvas from "../render/ArenaCanvas";
import Joystick from "../controls/Joystick";
import AttackButton from "../controls/AttackButton";
import { botInput } from "../local/bots";
import type { RenderState } from "../types";
import type { RootStackParamList } from "../../lib/navigation";

type Props = NativeStackScreenProps<RootStackParamList, "LocalGame">;

const TICK_MS = 1000 / TICK_RATE;
const SELF_ID = "p1";

const SEEDS: PlayerSeed[] = [
  { id: "p1", name: "You" },
  { id: "p2", name: "Bot 1" },
  { id: "p3", name: "Bot 2" },
  { id: "p4", name: "Bot 3" },
];

function buildRenderState(world: WorldState): RenderState {
  return {
    storm: { ...world.storm },
    projectiles: world.projectiles.map((p) => ({ id: p.id, x: p.x, y: p.y })),
    players: world.players.map((p, index) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      facingX: p.facingX,
      facingY: p.facingY,
      hp: p.hp,
      maxHp: DEFAULT_WORLD_CONFIG.playerMaxHp,
      alive: p.alive,
      colorIndex: index,
      isSelf: p.id === SELF_ID,
    })),
  };
}

export default function GameScreen({ navigation }: Props) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [render, setRender] = useState<RenderState | null>(null);
  const [winner, setWinner] = useState<string | null | undefined>(undefined);

  const moveX = useSharedValue(0);
  const moveY = useSharedValue(0);
  const fireRef = useRef(false);

  const worldRef = useRef<WorldState | null>(null);
  const rafRef = useRef<number | null>(null);
  const accRef = useRef(0);
  const lastRef = useRef<number | null>(null);

  const start = useCallback(() => {
    worldRef.current = createWorld(SEEDS, DEFAULT_WORLD_CONFIG);
    accRef.current = 0;
    lastRef.current = null;
    setWinner(undefined);
    setRender(buildRenderState(worldRef.current));

    const frame = (ts: number) => {
      const world = worldRef.current;
      if (!world) return;
      if (lastRef.current === null) lastRef.current = ts;
      accRef.current = Math.min(accRef.current + (ts - lastRef.current), 250);
      lastRef.current = ts;

      let next = world;
      while (accRef.current >= TICK_MS && next.phase !== "over") {
        const inputs: Record<string, InputCommand> = {
          [SELF_ID]: {
            moveX: moveX.value,
            moveY: moveY.value,
            aimX: 0,
            aimY: 0,
            fire: fireRef.current,
          },
        };
        for (const seed of SEEDS) {
          if (seed.id !== SELF_ID) inputs[seed.id] = botInput(next, seed.id);
        }
        next = stepWorld(next, inputs, DEFAULT_WORLD_CONFIG);
        accRef.current -= TICK_MS;
      }
      worldRef.current = next;
      setRender(buildRenderState(next));

      if (next.phase === "over") {
        const w = next.players.find((p) => p.id === next.winnerId);
        setWinner(w ? w.name : null);
        rafRef.current = null;
        return;
      }
      rafRef.current = requestAnimationFrame(frame);
    };
    rafRef.current = requestAnimationFrame(frame);
  }, [moveX, moveY]);

  useEffect(() => {
    start();
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [start]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ width, height });
  };

  return (
    <View style={styles.screen}>
      <View style={styles.arena} onLayout={onLayout}>
        {render && size.width > 0 ? (
          <ArenaCanvas state={render} width={size.width} height={size.height} />
        ) : null}

        {/* Controls float over the arena */}
        <View style={styles.controls} pointerEvents="box-none">
          <Joystick moveX={moveX} moveY={moveY} />
          <AttackButton fireRef={fireRef} />
        </View>

        {winner !== undefined ? (
          <View style={styles.overlay} pointerEvents="auto">
            <Text style={styles.overlayTitle}>
              {winner === "You" ? "You win! 🎉" : winner ? `${winner} wins` : "Draw"}
            </Text>
            <Pressable style={styles.primaryButton} onPress={start}>
              <Text style={styles.primaryButtonText}>Play again</Text>
            </Pressable>
            <Pressable
              style={styles.secondaryButton}
              onPress={() => navigation.goBack()}
            >
              <Text style={styles.secondaryButtonText}>Back to menu</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0b1120" },
  arena: { flex: 1, overflow: "hidden" },
  controls: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 28,
    paddingHorizontal: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#0b1120cc",
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
  },
  overlayTitle: { color: "#f8fafc", fontSize: 30, fontWeight: "800" },
  primaryButton: {
    backgroundColor: "#a3e635",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 28,
  },
  primaryButtonText: { color: "#0b1120", fontWeight: "800", fontSize: 16 },
  secondaryButton: {
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderWidth: 1,
    borderColor: "#475569",
  },
  secondaryButtonText: { color: "#f8fafc", fontWeight: "600", fontSize: 15 },
});
