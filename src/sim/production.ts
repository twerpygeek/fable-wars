// =============================================================================
// POCKET ALERT — sim/production.ts (Owner A)
// Production queues (pay-as-you-build), placement validation, spiral placement
// search for the AI, and the per-tick queue/construction advancement used by
// game.ts. Selling/cancel refunds are handled in game.ts command application.
// =============================================================================

import type {
  BuildingDef,
  Entity,
  GameData,
  GameEvent,
  GameState,
  PlayerId,
  PlayerState,
  ProductionQueue,
  ProductionTab,
  UnitDef,
  Vec2,
} from '../core/types';
import { MoveDomain, Terrain, entityCenter, inBounds, tileIndex } from '../core/types';
import {
  BUILD_RADIUS,
  LOW_POWER_BUILD_FACTOR,
  MAX_QUEUE_LENGTH,
  MAX_UNITS_PER_PLAYER,
  secondsToTicks,
} from '../core/constants';
import { isGroundPassable, passableFor } from '../map/terrain';
import { buildingsOf, entitiesOf, occupyEntity, spawnUnit } from './entity';

const UNIT_TABS: ProductionTab[] = ['infantry', 'vehicle', 'air', 'naval'];
const ALL_TABS: ProductionTab[] = ['structure', 'defense', 'infantry', 'vehicle', 'air', 'naval'];

/** Ticks for the on-map construction ramp after a building is placed (cosmetic;
 *  the building only becomes operational at buildProgress 1). Local choice. */
const CONSTRUCTION_TICKS = secondsToTicks(2);
/** insufficientFunds announcer dedupe window. */
const FUNDS_EVENT_COOLDOWN = secondsToTicks(5);

// Last insufficientFunds tick per player; cosmetic event dedupe only, so a
// process-local WeakMap keyed by state is fine (and deterministic per run).
const fundsEventTracker = new WeakMap<GameState, Map<PlayerId, number>>();

function unitDefOf(data: GameData, defId: string): UnitDef | undefined {
  return data.units[defId] as UnitDef | undefined;
}

function buildingDefOf(data: GameData, defId: string): BuildingDef | undefined {
  return data.buildings[defId] as BuildingDef | undefined;
}

// --- canQueue --------------------------------------------------------------------

export function canQueue(
  state: GameState,
  data: GameData,
  player: PlayerId,
  defId: string,
): { ok: boolean; reason?: string } {
  const p = state.players[player];
  if (!p || p.eliminated) return { ok: false, reason: 'Player unavailable' };

  const unitDef = unitDefOf(data, defId);
  const bldDef = unitDef ? undefined : buildingDefOf(data, defId);
  const def = unitDef ?? bldDef;
  if (!def) return { ok: false, reason: 'Unknown def' };
  if (def.faction !== p.faction) return { ok: false, reason: 'Wrong faction' };

  const tab = def.tab;
  const queue = p.queues[tab];
  if (!queue) return { ok: false, reason: 'No such tab' };
  if (queue.items.length >= MAX_QUEUE_LENGTH) return { ok: false, reason: 'Queue full' };

  // Scan own operational buildings once for producer / tier gates.
  let hasProducer = false;
  let hasRadar = false;
  let hasTechLab = false;
  const myBuildings = buildingsOf(state, player);
  for (const b of myBuildings) {
    if (b.buildProgress < 1) continue;
    const bd = data.buildings[b.defId];
    if (bd.producesTabs && bd.producesTabs.indexOf(tab) >= 0) hasProducer = true;
    if (bd.isRadar) hasRadar = true;
    if (bd.isTechLab) hasTechLab = true;
  }
  if (!hasProducer) return { ok: false, reason: 'No production structure' };

  if (unitDef) {
    if (countUnitsAndQueued(state, p) >= MAX_UNITS_PER_PLAYER) {
      return { ok: false, reason: 'Unit limit reached' };
    }
    if (unitDef.tier >= 2 && !hasRadar) return { ok: false, reason: 'Requires radar' };
    if (unitDef.tier >= 3 && !hasTechLab) return { ok: false, reason: 'Requires tech lab' };
  }

  for (const pre of def.prerequisites) {
    let met = false;
    for (const b of myBuildings) {
      if (b.defId === pre && b.buildProgress >= 1) {
        met = true;
        break;
      }
    }
    if (!met) {
      const pd = buildingDefOf(data, pre);
      return { ok: false, reason: `Requires ${pd ? pd.name : pre}` };
    }
  }
  return { ok: true };
}

function countUnitsAndQueued(state: GameState, p: PlayerState): number {
  let n = 0;
  for (const e of entitiesOf(state, p.id)) if (e.kind === 'unit') n++;
  for (const tab of UNIT_TABS) n += p.queues[tab].items.length;
  return n;
}

// --- placement ---------------------------------------------------------------------

export function isValidPlacement(
  state: GameState,
  data: GameData,
  player: PlayerId,
  defId: string,
  pos: Vec2,
): boolean {
  const p = state.players[player];
  if (!p || p.eliminated) return false;
  const def = buildingDefOf(data, defId);
  if (!def || def.faction !== p.faction) return false;

  const map = state.map;
  const x0 = Math.floor(pos.x);
  const y0 = Math.floor(pos.y);
  const w = def.footprint.w;
  const h = def.footprint.h;
  if (!inBounds(map, x0, y0) || !inBounds(map, x0 + w - 1, y0 + h - 1)) return false;

  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const idx = tileIndex(map, x, y);
      if (def.placeOnWater) {
        if (map.terrain[idx] !== Terrain.WATER) return false;
      } else {
        if (!isGroundPassable(map, x, y)) return false;
        if (map.terrain[idx] === Terrain.CRYSTAL) return false;
      }
      const occ = state.occupancy.get(idx);
      if (occ && occ.length > 0) return false;
      if (!p.explored[idx]) return false;
    }
  }

  // Within BUILD_RADIUS (Chebyshev gap) of any own building's footprint edge.
  for (const b of buildingsOf(state, player)) {
    const bd = data.buildings[b.defId];
    const bx = b.pos.x | 0;
    const by = b.pos.y | 0;
    const gapX = Math.max(0, bx - (x0 + w - 1), x0 - (bx + bd.footprint.w - 1));
    const gapY = Math.max(0, by - (y0 + h - 1), y0 - (by + bd.footprint.h - 1));
    if (Math.max(gapX, gapY) <= BUILD_RADIUS) return true;
  }
  return false;
}

/** Spiral search for a valid top-left placement near `near` (or the player's
 *  ConYard / first building). Works for water buildings too because
 *  isValidPlacement enforces WATER footprints. Used by the AI. */
export function findPlacement(
  state: GameState,
  data: GameData,
  player: PlayerId,
  defId: string,
  near?: Vec2,
): Vec2 | null {
  const p = state.players[player];
  if (!p || p.eliminated) return null;
  const def = buildingDefOf(data, defId);
  if (!def) return null;

  let origin: Vec2 | undefined = near;
  if (!origin) {
    const mine = buildingsOf(state, player);
    let anchor: Entity | null = null;
    for (const b of mine) {
      if (data.buildings[b.defId].isConYard) {
        anchor = b;
        break;
      }
    }
    if (!anchor && mine.length > 0) anchor = mine[0];
    origin = anchor ? entityCenter(anchor, data) : state.map.startPositions[player];
  }
  if (!origin) return null;

  const cx = Math.round(origin.x);
  const cy = Math.round(origin.y);
  const halfW = def.footprint.w >> 1;
  const halfH = def.footprint.h >> 1;
  const maxR = 26;

  const tryAt = (dx: number, dy: number): Vec2 | null => {
    const cand = { x: cx + dx - halfW, y: cy + dy - halfH };
    return isValidPlacement(state, data, player, defId, cand) ? cand : null;
  };

  const center = tryAt(0, 0);
  if (center) return center;
  for (let r = 1; r <= maxR; r++) {
    for (let dx = -r; dx <= r; dx++) {
      const top = tryAt(dx, -r);
      if (top) return top;
      const bottom = tryAt(dx, r);
      if (bottom) return bottom;
    }
    for (let dy = -r + 1; dy <= r - 1; dy++) {
      const left = tryAt(-r, dy);
      if (left) return left;
      const right = tryAt(r, dy);
      if (right) return right;
    }
  }
  return null;
}

// --- unit spawn tile search -----------------------------------------------------------

/** First free, domain-passable tile in expanding rings around a footprint.
 *  Checks the occupancy index, so callers should occupyEntity() what they spawn. */
export function findSpawnTileNear(
  state: GameState,
  x0: number,
  y0: number,
  w: number,
  h: number,
  domain: MoveDomain,
): Vec2 | null {
  const map = state.map;
  for (let r = 1; r <= 6; r++) {
    const xa = x0 - r;
    const ya = y0 - r;
    const xb = x0 + w - 1 + r;
    const yb = y0 + h - 1 + r;
    for (let x = xa; x <= xb; x++) {
      if (freeTile(state, domain, x, ya)) return { x, y: ya };
      if (freeTile(state, domain, x, yb)) return { x, y: yb };
    }
    for (let y = ya + 1; y <= yb - 1; y++) {
      if (freeTile(state, domain, xa, y)) return { x: xa, y };
      if (freeTile(state, domain, xb, y)) return { x: xb, y };
    }
  }
  return null;
}

function freeTile(state: GameState, domain: MoveDomain, x: number, y: number): boolean {
  const map = state.map;
  if (!inBounds(map, x, y)) return false;
  if (!passableFor(map, domain, x, y)) return false;
  const occ = state.occupancy.get(tileIndex(map, x, y));
  return !occ || occ.length === 0;
}

// --- per-tick advancement (called by game.ts) ------------------------------------------

export function advanceProduction(state: GameState, data: GameData, events: GameEvent[]): void {
  for (const p of state.players) {
    if (p.eliminated) continue;

    // 1) Construction ramp on placed buildings.
    for (const b of buildingsOf(state, p.id)) {
      if (b.buildProgress >= 1) continue;
      b.buildProgress = Math.min(1, b.buildProgress + 1 / CONSTRUCTION_TICKS);
      if (b.buildProgress >= 1) onBuildingConstructed(state, data, p, b, events);
    }

    // 2) Queues — pay-as-you-build, slowed under low power.
    const lowPower = p.powerConsumed > p.powerProduced;
    const factor = lowPower ? LOW_POWER_BUILD_FACTOR : 1;

    for (const tab of ALL_TABS) {
      const q = p.queues[tab];
      if (q.items.length === 0) {
        q.progress = 0;
        q.onHold = false;
        continue;
      }
      // A finished structure awaiting placement stalls its tab.
      if (q.readyBuilding !== null) {
        q.onHold = false;
        continue;
      }
      const defId = q.items[0];
      const unitDef = unitDefOf(data, defId);
      const bldDef = unitDef ? undefined : buildingDefOf(data, defId);
      const def = unitDef ?? bldDef;
      if (!def) {
        // Corrupt queue entry — drop it (should never happen with canQueue gating).
        q.items.shift();
        q.progress = 0;
        continue;
      }
      // Producer destroyed mid-build: pause (credits already spent stay banked
      // in progress; resumes if the producer is rebuilt).
      if (!hasOperationalProducer(state, data, p.id, tab)) {
        q.onHold = true;
        continue;
      }

      if (q.progress < def.buildTicks) {
        const costPerTick = (def.cost / def.buildTicks) * factor;
        if (p.credits >= costPerTick) {
          p.credits -= costPerTick;
          q.progress += factor;
          q.onHold = false;
        } else {
          q.onHold = true;
          emitInsufficientFunds(state, p.id, events);
        }
      }

      if (q.progress >= def.buildTicks - 1e-6) {
        if (unitDef) {
          completeUnit(state, data, p, q, unitDef, events);
        } else {
          q.readyBuilding = defId;
          q.items.shift();
          q.progress = 0;
          events.push({ type: 'buildingReady', player: p.id, defId });
        }
      }
    }
  }
}

function hasOperationalProducer(
  state: GameState,
  data: GameData,
  player: PlayerId,
  tab: ProductionTab,
): boolean {
  for (const b of buildingsOf(state, player)) {
    if (b.buildProgress < 1) continue;
    const bd = data.buildings[b.defId];
    if (bd.producesTabs && bd.producesTabs.indexOf(tab) >= 0) return true;
  }
  return false;
}

function pickProducer(
  state: GameState,
  data: GameData,
  player: PlayerId,
  tab: ProductionTab,
): Entity | null {
  let first: Entity | null = null;
  for (const b of buildingsOf(state, player)) {
    if (b.buildProgress < 1) continue;
    const bd = data.buildings[b.defId];
    if (!bd.producesTabs || bd.producesTabs.indexOf(tab) < 0) continue;
    if (b.rally) return b; // prefer a producer with a rally point set
    if (!first) first = b;
  }
  return first;
}

function completeUnit(
  state: GameState,
  data: GameData,
  p: PlayerState,
  q: ProductionQueue,
  def: UnitDef,
  events: GameEvent[],
): void {
  const producer = pickProducer(state, data, p.id, def.tab);
  if (!producer) {
    q.onHold = true; // wait for a producer to exist again
    return;
  }
  const bd = data.buildings[producer.defId];
  const x0 = producer.pos.x | 0;
  const y0 = producer.pos.y | 0;
  const tile =
    findSpawnTileNear(state, x0, y0, bd.footprint.w, bd.footprint.h, def.domain) ?? {
      x: Math.min(state.map.w - 1, x0 + (bd.footprint.w >> 1)),
      y: Math.min(state.map.h - 1, y0 + bd.footprint.h),
    };
  const u = spawnUnit(state, data, def.id, p.id, tile);
  occupyEntity(state, data, u); // so a same-tick spawn elsewhere can't pick this tile
  if (producer.rally) {
    u.orders.push({ kind: 'move', dest: { x: producer.rally.x, y: producer.rally.y } });
    u.facing = Math.atan2(producer.rally.y - u.pos.y, producer.rally.x - u.pos.x);
  } else if (def.harvester) {
    u.orders.push({ kind: 'harvest' });
  }
  p.stats.built++;
  events.push({ type: 'unitReady', player: p.id, defId: def.id, id: u.id });
  q.items.shift();
  q.progress = 0;
}

/** Fired when a placed building finishes its construction ramp. */
function onBuildingConstructed(
  state: GameState,
  data: GameData,
  p: PlayerState,
  b: Entity,
  events: GameEvent[],
): void {
  const def = data.buildings[b.defId];
  if (!def.isRefinery) return;

  // Refineries come with a free harvester.
  let aliveUnits = 0;
  for (const e of entitiesOf(state, p.id)) if (e.kind === 'unit') aliveUnits++;
  if (aliveUnits >= MAX_UNITS_PER_PLAYER) return;

  let harvDef: UnitDef | null = null;
  for (const key in data.units) {
    const ud = data.units[key];
    if (ud.faction === p.faction && ud.harvester) {
      harvDef = ud;
      break;
    }
  }
  if (!harvDef) return;

  const tile = findSpawnTileNear(
    state,
    b.pos.x | 0,
    b.pos.y | 0,
    def.footprint.w,
    def.footprint.h,
    harvDef.domain,
  );
  if (!tile) return;
  const u = spawnUnit(state, data, harvDef.id, p.id, tile);
  occupyEntity(state, data, u);
  u.orders.push({ kind: 'harvest' });
  p.stats.built++;
  events.push({ type: 'unitReady', player: p.id, defId: harvDef.id, id: u.id });
}

function emitInsufficientFunds(state: GameState, player: PlayerId, events: GameEvent[]): void {
  let tracker = fundsEventTracker.get(state);
  if (!tracker) {
    tracker = new Map();
    fundsEventTracker.set(state, tracker);
  }
  const last = tracker.get(player);
  if (last !== undefined && state.tick - last < FUNDS_EVENT_COOLDOWN) return;
  tracker.set(player, state.tick);
  events.push({ type: 'insufficientFunds', player });
}
