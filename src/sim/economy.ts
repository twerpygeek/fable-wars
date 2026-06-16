// =============================================================================
// POCKET ALERT — sim/economy.ts (Owner A)
// Per-tick economy pass:
//   power recompute (edge-triggered lowPower/powerRestored events, radarActive),
//   building repair drain (credits -> hp),
//   repair-depot free healing of nearby ground units,
//   harvester order state machine (harvest -> full -> returnCargo -> unload ->
//   auto-repeat to last field; idle harvesters near crystal auto-start).
//
// Harvester claim system (clean-room reimplementation of OpenRA's resource
// claim mechanism from a prose description — no GPL source consulted):
// harvesters of the SAME owner never target the same crystal tile (enemy
// contention stays — it's FFA gameplay); target picks are scored toward the
// refinery side of a field; a 2s backoff stops failed searches from thrashing.
// =============================================================================

import type {
  Entity,
  EntityId,
  GameData,
  GameEvent,
  GameMap,
  GameState,
  PlayerId,
  PlayerState,
  UnitDef,
  Vec2,
} from '../core/types';
import { MoveDomain, Terrain, dist, entityCenter, inBounds, tileIndex } from '../core/types';
import {
  HARVEST_PER_TICK,
  REPAIR_COST_PER_HP,
  REPAIR_DEPOT_HP_PER_TICK,
  REPAIR_DEPOT_RANGE,
  REPAIR_HP_PER_TICK,
  UNLOAD_PER_TICK,
  secondsToTicks,
} from '../core/constants';
import { isGroundPassable } from '../map/terrain';
import { orderMove } from './movement';
import { findPath } from './pathfinding';
import { buildingsOf, entitiesOf } from './entity';

// --- harvester claim registry (derived cache, not part of serialized state) ----

/** Ticks a harvester waits after a failed crystal search before retrying. */
const SEARCH_BACKOFF_TICKS = secondsToTicks(2);
/** Chebyshev search radius for the throttled idle scan. */
const IDLE_SCAN_RADIUS = 10;
/** Chebyshev search radius for an active harvest retarget. */
const RETARGET_RADIUS = 64;
/** Weight of the refinery-distance term in target scoring: prefers tiles on
 *  the refinery side of a field, so harvesters stop marching ever-outward. */
const REFINERY_BIAS = 0.5;

interface ClaimRegistry {
  /** tile index -> claiming harvester id. */
  byTile: Map<number, EntityId>;
  /** harvester id -> claimed tile index. */
  byUnit: Map<EntityId, number>;
  /** harvester id -> earliest tick it may search for crystal again. */
  nextSearchTick: Map<EntityId, number>;
}

const claimStore = new WeakMap<GameState, ClaimRegistry>();

function claimsOf(state: GameState): ClaimRegistry {
  let reg = claimStore.get(state);
  if (!reg) {
    reg = { byTile: new Map(), byUnit: new Map(), nextSearchTick: new Map() };
    claimStore.set(state, reg);
  }
  return reg;
}

/** A claim is live while its harvester is alive and still on harvest duty
 *  (a harvest or returnCargo order anywhere in its queue) for that tile. */
function claimantActive(
  state: GameState,
  data: GameData,
  reg: ClaimRegistry,
  id: EntityId,
  idx: number,
): boolean {
  if (reg.byUnit.get(id) !== idx) return false;
  const e = state.entities.get(id);
  if (e === undefined || e.hp <= 0 || e.kind !== 'unit') return false;
  const def = data.units[e.defId];
  if (def === undefined || def.harvester === undefined) return false;
  for (let i = 0; i < e.orders.length; i++) {
    const k = e.orders[i].kind;
    if (k === 'harvest' || k === 'returnCargo') return true;
  }
  return false;
}

function releaseClaim(reg: ClaimRegistry, u: Entity): void {
  const idx = reg.byUnit.get(u.id);
  if (idx === undefined) return;
  reg.byUnit.delete(u.id);
  if (reg.byTile.get(idx) === u.id) reg.byTile.delete(idx);
}

function claimTile(reg: ClaimRegistry, u: Entity, idx: number): void {
  if (reg.byUnit.get(u.id) === idx) return; // already ours
  releaseClaim(reg, u);
  reg.byTile.set(idx, u.id);
  reg.byUnit.set(u.id, idx);
}

/** True when the tile is claimed by ANOTHER live harvester of the same owner.
 *  Stale claims (dead / repurposed claimants) are lazily purged here. Enemy
 *  claims never block — crystal contention between players is gameplay. */
function claimedByOwnOther(
  state: GameState,
  data: GameData,
  reg: ClaimRegistry,
  owner: PlayerId,
  selfId: EntityId,
  idx: number,
): boolean {
  const cid = reg.byTile.get(idx);
  if (cid === undefined || cid === selfId) return false;
  const claimant = state.entities.get(cid);
  if (claimant === undefined || !claimantActive(state, data, reg, cid, idx)) {
    reg.byTile.delete(idx);
    if (reg.byUnit.get(cid) === idx) reg.byUnit.delete(cid);
    return false;
  }
  return claimant.owner === owner;
}

/**
 * Claim-aware crystal target pick within Chebyshev radius `maxR` of the
 * harvester. Candidates skip tiles claimed by another of the same owner's
 * live harvesters; the best tile minimizes
 *   distToUnit + REFINERY_BIAS * distToNearestOwnRefinery.
 * On success the tile is claimed; on failure a 2s search backoff is armed.
 * Returns null while the backoff is active.
 */
function pickCrystalTarget(
  state: GameState,
  data: GameData,
  p: PlayerState,
  u: Entity,
  maxR: number,
): Vec2 | null {
  const reg = claimsOf(state);
  const backoff = reg.nextSearchTick.get(u.id);
  if (backoff !== undefined && state.tick < backoff) return null;

  const map = state.map;
  const cx = Math.round(u.pos.x);
  const cy = Math.round(u.pos.y);
  const refinery = nearestRefinery(state, data, p, u.pos);
  const rc = refinery !== null ? entityCenter(refinery, data) : null;
  const x0 = Math.max(0, cx - maxR);
  const x1 = Math.min(map.w - 1, cx + maxR);
  const y0 = Math.max(0, cy - maxR);
  const y1 = Math.min(map.h - 1, cy + maxR);

  let bestX = -1;
  let bestY = -1;
  let bestScore = Infinity;
  for (let y = y0; y <= y1; y++) {
    const row = y * map.w;
    for (let x = x0; x <= x1; x++) {
      const idx = row + x;
      if (map.terrain[idx] !== Terrain.CRYSTAL || map.crystal[idx] <= 0) continue;
      if (claimedByOwnOther(state, data, reg, p.id, u.id, idx)) continue;
      const dux = x - u.pos.x;
      const duy = y - u.pos.y;
      let score = Math.sqrt(dux * dux + duy * duy);
      if (score >= bestScore) continue; // refinery term only adds
      if (rc !== null) {
        const drx = x - rc.x;
        const dry = y - rc.y;
        score += REFINERY_BIAS * Math.sqrt(drx * drx + dry * dry);
      }
      if (score >= bestScore) continue;
      if (!canHarvesterReachCrystal(state, u, x, y)) continue;
      if (score < bestScore) {
        bestScore = score;
        bestX = x;
        bestY = y;
      }
    }
  }

  if (bestX < 0) {
    reg.nextSearchTick.set(u.id, state.tick + SEARCH_BACKOFF_TICKS);
    return null;
  }
  reg.nextSearchTick.delete(u.id);
  claimTile(reg, u, tileIndex(map, bestX, bestY));
  return { x: bestX, y: bestY };
}

function canHarvesterReachCrystal(state: GameState, u: Entity, x: number, y: number): boolean {
  const from = { x: Math.floor(u.pos.x), y: Math.floor(u.pos.y) };
  if (Math.max(Math.abs(from.x - x), Math.abs(from.y - y)) <= 1) return true;
  const blocked = (tx: number, ty: number): boolean => {
    const ids = state.occupancy.get(ty * state.map.w + tx);
    if (ids === undefined) return false;
    for (const id of ids) {
      if (id === u.id) continue;
      const e = state.entities.get(id);
      if (e !== undefined && e.hp > 0 && e.kind === 'building') return true;
    }
    return false;
  };
  const path = findPath(state.map, MoveDomain.GROUND, from, { x, y }, blocked);
  if (path === null) return false;
  if (path.length === 0) return true;
  const last = path[path.length - 1];
  return Math.max(Math.abs(last.x - x), Math.abs(last.y - y)) <= 1;
}

/** Recompute a player's produced/consumed power from operational buildings.
 *  Also used by game.ts to seed sensible values at game creation. */
export function recomputePower(state: GameState, data: GameData, p: PlayerState): void {
  let produced = 0;
  let consumed = 0;
  for (const b of buildingsOf(state, p.id)) {
    if (b.buildProgress < 1) continue;
    const def = data.buildings[b.defId];
    if (def.power >= 0) produced += def.power;
    else consumed += -def.power;
  }
  p.powerProduced = produced;
  p.powerConsumed = consumed;
}

export function updateEconomy(state: GameState, data: GameData, events: GameEvent[]): void {
  for (const p of state.players) {
    if (p.eliminated) continue;

    // --- power (edge-triggered events against last tick's values) ---
    const prevLow = p.powerConsumed > p.powerProduced;
    recomputePower(state, data, p);
    const low = p.powerConsumed > p.powerProduced;
    if (low && !prevLow) events.push({ type: 'lowPower', player: p.id });
    else if (!low && prevLow) events.push({ type: 'powerRestored', player: p.id });

    const myBuildings = buildingsOf(state, p.id);

    // radar requires an operational radar building AND power
    let hasRadar = false;
    for (const b of myBuildings) {
      if (b.buildProgress >= 1 && data.buildings[b.defId].isRadar) {
        hasRadar = true;
        break;
      }
    }
    p.radarActive = hasRadar && !low;

    // --- building repair (credits -> hp, auto-off at full) ---
    for (const b of myBuildings) {
      if (!b.repairing) continue;
      if (b.hp >= b.maxHp) {
        b.repairing = false;
        continue;
      }
      const heal = Math.min(REPAIR_HP_PER_TICK, b.maxHp - b.hp);
      const cost = heal * REPAIR_COST_PER_HP;
      if (p.credits >= cost) {
        p.credits -= cost;
        b.hp += heal;
        if (b.hp >= b.maxHp) {
          b.hp = b.maxHp;
          b.repairing = false;
        }
      }
      // can't afford: keep the flag, resume when credits flow again
    }

    const myEntities = entitiesOf(state, p.id);

    // --- repair depots heal nearby own ground units (free) ---
    for (const b of myBuildings) {
      if (b.buildProgress < 1) continue;
      const bd = data.buildings[b.defId];
      if (!bd.isRepairDepot) continue;
      const center = entityCenter(b, data);
      for (const u of myEntities) {
        if (u.kind !== 'unit' || u.hp <= 0 || u.hp >= u.maxHp) continue;
        const ud = data.units[u.defId];
        if (ud.domain !== MoveDomain.GROUND) continue;
        if (dist(center, u.pos) <= REPAIR_DEPOT_RANGE) {
          u.hp = Math.min(u.maxHp, u.hp + REPAIR_DEPOT_HP_PER_TICK);
        }
      }
    }

    // --- harvesters ---
    for (const u of myEntities) {
      if (u.kind !== 'unit' || u.hp <= 0) continue;
      const ud = data.units[u.defId];
      if (!ud.harvester) continue;
      updateHarvester(state, data, p, u, ud, events);
    }
  }
}

// --- harvester state machine -------------------------------------------------------

function updateHarvester(
  state: GameState,
  data: GameData,
  p: PlayerState,
  u: Entity,
  ud: UnitDef,
  events: GameEvent[],
): void {
  const cap = ud.harvester ? ud.harvester.capacity : 0;
  if (cap <= 0) return;
  const map = state.map;

  let ord = u.orders.length > 0 ? u.orders[0] : undefined;

  if (!ord) {
    // Idle auto-behavior: full -> return cargo; near crystal -> start harvesting.
    if (u.cargo >= cap) {
      u.orders.unshift({ kind: 'returnCargo' });
    } else if ((state.tick + u.id) % 15 === 0) {
      // Throttled, deterministic idle scan (claim-aware, backoff-gated).
      const tile = pickCrystalTarget(state, data, p, u, IDLE_SCAN_RADIUS);
      if (tile) u.orders.unshift({ kind: 'harvest', tile });
      else if (u.cargo > 0) u.orders.unshift({ kind: 'returnCargo' });
    }
    ord = u.orders.length > 0 ? u.orders[0] : undefined;
    if (!ord) return;
  }

  if (ord.kind === 'harvest') {
    if (u.cargo >= cap) {
      stopMoving(u);
      u.orders.unshift({ kind: 'returnCargo' });
      return;
    }
    const reg = claimsOf(state);
    let tile = ord.tile;
    if (tile && isLiveCrystal(map, tile.x, tile.y)) {
      const idx = tileIndex(map, tile.x, tile.y);
      if (claimedByOwnOther(state, data, reg, p.id, u.id, idx)) {
        tile = undefined; // a sibling harvester beat us to it — retarget
      } else {
        claimTile(reg, u, idx); // claim (or keep claiming) our working tile
      }
    } else {
      tile = undefined;
    }
    if (!tile) {
      // Auto-retarget the best unclaimed live crystal tile.
      const next = pickCrystalTarget(state, data, p, u, RETARGET_RADIUS);
      if (!next) {
        u.orders.shift();
        if (u.cargo > 0) u.orders.unshift({ kind: 'returnCargo' });
        else stopMoving(u);
        return;
      }
      ord.tile = next;
      tile = next;
    }
    const rx = Math.round(u.pos.x);
    const ry = Math.round(u.pos.y);
    if (Math.max(Math.abs(rx - tile.x), Math.abs(ry - tile.y)) <= 1) {
      // On/adjacent to the field: drain.
      stopMoving(u);
      if (tile.x !== rx || tile.y !== ry) {
        u.facing = Math.atan2(tile.y - u.pos.y, tile.x - u.pos.x);
      }
      const idx = tileIndex(map, tile.x, tile.y);
      const amt = Math.min(HARVEST_PER_TICK, map.crystal[idx], cap - u.cargo);
      if (amt > 0) {
        u.cargo += amt;
        map.crystal[idx] -= amt;
      }
      if (map.crystal[idx] <= 0) {
        map.crystal[idx] = 0;
        map.terrain[idx] = Terrain.DIRT;
        events.push({ type: 'crystalDepleted', pos: { x: tile.x, y: tile.y } });
      }
      if (u.cargo >= cap) u.orders.unshift({ kind: 'returnCargo' });
    } else {
      ensureMove(state, data, u, tile);
    }
    return;
  }

  if (ord.kind === 'returnCargo') {
    if (u.cargo <= 0) {
      u.orders.shift(); // resume underlying harvest order (or go idle)
      return;
    }
    const refinery = nearestRefinery(state, data, p, u.pos);
    if (!refinery) {
      stopMoving(u); // wait — resumes if a refinery is (re)built
      return;
    }
    const rdef = data.buildings[refinery.defId];
    const bx = refinery.pos.x | 0;
    const by = refinery.pos.y | 0;
    const rx = Math.round(u.pos.x);
    const ry = Math.round(u.pos.y);
    if (chebyshevToRect(rx, ry, bx, by, rdef.footprint.w, rdef.footprint.h) <= 1) {
      // Docked: unload. Release our field claim so a sibling can take the tile.
      stopMoving(u);
      releaseClaim(claimsOf(state), u);
      const center = entityCenter(refinery, data);
      u.facing = Math.atan2(center.y - u.pos.y, center.x - u.pos.x);
      const amt = Math.min(UNLOAD_PER_TICK, u.cargo);
      u.cargo -= amt;
      p.credits += amt;
      p.stats.creditsHarvested += amt;
      if (u.cargo <= 0) {
        u.cargo = 0;
        u.orders.shift();
      }
    } else {
      const dest = nearestDockTile(map, bx, by, rdef.footprint.w, rdef.footprint.h, u.pos);
      if (dest) ensureMove(state, data, u, dest);
      else stopMoving(u);
    }
  }
  // Any other order kind (move/attack/...) is handled by movement/combat.
}

// --- helpers ---------------------------------------------------------------------------

function isLiveCrystal(map: GameMap, x: number, y: number): boolean {
  if (!inBounds(map, x, y)) return false;
  const idx = tileIndex(map, x, y);
  return map.terrain[idx] === Terrain.CRYSTAL && map.crystal[idx] > 0;
}

function stopMoving(u: Entity): void {
  u.path = null;
  u.pathTarget = null;
}

/** Path toward dest unless we're already on our way; back off briefly when the
 *  pathfinder fails so blocked harvesters don't repath every tick. */
function ensureMove(state: GameState, data: GameData, u: Entity, dest: Vec2): void {
  if (
    u.pathTarget &&
    u.pathTarget.x === dest.x &&
    u.pathTarget.y === dest.y &&
    u.path &&
    u.path.length > 0
  ) {
    return; // already en route
  }
  if (u.repathCooldown > 0) {
    u.repathCooldown--;
    return;
  }
  orderMove(state, data, u, { x: dest.x, y: dest.y });
  if (!u.path || u.path.length === 0) u.repathCooldown = 20;
}

function nearestRefinery(
  state: GameState,
  data: GameData,
  p: PlayerState,
  pos: Vec2,
): Entity | null {
  let best: Entity | null = null;
  let bestD = Infinity;
  for (const b of buildingsOf(state, p.id)) {
    if (b.buildProgress < 1) continue;
    const def = data.buildings[b.defId];
    if (!def.isRefinery) continue;
    const d = dist(entityCenter(b, data), pos);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

function chebyshevToRect(
  px: number,
  py: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
): number {
  const dx = Math.max(0, x0 - px, px - (x0 + w - 1));
  const dy = Math.max(0, y0 - py, py - (y0 + h - 1));
  return Math.max(dx, dy);
}

/** Closest ground-passable tile ringing the footprint (expanding up to 2 rings). */
function nearestDockTile(
  map: GameMap,
  x0: number,
  y0: number,
  w: number,
  h: number,
  from: Vec2,
): Vec2 | null {
  for (let r = 1; r <= 2; r++) {
    let best: Vec2 | null = null;
    let bestD = Infinity;
    const xa = x0 - r;
    const ya = y0 - r;
    const xb = x0 + w - 1 + r;
    const yb = y0 + h - 1 + r;
    const consider = (x: number, y: number): void => {
      if (!inBounds(map, x, y) || !isGroundPassable(map, x, y)) return;
      const dxx = x - from.x;
      const dyy = y - from.y;
      const d = dxx * dxx + dyy * dyy;
      if (d < bestD) {
        bestD = d;
        best = { x, y };
      }
    };
    for (let x = xa; x <= xb; x++) {
      consider(x, ya);
      consider(x, yb);
    }
    for (let y = ya + 1; y <= yb - 1; y++) {
      consider(xa, y);
      consider(xb, y);
    }
    if (best) return best;
  }
  return null;
}
