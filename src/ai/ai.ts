// =============================================================================
// FABLE WARS — AI opponent (the entire skirmish brain).
//
// aiThink(state, data, player) is called by the main loop every
// AI_THINK_INTERVAL[difficulty] ticks and returns Command[] — it never mutates
// GameState (except the sanctioned simRandom(state) RNG step) and never reads
// fog-hidden enemy information: enemy units are only considered while the tile
// they stand on is currently visible, enemy buildings only once their
// footprint has been explored. All persistent scratch lives in
// player.aiMemory (typed locally as AIMemory); there is NO module-level
// mutable state, so several AI players and headless runs share this module
// safely.
// =============================================================================

import {
  ArmorClass,
  MoveDomain,
  Terrain,
  WeaponClass,
  dist,
  entityCenter,
  inBounds,
} from '../core/types';
import type {
  AIDifficulty,
  BuildingDef,
  Command,
  Entity,
  EntityId,
  FactionId,
  GameData,
  GameMap,
  GameState,
  Order,
  PlayerId,
  PlayerState,
  ProductionTab,
  UnitDef,
  Vec2,
} from '../core/types';
import { MAX_QUEUE_LENGTH, MAX_UNITS_PER_PLAYER, secondsToTicks } from '../core/constants';
import { simRandom } from '../core/rng';
import { canQueue, findPlacement } from '../sim/production';
import { findNearestTile } from '../sim/pathfinding';

// --- AI memory (lives in player.aiMemory) -------------------------------------

interface KnownBuilding {
  id: EntityId;
  defId: string;
  pos: Vec2; // building center, tile coords
  owner: PlayerId;
  lastSeenTick: number;
}

/** Unit category for composition intel: 0 infantry, 1 armor, 2 air, 3 naval. */
interface SeenUnit {
  cat: number;
  tick: number;
}

interface AIMemory {
  init: boolean;
  /** Index of the first unmet entry in the opening structure order (debug/cursor). */
  buildOrderIdx: number;
  // wave state
  waveState: 'massing' | 'attacking';
  waveUnits: EntityId[];
  flankUnits: EntityId[];
  waveTarget: Vec2 | null;
  lastWaveTick: number;
  huntTarget: Vec2 | null;
  /** Randomized launch threshold (waveMin + rolled bonus); re-rolled after each launch. */
  waveRequired: number;
  // unpredictability (clean-room from OpenRA SquadManager technique notes)
  cadenceOffset: number; // rolled once; staggers the macro-concern phases (-1 = unrolled)
  thinkCounter: number; // thinks since init — the cadence clock
  crateRunnerId: EntityId | null; // one unit detoured to grab a nearby crate
  // scouting
  scoutId: EntityId | null;
  scoutDone: boolean;
  // enemy intel — updated ONLY from visible units / explored buildings
  knownBuildings: KnownBuilding[];
  seenUnits: Record<string, SeenUnit>;
  // defense reflex
  hpSnapshot: Record<string, number>;
  defendUntil: number;
  defendPos: Vec2 | null;
  lastDefenseOrderTick: number;
  // hard micro
  retreating: EntityId[];
  engineerId: EntityId | null;
  lastEngineerTick: number;
  // superweapon
  swReadySince: number;
  // cached static map facts
  waterChecked: boolean;
  waterNear: Vec2 | null;
}

function getMemory(p: PlayerState): AIMemory {
  const m = p.aiMemory as unknown as Partial<AIMemory>;
  if (m.init !== true) {
    m.init = true;
    m.buildOrderIdx = 0;
    m.waveState = 'massing';
    m.waveUnits = [];
    m.flankUnits = [];
    m.waveTarget = null;
    m.lastWaveTick = 0;
    m.huntTarget = null;
    m.waveRequired = 0;
    m.cadenceOffset = -1;
    m.thinkCounter = 0;
    m.crateRunnerId = null;
    m.scoutId = null;
    m.scoutDone = false;
    m.knownBuildings = [];
    m.seenUnits = {};
    m.hpSnapshot = {};
    m.defendUntil = 0;
    m.defendPos = null;
    m.lastDefenseOrderTick = -100000;
    m.retreating = [];
    m.engineerId = null;
    m.lastEngineerTick = -100000;
    m.swReadySince = -1;
    m.waterChecked = false;
    m.waterNear = null;
  }
  return m as AIMemory;
}

// --- Difficulty personality ----------------------------------------------------

interface DiffParams {
  harvTarget: number;
  waveIntervalTicks: number;
  waveMin: number;
  creditReserve: number; // military production keeps this much banked
  scout: boolean;
  navalAir: boolean;
  airCap: number;
  navalCap: number;
  sw: 'never' | 'delayed' | 'instant';
  retreatMicro: boolean;
  engineer: boolean;
  repair: boolean;
  reinforce: boolean;
  flank: boolean;
  defendSeconds: number;
}

const PARAMS: Record<AIDifficulty, DiffParams> = {
  easy: {
    harvTarget: 2,
    waveIntervalTicks: secondsToTicks(240),
    waveMin: 5,
    creditReserve: 0,
    scout: false,
    navalAir: false,
    airCap: 0,
    navalCap: 0,
    sw: 'never',
    retreatMicro: false,
    engineer: false,
    repair: false,
    reinforce: false,
    flank: false,
    defendSeconds: 10,
  },
  medium: {
    harvTarget: 4,
    waveIntervalTicks: secondsToTicks(195),
    waveMin: 11,
    creditReserve: 120,
    scout: true,
    navalAir: true,
    airCap: 3,
    navalCap: 3,
    sw: 'delayed',
    retreatMicro: false,
    engineer: false,
    repair: false,
    reinforce: false,
    flank: false,
    defendSeconds: 12,
  },
  hard: {
    harvTarget: 5,
    waveIntervalTicks: secondsToTicks(85),
    waveMin: 14,
    creditReserve: 250,
    scout: true,
    navalAir: true,
    airCap: 5,
    navalCap: 4,
    sw: 'instant',
    retreatMicro: true,
    engineer: true,
    repair: true,
    reinforce: true,
    flank: true,
    defendSeconds: 22,
  },
};

// --- Unpredictability tuning (clean-room from OpenRA SquadManager prose specs;
// techniques only — no upstream code was read). Easy skips all of it. ----------

const WAVE_THRESHOLD_JITTER = 0.22; // launch at waveMin + 0..22% extra units, re-rolled per wave
const RUSH_CONYARD_DIST = 40; // tiles: an enemy ConYard closer than this counts as exposed
const RUSH_POOL_FRACTION = 0.62; // rush once the ground pool reaches this share of the threshold
const RUSH_MAX_KNOWN_BUILDINGS = 4; // ...and the victim has shown us at most this many buildings
const CRATE_CHASE_RADIUS = 10; // tiles from base center worth detouring a fighter for a crate

// --- Build orders (key + target count + optional condition) --------------------

interface BuildEntry {
  key: string;
  count: number;
  cond?: (c: Ctx) => boolean;
}

/** Strategic value of enemy building keys (superweapon / engineer targeting). */
const BUILDING_VALUE: Record<string, number> = {
  conyard: 100,
  refinery: 90,
  sw: 85,
  techlab: 75,
  factory: 70,
  radar: 55,
  airpad: 45,
  navalyard: 40,
  barracks: 35,
  power: 30,
  repair: 25,
  def_adv: 18,
  def_aa: 14,
  def_basic: 12,
  wall: 1,
};

const ENGINEER_TARGET_VALUE = 70; // capture only conyard/refinery/sw/techlab/factory

function hasBuilt(c: Ctx, key: string): boolean {
  return (c.buildingCounts[c.faction + '_' + key] ?? 0) > 0;
}

function navalViable(c: Ctx): boolean {
  const w = c.mem.waterNear;
  if (w === null) return false;
  // shoreline must be explored, near an own building (BUILD_RADIUS reach) and
  // wide enough to fit a 3x3 yard — otherwise the ready building would jam the queue.
  if (c.p.explored[(w.y | 0) * c.state.map.w + (w.x | 0)] === 0) return false;
  let nearBuilding = false;
  for (const b of c.myBuildings) {
    if (dist(entityCenter(b, c.data), w) <= 10) {
      nearBuilding = true;
      break;
    }
  }
  if (!nearBuilding) return false;
  let waterTiles = 0;
  for (let y = (w.y | 0) - 2; y <= (w.y | 0) + 2; y++) {
    for (let x = (w.x | 0) - 2; x <= (w.x | 0) + 2; x++) {
      if (inBounds(c.state.map, x, y) && c.state.map.terrain[y * c.state.map.w + x] === Terrain.WATER) {
        waterTiles++;
      }
    }
  }
  return waterTiles >= 12;
}

function structureOrder(diff: AIDifficulty, faction: FactionId): BuildEntry[] {
  if (diff === 'easy') {
    return [
      { key: 'power', count: 1 },
      { key: 'refinery', count: 1 },
      { key: 'barracks', count: 1 },
      { key: 'factory', count: 1 },
    ];
  }
  const order: BuildEntry[] =
    diff === 'medium'
      ? [
          { key: 'power', count: 1 },
          { key: 'refinery', count: 1 },
          { key: 'barracks', count: 1 },
          { key: 'factory', count: 1 },
          { key: 'power', count: 2 },
          { key: 'refinery', count: 2 },
          { key: 'radar', count: 1 },
          { key: 'airpad', count: 1 },
          { key: 'navalyard', count: 1, cond: navalViable },
          { key: 'techlab', count: 1 },
          { key: 'sw', count: 1 },
        ]
      : [
          { key: 'power', count: 1 },
          { key: 'refinery', count: 1 },
          { key: 'barracks', count: 1 },
          { key: 'factory', count: 1 },
          { key: 'refinery', count: 2 },
          { key: 'power', count: 2 },
          { key: 'radar', count: 1 },
          { key: 'factory', count: 2 },
          { key: 'barracks', count: 2 },
          { key: 'airpad', count: 1 },
          { key: 'navalyard', count: 1, cond: navalViable },
          { key: 'techlab', count: 1 },
          { key: 'sw', count: 1 },
        ];
  if (faction === 'tide') {
    // Tide Dominion leans naval: dock goes up right after radar.
    const navalIdx = order.findIndex((e) => e.key === 'navalyard');
    const radarIdx = order.findIndex((e) => e.key === 'radar');
    if (navalIdx > radarIdx + 1 && radarIdx >= 0) {
      const [entry] = order.splice(navalIdx, 1);
      order.splice(radarIdx + 1, 0, entry);
    }
  }
  return order;
}

function defenseOrder(diff: AIDifficulty): BuildEntry[] {
  if (diff === 'easy') {
    return [
      { key: 'def_basic', count: 2, cond: (c) => hasBuilt(c, 'barracks') },
      { key: 'def_basic', count: 3, cond: (c) => hasBuilt(c, 'factory') },
    ];
  }
  if (diff === 'medium') {
    return [
      { key: 'def_basic', count: 1, cond: (c) => hasBuilt(c, 'barracks') },
      { key: 'def_basic', count: 2, cond: (c) => hasBuilt(c, 'factory') },
      { key: 'def_aa', count: 1, cond: (c) => c.airSeen && hasBuilt(c, 'radar') },
      { key: 'def_adv', count: 1, cond: (c) => hasBuilt(c, 'radar') },
      { key: 'def_aa', count: 2, cond: (c) => c.airSeen && hasBuilt(c, 'radar') },
      { key: 'def_basic', count: 3, cond: (c) => hasBuilt(c, 'techlab') },
    ];
  }
  return [
    { key: 'def_basic', count: 1, cond: (c) => hasBuilt(c, 'barracks') },
    { key: 'def_basic', count: 2, cond: (c) => hasBuilt(c, 'factory') },
    { key: 'def_adv', count: 1, cond: (c) => hasBuilt(c, 'radar') },
    { key: 'def_aa', count: 2, cond: (c) => c.airSeen && hasBuilt(c, 'radar') },
    { key: 'def_adv', count: 2, cond: (c) => hasBuilt(c, 'radar') },
    { key: 'def_basic', count: 4, cond: (c) => hasBuilt(c, 'techlab') },
    { key: 'def_aa', count: 3, cond: (c) => c.airSeen && hasBuilt(c, 'radar') },
  ];
}

// --- Per-think context (gathered once; everything below reads from this) -------

interface Ctx {
  state: GameState;
  data: GameData;
  p: PlayerState;
  pid: PlayerId;
  diff: AIDifficulty;
  params: DiffParams;
  mem: AIMemory;
  out: Command[];
  faction: FactionId;
  // own forces
  myBuildings: Entity[];
  myUnits: Entity[];
  military: Entity[]; // ground + air combat units
  navalMilitary: Entity[];
  harvesters: Entity[];
  engineers: Entity[];
  ownAA: number;
  ownAir: number;
  conyard: Entity | null;
  // strictly-filtered enemy views
  enemyUnitsVisible: Entity[];
  enemyBuildingsExplored: Entity[];
  // tallies
  buildingCounts: Record<string, number>;
  unitCounts: Record<string, number>;
  queuedCounts: Record<string, number>;
  queuedUnitTotal: number;
  // composition intel (derived from mem.seenUnits)
  comp: { inf: number; armor: number; air: number; naval: number; total: number };
  airSeen: boolean;
  // geometry
  baseCenter: Vec2;
  baseCenterInt: Vec2;
  enemyFocus: Vec2 | null; // nearest known enemy presence
  enemyStart: Vec2 | null; // start position of nearest living enemy
  // working credit budget for this think
  avail: number;
  // faction def shortcuts
  factionUnits: UnitDef[];
  harvesterDef: UnitDef | null;
  engineerDef: UnitDef | null;
}

function keyOfDef(defId: string): string {
  const i = defId.indexOf('_');
  return i >= 0 ? defId.slice(i + 1) : defId;
}

function isUnitVisibleTo(p: PlayerState, map: GameMap, e: Entity): boolean {
  const x = e.pos.x | 0;
  const y = e.pos.y | 0;
  return inBounds(map, x, y) && p.visible[y * map.w + x] !== 0;
}

function footprintMatches(
  p: PlayerState,
  map: GameMap,
  e: Entity,
  def: BuildingDef,
  grid: Uint8Array,
): boolean {
  const bx = e.pos.x | 0;
  const by = e.pos.y | 0;
  for (let y = by; y < by + def.footprint.h; y++) {
    for (let x = bx; x < bx + def.footprint.w; x++) {
      if (inBounds(map, x, y) && grid[y * map.w + x] !== 0) return true;
    }
  }
  return false;
}

function unitCategory(data: GameData, e: Entity): number {
  const d = data.units[e.defId];
  if (d === undefined) return 1;
  if (d.domain === MoveDomain.AIR) return 2;
  if (d.domain === MoveDomain.WATER) return 3;
  return d.armor === ArmorClass.LIGHT ? 0 : 1;
}

function clampTile(map: GameMap, v: Vec2): Vec2 {
  return {
    x: Math.min(map.w - 2, Math.max(1, Math.floor(v.x))),
    y: Math.min(map.h - 2, Math.max(1, Math.floor(v.y))),
  };
}

function gatherCtx(
  state: GameState,
  data: GameData,
  p: PlayerState,
  pid: PlayerId,
  diff: AIDifficulty,
  mem: AIMemory,
  out: Command[],
): Ctx {
  const map = state.map;
  const myBuildings: Entity[] = [];
  const myUnits: Entity[] = [];
  const military: Entity[] = [];
  const navalMilitary: Entity[] = [];
  const harvesters: Entity[] = [];
  const engineers: Entity[] = [];
  const enemyUnitsVisible: Entity[] = [];
  const enemyBuildingsExplored: Entity[] = [];
  const buildingCounts: Record<string, number> = {};
  const unitCounts: Record<string, number> = {};
  let ownAA = 0;
  let ownAir = 0;
  let conyard: Entity | null = null;

  for (const e of state.entities.values()) {
    if (e.hp <= 0) continue;
    if (e.owner === pid) {
      if (e.kind === 'building') {
        myBuildings.push(e);
        buildingCounts[e.defId] = (buildingCounts[e.defId] ?? 0) + 1;
        const def = data.buildings[e.defId];
        if (def !== undefined && def.isConYard === true && conyard === null) conyard = e;
      } else {
        myUnits.push(e);
        unitCounts[e.defId] = (unitCounts[e.defId] ?? 0) + 1;
        const d = data.units[e.defId];
        if (d === undefined) continue;
        if (d.harvester !== undefined) harvesters.push(e);
        else if (d.engineer === true) engineers.push(e);
        else if (d.weapon !== undefined) {
          if (d.domain === MoveDomain.WATER) navalMilitary.push(e);
          else {
            military.push(e);
            if (d.domain === MoveDomain.AIR) ownAir++;
          }
          if (d.weapon.canTargetAir) ownAA++;
        }
      }
    } else {
      // STRICT visibility filter — the only place enemy entities are admitted.
      if (e.kind === 'building') {
        const def = data.buildings[e.defId];
        if (def !== undefined && footprintMatches(p, map, e, def, p.explored)) {
          enemyBuildingsExplored.push(e);
        }
      } else if (isUnitVisibleTo(p, map, e)) {
        enemyUnitsVisible.push(e);
      }
    }
  }

  // production queue tallies
  const queuedCounts: Record<string, number> = {};
  let queuedUnitTotal = 0;
  const tabs: ProductionTab[] = ['structure', 'defense', 'infantry', 'vehicle', 'air', 'naval'];
  for (const tab of tabs) {
    const q = p.queues[tab];
    for (const id of q.items) {
      queuedCounts[id] = (queuedCounts[id] ?? 0) + 1;
      if (tab !== 'structure' && tab !== 'defense') queuedUnitTotal++;
    }
    if (q.readyBuilding !== null) {
      queuedCounts[q.readyBuilding] = (queuedCounts[q.readyBuilding] ?? 0) + 1;
    }
  }

  // base center
  let baseCenter: Vec2;
  if (conyard !== null) baseCenter = entityCenter(conyard, data);
  else if (myBuildings.length > 0) baseCenter = entityCenter(myBuildings[0], data);
  else if (myUnits.length > 0) baseCenter = { x: myUnits[0].pos.x, y: myUnits[0].pos.y };
  else baseCenter = { x: map.w / 2, y: map.h / 2 };
  const baseCenterInt = clampTile(map, baseCenter);

  // static water near base (computed once; terrain never changes)
  if (!mem.waterChecked && PARAMS[diff].navalAir) {
    mem.waterChecked = true;
    mem.waterNear = findNearestTile(
      map,
      baseCenterInt,
      (x, y) => map.terrain[y * map.w + x] === Terrain.WATER,
      22,
    );
  }

  const faction = p.faction;
  const factionUnits: UnitDef[] = [];
  let harvesterDef: UnitDef | null = null;
  let engineerDef: UnitDef | null = null;
  for (const id in data.units) {
    const d = data.units[id];
    if (d.faction !== faction) continue;
    factionUnits.push(d);
    if (d.harvester !== undefined && harvesterDef === null) harvesterDef = d;
    if (d.engineer === true && engineerDef === null) engineerDef = d;
  }

  return {
    state,
    data,
    p,
    pid,
    diff,
    params: PARAMS[diff],
    mem,
    out,
    faction,
    myBuildings,
    myUnits,
    military,
    navalMilitary,
    harvesters,
    engineers,
    ownAA,
    ownAir,
    conyard,
    enemyUnitsVisible,
    enemyBuildingsExplored,
    buildingCounts,
    unitCounts,
    queuedCounts,
    queuedUnitTotal,
    comp: { inf: 0, armor: 0, air: 0, naval: 0, total: 0 },
    airSeen: false,
    baseCenter,
    baseCenterInt,
    enemyFocus: null,
    enemyStart: null,
    avail: p.credits,
    factionUnits,
    harvesterDef,
    engineerDef,
  };
}

// --- Intel --------------------------------------------------------------------

const SEEN_UNIT_TTL = secondsToTicks(90);

function updateIntel(c: Ctx): void {
  const { state, data, p, mem } = c;
  const map = state.map;

  // Buildings: rebuild the known list from the explored-gated scan each think.
  // Entries vanish naturally when the building dies (it leaves the scan) and
  // lastSeenTick only advances while the footprint is actually visible.
  const prev = new Map<EntityId, KnownBuilding>();
  for (const kb of mem.knownBuildings) prev.set(kb.id, kb);
  const known: KnownBuilding[] = [];
  for (const e of c.enemyBuildingsExplored) {
    const def = data.buildings[e.defId];
    if (def === undefined) continue;
    const old = prev.get(e.id);
    const vis = footprintMatches(p, map, e, def, p.visible);
    known.push({
      id: e.id,
      defId: e.defId,
      pos: entityCenter(e, data),
      owner: e.owner,
      lastSeenTick: vis ? state.tick : old !== undefined ? old.lastSeenTick : state.tick,
    });
  }
  mem.knownBuildings = known;

  // Units: record currently-visible enemies, age out stale sightings.
  for (const e of c.enemyUnitsVisible) {
    mem.seenUnits[String(e.id)] = { cat: unitCategory(data, e), tick: state.tick };
  }
  for (const key in mem.seenUnits) {
    if (state.tick - mem.seenUnits[key].tick > SEEN_UNIT_TTL) delete mem.seenUnits[key];
  }
  const comp = c.comp;
  for (const key in mem.seenUnits) {
    const cat = mem.seenUnits[key].cat;
    if (cat === 0) comp.inf++;
    else if (cat === 1) comp.armor++;
    else if (cat === 2) comp.air++;
    else comp.naval++;
  }
  comp.total = comp.inf + comp.armor + comp.air + comp.naval;
  c.airSeen = comp.air > 0;
}

function computeThreatFocus(c: Ctx): void {
  const { state, mem } = c;
  // nearest known enemy building, else nearest visible enemy unit
  let best: Vec2 | null = null;
  let bestD = Infinity;
  for (const kb of mem.knownBuildings) {
    const owner = state.players[kb.owner];
    if (owner !== undefined && owner.eliminated) continue;
    const d = dist(c.baseCenter, kb.pos);
    if (d < bestD) {
      bestD = d;
      best = kb.pos;
    }
  }
  if (best === null) {
    for (const e of c.enemyUnitsVisible) {
      const d = dist(c.baseCenter, e.pos);
      if (d < bestD) {
        bestD = d;
        best = { x: e.pos.x, y: e.pos.y };
      }
    }
  }
  c.enemyFocus = best;

  // start position of nearest living enemy (map knowledge, not fog state)
  let startBest: Vec2 | null = null;
  let startD = Infinity;
  for (const pl of state.players) {
    if (pl.id === c.pid || pl.eliminated) continue;
    const sp = state.map.startPositions[pl.id];
    if (sp === undefined) continue;
    const d = dist(c.baseCenter, sp);
    if (d < startD) {
      startD = d;
      startBest = sp;
    }
  }
  c.enemyStart = startBest;
}

// --- Command helpers ------------------------------------------------------------

function issue(c: Ctx, ids: EntityId[], order: Order, queued = false): void {
  if (ids.length === 0) return;
  c.out.push({ type: 'issueOrder', player: c.pid, unitIds: ids.slice(), order, queued });
}

function tryQueue(c: Ctx, tab: ProductionTab, defId: string, cost: number, payFraction: number): boolean {
  const q = c.p.queues[tab];
  if (q.items.length >= MAX_QUEUE_LENGTH) return false;
  const ok = canQueue(c.state, c.data, c.pid, defId);
  if (!ok.ok) return false;
  c.out.push({ type: 'queueProduction', player: c.pid, tab, defId });
  c.queuedCounts[defId] = (c.queuedCounts[defId] ?? 0) + 1;
  c.avail -= cost * payFraction;
  return true;
}

// --- Defense reflex (all difficulties) ------------------------------------------

function defenseReflex(c: Ctx): void {
  const { state, data, mem, params } = c;
  const next: Record<string, number> = {};
  let worstDrop = 0;
  let dmgPos: Vec2 | null = null;
  const damaged: Entity[] = [];
  for (const b of c.myBuildings) {
    const key = String(b.id);
    next[key] = b.hp;
    const prevHp = mem.hpSnapshot[key];
    if (prevHp !== undefined && b.hp < prevHp - 0.01) {
      const drop = prevHp - b.hp;
      damaged.push(b);
      if (drop > worstDrop) {
        worstDrop = drop;
        dmgPos = entityCenter(b, data);
      }
    }
  }
  mem.hpSnapshot = next;
  if (dmgPos === null) return;

  mem.defendUntil = state.tick + secondsToTicks(params.defendSeconds);
  mem.defendPos = dmgPos;
  const target = clampTile(state.map, dmgPos);

  // hard repairs whatever is burning, regardless of order-throttle below
  if (params.repair && c.p.credits > 400) {
    for (const b of damaged) {
      if (!b.repairing && b.buildProgress >= 1 && b.hp < b.maxHp * 0.9) {
        c.out.push({ type: 'toggleRepair', player: c.pid, buildingId: b.id });
      }
    }
  }

  // throttle repeated rally orders while a base is being shelled
  if (state.tick - mem.lastDefenseOrderTick < secondsToTicks(3)) return;
  mem.lastDefenseOrderTick = state.tick;

  if (c.diff === 'easy') {
    const ids: EntityId[] = [];
    for (const u of c.military) if (dist(u.pos, dmgPos) <= 15) ids.push(u.id);
    issue(c, ids, { kind: 'attackMove', dest: target });
  } else if (c.diff === 'medium') {
    // respond only when the attacker is actually visible
    let attacker: Entity | null = null;
    let attackerD = Infinity;
    for (const e of c.enemyUnitsVisible) {
      const d = dist(e.pos, dmgPos);
      if (d <= 13 && d < attackerD) {
        attackerD = d;
        attacker = e;
      }
    }
    if (attacker !== null) {
      const dest = clampTile(state.map, attacker.pos);
      const ids: EntityId[] = [];
      for (const u of c.military) if (dist(u.pos, dmgPos) <= 30) ids.push(u.id);
      issue(c, ids, { kind: 'attackMove', dest });
    }
  } else {
    // hard: full response
    const engId = mem.engineerId;
    const ids: EntityId[] = [];
    for (const u of c.military) if (u.id !== engId) ids.push(u.id);
    issue(c, ids, { kind: 'attackMove', dest: target });
  }
}

// --- Building placement ----------------------------------------------------------

function richestExploredCrystal(c: Ctx): Vec2 | null {
  const { state, p } = c;
  const map = state.map;
  let best: Vec2 | null = null;
  let bestScore = -Infinity;
  for (let y = 0; y < map.h; y++) {
    const row = y * map.w;
    for (let x = 0; x < map.w; x++) {
      const i = row + x;
      if (map.terrain[i] !== Terrain.CRYSTAL || map.crystal[i] === 0 || p.explored[i] === 0) continue;
      const score = map.crystal[i] - dist({ x, y }, c.baseCenter) * 8;
      if (score > bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }
  return best;
}

function defensePlacementHint(c: Ctx): Vec2 {
  const { state } = c;
  const focus = c.enemyFocus ?? c.enemyStart;
  let dx: number;
  let dy: number;
  if (focus !== null) {
    dx = focus.x - c.baseCenter.x;
    dy = focus.y - c.baseCenter.y;
  } else {
    const a = simRandom(state) * Math.PI * 2;
    dx = Math.cos(a);
    dy = Math.sin(a);
  }
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.001) {
    dx = 1;
    dy = 0;
  } else {
    dx /= len;
    dy /= len;
  }
  const jitter = simRandom(state) * 6 - 3; // spread along the perimeter
  return clampTile(state.map, {
    x: c.baseCenter.x + dx * 5.5 - dy * jitter,
    y: c.baseCenter.y + dy * 5.5 + dx * jitter,
  });
}

function placementHint(c: Ctx, defId: string): Vec2 {
  const { state, p } = c;
  const map = state.map;
  const key = keyOfDef(defId);
  if (key === 'refinery') {
    if ((c.buildingCounts[defId] ?? 0) === 0) {
      const near = findNearestTile(
        map,
        c.baseCenterInt,
        (x, y) => map.terrain[y * map.w + x] === Terrain.CRYSTAL && p.explored[y * map.w + x] !== 0,
        15,
      );
      return near !== null ? near : c.baseCenterInt;
    }
    const rich = richestExploredCrystal(c);
    return rich !== null ? rich : c.baseCenterInt;
  }
  if (key === 'navalyard') {
    return c.mem.waterNear !== null ? clampTile(map, c.mem.waterNear) : c.baseCenterInt;
  }
  if (key === 'def_basic' || key === 'def_adv' || key === 'def_aa' || key === 'wall') {
    return defensePlacementHint(c);
  }
  return c.baseCenterInt;
}

function dispatchPlacements(c: Ctx): void {
  const tabs: ProductionTab[] = ['structure', 'defense'];
  for (const tab of tabs) {
    const q = c.p.queues[tab];
    const defId = q.readyBuilding;
    if (defId === null) continue;
    const hint = placementHint(c, defId);
    let pos = findPlacement(c.state, c.data, c.pid, defId, hint);
    if (pos === null) pos = findPlacement(c.state, c.data, c.pid, defId, c.baseCenterInt);
    if (pos !== null) {
      c.out.push({ type: 'placeBuilding', player: c.pid, defId, pos });
    }
  }
}

// --- Macro: structures & defenses -------------------------------------------------

function haveOf(c: Ctx, key: string): number {
  const defId = c.faction + '_' + key;
  return (c.buildingCounts[defId] ?? 0) + (c.queuedCounts[defId] ?? 0);
}

function macroStructures(c: Ctx): void {
  const q = c.p.queues['structure'];
  if (q.readyBuilding !== null || q.items.length > 0) return;

  // power headroom +50 always wins once the opening power+refinery exist
  const headroom = c.p.powerProduced - c.p.powerConsumed;
  if (haveOf(c, 'power') >= 1 && haveOf(c, 'refinery') >= 1 && headroom < 50) {
    const def = c.data.buildings[c.faction + '_power'];
    if (def !== undefined && c.avail >= def.cost * 0.5) {
      if (tryQueue(c, 'structure', def.id, def.cost, 0.5)) return;
    }
  }

  const order = structureOrder(c.diff, c.faction);
  for (let i = 0; i < order.length; i++) {
    const entry = order[i];
    if (entry.cond !== undefined && !entry.cond(c)) continue;
    if (haveOf(c, entry.key) >= entry.count) continue;
    c.mem.buildOrderIdx = i;
    const def = c.data.buildings[c.faction + '_' + entry.key];
    if (def === undefined) continue;
    const ok = canQueue(c.state, c.data, c.pid, def.id);
    if (!ok.ok) continue; // prerequisite still building — see if a later entry fits
    if (c.avail < def.cost * 0.5) return; // save up rather than skipping ahead
    tryQueue(c, 'structure', def.id, def.cost, 0.5);
    return;
  }
  c.mem.buildOrderIdx = order.length;
}

function macroDefenses(c: Ctx): void {
  const q = c.p.queues['defense'];
  if (q.readyBuilding !== null || q.items.length > 0) return;
  const order = defenseOrder(c.diff);
  for (const entry of order) {
    if (entry.cond !== undefined && !entry.cond(c)) continue;
    if (haveOf(c, entry.key) >= entry.count) continue;
    const def = c.data.buildings[c.faction + '_' + entry.key];
    if (def === undefined) continue;
    const ok = canQueue(c.state, c.data, c.pid, def.id);
    if (!ok.ok) continue;
    if (c.avail < def.cost * 0.5) return;
    tryQueue(c, 'defense', def.id, def.cost, 0.5);
    return;
  }
}

// --- Economy ----------------------------------------------------------------------

function manageEconomy(c: Ctx): void {
  const harv = c.harvesterDef;
  if (harv !== null) {
    const queued = c.queuedCounts[harv.id] ?? 0;
    const total = c.harvesters.length + queued;
    const q = c.p.queues['vehicle'];
    if (total < c.params.harvTarget && q.items.length < 3) {
      // an economy with zero harvesters rebuilds one no matter the bank
      if (c.harvesters.length === 0 || c.avail >= harv.cost) {
        tryQueue(c, 'vehicle', harv.id, harv.cost, 1);
      }
    }
  }
  // wake idle harvesters (covers refinery loss / fresh spawns / stray stops)
  const toHarvest: EntityId[] = [];
  const toReturn: EntityId[] = [];
  for (const h of c.harvesters) {
    if (h.orders.length !== 0) continue;
    if (h.cargo >= 300) toReturn.push(h.id);
    else toHarvest.push(h.id);
  }
  issue(c, toHarvest, { kind: 'harvest' });
  issue(c, toReturn, { kind: 'returnCargo' });
}

// --- Military production -------------------------------------------------------

interface Needs {
  aa: number;
  antiArmor: number;
  antiInf: number;
}

function computeNeeds(c: Ctx): Needs {
  const t = c.comp.total;
  if (t < 2) return { aa: 0.15, antiArmor: 0.45, antiInf: 0.5 };
  return {
    aa: Math.min(1, (c.comp.air * 2) / t + (c.comp.air > 0 ? 0.25 : 0)),
    antiArmor: Math.min(1, (c.comp.armor * 1.5) / t),
    antiInf: Math.min(1, (c.comp.inf * 1.3) / t),
  };
}

function bestUnitFor(c: Ctx, tab: ProductionTab, needs: Needs): UnitDef | null {
  let best: UnitDef | null = null;
  let bestScore = -Infinity;
  for (const d of c.factionUnits) {
    if (d.tab !== tab) continue;
    const w = d.weapon;
    if (w === undefined || d.harvester !== undefined || d.engineer === true) continue;
    if (d.cost > c.avail - c.params.creditReserve) continue;
    if (!canQueue(c.state, c.data, c.pid, d.id).ok) continue;
    let s = 0.6 + d.tier * 0.35 + simRandom(c.state) * 0.9;
    if (w.canTargetAir) {
      s += needs.aa * 3;
      if (c.airSeen && c.ownAA < 3) s += 1.2;
    }
    if (!w.canTargetGround && !c.airSeen) s -= 1.5; // pure AA is dead weight without air
    if (w.weaponClass === WeaponClass.CANNON) s += needs.antiArmor * 2.4;
    else if (w.weaponClass === WeaponClass.CLAW) s += needs.antiInf * 1.8;
    else if (w.weaponClass === WeaponClass.BLAST) s += needs.antiInf * 1.2 + 0.4;
    else s += 0.5;
    // faction flavor
    if (c.faction === 'scorch' && w.weaponClass === WeaponClass.CANNON) s += 0.3;
    if (c.faction === 'verdant' && d.tab === 'infantry') s += 0.4;
    if (c.faction === 'tide' && d.speed >= 2.2) s += 0.3;
    // diversity pressure
    s -= 0.08 * (c.unitCounts[d.id] ?? 0);
    if (s > bestScore) {
      bestScore = s;
      best = d;
    }
  }
  return best;
}

function produceMilitary(c: Ctx): void {
  if (c.myUnits.length + c.queuedUnitTotal >= MAX_UNITS_PER_PLAYER - 4) return;
  const needs = computeNeeds(c);
  const tabs: ProductionTab[] = ['vehicle', 'infantry', 'air', 'naval'];
  for (const tab of tabs) {
    if ((tab === 'air' || tab === 'naval') && !c.params.navalAir) continue;
    if (tab === 'air' && c.ownAir + (queuedInTab(c, 'air')) >= c.params.airCap) continue;
    if (tab === 'naval' && c.navalMilitary.length + queuedInTab(c, 'naval') >= c.params.navalCap) continue;
    const q = c.p.queues[tab];
    if (q.items.length >= 2) continue;
    const pick = bestUnitFor(c, tab, needs);
    if (pick === null) continue;
    tryQueue(c, tab, pick.id, pick.cost, 1);
  }
}

function queuedInTab(c: Ctx, tab: ProductionTab): number {
  return c.p.queues[tab].items.length;
}

// --- Scouting (medium/hard) -------------------------------------------------------

function runScouting(c: Ctx): void {
  const { state, mem } = c;
  if (!c.params.scout || mem.scoutDone) return;
  if (mem.scoutId !== null) {
    const s = state.entities.get(mem.scoutId);
    if (s === undefined || s.owner !== c.pid || s.hp <= 0 || s.orders.length === 0) {
      mem.scoutDone = true;
      mem.scoutId = null;
    }
    return;
  }
  if (state.tick < secondsToTicks(55)) return;
  // pick the cheapest fast ground unit we own
  let pick: Entity | null = null;
  let pickCost = Infinity;
  let pickSpeed = -1;
  for (const u of c.military) {
    const d = c.data.units[u.defId];
    if (d === undefined || d.domain !== MoveDomain.GROUND || d.cost > 450) continue;
    if (
      d.cost < pickCost ||
      (d.cost === pickCost && d.speed > pickSpeed) ||
      (d.cost === pickCost && d.speed === pickSpeed && (pick === null || u.id < pick.id))
    ) {
      pick = u;
      pickCost = d.cost;
      pickSpeed = d.speed;
    }
  }
  if (pick === null) return;
  const map = state.map;
  const corners: Vec2[] = [
    { x: 3, y: 3 },
    { x: map.w - 4, y: 3 },
    { x: 3, y: map.h - 4 },
    { x: map.w - 4, y: map.h - 4 },
  ];
  let farCorner = corners[0];
  let farD = -1;
  for (const cnr of corners) {
    const d = dist(cnr, c.baseCenter);
    if (d > farD) {
      farD = d;
      farCorner = cnr;
    }
  }
  const center = { x: map.w >> 1, y: map.h >> 1 };
  const first = c.enemyStart !== null ? clampTile(map, c.enemyStart) : center;
  const wps: Vec2[] = [first, center, farCorner];
  issue(c, [pick.id], { kind: 'move', dest: wps[0] }, false);
  issue(c, [pick.id], { kind: 'move', dest: wps[1] }, true);
  issue(c, [pick.id], { kind: 'move', dest: wps[2] }, true);
  mem.scoutId = pick.id;
}

// --- Hard micro: retreat, engineer runs, repair ------------------------------------

function runMicro(c: Ctx): void {
  const { state, mem, params } = c;
  const alive = (id: EntityId): Entity | undefined => {
    const e = state.entities.get(id);
    return e !== undefined && e.hp > 0 && e.owner === c.pid ? e : undefined;
  };

  // retreat units below 30% hp toward base — unless we are defending the base
  if (params.retreatMicro) {
    const retreatSet = new Set<EntityId>(mem.retreating);
    const keep: EntityId[] = [];
    for (const id of mem.retreating) {
      const u = alive(id);
      if (u === undefined) continue;
      if (u.hp >= u.maxHp * 0.45 || dist(u.pos, c.baseCenter) <= 7) continue; // released
      keep.push(id);
    }
    mem.retreating = keep;
    if (state.tick >= mem.defendUntil) {
      const fresh: EntityId[] = [];
      for (const u of c.military) {
        if (u.hp >= u.maxHp * 0.2) continue;
        if (retreatSet.has(u.id) || u.id === mem.scoutId || u.id === mem.engineerId) continue;
        if (dist(u.pos, c.baseCenter) <= 10) continue;
        fresh.push(u.id);
        mem.retreating.push(u.id);
      }
      issue(c, fresh, { kind: 'move', dest: c.baseCenterInt });
    }
  }

  // one opportunistic engineer capture run at a time
  if (params.engineer) {
    if (mem.engineerId !== null && alive(mem.engineerId) === undefined) mem.engineerId = null;
    // pick a target worth stealing
    let targetKb: KnownBuilding | null = null;
    let targetD = Infinity;
    for (const kb of mem.knownBuildings) {
      if ((BUILDING_VALUE[keyOfDef(kb.defId)] ?? 0) < ENGINEER_TARGET_VALUE) continue;
      const d = dist(c.baseCenter, kb.pos);
      if (d < targetD) {
        targetD = d;
        targetKb = kb;
      }
    }
    // keep one engineer in production when a run looks worthwhile
    if (
      targetKb !== null &&
      c.engineerDef !== null &&
      c.engineers.length === 0 &&
      (c.queuedCounts[c.engineerDef.id] ?? 0) === 0 &&
      state.tick - mem.lastEngineerTick > secondsToTicks(150) &&
      c.avail - params.creditReserve >= c.engineerDef.cost &&
      c.p.queues['infantry'].items.length < 2
    ) {
      tryQueue(c, 'infantry', c.engineerDef.id, c.engineerDef.cost, 1);
    }
    if (mem.engineerId === null && targetKb !== null) {
      for (const eng of c.engineers) {
        if (eng.orders.length !== 0) continue;
        mem.engineerId = eng.id;
        mem.lastEngineerTick = state.tick;
        issue(c, [eng.id], { kind: 'capture', target: targetKb.id });
        break;
      }
    } else if (mem.engineerId !== null) {
      const eng = alive(mem.engineerId);
      if (eng !== undefined && eng.orders.length === 0 && state.tick - mem.lastEngineerTick > secondsToTicks(30)) {
        mem.engineerId = null; // run ended (success or fizzle) — free the slot
      }
    }
  }

  // repair damaged buildings, stop paying once topped off
  if (params.repair) {
    let toggles = 0;
    for (const b of c.myBuildings) {
      if (toggles >= 3) break;
      if (b.repairing && b.hp >= b.maxHp) {
        c.out.push({ type: 'toggleRepair', player: c.pid, buildingId: b.id });
        toggles++;
      } else if (!b.repairing && b.buildProgress >= 1 && b.hp < b.maxHp * 0.6 && c.p.credits > 500) {
        c.out.push({ type: 'toggleRepair', player: c.pid, buildingId: b.id });
        toggles++;
      }
    }
  }
}

// --- Crate chasing (medium/hard) ------------------------------------------------

function runCrates(c: Ctx): void {
  const { state, mem } = c;
  // one runner at a time; release the slot once the errand ends (or the unit dies)
  if (mem.crateRunnerId !== null) {
    const u = state.entities.get(mem.crateRunnerId);
    if (u !== undefined && u.hp > 0 && u.owner === c.pid && u.orders.length > 0) return;
    mem.crateRunnerId = null;
  }
  if (state.crates.length === 0) return;
  let crate: Vec2 | null = null;
  let crateD = Infinity;
  for (const cr of state.crates) {
    const d = dist(c.baseCenter, cr.pos);
    if (d <= CRATE_CHASE_RADIUS && d < crateD) {
      crateD = d;
      crate = cr.pos;
    }
  }
  if (crate === null) return;
  // nearest idle ground fighter (harvesters/engineers are not in c.military;
  // the scout and retreaters keep their day jobs)
  const retreatSet = new Set<EntityId>(mem.retreating);
  let pick: Entity | null = null;
  let pickD = Infinity;
  for (const u of c.military) {
    if (u.orders.length !== 0) continue;
    if (u.id === mem.scoutId || u.id === mem.engineerId || retreatSet.has(u.id)) continue;
    const d = c.data.units[u.defId];
    if (d === undefined || d.domain !== MoveDomain.GROUND) continue;
    const dd = dist(u.pos, crate);
    if (dd < pickD || (dd === pickD && (pick === null || u.id < pick.id))) {
      pickD = dd;
      pick = u;
    }
  }
  if (pick === null) return;
  mem.crateRunnerId = pick.id;
  issue(c, [pick.id], { kind: 'move', dest: clampTile(state.map, crate) });
}

// --- Attack waves -------------------------------------------------------------------

/**
 * Randomized wave threshold (SquadManager technique): the AI must not attack
 * on a predictable unit count, so each wave needs waveMin plus a rolled bonus.
 * Re-rolled after every launch; easy keeps its fixed, beatable count.
 */
function rollWaveRequired(c: Ctx): void {
  if (c.diff === 'easy') return;
  c.mem.waveRequired =
    c.params.waveMin + Math.floor(simRandom(c.state) * c.params.waveMin * WAVE_THRESHOLD_JITTER);
}

/**
 * Opportunistic rush check: a known enemy ConYard within RUSH_CONYARD_DIST of
 * our base whose owner has shown us at most RUSH_MAX_KNOWN_BUILDINGS buildings
 * is exposed — worth hitting before the full wave threshold is met.
 */
function exposedConYard(c: Ctx): Vec2 | null {
  const ownerKnown: Record<number, number> = {};
  for (const kb of c.mem.knownBuildings) {
    ownerKnown[kb.owner] = (ownerKnown[kb.owner] ?? 0) + 1;
  }
  let best: Vec2 | null = null;
  let bestD = Infinity;
  for (const kb of c.mem.knownBuildings) {
    if (keyOfDef(kb.defId) !== 'conyard') continue;
    const owner = c.state.players[kb.owner];
    if (owner !== undefined && owner.eliminated) continue;
    if ((ownerKnown[kb.owner] ?? 0) > RUSH_MAX_KNOWN_BUILDINGS) continue;
    const d = dist(c.baseCenter, kb.pos);
    if (d < RUSH_CONYARD_DIST && d < bestD) {
      bestD = d;
      best = kb.pos;
    }
  }
  return best !== null ? clampTile(c.state.map, best) : null;
}

function nearestClusterTarget(c: Ctx): Vec2 | null {
  const ks = c.mem.knownBuildings;
  if (ks.length === 0) return null;
  let anchor: KnownBuilding | null = null;
  let bestD = Infinity;
  for (const kb of ks) {
    const owner = c.state.players[kb.owner];
    if (owner !== undefined && owner.eliminated) continue;
    const d = dist(c.baseCenter, kb.pos);
    if (d < bestD) {
      bestD = d;
      anchor = kb;
    }
  }
  if (anchor === null) return null;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const kb of ks) {
    if (dist(kb.pos, anchor.pos) <= 7) {
      sx += kb.pos.x;
      sy += kb.pos.y;
      n++;
    }
  }
  return clampTile(c.state.map, { x: sx / n, y: sy / n });
}

function pickHuntTarget(c: Ctx): Vec2 {
  const { state, mem, p } = c;
  const map = state.map;
  const exploredAt = (v: Vec2): boolean => p.explored[(v.y | 0) * map.w + (v.x | 0)] !== 0;
  if (mem.huntTarget !== null && !exploredAt(mem.huntTarget)) return mem.huntTarget;
  // unexplored enemy start first
  for (const pl of state.players) {
    if (pl.id === c.pid || pl.eliminated) continue;
    const sp = map.startPositions[pl.id];
    if (sp !== undefined && !exploredAt(sp)) {
      mem.huntTarget = clampTile(map, sp);
      return mem.huntTarget;
    }
  }
  // then any unexplored patch (deterministic random probes)
  for (let i = 0; i < 12; i++) {
    const x = 2 + Math.floor(simRandom(state) * (map.w - 4));
    const y = 2 + Math.floor(simRandom(state) * (map.h - 4));
    if (p.explored[y * map.w + x] === 0) {
      mem.huntTarget = { x, y };
      return mem.huntTarget;
    }
  }
  mem.huntTarget = c.enemyStart !== null ? clampTile(map, c.enemyStart) : { x: map.w >> 1, y: map.h >> 1 };
  return mem.huntTarget;
}

function flankTargetFor(c: Ctx): Vec2 | null {
  // known enemy refinery first, then any visible enemy harvester
  let best: Vec2 | null = null;
  let bestD = Infinity;
  for (const kb of c.mem.knownBuildings) {
    if (keyOfDef(kb.defId) !== 'refinery') continue;
    const d = dist(c.baseCenter, kb.pos);
    if (d < bestD) {
      bestD = d;
      best = kb.pos;
    }
  }
  if (best !== null) return clampTile(c.state.map, best);
  for (const e of c.enemyUnitsVisible) {
    const d = c.data.units[e.defId];
    if (d === undefined || d.harvester === undefined) continue;
    const dd = dist(c.baseCenter, e.pos);
    if (dd < bestD) {
      bestD = dd;
      best = e.pos;
    }
  }
  return best !== null ? clampTile(c.state.map, best) : null;
}

function stagingPoint(c: Ctx): Vec2 {
  const focus = c.enemyFocus ?? c.enemyStart;
  if (focus === null) return c.baseCenterInt;
  let dx = focus.x - c.baseCenter.x;
  let dy = focus.y - c.baseCenter.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.001) return c.baseCenterInt;
  dx /= len;
  dy /= len;
  return clampTile(c.state.map, { x: c.baseCenter.x + dx * 7, y: c.baseCenter.y + dy * 7 });
}

function runWaves(c: Ctx): void {
  const { state, mem, params } = c;
  const aliveUnit = (id: EntityId): boolean => {
    const e = state.entities.get(id);
    return e !== undefined && e.hp > 0 && e.owner === c.pid;
  };
  mem.waveUnits = mem.waveUnits.filter(aliveUnit);
  mem.flankUnits = mem.flankUnits.filter(aliveUnit);
  if (mem.waveState === 'attacking' && mem.waveUnits.length === 0) {
    mem.waveState = 'massing';
    mem.waveTarget = null;
  }

  const special = new Set<EntityId>(mem.retreating);
  if (mem.scoutId !== null) special.add(mem.scoutId);
  if (mem.engineerId !== null) special.add(mem.engineerId);
  if (mem.crateRunnerId !== null) special.add(mem.crateRunnerId);

  const pool: Entity[] = [];
  for (const u of c.military) if (!special.has(u.id)) pool.push(u);

  const clusterTarget = nearestClusterTarget(c);
  const target = clusterTarget !== null ? clusterTarget : pickHuntTarget(c);

  // while the base is bleeding, defense reflex owns the army
  const defending = state.tick < mem.defendUntil;

  if (mem.waveState === 'massing') {
    // randomized launch threshold — easy keeps its fixed, predictable count
    const required = c.diff === 'easy' ? params.waveMin : Math.max(params.waveMin, mem.waveRequired);

    // Opportunistic rush: a close, barely-developed enemy ConYard is worth
    // hitting at 70% strength, before the full wave assembles (medium/hard).
    if (!defending && c.diff !== 'easy') {
      const rushTarget = exposedConYard(c);
      if (rushTarget !== null) {
        let groundPool = 0;
        for (const u of pool) {
          const d = c.data.units[u.defId];
          if (d !== undefined && d.domain === MoveDomain.GROUND) groundPool++;
        }
        if (groundPool >= Math.ceil(required * RUSH_POOL_FRACTION)) {
          const ids = pool.map((u) => u.id);
          issue(c, ids, { kind: 'attackMove', dest: rushTarget });
          mem.waveUnits = ids;
          mem.flankUnits = [];
          mem.waveTarget = rushTarget;
          mem.waveState = 'attacking';
          mem.lastWaveTick = state.tick;
          rollWaveRequired(c);
          return;
        }
      }
    }

    if (
      !defending &&
      state.tick - mem.lastWaveTick >= params.waveIntervalTicks &&
      pool.length >= required
    ) {
      // launch! hard splits off a fast flank squad when it can spare one
      let flankIds: EntityId[] = [];
      const ft = params.flank ? flankTargetFor(c) : null;
      if (ft !== null && pool.length >= required + 6) {
        const fast = pool
          .filter((u) => {
            const d = c.data.units[u.defId];
            return d !== undefined && d.domain === MoveDomain.GROUND && d.speed >= 2.0;
          })
          .sort((a, b) => {
            const sa = c.data.units[a.defId].speed;
            const sb = c.data.units[b.defId].speed;
            return sb !== sa ? sb - sa : a.id - b.id;
          });
        const flankSize = Math.min(fast.length, pool.length - required, simRandom(state) < 0.5 ? 3 : 4);
        flankIds = fast.slice(0, Math.max(0, flankSize)).map((u) => u.id);
      }
      const flankSet = new Set<EntityId>(flankIds);
      const mainIds = pool.filter((u) => !flankSet.has(u.id)).map((u) => u.id);
      issue(c, mainIds, { kind: 'attackMove', dest: target });
      if (flankIds.length > 0 && ft !== null) issue(c, flankIds, { kind: 'attackMove', dest: ft });
      mem.waveUnits = mainIds;
      mem.flankUnits = flankIds;
      mem.waveTarget = target;
      mem.waveState = 'attacking';
      mem.lastWaveTick = state.tick;
      rollWaveRequired(c);
    } else if (!defending && params.scout) {
      // medium/hard: mass idle troops at a forward staging point
      const stage = stagingPoint(c);
      const idle: EntityId[] = [];
      for (const u of pool) if (u.orders.length === 0) idle.push(u.id);
      issue(c, idle, { kind: 'attackMove', dest: stage });
    }
    return;
  }

  // --- attacking ---
  if (defending) return; // wave members were already recalled by the reflex

  const retarget = mem.waveTarget === null || dist(target, mem.waveTarget) > 8;
  mem.waveTarget = target;
  if (retarget) {
    issue(c, mem.waveUnits, { kind: 'attackMove', dest: target });
  } else {
    const idle: EntityId[] = [];
    for (const id of mem.waveUnits) {
      const e = state.entities.get(id);
      if (e !== undefined && e.orders.length === 0) idle.push(id);
    }
    issue(c, idle, { kind: 'attackMove', dest: target });
  }

  // flank squad upkeep
  if (mem.flankUnits.length > 0) {
    const ft = flankTargetFor(c);
    const dest = ft !== null ? ft : target;
    const idleFlank: EntityId[] = [];
    for (const id of mem.flankUnits) {
      const e = state.entities.get(id);
      if (e !== undefined && e.orders.length === 0) idleFlank.push(id);
    }
    issue(c, idleFlank, { kind: 'attackMove', dest });
  }

  // hard: stream reinforcements into the ongoing push
  if (params.reinforce) {
    const inWave = new Set<EntityId>(mem.waveUnits);
    for (const id of mem.flankUnits) inWave.add(id);
    const spare: EntityId[] = [];
    for (const u of pool) if (!inWave.has(u.id)) spare.push(u.id);
    if (spare.length >= 6) {
      issue(c, spare, { kind: 'attackMove', dest: target });
      for (const id of spare) mem.waveUnits.push(id);
    }
  }
}

// --- Naval squad --------------------------------------------------------------------

function runNavy(c: Ctx): void {
  if (!c.params.navalAir || c.navalMilitary.length < 2) return;
  const idle: EntityId[] = [];
  for (const u of c.navalMilitary) if (u.orders.length === 0) idle.push(u.id);
  if (idle.length === 0) return;
  const { state } = c;
  const map = state.map;
  const isWater = (x: number, y: number): boolean => map.terrain[y * map.w + x] === Terrain.WATER;
  // nearest known enemy building with a shoreline → attack-move to that shore
  let dest: Vec2 | null = null;
  const sorted = c.mem.knownBuildings
    .slice()
    .sort((a, b) => {
      const da = dist(c.baseCenter, a.pos);
      const db = dist(c.baseCenter, b.pos);
      return da !== db ? da - db : a.id - b.id;
    })
    .slice(0, 12);
  for (const kb of sorted) {
    const w = findNearestTile(map, clampTile(map, kb.pos), isWater, 9);
    if (w !== null) {
      dest = w;
      break;
    }
  }
  if (dest === null && c.enemyStart !== null) {
    dest = findNearestTile(map, clampTile(map, c.enemyStart), isWater, 22);
  }
  if (dest === null) return;
  issue(c, idle, { kind: 'attackMove', dest });
}

// --- Superweapon ---------------------------------------------------------------------

function largestClusterCentroid(c: Ctx): Vec2 | null {
  const ks = c.mem.knownBuildings;
  if (ks.length === 0) return null;
  let anchor: KnownBuilding | null = null;
  let bestN = -1;
  for (const kb of ks) {
    let n = 0;
    for (const other of ks) if (dist(kb.pos, other.pos) <= 6) n++;
    if (n > bestN) {
      bestN = n;
      anchor = kb;
    }
  }
  if (anchor === null) return null;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const kb of ks) {
    if (dist(kb.pos, anchor.pos) <= 6) {
      sx += kb.pos.x;
      sy += kb.pos.y;
      n++;
    }
  }
  return clampTile(c.state.map, { x: sx / n, y: sy / n });
}

function highestValueTarget(c: Ctx): Vec2 | null {
  const ks = c.mem.knownBuildings;
  if (ks.length === 0) return null;
  let best: KnownBuilding | null = null;
  let bestScore = -Infinity;
  for (const kb of ks) {
    let neighbors = 0;
    for (const other of ks) if (dist(kb.pos, other.pos) <= 6) neighbors++;
    const score = (BUILDING_VALUE[keyOfDef(kb.defId)] ?? 10) + neighbors * 2;
    if (score > bestScore) {
      bestScore = score;
      best = kb;
    }
  }
  return best !== null ? clampTile(c.state.map, best.pos) : null;
}

function runSuperweapon(c: Ctx): void {
  const { state, mem, params, p } = c;
  if (params.sw === 'never') return;
  const sw = p.superweapon;
  if (sw === null || sw.readyAtTick < 0 || state.tick < sw.readyAtTick) {
    mem.swReadySince = -1;
    return;
  }
  if (mem.swReadySince < 0) mem.swReadySince = state.tick;
  const delay = params.sw === 'instant' ? 0 : secondsToTicks(60);
  if (state.tick - mem.swReadySince < delay) return;
  const target = params.sw === 'instant' ? highestValueTarget(c) : largestClusterCentroid(c);
  if (target === null) return; // no intel — hold fire until we know where it hurts
  c.out.push({ type: 'fireSuperweapon', player: c.pid, target });
  mem.swReadySince = -1;
}

// --- Entry point ----------------------------------------------------------------------

export function aiThink(state: GameState, data: GameData, player: PlayerId): Command[] {
  const p = state.players[player];
  if (p === undefined || p.isHuman || p.eliminated || state.winner !== null) return [];
  const diff: AIDifficulty = p.difficulty !== null ? p.difficulty : 'medium';
  const mem = getMemory(p);
  const out: Command[] = [];
  const c = gatherCtx(state, data, p, player, diff, mem, out);
  if (c.myBuildings.length === 0 && c.myUnits.length === 0) return out;

  // lazy unpredictability rolls — they need the sim RNG, so not done in getMemory
  if (diff !== 'easy') {
    if (mem.cadenceOffset < 0) mem.cadenceOffset = Math.floor(simRandom(state) * 8);
    if (mem.waveRequired <= 0) rollWaveRequired(c);
  }

  // Desynchronized cadences (SquadManager technique): the four macro concerns
  // alternate thinks, phase-shifted by player id + the rolled offset, so several
  // AIs (and the concerns themselves) never all spend their budget on the same
  // think tick. Intel and placement stay every-think; easy keeps the old beat.
  mem.thinkCounter++;
  const beat = mem.thinkCounter + player + mem.cadenceOffset;
  const fires = (concern: number): boolean => diff === 'easy' || ((beat + concern) & 1) === 0;

  updateIntel(c);
  computeThreatFocus(c);
  if (fires(3)) defenseReflex(c);
  dispatchPlacements(c);
  if (fires(0)) {
    macroStructures(c);
    macroDefenses(c);
    manageEconomy(c);
  }
  if (fires(1)) produceMilitary(c);
  if (fires(2)) runScouting(c);
  if (fires(3)) runMicro(c); // updates retreat/engineer sets before wave assignment
  if (fires(2)) {
    if (diff !== 'easy') runCrates(c);
    runWaves(c);
    runNavy(c);
    runSuperweapon(c);
  }
  return out;
}
