/**
 * Skia renderer for an Arena Royale frame. Draws the arena, the shrinking safe
 * zone, projectiles, and cute round fighters with eyes that look the way they
 * face. It is fed a plain `RenderState` so it works identically for the local
 * vs-bots simulation and for interpolated online snapshots.
 *
 * Arena coordinates are in abstract units (see shared constants); the canvas
 * scales them to fit the available space with letterboxing.
 */

import { Canvas, Circle, Group, Rect } from "@shopify/react-native-skia";
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  DEFAULT_WORLD_CONFIG,
  PLAYER_COLORS,
} from "../../../../shared/game/sim/constants";
import type { RenderState } from "../types";

const PLAYER_R = DEFAULT_WORLD_CONFIG.playerRadius;
const PROJECTILE_R = DEFAULT_WORLD_CONFIG.projectileRadius;

interface Props {
  state: RenderState;
  width: number;
  height: number;
}

function colorFor(index: number): string {
  return PLAYER_COLORS[index % PLAYER_COLORS.length];
}

export default function ArenaCanvas({ state, width, height }: Props) {
  const scale = Math.min(width / ARENA_WIDTH, height / ARENA_HEIGHT);
  const offsetX = (width - ARENA_WIDTH * scale) / 2;
  const offsetY = (height - ARENA_HEIGHT * scale) / 2;

  return (
    <Canvas style={{ width, height }}>
      <Group transform={[{ translateX: offsetX }, { translateY: offsetY }, { scale }]}>
        {/* Arena floor */}
        <Rect x={0} y={0} width={ARENA_WIDTH} height={ARENA_HEIGHT} color="#0b1120" />

        {/* Safe zone fill + boundary ring */}
        <Circle
          cx={state.storm.cx}
          cy={state.storm.cy}
          r={state.storm.radius}
          color="#13203b"
        />
        <Circle
          cx={state.storm.cx}
          cy={state.storm.cy}
          r={state.storm.radius}
          color="#38bdf8"
          style="stroke"
          strokeWidth={5}
        />

        {/* Projectiles */}
        {state.projectiles.map((p) => (
          <Circle key={p.id} cx={p.x} cy={p.y} r={PROJECTILE_R} color="#fde68a" />
        ))}

        {/* Players */}
        {state.players.map((p) => (
          <PlayerSprite key={p.id} player={p} />
        ))}
      </Group>
    </Canvas>
  );
}

function PlayerSprite({ player }: { player: RenderState["players"][number] }) {
  const color = colorFor(player.colorIndex);
  const len = Math.hypot(player.facingX, player.facingY) || 1;
  const fx = player.facingX / len;
  const fy = player.facingY / len;
  // Eyes sit forward of center and split to either side of the facing axis.
  const eyeFwd = PLAYER_R * 0.42;
  const eyeSide = PLAYER_R * 0.4;
  const eyeR = PLAYER_R * 0.2;
  const ex = player.x + fx * eyeFwd;
  const ey = player.y + fy * eyeFwd;
  // Perpendicular to facing.
  const px = -fy;
  const py = fx;

  const hpFrac = Math.max(0, Math.min(1, player.hp / player.maxHp));
  const barW = PLAYER_R * 2;
  const barX = player.x - PLAYER_R;
  const barY = player.y - PLAYER_R - 14;

  return (
    <Group opacity={player.alive ? 1 : 0.25}>
      {/* Self ring highlight */}
      {player.isSelf ? (
        <Circle cx={player.x} cy={player.y} r={PLAYER_R + 5} color="#f8fafc" />
      ) : null}
      <Circle cx={player.x} cy={player.y} r={PLAYER_R} color={color} />

      {player.alive ? (
        <>
          {/* Eyes */}
          <Circle cx={ex + px * eyeSide} cy={ey + py * eyeSide} r={eyeR} color="#0b1120" />
          <Circle cx={ex - px * eyeSide} cy={ey - py * eyeSide} r={eyeR} color="#0b1120" />

          {/* HP bar */}
          <Rect x={barX} y={barY} width={barW} height={6} color="#1e293b" />
          <Rect x={barX} y={barY} width={barW * hpFrac} height={6} color="#a3e635" />
        </>
      ) : null}
    </Group>
  );
}
