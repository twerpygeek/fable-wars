// =============================================================================
// POCKET ALERT — sim/game.ts (Owner A)
// createGame + tickGame: the ONLY mutators of GameState. Tick order per
// ARCHITECTURE.md: commands → production → economy → unit brains (combat,
// movement) → unit pushing → projectiles → superweapons → crates → fog →
// cleanup → occupancy.
// =============================================================================

import type {
  Command,
  Entity,
  GameConfig,
  GameData,
  GameEvent,
  GameState,
  PlayerId,
  PlayerState,
  ProductionQueue,
  ProductionTab,
  Vec2,
} from '../core/types';
import {
  MAP_SIZES,
  SELL_REFUND,
  STARTING_CREDITS,
  UNDER_ATTACK_COOLDOWN,
  secondsToTicks,
} from '../core/constants';
import { generateMap } from '../map/mapgen';
import {
  buildingsOf,
  entitiesOf,
  rebuildOccupancy,
  removeEntity,
  spawnBuilding,
  spawnUnit,
} from './entity';
import { updateEconomy, recomputePower } from './economy';
import {
  advanceProduction,
  canQueue,
  findSpawnTileNear,
  isValidPlacement,
} from './production';
import { applyUnitPushing, orderMove, updateUnitMovement } from './movement';
import { updateProjectiles, updateUnitCombat } from './combat';
import { updateCrates } from './crates';
import { updateFog } from './fog';
import { launchSuperweapon, updateSuperweapons } from './superweapons';
import {
  applyCrystalRushCommand,
  revealCrystalRushMap,
  setupCrystalRush,
  updateCrystalRush,
} from './modes/crystalRush';

const ALL_TABS: ProductionTab[] = ['structure', 'defense', 'infantry', 'vehicle', 'air', 'naval'];

// Per-state announcer dedupe (sim-internal, not part of state). Kill/loss
// stats are event-driven and monotonic — credited in combat.ts dealDamage
// (kills) and cleanupDeaths/eliminatePlayer below (losses).
interface TickMemo {
  lastUnderAttack: number[]; // per player, tick of last underAttack event let through
  lastNoFunds: number[]; // per player, tick of last insufficientFunds let through
  gameOverEmitted: boolean;
}
const memos = new WeakMap<GameState, TickMemo>();

function memoOf(state: GameState): TickMemo {
  let m = memos.get(state);
  if (!m) {
    const n = state.players.length;
    m = {
      lastUnderAttack: new Array(n).fill(-1e9),
      lastNoFunds: new Array(n).fill(-1e9),
      gameOverEmitted: false,
    };
    memos.set(state, m);
  }
  return m;
}

// --- createGame -----------------------------------------------------------------

function emptyQueue(): ProductionQueue {
  return { items: [], progress: 0, readyBuilding: null, onHold: false };
}

export function createGame(config: GameConfig, data: GameData): GameState {
  const size = MAP_SIZES[config.mapSize];
  const map = generateMap(config.seed, config.mapSize, config.waterAmount, config.players.length);

  const players: PlayerState[] = config.players.map((pc, i) => {
    const queues = {} as Record<ProductionTab, ProductionQueue>;
    for (const tab of ALL_TABS) queues[tab] = emptyQueue();
    return {
      id: i,
      name: pc.name,
      faction: pc.faction,
      colorIdx: pc.colorIdx,
      isHuman: pc.isHuman,
      difficulty: pc.difficulty,
      eliminated: false,
      credits: STARTING_CREDITS,
      powerProduced: 0,
      powerConsumed: 0,
      queues,
      superweapon: null,
      radarActive: false,
      explored: new Uint8Array(map.w * map.h),
      visible: new Uint8Array(map.w * map.h),
      aiMemory: {},
      stats: {
        unitsKilled: 0,
        unitsLost: 0,
        buildingsKilled: 0,
        buildingsLost: 0,
        built: 0,
        creditsHarvested: 0,
        score: 0,
      },
    };
  });

  const state: GameState = {
    tick: 0,
    config,
    map,
    players,
    entities: new Map(),
    projectiles: [],
    crates: [],
    nextEntityId: 1,
    nextProjectileId: 1,
    rngState: config.seed >>> 0 || 1,
    winner: null,
    occupancy: new Map(),
  };
  void size;

  // Starting forces: ConYard (instant) + 2 harvesters per player.
  for (const p of players) {
    const start = map.startPositions[p.id] ?? { x: map.w >> 1, y: map.h >> 1 };
    const conDef = data.buildings[`${p.faction}_conyard`];
    const cx = Math.max(0, Math.min(map.w - conDef.footprint.w, Math.round(start.x - conDef.footprint.w / 2)));
    const cy = Math.max(0, Math.min(map.h - conDef.footprint.h, Math.round(start.y - conDef.footprint.h / 2)));
    const con = spawnBuilding(state, data, conDef.id, p.id, { x: cx, y: cy }, true);
    rebuildOccupancy(state, data);

    const harvDef = Object.values(data.units).find((u) => u.faction === p.faction && u.harvester);
    if (harvDef) {
      for (let k = 0; k < 2; k++) {
        const tile = findSpawnTileNear(
          state,
          con.pos.x | 0,
          con.pos.y | 0,
          conDef.footprint.w,
          conDef.footprint.h,
          harvDef.domain,
        );
        if (tile) {
          const h = spawnUnit(state, data, harvDef.id, p.id, { x: tile.x + 0.5, y: tile.y + 0.5 });
          h.orders = [{ kind: 'harvest' }];
        }
      }
    }
    recomputePower(state, data, p);
  }
  if (config.mode === 'crystalRush') setupCrystalRush(state, data);
  rebuildOccupancy(state, data);
  updateFog(state, data);
  if (config.mode === 'crystalRush') revealCrystalRushMap(state);
  return state;
}

// --- command application -----------------------------------------------------------

function tabOfDef(data: GameData, defId: string): ProductionTab | null {
  const u = data.units[defId];
  if (u) return u.tab;
  const b = data.buildings[defId];
  if (b) return b.tab;
  return null;
}

function applyCommand(state: GameState, data: GameData, c: Command, events: GameEvent[]): void {
  const p = state.players[c.player];
  if (!p || p.eliminated) return;
  if (applyCrystalRushCommand(state, data, c, events)) return;

  switch (c.type) {
    case 'queueProduction': {
      if (c.tab !== tabOfDef(data, c.defId)) return;
      if (!canQueue(state, data, c.player, c.defId).ok) return;
      p.queues[c.tab].items.push(c.defId);
      return;
    }
    case 'cancelProduction': {
      const q = p.queues[c.tab];
      // Cancel an unplaced ready structure first: full refund.
      if (c.index === 0 && q.readyBuilding) {
        const def = data.buildings[q.readyBuilding];
        if (def) p.credits += def.cost;
        q.readyBuilding = null;
        return;
      }
      if (c.index < 0 || c.index >= q.items.length) return;
      const defId = q.items[c.index];
      const def = data.units[defId] ?? data.buildings[defId];
      if (c.index === 0 && def) {
        // Refund what pay-as-you-build already charged.
        p.credits += Math.floor((q.progress / Math.max(1, def.buildTicks)) * def.cost);
        q.progress = 0;
        q.onHold = false;
      }
      q.items.splice(c.index, 1);
      return;
    }
    case 'placeBuilding': {
      const def = data.buildings[c.defId];
      if (!def) return;
      const q = p.queues[def.tab];
      if (q.readyBuilding !== c.defId) return;
      if (!isValidPlacement(state, data, c.player, c.defId, c.pos)) return;
      q.readyBuilding = null;
      const b = spawnBuilding(state, data, c.defId, c.player, c.pos, false);
      // Occupy immediately so two placements can't overlap within one tick.
      rebuildOccupancy(state, data);
      p.stats.built++;
      events.push({ type: 'buildingPlaced', player: c.player, defId: c.defId, id: b.id });
      return;
    }
    case 'issueOrder': {
      for (const id of c.unitIds) {
        const u = state.entities.get(id);
        if (!u || u.owner !== c.player || u.kind !== 'unit' || u.hp <= 0) continue;
        if (c.order.kind === 'stop') {
          u.orders = [];
          u.path = null;
          u.pathTarget = null;
          u.targetId = null;
          continue;
        }
        if (c.queued && u.orders.length > 0) {
          u.orders.push(c.order);
          continue;
        }
        u.orders = [c.order];
        u.path = null;
        u.pathTarget = null;
        u.targetId = c.order.kind === 'attack' ? c.order.target : null;
        const dest =
          c.order.kind === 'move' || c.order.kind === 'attackMove' ? c.order.dest : null;
        if (dest) orderMove(state, data, u, dest);
      }
      return;
    }
    case 'setRally': {
      const b = state.entities.get(c.buildingId);
      if (b && b.owner === c.player && b.kind === 'building') b.rally = { x: c.pos.x, y: c.pos.y };
      return;
    }
    case 'sell': {
      const b = state.entities.get(c.buildingId);
      if (!b || b.owner !== c.player || b.kind !== 'building' || b.hp <= 0) return;
      const def = data.buildings[b.defId];
      p.credits += Math.floor(def.cost * SELL_REFUND);
      events.push({
        type: 'entityDied',
        id: b.id,
        defId: b.defId,
        kind: 'building',
        pos: { x: b.pos.x + def.footprint.w / 2, y: b.pos.y + def.footprint.h / 2 },
        owner: b.owner,
      });
      removeEntity(state, b.id);
      return;
    }
    case 'toggleRepair': {
      const b = state.entities.get(c.buildingId);
      if (b && b.owner === c.player && b.kind === 'building' && b.hp > 0) b.repairing = !b.repairing;
      return;
    }
    case 'fireSuperweapon': {
      launchSuperweapon(state, data, c.player, c.target, events);
      return;
    }
    case 'setStance': {
      for (const id of c.unitIds) {
        const u = state.entities.get(id);
        if (!u || u.owner !== c.player || u.kind !== 'unit' || u.hp <= 0) continue;
        u.stance = c.stance;
      }
      return;
    }
    case 'setPrimary': {
      const b = state.entities.get(c.buildingId);
      if (!b || b.owner !== c.player || b.kind !== 'building' || b.hp <= 0) return;
      if (b.buildProgress < 1) return;
      const def = data.buildings[b.defId];
      const tabs = def ? def.producesTabs : undefined;
      if (!tabs || tabs.length === 0) return;
      // One primary per production tab: clear rivals sharing any of its tabs.
      for (const other of buildingsOf(state, c.player)) {
        if (other.id === b.id || !other.isPrimary || other.buildProgress < 1) continue;
        const od = data.buildings[other.defId];
        if (!od || !od.producesTabs) continue;
        let shares = false;
        for (const t of od.producesTabs) {
          if (tabs.indexOf(t) >= 0) {
            shares = true;
            break;
          }
        }
        if (shares) other.isPrimary = false;
      }
      b.isPrimary = true;
      return;
    }
    case 'crystalRushSetStance':
    case 'crystalRushBuyUpgrade':
    case 'crystalRushDeployWave':
      return;
    case 'surrender': {
      eliminatePlayer(state, data, c.player, events);
      return;
    }
  }
}

// --- elimination / victory ----------------------------------------------------------

function eliminatePlayer(state: GameState, data: GameData, id: PlayerId, events: GameEvent[]): void {
  const p = state.players[id];
  if (!p || p.eliminated) return;
  p.eliminated = true;
  // RA2 short-game style: everything they own goes down with them.
  for (const e of [...entitiesOf(state, id)]) {
    if (e.kind === 'unit') p.stats.unitsLost++;
    else p.stats.buildingsLost++;
    const def = e.kind === 'building' ? data.buildings[e.defId] : data.units[e.defId];
    events.push({
      type: 'entityDied',
      id: e.id,
      defId: e.defId,
      kind: e.kind,
      pos:
        e.kind === 'building' && 'footprint' in def
          ? { x: e.pos.x + def.footprint.w / 2, y: e.pos.y + def.footprint.h / 2 }
          : { x: e.pos.x, y: e.pos.y },
      owner: e.owner,
    });
    removeEntity(state, e.id);
  }
  p.superweapon = null;
  events.push({ type: 'playerEliminated', player: id });
}

function checkVictory(state: GameState, data: GameData, events: GameEvent[]): void {
  // A player with zero buildings is eliminated.
  for (const p of state.players) {
    if (p.eliminated) continue;
    if (buildingsOf(state, p.id).length === 0) eliminatePlayer(state, data, p.id, events);
  }
  if (state.winner !== null) return;
  const alive = state.players.filter((p) => !p.eliminated);
  if (alive.length <= 1) {
    const memo = memoOf(state);
    if (!memo.gameOverEmitted) {
      memo.gameOverEmitted = true;
      state.winner = alive.length === 1 ? alive[0].id : null;
      events.push({ type: 'gameOver', winner: state.winner });
    }
  }
}

// --- death cleanup -------------------------------------------------------------------

function cleanupDeaths(state: GameState, data: GameData, events: GameEvent[]): void {
  const dead: Entity[] = [];
  for (const e of state.entities.values()) if (e.hp <= 0) dead.push(e);
  for (const e of dead) {
    const p = state.players[e.owner];
    if (p) {
      if (e.kind === 'unit') p.stats.unitsLost++;
      else p.stats.buildingsLost++;
    }
    const def = e.kind === 'building' ? data.buildings[e.defId] : data.units[e.defId];
    events.push({
      type: 'entityDied',
      id: e.id,
      defId: e.defId,
      kind: e.kind,
      pos:
        e.kind === 'building' && 'footprint' in def
          ? { x: e.pos.x + def.footprint.w / 2, y: e.pos.y + def.footprint.h / 2 }
          : { x: e.pos.x, y: e.pos.y },
      owner: e.owner,
    });
    removeEntity(state, e.id);
  }
}

// --- event filtering (announcer dedupe) -----------------------------------------------

function filterEvents(state: GameState, events: GameEvent[]): GameEvent[] {
  const memo = memoOf(state);
  const noFundsWindow = secondsToTicks(5);
  return events.filter((ev) => {
    if (ev.type === 'underAttack') {
      if (state.tick - memo.lastUnderAttack[ev.player] < UNDER_ATTACK_COOLDOWN) return false;
      memo.lastUnderAttack[ev.player] = state.tick;
      return true;
    }
    if (ev.type === 'insufficientFunds') {
      if (state.tick - memo.lastNoFunds[ev.player] < noFundsWindow) return false;
      memo.lastNoFunds[ev.player] = state.tick;
      return true;
    }
    return true;
  });
}

// --- tickGame --------------------------------------------------------------------------

export function tickGame(state: GameState, data: GameData, commands: Command[]): GameEvent[] {
  const events: GameEvent[] = [];
  if (state.winner !== null) return events;

  for (const c of commands) applyCommand(state, data, c, events);

  if (state.config.mode === 'crystalRush') updateCrystalRush(state, data, events);
  else {
    advanceProduction(state, data, events);
    updateEconomy(state, data, events);
  }

  // Unit/building brains. Snapshot the list: spawns/removals during the loop
  // must not affect iteration.
  const all = [...state.entities.values()];
  for (const e of all) {
    if (e.hp <= 0) continue;
    updateUnitCombat(state, data, e, events);
    if (e.kind === 'unit') updateUnitMovement(state, data, e, events);
  }
  // Soft unit pushing: moving units slide around each other instead of jamming.
  applyUnitPushing(state, data);

  updateProjectiles(state, data, events);
  if (state.config.mode !== 'crystalRush') {
    updateSuperweapons(state, data, events);
    updateCrates(state, data, events);
  }
  updateFog(state, data);
  if (state.config.mode === 'crystalRush') revealCrystalRushMap(state);

  cleanupDeaths(state, data, events);
  checkVictory(state, data, events);
  rebuildOccupancy(state, data);

  state.tick++;
  return filterEvents(state, events);
}
