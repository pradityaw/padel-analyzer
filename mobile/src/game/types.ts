/**
 * Render-facing types for the Arena Royale mobile client. The renderer
 * (ArenaCanvas) is fed a `RenderState` regardless of whether the source is the
 * local vs-bots simulation or interpolated online snapshots, so both modes
 * share one drawing path.
 */

export interface RenderPlayer {
  id: string;
  x: number;
  y: number;
  facingX: number;
  facingY: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  colorIndex: number;
  isSelf: boolean;
}

export interface RenderProjectile {
  id: number;
  x: number;
  y: number;
}

export interface RenderState {
  players: RenderPlayer[];
  projectiles: RenderProjectile[];
  storm: { cx: number; cy: number; radius: number };
}
