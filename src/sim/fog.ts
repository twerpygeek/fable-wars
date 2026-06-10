// =============================================================================
// POCKET ALERT — sim/fog.ts (Owner B)
// Per-player fog of war. Each tick every player's `visible` bitmap is cleared
// and re-stamped with filled circles of radius def.sight around each of their
// entities; `explored` accumulates (explored |= visible).
//
// Circle offsets are precomputed once per integer radius (module-level cache —
// pure function of the radius, so determinism is unaffected).
// =============================================================================

import type { GameData, GameState, PlayerId } from '../core/types';
import { entityCenter, inBounds, tileIndex } from '../core/types';

/** radius -> flat [dx0, dy0, dx1, dy1, ...] offsets within the circle. */
const offsetCache = new Map<number, Int32Array>();

function offsetsFor(radius: number): Int32Array {
  const r = radius < 0 ? 0 : radius | 0;
  let offs = offsetCache.get(r);
  if (offs === undefined) {
    const tmp: number[] = [];
    const r2 = r * r;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy <= r2) {
          tmp.push(dx, dy);
        }
      }
    }
    offs = Int32Array.from(tmp);
    offsetCache.set(r, offs);
  }
  return offs;
}

/**
 * Recompute every player's `visible` map from their entities' sight radii and
 * fold it into the persistent `explored` map.
 */
export function updateFog(state: GameState, data: GameData): void {
  const map = state.map;
  const w = map.w;
  const h = map.h;

  for (let p = 0; p < state.players.length; p++) {
    state.players[p].visible.fill(0);
  }

  for (const e of state.entities.values()) {
    if (e.hp <= 0) continue;
    const player = state.players[e.owner];
    if (player === undefined || player.eliminated) continue;
    const def = e.kind === 'unit' ? data.units[e.defId] : data.buildings[e.defId];
    if (def === undefined) continue;

    const c = entityCenter(e, data);
    const cx = Math.floor(c.x);
    const cy = Math.floor(c.y);
    const offs = offsetsFor(Math.round(def.sight));
    const visible = player.visible;
    const explored = player.explored;

    for (let i = 0; i < offs.length; i += 2) {
      const x = cx + offs[i];
      const y = cy + offs[i + 1];
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const idx = y * w + x;
      visible[idx] = 1;
      explored[idx] = 1;
    }
  }
}

/**
 * Whether tile (x, y) — float coords are floored — is currently visible to
 * `player`. Out-of-bounds tiles are never visible.
 */
export function isVisibleTo(state: GameState, player: PlayerId, x: number, y: number): boolean {
  if (!inBounds(state.map, x, y)) return false;
  const p = state.players[player];
  if (p === undefined) return false;
  return p.visible[tileIndex(state.map, x, y)] === 1;
}
