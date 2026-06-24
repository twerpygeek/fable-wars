// =============================================================================
// FABLE WARS — sim/crates.ts (Owner A)
// RA2 [CrateRules]-style map bonuses. Called once per tick from game.ts
// (after updateSuperweapons). Spawns crates on a fixed schedule at random
// passable ground tiles, detects pickup by any player's unit, and applies the
// bonus (money / veterancy / free unit / heal / reveal / armor / speed /
// firepower). No evil crates — RA2 shipped them disabled.
//
// Deterministic: tick counts + simRandom(state) only. Crate ids are the spawn
// tick (at most one crate spawns per tick, so they are unique per match).
// =============================================================================

import type {
  Crate,
  CrateKind,
  Entity,
  FactionId,
  GameData,
  GameEvent,
  GameState,
  UnitDef,
} from '../core/types';
import { Terrain, VetRank, tileIndex } from '../core/types';
import {
  CRATE_BUFF_ARMOR,
  CRATE_BUFF_FIREPOWER,
  CRATE_BUFF_SPEED,
  CRATE_CAP,
  CRATE_INTERVAL_TICKS,
  CRATE_MONEY_BASE,
  CRATE_MONEY_RNG,
  CRATE_RADIUS,
  CRATE_WEIGHTS,
} from '../core/constants';
import { simRandom } from '../core/rng';
import { isGroundPassable } from '../map/terrain';
import { entitiesOf, occupyEntity, spawnUnit } from './entity';
import { findSpawnTileNear } from './production';

/** Crates never spawn within this many tiles of a start position (keeps the
 *  early game fair — nobody gets a free crate in their base). */
const START_CLEARANCE = 8;
/** A unit within this distance of the crate tile's center collects it. */
const PICKUP_RADIUS = 0.9;
/** Bounded random placement attempts per spawn tick (deterministic). */
const SPAWN_ATTEMPTS = 40;

/**
 * Per-tick crate update: spawn on schedule (first crate at half the interval,
 * then one every CRATE_INTERVAL_TICKS while under CRATE_CAP), then resolve
 * pickups. Does nothing when the lobby toggle is off.
 */
export function updateCrates(state: GameState, data: GameData, events: GameEvent[]): void {
  if (!state.config.crates) return;

  if (
    state.crates.length < CRATE_CAP &&
    state.tick % CRATE_INTERVAL_TICKS === CRATE_INTERVAL_TICKS >> 1
  ) {
    spawnCrate(state);
  }

  for (let i = 0; i < state.crates.length; i++) {
    const crate = state.crates[i];
    const collector = findCollector(state, crate);
    if (collector === null) continue;
    state.crates.splice(i, 1);
    i--;
    applyCrate(state, data, crate, collector, events);
  }
}

// --- spawning -------------------------------------------------------------------

function spawnCrate(state: GameState): void {
  const map = state.map;
  for (let attempt = 0; attempt < SPAWN_ATTEMPTS; attempt++) {
    const x = Math.floor(simRandom(state) * map.w);
    const y = Math.floor(simRandom(state) * map.h);
    if (!isGroundPassable(map, x, y)) continue;
    const idx = tileIndex(map, x, y);
    if (map.terrain[idx] === Terrain.CRYSTAL) continue;
    const occ = state.occupancy.get(idx);
    if (occ !== undefined && occ.length > 0) continue;
    let rejected = false;
    for (const sp of map.startPositions) {
      const dx = x - sp.x;
      const dy = y - sp.y;
      if (dx * dx + dy * dy < START_CLEARANCE * START_CLEARANCE) {
        rejected = true;
        break;
      }
    }
    if (rejected) continue;
    for (const c of state.crates) {
      if (c.pos.x === x && c.pos.y === y) {
        rejected = true;
        break;
      }
    }
    if (rejected) continue;
    const crate: Crate = {
      id: state.tick,
      pos: { x, y },
      kind: pickKind(state),
      spawnedTick: state.tick,
    };
    state.crates.push(crate);
    return;
  }
}

/** Weighted kind pick over CRATE_WEIGHTS (RA2 default weights). */
function pickKind(state: GameState): CrateKind {
  let total = 0;
  for (let i = 0; i < CRATE_WEIGHTS.length; i++) total += CRATE_WEIGHTS[i][1];
  let roll = simRandom(state) * total;
  for (let i = 0; i < CRATE_WEIGHTS.length; i++) {
    roll -= CRATE_WEIGHTS[i][1];
    if (roll < 0) return CRATE_WEIGHTS[i][0];
  }
  return CRATE_WEIGHTS[CRATE_WEIGHTS.length - 1][0];
}

// --- pickup ---------------------------------------------------------------------

/** First live unit (ascending entity id — Map insertion order is creation
 *  order) within PICKUP_RADIUS of the crate tile's center. */
function findCollector(state: GameState, crate: Crate): Entity | null {
  const cx = crate.pos.x + 0.5;
  const cy = crate.pos.y + 0.5;
  const r2 = PICKUP_RADIUS * PICKUP_RADIUS;
  for (const e of state.entities.values()) {
    if (e.kind !== 'unit' || e.hp <= 0) continue;
    const dx = e.pos.x - cx;
    const dy = e.pos.y - cy;
    if (dx * dx + dy * dy <= r2) return e;
  }
  return null;
}

/** Cheapest weaponized vehicle-tab unit of a faction (free-unit crates). */
function cheapestArmedVehicle(data: GameData, faction: FactionId): UnitDef | null {
  let best: UnitDef | null = null;
  for (const key in data.units) {
    const ud = data.units[key];
    if (ud.faction !== faction || ud.tab !== 'vehicle' || ud.weapon === undefined) continue;
    if (best === null || ud.cost < best.cost) best = ud;
  }
  return best;
}

function applyCrate(
  state: GameState,
  data: GameData,
  crate: Crate,
  collector: Entity,
  events: GameEvent[],
): void {
  const p = state.players[collector.owner];
  if (p === undefined) return;
  const cx = crate.pos.x + 0.5;
  const cy = crate.pos.y + 0.5;
  const radius2 = CRATE_RADIUS * CRATE_RADIUS;
  let amount: number | undefined;

  switch (crate.kind) {
    case 'money': {
      amount = CRATE_MONEY_BASE + Math.floor(simRandom(state) * CRATE_MONEY_RNG);
      p.credits += amount;
      break;
    }
    case 'veteran': {
      // Collector-owner units near the crate gain one rank (capped at ELITE).
      for (const e of entitiesOf(state, collector.owner)) {
        if (e.kind !== 'unit' || e.hp <= 0 || e.vet >= VetRank.ELITE) continue;
        const dx = e.pos.x - cx;
        const dy = e.pos.y - cy;
        if (dx * dx + dy * dy > radius2) continue;
        e.vet = e.vet === VetRank.ROOKIE ? VetRank.VETERAN : VetRank.ELITE;
        events.push({ type: 'promotion', id: e.id, rank: e.vet });
      }
      break;
    }
    case 'unit': {
      const def = cheapestArmedVehicle(data, p.faction);
      if (def !== null) {
        const tile = findSpawnTileNear(state, crate.pos.x, crate.pos.y, 1, 1, def.domain);
        if (tile !== null) {
          const u = spawnUnit(state, data, def.id, collector.owner, tile);
          occupyEntity(state, data, u);
        }
      }
      break;
    }
    case 'heal': {
      for (const e of entitiesOf(state, collector.owner)) {
        if (e.hp > 0) e.hp = e.maxHp;
      }
      break;
    }
    case 'reveal': {
      p.explored.fill(1);
      break;
    }
    case 'armor':
    case 'speed':
    case 'firepower': {
      // Set (not stack) the buff on collector-owner units near the crate.
      for (const e of entitiesOf(state, collector.owner)) {
        if (e.kind !== 'unit' || e.hp <= 0) continue;
        const dx = e.pos.x - cx;
        const dy = e.pos.y - cy;
        if (dx * dx + dy * dy > radius2) continue;
        if (crate.kind === 'armor') e.buffs.armor = CRATE_BUFF_ARMOR;
        else if (crate.kind === 'speed') e.buffs.speed = CRATE_BUFF_SPEED;
        else e.buffs.fire = CRATE_BUFF_FIREPOWER;
      }
      break;
    }
  }

  events.push(
    amount !== undefined
      ? {
          type: 'cratePickup',
          player: collector.owner,
          kind: crate.kind,
          pos: { x: crate.pos.x, y: crate.pos.y },
          amount,
        }
      : {
          type: 'cratePickup',
          player: collector.owner,
          kind: crate.kind,
          pos: { x: crate.pos.x, y: crate.pos.y },
        },
  );
}
