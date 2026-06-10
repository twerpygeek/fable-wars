// =============================================================================
// POCKET ALERT — sim/movement.ts (Owner B)
// Waypoint-following unit movement with soft collision avoidance.
//
// Units follow `u.path` (integer tile waypoints from pathfinding; the physical
// target of each waypoint is its tile center, i.e. waypoint + 0.5) at
// def.speed / TICK_RATE tiles per tick. A waypoint is consumed when the unit
// is within WAYPOINT_EPS of its center. Facing turns smoothly toward the
// velocity heading. Ground/naval units soft-collide with stationary units and
// buildings: they sidestep to an adjacent free tile or repath, gated by
// `repathCooldown` (~1s, randomized ±25% via simRandom). Air units fly
// straight and ignore collision entirely.
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
  let remaining = def.speed / TICK_RATE;
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
