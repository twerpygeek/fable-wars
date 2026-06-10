// =============================================================================
// POCKET ALERT — sim/entity.ts (Owner A)
// Entity lifecycle: spawn, remove, per-player queries, occupancy maintenance.
//
// entitiesOf/buildingsOf are backed by a per-state cache invalidated on every
// spawn/remove, so the many per-tick callers (economy, production, AI, UI)
// share one O(n) rebuild instead of repeated full-map scans.
// =============================================================================

import type {
  Entity,
  EntityId,
  GameData,
  GameState,
  PlayerId,
  Vec2,
} from '../core/types';
import { VetRank, inBounds, tileIndex } from '../core/types';

// --- per-state entity list cache ---------------------------------------------

interface EntityCache {
  version: number;
  all: Entity[][]; // index = PlayerId
  buildings: Entity[][];
}

const cacheVersions = new WeakMap<GameState, number>();
const caches = new WeakMap<GameState, EntityCache>();

function bumpVersion(state: GameState): void {
  cacheVersions.set(state, (cacheVersions.get(state) ?? 0) + 1);
}

function getCache(state: GameState): EntityCache {
  const version = cacheVersions.get(state) ?? 0;
  let cache = caches.get(state);
  if (cache && cache.version === version) return cache;
  const n = state.players.length;
  const all: Entity[][] = [];
  const buildings: Entity[][] = [];
  for (let i = 0; i < n; i++) {
    all.push([]);
    buildings.push([]);
  }
  // Map iteration order = insertion order: deterministic.
  for (const e of state.entities.values()) {
    if (e.owner < 0 || e.owner >= n) continue;
    all[e.owner].push(e);
    if (e.kind === 'building') buildings[e.owner].push(e);
  }
  cache = { version, all, buildings };
  caches.set(state, cache);
  return cache;
}

// --- spawning ------------------------------------------------------------------

export function spawnUnit(
  state: GameState,
  data: GameData,
  defId: string,
  owner: PlayerId,
  pos: Vec2,
): Entity {
  const def = data.units[defId];
  if (!def) throw new Error(`spawnUnit: unknown unit def '${defId}'`);
  const e: Entity = {
    id: state.nextEntityId++,
    kind: 'unit',
    defId,
    owner,
    pos: { x: pos.x, y: pos.y },
    facing: 0,
    hp: def.hp,
    maxHp: def.hp,
    orders: [],
    path: null,
    pathTarget: null,
    attackCooldown: 0,
    targetId: null,
    cargo: 0,
    kills: 0,
    vet: VetRank.ROOKIE,
    repathCooldown: 0,
    stance: 'aggressive',
    buffs: { armor: 1, speed: 1, fire: 1 },
    buildProgress: 1,
    rally: null,
    repairing: false,
    captureProgress: 0,
    swChargeTick: -1,
    isPrimary: false,
  };
  state.entities.set(e.id, e);
  bumpVersion(state);
  return e;
}

export function spawnBuilding(
  state: GameState,
  data: GameData,
  defId: string,
  owner: PlayerId,
  pos: Vec2,
  instant?: boolean,
): Entity {
  const def = data.buildings[defId];
  if (!def) throw new Error(`spawnBuilding: unknown building def '${defId}'`);
  const e: Entity = {
    id: state.nextEntityId++,
    kind: 'building',
    defId,
    owner,
    pos: { x: Math.floor(pos.x), y: Math.floor(pos.y) },
    facing: 0,
    hp: def.hp,
    maxHp: def.hp,
    orders: [],
    path: null,
    pathTarget: null,
    attackCooldown: 0,
    targetId: null,
    cargo: 0,
    kills: 0,
    vet: VetRank.ROOKIE,
    repathCooldown: 0,
    stance: 'aggressive',
    buffs: { armor: 1, speed: 1, fire: 1 },
    // Placed buildings play a short construction ramp (advanced in
    // production.ts); buildProgress >= 1 means operational.
    buildProgress: instant ? 1 : 0,
    rally: null,
    repairing: false,
    captureProgress: 0,
    swChargeTick: -1,
    isPrimary: false,
  };
  state.entities.set(e.id, e);
  bumpVersion(state);
  return e;
}

export function removeEntity(state: GameState, id: EntityId): void {
  if (state.entities.delete(id)) bumpVersion(state);
}

// --- queries -------------------------------------------------------------------

export function entitiesOf(state: GameState, player: PlayerId): Entity[] {
  const cache = getCache(state);
  return player >= 0 && player < cache.all.length ? cache.all[player] : [];
}

export function buildingsOf(state: GameState, player: PlayerId): Entity[] {
  const cache = getCache(state);
  return player >= 0 && player < cache.buildings.length ? cache.buildings[player] : [];
}

// --- occupancy -------------------------------------------------------------------

/** Add a single entity to the occupancy index (units: rounded tile, buildings: footprint). */
export function occupyEntity(state: GameState, data: GameData, e: Entity): void {
  const map = state.map;
  if (e.kind === 'building') {
    const def = data.buildings[e.defId];
    const x0 = e.pos.x | 0;
    const y0 = e.pos.y | 0;
    for (let y = y0; y < y0 + def.footprint.h; y++) {
      for (let x = x0; x < x0 + def.footprint.w; x++) {
        if (!inBounds(map, x, y)) continue;
        pushOccupant(state, tileIndex(map, x, y), e.id);
      }
    }
  } else {
    const x = Math.round(e.pos.x);
    const y = Math.round(e.pos.y);
    if (inBounds(map, x, y)) pushOccupant(state, tileIndex(map, x, y), e.id);
  }
}

function pushOccupant(state: GameState, idx: number, id: EntityId): void {
  const list = state.occupancy.get(idx);
  if (list) list.push(id);
  else state.occupancy.set(idx, [id]);
}

/** Full occupancy rebuild — called once at the end of every tick. */
export function rebuildOccupancy(state: GameState, data: GameData): void {
  state.occupancy.clear();
  for (const e of state.entities.values()) occupyEntity(state, data, e);
}
