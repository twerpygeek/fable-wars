// =============================================================================
// FABLE WARS — sim/movement.ts (Owner B)
// Waypoint-following unit movement with soft collision avoidance.
//
// Units follow `u.path` (integer tile waypoints from pathfinding; the physical
// target of each waypoint is its tile center, i.e. waypoint + 0.5) at
// def.speed / TICK_RATE tiles per tick. A waypoint is consumed when the unit
// is within WAYPOINT_EPS of its center. Facing turns smoothly toward the
// velocity heading. Ground/naval units soft-collide with stationary units and
// buildings: they sidestep to an adjacent free tile or repath, gated by
// `repathCooldown` (~1s, randomized ±25% via simRandom). Air units fly
// straight and ignore collision entirely. Moving units never hard-block each
// other; overlap between movers is resolved by the soft-push pass
// (applyUnitPushing, called by game.ts after the movement loop).
//
// Deterministic: tick counts + simRandom(state) only.
// =============================================================================

import type { Entity, EntityId, GameData, GameEvent, GameState, Vec2 } from '../core/types';
import { MoveDomain, dist } from '../core/types';
import { TICK_RATE } from '../core/constants';
import { simRandom } from '../core/rng';
import { passableFor } from '../map/terrain';
import { findPath } from './pathfinding';

/** Distance (tiles) from a waypoint center at which it counts as reached. */
const WAYPOINT_EPS = 0.15;
/** Distance from an order's destination center that counts as "arrived". */
const ARRIVE_EPS = 1.2;
/** Base repath cooldown (~1 second), randomized ±25% when applied. */
const REPATH_BASE_TICKS = TICK_RATE;
/** Per-tick facing interpolation factor toward the movement heading. */
const FACING_LERP = 0.35;
/** Safety bound on waypoint pops within a single tick. */
const MAX_WAYPOINTS_PER_TICK = 16;

// Fixed neighbor order (orthogonals first) keeps sidestep choice deterministic.
const NDX = [1, -1, 0, 0, 1, 1, -1, -1];
const NDY = [0, 0, 1, -1, 1, -1, 1, -1];

function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

/** Id of the building this unit is explicitly attacking/capturing (its tiles
 *  must not block pathing/entry so the unit can approach to adjacency). */
function attackOrCaptureTarget(u: Entity): EntityId {
  const o = u.orders.length > 0 ? u.orders[0] : undefined;
  if (o !== undefined && (o.kind === 'attack' || o.kind === 'capture')) return o.target;
  return -1;
}

function isStationaryUnit(e: Entity): boolean {
  return e.kind === 'unit' && (e.path === null || e.path.length === 0);
}

/**
 * True when tile (x,y) is blocked for `u` stepping into it: occupied by a
 * building (other than u's attack/capture target) or by a stationary other
 * unit on the surface layer. Air occupants never block.
 */
function tileBlockedForEntry(
  state: GameState,
  data: GameData,
  u: Entity,
  x: number,
  y: number,
  exceptId: EntityId,
): boolean {
  const ids = state.occupancy.get(y * state.map.w + x);
  if (ids === undefined) return false;
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (id === u.id) continue;
    const e = state.entities.get(id);
    if (e === undefined || e.hp <= 0) continue;
    if (e.kind === 'building') {
      if (e.id !== exceptId) return true;
      continue;
    }
    if (!isStationaryUnit(e)) continue;
    const odef = data.units[e.defId];
    if (odef !== undefined && odef.domain === MoveDomain.AIR) continue;
    return true;
  }
  return false;
}

/**
 * Blocked-tile predicate for pathfinding. Always blocks building-occupied
 * tiles (except u's current attack/capture target); optionally also blocks
 * tiles held by stationary surface units (used for collision repaths).
 */
function makeBlockedFn(
  state: GameState,
  data: GameData,
  u: Entity,
  includeStationaryUnits: boolean,
): (x: number, y: number) => boolean {
  const exceptId = attackOrCaptureTarget(u);
  const w = state.map.w;
  const occupancy = state.occupancy;
  const entities = state.entities;
  const selfId = u.id;
  return (x: number, y: number): boolean => {
    const ids = occupancy.get(y * w + x);
    if (ids === undefined) return false;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      if (id === selfId) continue;
      const e = entities.get(id);
      if (e === undefined || e.hp <= 0) continue;
      if (e.kind === 'building') {
        if (e.id !== exceptId) return true;
        continue;
      }
      if (!includeStationaryUnits || !isStationaryUnit(e)) continue;
      const odef = data.units[e.defId];
      if (odef !== undefined && odef.domain === MoveDomain.AIR) continue;
      return true;
    }
    return false;
  };
}

function applyRepathCooldown(state: GameState, u: Entity): void {
  // ~1s randomized ±25% so clumped units desynchronize their repaths.
  u.repathCooldown = Math.max(1, Math.round(REPATH_BASE_TICKS * (0.75 + 0.5 * simRandom(state))));
}

/**
 * Compute and assign a path for `u` toward `dest` (tile coords; floats are
 * floored by pathfinding). Blocked tiles are building footprints, EXCEPT the
 * tiles of the building u is currently ordered to attack/capture, so paths
 * can run adjacent to (or be retargeted near) that building. On failure the
 * path is set to null; `pathTarget` always records the requested dest.
 */
export function orderMove(state: GameState, data: GameData, u: Entity, dest: Vec2): void {
  const def = data.units[u.defId];
  if (u.kind !== 'unit' || def === undefined) return;
  const from = { x: Math.floor(u.pos.x), y: Math.floor(u.pos.y) };
  const blocked = makeBlockedFn(state, data, u, false);
  u.path = findPath(state.map, def.domain, from, dest, blocked);
  u.pathTarget = { x: dest.x, y: dest.y };
}

/** Pop a completed move/attackMove order once its path has been consumed. */
function onPathExhausted(u: Entity): void {
  u.path = null;
  const order = u.orders.length > 0 ? u.orders[0] : undefined;
  if (order !== undefined && (order.kind === 'move' || order.kind === 'attackMove')) {
    const near =
      dist(u.pos, { x: order.dest.x + 0.5, y: order.dest.y + 0.5 }) <= ARRIVE_EPS;
    const pt = u.pathTarget;
    const pathWasForOrder = pt !== null && pt.x === order.dest.x && pt.y === order.dest.y;
    // Arrived, or got as close as the path allowed: order complete -> idle/guard.
    if (near || pathWasForOrder) u.orders.shift();
  }
  u.pathTarget = null;
}

/**
 * No current path: self-heal move/attackMove orders that have no path yet
 * (e.g. issued without an explicit orderMove, or whose previous path failed).
 * Other orders (attack/capture/harvest/...) are managed by combat/economy.
 */
function handleNoPath(state: GameState, data: GameData, u: Entity): void {
  if (u.path !== null) {
    onPathExhausted(u);
    return;
  }
  const order = u.orders.length > 0 ? u.orders[0] : undefined;
  if (order === undefined || (order.kind !== 'move' && order.kind !== 'attackMove')) return;
  if (dist(u.pos, { x: order.dest.x + 0.5, y: order.dest.y + 0.5 }) <= ARRIVE_EPS) {
    u.orders.shift();
    u.pathTarget = null;
    return;
  }
  if (u.repathCooldown > 0) return;
  orderMove(state, data, u, order.dest);
  // re-read through a local: orderMove mutated u.path behind TS's narrowing
  const newPath: Vec2[] | null = (u as Entity).path;
  if (newPath === null || newPath.length === 0) {
    // Destination unreachable: drop the order rather than spinning forever.
    u.path = null;
    u.pathTarget = null;
    u.orders.shift();
  }
}

/**
 * Pick an adjacent free passable tile to dodge around a blocking entity.
 * Chooses the neighbor closest to the current waypoint (deterministic order),
 * rejecting choices that would walk meaningfully away from it.
 */
function findSidestep(
  state: GameState,
  data: GameData,
  u: Entity,
  blockedX: number,
  blockedY: number,
): Vec2 | null {
  const def = data.units[u.defId];
  if (def === undefined || u.path === null || u.path.length === 0) return null;
  const exceptId = attackOrCaptureTarget(u);
  const goal = u.path[0];
  const gx = goal.x + 0.5;
  const gy = goal.y + 0.5;
  const cx = Math.floor(u.pos.x);
  const cy = Math.floor(u.pos.y);
  const curD = Math.hypot(gx - u.pos.x, gy - u.pos.y);
  let bestX = -1;
  let bestY = -1;
  let bestD = Infinity;
  const open = (x: number, y: number): boolean =>
    passableFor(state.map, def.domain, x, y) &&
    !tileBlockedForEntry(state, data, u, x, y, exceptId);
  for (let i = 0; i < 8; i++) {
    const nx = cx + NDX[i];
    const ny = cy + NDY[i];
    if (nx === blockedX && ny === blockedY) continue;
    if (!open(nx, ny)) continue;
    // Diagonal sidesteps must not corner-cut past a blocked orthogonal tile
    // (the continuous step would clip it and immediately re-collide).
    if (i >= 4 && (!open(cx + NDX[i], cy) || !open(cx, cy + NDY[i]))) continue;
    const d = Math.hypot(gx - (nx + 0.5), gy - (ny + 0.5));
    if (d < bestD) {
      bestD = d;
      bestX = nx;
      bestY = ny;
    }
  }
  if (bestX < 0 || bestD >= curD + 1.0) return null;
  return { x: bestX, y: bestY };
}

/** Collision response: sidestep, or full repath around stationary blockers. */
function handleBlocked(
  state: GameState,
  data: GameData,
  u: Entity,
  blockedX: number,
  blockedY: number,
): void {
  if (u.repathCooldown > 0) return; // wait in place until allowed to react
  applyRepathCooldown(state, u);
  const def = data.units[u.defId];
  if (def === undefined || u.path === null) return;

  // If the blocked tile is the final waypoint and we already stand adjacent
  // (units bunching at a shared destination), accept this spot as arrival.
  if (u.path.length === 1) {
    const wp = u.path[0];
    const cheb = Math.max(
      Math.abs(Math.floor(u.pos.x) - wp.x),
      Math.abs(Math.floor(u.pos.y) - wp.y),
    );
    if (cheb <= 1) {
      u.path = [];
      onPathExhausted(u);
      return;
    }
  }

  const side = findSidestep(state, data, u, blockedX, blockedY);
  if (side !== null) {
    u.path.unshift(side);
    return;
  }

  // Full repath treating stationary units as obstacles.
  const dest = u.pathTarget !== null ? u.pathTarget : u.path[u.path.length - 1];
  const from = { x: Math.floor(u.pos.x), y: Math.floor(u.pos.y) };
  const blocked = makeBlockedFn(state, data, u, true);
  const newPath = findPath(state.map, def.domain, from, dest, blocked);
  if (newPath !== null && newPath.length > 0) {
    u.path = newPath;
  } else {
    // Boxed in: treat as best-effort arrival so the unit doesn't jam forever.
    u.path = [];
    onPathExhausted(u);
  }
}

/**
 * Per-tick movement update for one unit. Follows the current path, applies
 * soft collision (ground/naval), turns facing toward the heading, and pops
 * completed move-type orders on arrival (leaving the unit idle/guarding).
 */
export function updateUnitMovement(
  state: GameState,
  data: GameData,
  u: Entity,
  events: GameEvent[],
): void {
  void events; // movement emits no events; parameter kept per contract
  if (u.kind !== 'unit' || u.hp <= 0) return;
  if (u.repathCooldown > 0) u.repathCooldown -= 1;
  const def = data.units[u.defId];
  if (def === undefined) return;

  if (u.path === null || u.path.length === 0) {
    handleNoPath(state, data, u);
    return;
  }

  const isAir = def.domain === MoveDomain.AIR;
  const exceptId = attackOrCaptureTarget(u);
  let remaining = (def.speed * u.buffs.speed) / TICK_RATE; // crate speed buff
  let pops = 0;

  while (remaining > 1e-6 && u.path !== null && u.path.length > 0 && pops < MAX_WAYPOINTS_PER_TICK) {
    const wp = u.path[0];
    const wx = wp.x + 0.5;
    const wy = wp.y + 0.5;
    const dx = wx - u.pos.x;
    const dy = wy - u.pos.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= WAYPOINT_EPS) {
      u.path.shift();
      pops++;
      continue;
    }
    const step = Math.min(remaining, d);
    const nx = u.pos.x + (dx / d) * step;
    const ny = u.pos.y + (dy / d) * step;

    if (!isAir) {
      const curTX = Math.floor(u.pos.x);
      const curTY = Math.floor(u.pos.y);
      const nTX = Math.floor(nx);
      const nTY = Math.floor(ny);
      if (
        (nTX !== curTX || nTY !== curTY) &&
        tileBlockedForEntry(state, data, u, nTX, nTY, exceptId)
      ) {
        handleBlocked(state, data, u, nTX, nTY);
        return; // no further movement this tick
      }
    }

    u.pos.x = nx;
    u.pos.y = ny;
    u.facing = lerpAngle(u.facing, Math.atan2(dy, dx), FACING_LERP);
    remaining -= step;
    if (d - step <= WAYPOINT_EPS) {
      u.path.shift();
      pops++;
    }
  }

  if (u.path !== null && u.path.length === 0) onPathExhausted(u);
}

// --- Soft unit pushing -----------------------------------------------------------
// Clean-room reimplementation of 0 A.D.'s unit-pushing mechanism from a prose
// description (no GPL source consulted): after the per-unit movement loop,
// pairs of MOVING same-domain surface units that overlap get pushed gently
// apart, and opposing columns receive a perpendicular nudge so they slide
// past each other instead of stop-start jamming. Idle units are never shoved
// (the existing halt + sidestep handles moving-vs-stationary), and a push is
// dropped rather than ever placing a unit on impassable terrain or a
// building-occupied tile.

/** Pair distance under which pushing engages (tiles). */
const PUSH_RANGE = 1.2;
const PUSH_RANGE_SQ = PUSH_RANGE * PUSH_RANGE;
/** Separation strength: tiles moved per unit of overlap, per tick. */
const PUSH_STRENGTH = 0.08;
/** Perpendicular nudge for opposing headings (tiles, per tick). */
const PUSH_PERP = 0.04;
/** Normalized-heading dot product below which two movers count as opposing. */
const PUSH_OPPOSE_DOT = -0.1;

/** True iff the tile under (x, y) is passable for `domain` and free of live
 *  buildings — the clamp test for a pushed position. */
function pushDestinationOpen(
  state: GameState,
  domain: MoveDomain,
  x: number,
  y: number,
): boolean {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (!passableFor(state.map, domain, tx, ty)) return false;
  const ids = state.occupancy.get(ty * state.map.w + tx);
  if (ids !== undefined) {
    for (let i = 0; i < ids.length; i++) {
      const e = state.entities.get(ids[i]);
      if (e !== undefined && e.kind === 'building' && e.hp > 0) return false;
    }
  }
  return true;
}

/** Resolve one overlapping pair: separate along the offset vector, plus a
 *  perpendicular nudge when their headings oppose. Clamped per unit. */
function pushPair(state: GameState, u: Entity, v: Entity, domain: MoveDomain): void {
  const up = u.path;
  const vp = v.path;
  if (up === null || up.length === 0 || vp === null || vp.length === 0) return;

  let dx = v.pos.x - u.pos.x;
  let dy = v.pos.y - u.pos.y;
  const d2 = dx * dx + dy * dy;
  if (d2 >= PUSH_RANGE_SQ) return;
  let d = Math.sqrt(d2);
  if (d < 1e-6) {
    // Exactly stacked: deterministic separation axis.
    dx = 1;
    dy = 0;
    d = 1;
  }
  const nx = dx / d;
  const ny = dy / d;
  const overlap = 1.0 - d;
  const push = overlap > 0 ? PUSH_STRENGTH * overlap : 0;

  let ux = -nx * push;
  let uy = -ny * push;
  let vx = nx * push;
  let vy = ny * push;

  // Opposing headings: nudge the pair perpendicular to the offset (rotate the
  // offset 90°) so crossing columns slide past instead of deadlocking.
  const uhx = up[0].x + 0.5 - u.pos.x;
  const uhy = up[0].y + 0.5 - u.pos.y;
  const vhx = vp[0].x + 0.5 - v.pos.x;
  const vhy = vp[0].y + 0.5 - v.pos.y;
  const ul = Math.sqrt(uhx * uhx + uhy * uhy);
  const vl = Math.sqrt(vhx * vhx + vhy * vhy);
  if (ul > 1e-6 && vl > 1e-6) {
    const dot = (uhx * vhx + uhy * vhy) / (ul * vl);
    if (dot < PUSH_OPPOSE_DOT) {
      ux += -ny * PUSH_PERP;
      uy += nx * PUSH_PERP;
      vx -= -ny * PUSH_PERP;
      vy -= nx * PUSH_PERP;
    }
  }

  if (ux !== 0 || uy !== 0) {
    const px = u.pos.x + ux;
    const py = u.pos.y + uy;
    if (pushDestinationOpen(state, domain, px, py)) {
      u.pos.x = px;
      u.pos.y = py;
    }
  }
  if (vx !== 0 || vy !== 0) {
    const px = v.pos.x + vx;
    const py = v.pos.y + vy;
    if (pushDestinationOpen(state, domain, px, py)) {
      v.pos.x = px;
      v.pos.y = py;
    }
  }
}

/**
 * Soft-push pass over all moving surface units. Called by game.ts once per
 * tick AFTER the per-unit movement loop (before projectiles). Candidate pairs
 * come from the occupancy buckets (own tile + 8 neighbors; buckets are from
 * the previous tick's rebuild, which is within one step of current positions
 * — close enough for a soft force). Pairs are visited once each, in ascending
 * entity-id order, with squared-distance early outs and no allocations in the
 * hot loop. AIR units and moving-vs-idle pairs are skipped entirely.
 */
export function applyUnitPushing(state: GameState, data: GameData): void {
  const map = state.map;
  const w = map.w;
  const h = map.h;
  const entities = state.entities;
  const occupancy = state.occupancy;

  // Map iteration order = insertion order = ascending entity id.
  for (const u of entities.values()) {
    if (u.kind !== 'unit' || u.hp <= 0) continue;
    if (u.path === null || u.path.length === 0) continue; // only movers push
    const ud = data.units[u.defId];
    if (ud === undefined || ud.domain === MoveDomain.AIR) continue;
    const cx = Math.round(u.pos.x);
    const cy = Math.round(u.pos.y);

    for (let oy = -1; oy <= 1; oy++) {
      const ty = cy + oy;
      if (ty < 0 || ty >= h) continue;
      const row = ty * w;
      for (let ox = -1; ox <= 1; ox++) {
        const tx = cx + ox;
        if (tx < 0 || tx >= w) continue;
        const ids = occupancy.get(row + tx);
        if (ids === undefined) continue;
        for (let i = 0; i < ids.length; i++) {
          const vid = ids[i];
          if (vid <= u.id) continue; // each pair handled once
          const v = entities.get(vid);
          if (v === undefined || v.kind !== 'unit' || v.hp <= 0) continue;
          const vd = data.units[v.defId];
          if (vd === undefined || vd.domain !== ud.domain) continue;
          pushPair(state, u, v, ud.domain);
        }
      }
    }
  }
}
