import type {
  Command,
  CrystalRushUpgradeId,
  Entity,
  FactionId,
  GameData,
  GameEvent,
  GameState,
  PlayerId,
  UnitDef,
  Vec2,
} from '../../core/types';
import {
  MoveDomain,
  Terrain,
  dist,
  entityCenter,
  inBounds,
  tileIndex,
} from '../../core/types';
import { TICK_RATE, secondsToTicks } from '../../core/constants';
import { passableFor } from '../../map/terrain';
import {
  buildingsOf,
  entitiesOf,
  occupyEntity,
  rebuildOccupancy,
  removeEntity,
  spawnBuilding,
  spawnUnit,
} from '../entity';
import { orderMove } from '../movement';
import { findSpawnTileNear } from '../production';

const WAVE_INTERVAL = secondsToTicks(16);
const FIRST_WAVE_DELAY = secondsToTicks(8);
const RETARGET_INTERVAL = secondsToTicks(3);
const INCOME_INTERVAL = TICK_RATE;
const BASE_OBJECTIVE_INCOME = 54;
const OBJECTIVE_RADIUS = 4.2;
const MAX_WAVE_UNITS = 24;
const BASE_HP = 1150;
const MANUAL_DEPLOY_COOLDOWN = secondsToTicks(24);
const MANUAL_DEPLOY_COST_BASE = 180;

const STANCE_ORDER: Array<'greedy' | 'aggressive' | 'split'> = ['greedy', 'split', 'aggressive'];

export function setupCrystalRush(state: GameState, data: GameData): void {
  const objective = { x: Math.floor(state.map.w / 2), y: Math.floor(state.map.h / 2) };
  state.config.mode = 'crystalRush';
  state.config.crates = false;
  state.crystalRush = {
    objective,
    radius: OBJECTIVE_RADIUS,
    player: state.players.map((_, i) => ({
      stance: i === 0 ? 'greedy' : STANCE_ORDER[i % STANCE_ORDER.length],
      incomeRate: 0,
      totalIncome: 0,
      waveLevel: 1,
      economyLevel: 1,
      defenseLevel: 0,
      nextWaveTick: FIRST_WAVE_DELAY + i * secondsToTicks(2),
      nextDeployTick: secondsToTicks(12),
    })),
  };

  sculptCenterCrystal(state, objective);

  for (const p of state.players) {
    p.credits = 350;
    for (const q of Object.values(p.queues)) {
      q.items = [];
      q.progress = 0;
      q.readyBuilding = null;
      q.onHold = false;
    }
    p.superweapon = null;
  }

  for (const e of [...state.entities.values()]) {
    if (e.kind === 'unit') {
      removeEntity(state, e.id);
      continue;
    }
    const def = data.buildings[e.defId];
    if (!def?.isConYard) removeEntity(state, e.id);
    else {
      e.hp = Math.min(e.hp, BASE_HP);
      e.maxHp = Math.min(e.maxHp, BASE_HP);
      e.buildProgress = 1;
      e.repairing = false;
    }
  }
  rebuildOccupancy(state, data);
  revealCrystalRushMap(state);
}

export function applyCrystalRushCommand(
  state: GameState,
  data: GameData,
  c: Command,
  events: GameEvent[],
): boolean {
  if (state.config.mode !== 'crystalRush' || state.crystalRush === undefined) return false;
  const p = state.players[c.player];
  const crp = state.crystalRush.player[c.player];
  if (!p || !crp || p.eliminated) return true;

  switch (c.type) {
    case 'crystalRushSetStance':
      crp.stance = c.stance;
      return true;
    case 'crystalRushBuyUpgrade':
      buyUpgrade(state, data, c.player, c.upgrade, events);
      return true;
    case 'crystalRushDeployWave':
      deployManualWave(state, data, c.player, events);
      return true;
    case 'surrender':
      return false;
    default:
      return true;
  }
}

export function updateCrystalRush(state: GameState, data: GameData, events: GameEvent[]): void {
  const mode = state.crystalRush;
  if (state.config.mode !== 'crystalRush' || mode === undefined) return;

  if (state.tick % INCOME_INTERVAL === 0) updateCrystalIncome(state);

  for (const p of state.players) {
    if (p.eliminated) continue;
    const crp = mode.player[p.id];
    if (!p.isHuman && state.tick % secondsToTicks(4) === (p.id * 7) % secondsToTicks(4)) {
      runCrystalRushAI(state, data, p.id, events);
    }
    if (state.tick >= crp.nextWaveTick) {
      spawnWave(state, data, p.id, events);
      crp.nextWaveTick = state.tick + Math.max(secondsToTicks(10), WAVE_INTERVAL - crp.waveLevel * TICK_RATE);
    }
  }

  if (state.tick % RETARGET_INTERVAL === 0) retargetModeUnits(state, data);
  revealCrystalRushMap(state);
}

export function getCrystalRushUpgradeCost(state: GameState, player: PlayerId, upgrade: CrystalRushUpgradeId): number {
  const crp = state.crystalRush?.player[player];
  if (crp === undefined) return 0;
  switch (upgrade) {
    case 'economy':
      return 275 + crp.economyLevel * 225;
    case 'waves':
      return 325 + crp.waveLevel * 275;
    case 'defense':
      return 425 + crp.defenseLevel * 260;
  }
}

export function getCrystalRushDeployCost(state: GameState, player: PlayerId): number {
  const crp = state.crystalRush?.player[player];
  if (crp === undefined) return MANUAL_DEPLOY_COST_BASE;
  return MANUAL_DEPLOY_COST_BASE + Math.max(0, crp.waveLevel - 1) * 70;
}

export function getCrystalRushDeployCooldownTicks(): number {
  return MANUAL_DEPLOY_COOLDOWN;
}

function sculptCenterCrystal(state: GameState, center: Vec2): void {
  for (let y = center.y - 5; y <= center.y + 5; y++) {
    for (let x = center.x - 5; x <= center.x + 5; x++) {
      if (!inBounds(state.map, x, y)) continue;
      const d = Math.hypot(x - center.x, y - center.y);
      const idx = tileIndex(state.map, x, y);
      state.map.terrain[idx] = d <= 2.2 ? Terrain.CRYSTAL : Terrain.GRASS;
      state.map.crystal[idx] = d <= 2.2 ? 6000 : 0;
    }
  }
}

export function revealCrystalRushMap(state: GameState): void {
  const mode = state.crystalRush;
  if (mode === undefined) return;
  for (const p of state.players) {
    for (let y = mode.objective.y - 8; y <= mode.objective.y + 8; y++) {
      for (let x = mode.objective.x - 8; x <= mode.objective.x + 8; x++) {
        if (!inBounds(state.map, x, y)) continue;
        const idx = tileIndex(state.map, x, y);
        p.explored[idx] = 1;
        p.visible[idx] = 1;
      }
    }
    for (const start of state.map.startPositions) {
      for (let y = start.y - 8; y <= start.y + 8; y++) {
        for (let x = start.x - 8; x <= start.x + 8; x++) {
          if (!inBounds(state.map, x, y)) continue;
          p.explored[tileIndex(state.map, x, y)] = 1;
        }
      }
    }
  }
}

function updateCrystalIncome(state: GameState): void {
  const mode = state.crystalRush;
  if (mode === undefined) return;
  const counts = new Array(state.players.length).fill(0) as number[];
  for (const e of state.entities.values()) {
    if (e.kind !== 'unit' || e.hp <= 0) continue;
    const p = state.players[e.owner];
    if (p === undefined || p.eliminated) continue;
    if (dist(e.pos, mode.objective) <= mode.radius) counts[e.owner]++;
  }
  const total = counts.reduce((a, b) => a + b, 0);
  for (const p of state.players) {
    const crp = mode.player[p.id];
    if (p.eliminated || total <= 0) {
      crp.incomeRate = 0;
      continue;
    }
    const share = counts[p.id] / total;
    const leaderBonus = counts[p.id] > 0 && counts[p.id] === Math.max(...counts) ? 12 : 0;
    const income = Math.floor((BASE_OBJECTIVE_INCOME + crp.economyLevel * 14) * share + leaderBonus);
    crp.incomeRate = income;
    crp.totalIncome += income;
    p.credits += income;
    p.stats.creditsHarvested += income;
  }
}

function runCrystalRushAI(state: GameState, data: GameData, player: PlayerId, events: GameEvent[]): void {
  const crp = state.crystalRush?.player[player];
  if (crp === undefined) return;
  const liveEnemies = state.players.filter((p) => p.id !== player && !p.eliminated).length;
  if (liveEnemies <= 1) crp.stance = 'aggressive';
  else if (state.players[player].credits > getCrystalRushUpgradeCost(state, player, 'waves') + 180) crp.stance = 'aggressive';
  else if (crp.economyLevel < crp.waveLevel + 1) crp.stance = 'greedy';
  else crp.stance = 'split';

  const order: CrystalRushUpgradeId[] =
    crp.waveLevel < 5 ? ['waves', 'economy', 'defense'] : ['economy', 'waves', 'defense'];
  for (const upgrade of order) {
    if (state.players[player].credits >= getCrystalRushUpgradeCost(state, player, upgrade)) {
      buyUpgrade(state, data, player, upgrade, events);
      return;
    }
  }
}

function buyUpgrade(
  state: GameState,
  data: GameData,
  player: PlayerId,
  upgrade: CrystalRushUpgradeId,
  events: GameEvent[],
): void {
  const p = state.players[player];
  const crp = state.crystalRush?.player[player];
  if (p === undefined || crp === undefined || p.eliminated) return;
  const cost = getCrystalRushUpgradeCost(state, player, upgrade);
  if (p.credits < cost) {
    events.push({ type: 'insufficientFunds', player });
    return;
  }
  p.credits -= cost;
  if (upgrade === 'economy') crp.economyLevel++;
  else if (upgrade === 'waves') crp.waveLevel++;
  else {
    crp.defenseLevel++;
    placeDefense(state, data, player, events);
  }
}

function deployManualWave(state: GameState, data: GameData, player: PlayerId, events: GameEvent[]): void {
  const p = state.players[player];
  const crp = state.crystalRush?.player[player];
  if (p === undefined || crp === undefined || p.eliminated) return;
  if (state.tick < crp.nextDeployTick) return;
  const cost = getCrystalRushDeployCost(state, player);
  if (p.credits < cost) {
    events.push({ type: 'insufficientFunds', player });
    return;
  }
  p.credits -= cost;
  crp.nextDeployTick = state.tick + MANUAL_DEPLOY_COOLDOWN;
  spawnWave(state, data, player, events, true);
}

function placeDefense(state: GameState, data: GameData, player: PlayerId, events: GameEvent[]): void {
  const faction = state.players[player]?.faction;
  if (faction === undefined) return;
  const defId = `${faction}_def_basic`;
  if (data.buildings[defId] === undefined) return;
  const base = getBase(state, data, player);
  if (base === null) return;
  const spots = [
    { x: base.pos.x - 2, y: base.pos.y + 1 },
    { x: base.pos.x + 4, y: base.pos.y + 1 },
    { x: base.pos.x + 1, y: base.pos.y - 2 },
    { x: base.pos.x + 1, y: base.pos.y + 4 },
    { x: base.pos.x - 2, y: base.pos.y - 2 },
    { x: base.pos.x + 4, y: base.pos.y + 4 },
  ];
  for (const pos of spots) {
    if (!canPlaceOneTileBuilding(state, pos)) continue;
    const b = spawnBuilding(state, data, defId, player, pos, true);
    occupyEntity(state, data, b);
    state.players[player].stats.built++;
    events.push({ type: 'buildingPlaced', player, defId, id: b.id });
    return;
  }
}

function canPlaceOneTileBuilding(state: GameState, pos: Vec2): boolean {
  const x = Math.floor(pos.x);
  const y = Math.floor(pos.y);
  if (!inBounds(state.map, x, y)) return false;
  const idx = tileIndex(state.map, x, y);
  if (state.map.terrain[idx] === Terrain.CRYSTAL) return false;
  if (!passableFor(state.map, MoveDomain.GROUND, x, y)) return false;
  return (state.occupancy.get(idx)?.length ?? 0) === 0;
}

function spawnWave(state: GameState, data: GameData, player: PlayerId, events: GameEvent[], manual = false): void {
  const p = state.players[player];
  const crp = state.crystalRush?.player[player];
  if (p === undefined || crp === undefined || p.eliminated) return;
  const base = getBase(state, data, player);
  if (base === null) return;
  const roster = waveRoster(data, p.faction, crp.waveLevel, state.tick);
  if (roster.length === 0) return;
  const bd = data.buildings[base.defId];
  const baseCount = 3 + crp.waveLevel * 2 + Math.floor(state.tick / secondsToTicks(105));
  const count = Math.min(MAX_WAVE_UNITS, manual ? Math.ceil(baseCount * 0.75) + 2 : baseCount);
  for (let i = 0; i < count; i++) {
    const def = roster[i % roster.length];
    const tile = findSpawnTileNear(state, base.pos.x | 0, base.pos.y | 0, bd.footprint.w, bd.footprint.h, def.domain);
    if (tile === null) continue;
    const u = spawnUnit(state, data, def.id, player, { x: tile.x + 0.5, y: tile.y + 0.5 });
    occupyEntity(state, data, u);
    assignWaveOrder(state, data, u, i);
    p.stats.built++;
    events.push({ type: 'unitReady', player, defId: def.id, id: u.id });
  }
}

function waveRoster(data: GameData, faction: FactionId, level: number, tick: number): UnitDef[] {
  const units = Object.values(data.units)
    .filter((u) => u.faction === faction && u.weapon !== undefined && !u.harvester && !u.engineer && u.domain === MoveDomain.GROUND)
    .sort((a, b) => a.tier - b.tier || a.cost - b.cost);
  const infantry = units.filter((u) => u.tab === 'infantry' && u.tier <= Math.min(2, level));
  const vehicles = units.filter((u) => u.tab === 'vehicle' && u.tier <= Math.min(3, Math.max(1, level - 1)));
  const roster = [...infantry.slice(0, 2)];
  if (level >= 2 || tick > secondsToTicks(75)) roster.push(...vehicles.slice(0, 1));
  if (level >= 4) roster.push(...infantry.slice(2, 3), ...vehicles.slice(1, 2));
  return roster.length > 0 ? roster : units.slice(0, 1);
}

function retargetModeUnits(state: GameState, data: GameData): void {
  for (const e of state.entities.values()) {
    if (e.kind !== 'unit' || e.hp <= 0) continue;
    const order = e.orders[0];
    const targetGone = order?.kind === 'attack' && state.entities.get(order.target) === undefined;
    const idle = order === undefined || order.kind === 'guard' || targetGone;
    if (idle) assignWaveOrder(state, data, e, e.id);
  }
}

function assignWaveOrder(state: GameState, data: GameData, u: Entity, index: number): void {
  const mode = state.crystalRush;
  const crp = mode?.player[u.owner];
  if (mode === undefined || crp === undefined) return;
  const useCrystal = crp.stance === 'greedy' || (crp.stance === 'split' && index % 2 === 0);
  if (useCrystal) {
    const dest = objectiveRally(mode.objective, index);
    u.orders = [{ kind: 'attackMove', dest }];
    u.targetId = null;
    orderMove(state, data, u, dest);
    return;
  }
  const base = nearestEnemyBase(state, data, u.owner, u.pos);
  if (base !== null) {
    const dest = entityCenter(base, data);
    u.orders = [{ kind: 'attack', target: base.id }];
    u.targetId = base.id;
    orderMove(state, data, u, dest);
  }
}

function objectiveRally(center: Vec2, index: number): Vec2 {
  const ring = [
    { x: 0, y: -2 },
    { x: 2, y: 0 },
    { x: 0, y: 2 },
    { x: -2, y: 0 },
    { x: 2, y: 2 },
    { x: -2, y: -2 },
  ];
  const p = ring[index % ring.length];
  return { x: center.x + p.x, y: center.y + p.y };
}

function getBase(state: GameState, data: GameData, player: PlayerId): Entity | null {
  for (const b of buildingsOf(state, player)) {
    if (b.hp > 0 && data.buildings[b.defId]?.isConYard) return b;
  }
  return buildingsOf(state, player).find((b) => b.hp > 0) ?? null;
}

function nearestEnemyBase(state: GameState, data: GameData, player: PlayerId, from: Vec2): Entity | null {
  let best: Entity | null = null;
  let bestD = Infinity;
  for (const p of state.players) {
    if (p.id === player || p.eliminated) continue;
    const base = getBase(state, data, p.id);
    if (base === null) continue;
    const d = dist(from, entityCenter(base, data));
    if (d < bestD) {
      best = base;
      bestD = d;
    }
  }
  return best;
}
