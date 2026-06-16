// =============================================================================
// POCKET ALERT — shared type contract.
// Every module imports from here. Sim state is plain data (JSON-serializable
// except typed arrays) and is mutated only inside sim/game.ts tickGame().
// UI and AI talk to the sim exclusively through Command[]; the sim talks back
// through GameEvent[] returned from each tick.
// =============================================================================

export type EntityId = number;
export type PlayerId = number; // 0..3, index into GameState.players

export interface Vec2 {
  x: number;
  y: number;
}

// --- Terrain -----------------------------------------------------------------

export const enum Terrain {
  GRASS = 0,
  DIRT = 1,
  SAND = 2,
  WATER = 3, // navigable by naval units only
  ROCK = 4, // impassable obstacle
  TREE = 5, // impassable obstacle
  CRYSTAL = 6, // harvestable field tile; ground-passable
}

export interface GameMap {
  w: number;
  h: number;
  terrain: Uint8Array; // Terrain enum, index = y * w + x
  crystal: Uint16Array; // remaining crystal value on CRYSTAL tiles, else 0
  startPositions: Vec2[]; // one per player slot, tile coords
}

// --- Elements & damage -------------------------------------------------------

export const enum Element {
  NEUTRAL = 0,
  FIRE = 1,
  WATER = 2,
  GRASS = 3,
  ELECTRIC = 4, // no triangle bonus either way; bonus vs WATER (+25%)
}

export const enum ArmorClass {
  LIGHT = 0, // infantry-tier creatures
  MEDIUM = 1, // vehicle-tier creatures
  HEAVY = 2, // tier-3 monsters, naval capitals
  BUILDING = 3,
}

export const enum WeaponClass {
  CLAW = 0, // anti-infantry bias
  CANNON = 1, // anti-armor bias
  BLAST = 2, // anti-building bias (splash)
  PIERCE = 3, // balanced, anti-air capable
}

export interface WeaponDef {
  damage: number; // base damage per shot
  range: number; // tiles
  cooldown: number; // ticks between shots
  weaponClass: WeaponClass;
  projectileSpeed: number; // tiles/tick; >= 90 means instant (beam)
  splashRadius: number; // tiles, 0 = single target
  canTargetGround: boolean;
  canTargetAir: boolean;
  burst?: number; // shots per volley, default 1
}

// --- Defs --------------------------------------------------------------------

export type FactionId = 'scorch' | 'tide' | 'verdant';
export type GameMode = 'classic' | 'crystalRush';
export type CrystalRushStance = 'greedy' | 'aggressive' | 'split';
export type CrystalRushUpgradeId = 'economy' | 'waves' | 'defense';

export type ProductionTab =
  | 'structure'
  | 'defense'
  | 'infantry'
  | 'vehicle'
  | 'air'
  | 'naval';

export const enum MoveDomain {
  GROUND = 0,
  WATER = 1,
  AIR = 2,
}

export interface UnitDef {
  id: string; // e.g. 'scorch_peekachoo'
  name: string; // display, e.g. 'Peekachoo'
  blurb: string; // one-line flavor for tooltip
  faction: FactionId;
  tab: Extract<ProductionTab, 'infantry' | 'vehicle' | 'air' | 'naval'>;
  tier: 1 | 2 | 3;
  cost: number;
  buildTicks: number;
  hp: number;
  speed: number; // tiles per second
  sight: number; // tiles
  domain: MoveDomain;
  armor: ArmorClass;
  element: Element;
  weapon?: WeaponDef;
  // role flags
  harvester?: { capacity: number }; // gathers crystal
  engineer?: boolean; // captures enemy buildings on contact
  prerequisites: string[]; // building def ids (any one ConYard implied)
  spriteKey: string; // key into sprite atlas
  uiOrder: number; // sort order in sidebar
}

export interface BuildingDef {
  id: string; // e.g. 'scorch_conyard'
  name: string;
  blurb: string;
  faction: FactionId;
  tab: Extract<ProductionTab, 'structure' | 'defense'>;
  cost: number;
  buildTicks: number;
  hp: number;
  sight: number;
  footprint: { w: number; h: number }; // tiles
  power: number; // + produces, - consumes
  armor: ArmorClass; // always BUILDING, kept for symmetry
  weapon?: WeaponDef; // defenses
  needsPower?: boolean; // offline when low power (defenses, radar)
  prerequisites: string[]; // building def ids
  // capability flags
  isConYard?: boolean;
  isRefinery?: boolean; // harvester dropoff; spawns a free harvester when built
  isRadar?: boolean; // enables minimap; tier-2 gate
  isTechLab?: boolean; // tier-3 gate; superweapon gate
  isRepairDepot?: boolean; // heals adjacent ground units
  producesTabs?: ProductionTab[]; // e.g. hatchery -> ['infantry']
  superweaponId?: string; // building charges this superweapon
  placeOnWater?: boolean; // naval yard: footprint must be on WATER tiles
  spriteKey: string;
  uiOrder: number;
}

export interface SuperweaponDef {
  id: string; // 'magma_strike' | 'tsunami_surge' | 'sporestorm'
  name: string;
  chargeTicks: number;
  radius: number; // effect radius in tiles
  damage: number; // total damage at epicenter
  kind: 'nuke' | 'storm' | 'spore'; // visual/behavior style
  durationTicks: number; // storm/spore linger duration
}

export interface FactionDef {
  id: FactionId;
  name: string; // 'Scorch Legion' etc.
  element: Element;
  superweaponId: string;
  blurb: string;
  // ui theme color (hex) used for faction accents (not player color)
  themeColor: string;
}

// All defs bundled — data/index.ts exports a populated GameData.
export interface GameData {
  factions: Record<FactionId, FactionDef>;
  units: Record<string, UnitDef>;
  buildings: Record<string, BuildingDef>;
  superweapons: Record<string, SuperweaponDef>;
}

// --- Orders & entity state ---------------------------------------------------

export type Order =
  | { kind: 'move'; dest: Vec2 }
  | { kind: 'attackMove'; dest: Vec2 }
  | { kind: 'attack'; target: EntityId }
  | { kind: 'attackGround'; dest: Vec2 } // force-fire at a tile (Ctrl/F+click)
  | { kind: 'harvest'; tile?: Vec2 } // undefined = auto-find nearest crystal
  | { kind: 'returnCargo' }
  | { kind: 'capture'; target: EntityId }
  | { kind: 'guard' }
  | { kind: 'stop' };

export type UnitStance = 'aggressive' | 'holdfire';

// --- crates (RA2 [CrateRules]-style map bonuses) -------------------------------

export type CrateKind =
  | 'money'
  | 'veteran'
  | 'unit'
  | 'heal'
  | 'reveal'
  | 'armor'
  | 'speed'
  | 'firepower';

export interface Crate {
  id: number;
  pos: Vec2; // integer tile
  kind: CrateKind;
  spawnedTick: number;
}

export const enum VetRank {
  ROOKIE = 0,
  VETERAN = 1, // +25% damage
  ELITE = 2, // +50% damage, self-heal
}

export interface Entity {
  id: EntityId;
  kind: 'unit' | 'building';
  defId: string;
  owner: PlayerId;
  pos: Vec2; // tile coords, float. Buildings: top-left corner tile (integer).
  facing: number; // radians, 0 = +x axis (screen ESE in iso)
  hp: number;
  maxHp: number;

  // unit-only
  orders: Order[]; // current order = orders[0]
  path: Vec2[] | null; // waypoints from pathfinding, consumed front-first
  pathTarget: Vec2 | null; // dest the current path was computed for
  attackCooldown: number; // ticks until can fire
  targetId: EntityId | null; // current combat target
  cargo: number; // harvester crystal load
  kills: number;
  vet: VetRank;
  repathCooldown: number; // ticks until allowed to repath (anti-thrash)
  stance: UnitStance; // holdfire suppresses auto-acquire
  buffs: { armor: number; speed: number; fire: number }; // crate multipliers (1 = none)

  // building-only
  buildProgress: number; // 0..1, construction animation; 1 = operational
  rally: Vec2 | null;
  repairing: boolean; // owner paying credits to heal it
  captureProgress: number; // 0..100, engineer capture
  swChargeTick: number; // tick when this building's superweapon is ready (-1 n/a)
  isPrimary: boolean; // primary factory: units of its tab spawn here
}

export interface Projectile {
  id: number;
  pos: Vec2; // tile coords, float
  dest: Vec2;
  targetId: EntityId | null; // homing if set
  speed: number; // tiles per tick
  damage: number;
  weaponClass: WeaponClass;
  element: Element;
  splashRadius: number;
  owner: PlayerId;
  sourceDefId: string; // for visuals (what fired it)
  isAirTarget: boolean; // whether damage applies to air or surface layer
}

// --- Players -----------------------------------------------------------------

export type AIDifficulty = 'easy' | 'medium' | 'hard';

export interface ProductionQueue {
  // one queue per tab; items are def ids. items[0] is in progress.
  items: string[];
  progress: number; // ticks accumulated on items[0]
  readyBuilding: string | null; // structure/defense finished, awaiting placement
  onHold: boolean; // insufficient funds pause
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  faction: FactionId;
  colorIdx: number; // index into PLAYER_COLORS
  isHuman: boolean;
  difficulty: AIDifficulty | null; // null for human
  eliminated: boolean;
  credits: number;
  powerProduced: number; // recomputed each tick
  powerConsumed: number;
  queues: Record<ProductionTab, ProductionQueue>;
  superweapon: { defId: string; readyAtTick: number; charging: boolean } | null;
  radarActive: boolean; // has powered radar
  explored: Uint8Array; // map.w * map.h, 0/1 — persistent
  visible: Uint8Array; // map.w * map.h, 0/1 — recomputed each tick
  // AI scratch memory — sim never touches this; ai/ai.ts owns it
  aiMemory: Record<string, unknown>;
  stats: PlayerStats;
}

// RA2-style score accounting, updated live by the sim.
export interface PlayerStats {
  unitsKilled: number;
  unitsLost: number;
  buildingsKilled: number;
  buildingsLost: number;
  built: number; // structures placed
  creditsHarvested: number;
  score: number; // sum of scoreValue() of everything killed
}

export interface CrystalRushPlayerState {
  stance: CrystalRushStance;
  incomeRate: number;
  totalIncome: number;
  waveLevel: number;
  economyLevel: number;
  defenseLevel: number;
  nextWaveTick: number;
  nextDeployTick: number;
}

export interface CrystalRushState {
  objective: Vec2;
  radius: number;
  player: CrystalRushPlayerState[];
}

// --- Game state --------------------------------------------------------------

export interface GameConfig {
  mode?: GameMode;
  seed: number;
  mapSize: 'S' | 'M' | 'L'; // 56 / 72 / 96 tiles square (MAP_SIZES)
  waterAmount: 'low' | 'medium' | 'high';
  crates: boolean; // RA2 'Crates Appear' lobby toggle
  players: {
    faction: FactionId;
    isHuman: boolean;
    difficulty: AIDifficulty | null;
    colorIdx: number;
    name: string;
  }[];
}

export interface GameState {
  tick: number;
  config: GameConfig;
  map: GameMap;
  players: PlayerState[];
  entities: Map<EntityId, Entity>;
  projectiles: Projectile[];
  crates: Crate[];
  nextEntityId: number;
  nextProjectileId: number;
  rngState: number; // sim RNG lives in state for determinism
  winner: PlayerId | null; // set when one player (or none) remains
  crystalRush?: CrystalRushState;
  // spatial index rebuilt each tick: tile -> entity ids occupying it
  // (sim-internal; renderer may read)
  occupancy: Map<number, EntityId[]>; // key = tileY * map.w + tileX
}

// --- Commands (UI / AI -> sim) -----------------------------------------------

export type Command =
  | { type: 'queueProduction'; player: PlayerId; tab: ProductionTab; defId: string }
  | { type: 'cancelProduction'; player: PlayerId; tab: ProductionTab; index: number }
  | { type: 'placeBuilding'; player: PlayerId; defId: string; pos: Vec2 } // integer tile
  | { type: 'issueOrder'; player: PlayerId; unitIds: EntityId[]; order: Order; queued: boolean }
  | { type: 'setRally'; player: PlayerId; buildingId: EntityId; pos: Vec2 }
  | { type: 'sell'; player: PlayerId; buildingId: EntityId }
  | { type: 'toggleRepair'; player: PlayerId; buildingId: EntityId }
  | { type: 'fireSuperweapon'; player: PlayerId; target: Vec2 }
  | { type: 'setStance'; player: PlayerId; unitIds: EntityId[]; stance: UnitStance }
  | { type: 'setPrimary'; player: PlayerId; buildingId: EntityId }
  | { type: 'crystalRushSetStance'; player: PlayerId; stance: CrystalRushStance }
  | { type: 'crystalRushBuyUpgrade'; player: PlayerId; upgrade: CrystalRushUpgradeId }
  | { type: 'crystalRushDeployWave'; player: PlayerId }
  | { type: 'surrender'; player: PlayerId };

// --- Events (sim -> UI / audio / AI) ------------------------------------------

export type GameEvent =
  // announcer-worthy
  | { type: 'buildingReady'; player: PlayerId; defId: string } // structure awaiting placement
  | { type: 'buildingPlaced'; player: PlayerId; defId: string; id: EntityId }
  | { type: 'unitReady'; player: PlayerId; defId: string; id: EntityId }
  | { type: 'underAttack'; player: PlayerId; pos: Vec2; baseAttack: boolean }
  | { type: 'lowPower'; player: PlayerId }
  | { type: 'powerRestored'; player: PlayerId }
  | { type: 'insufficientFunds'; player: PlayerId }
  | { type: 'superweaponReady'; player: PlayerId; defId: string }
  | { type: 'superweaponLaunched'; byPlayer: PlayerId; defId: string; target: Vec2 }
  | { type: 'buildingCaptured'; byPlayer: PlayerId; fromPlayer: PlayerId; id: EntityId }
  | { type: 'playerEliminated'; player: PlayerId }
  | { type: 'gameOver'; winner: PlayerId | null }
  // sfx/vfx-worthy
  | { type: 'shotFired'; pos: Vec2; weaponClass: WeaponClass; element: Element }
  | { type: 'impact'; pos: Vec2; weaponClass: WeaponClass; element: Element; splash: number }
  | { type: 'entityDied'; id: EntityId; defId: string; kind: 'unit' | 'building'; pos: Vec2; owner: PlayerId }
  | { type: 'crystalDepleted'; pos: Vec2 }
  | { type: 'promotion'; id: EntityId; rank: VetRank }
  | { type: 'cratePickup'; player: PlayerId; kind: CrateKind; pos: Vec2; amount?: number }
  | { type: 'aiTaunt'; player: PlayerId; text: string };

// --- Rendering / UI shared types ----------------------------------------------

export interface Camera {
  // world-pixel offset of the viewport's top-left corner (iso projection space)
  x: number;
  y: number;
  zoom: number; // 1 = native
}

export interface UIState {
  selection: EntityId[];
  controlGroups: Record<number, EntityId[]>; // keys 1..9
  placingDefId: string | null; // building placement mode
  placeValid: boolean;
  sellMode: boolean;
  repairMode: boolean;
  targetingSuperweapon: boolean;
  hoverTile: Vec2 | null;
  dragStart: { sx: number; sy: number } | null; // screen px, drag select
  dragEnd: { sx: number; sy: number } | null;
  paused: boolean;
  gameSpeed: number; // 1 = normal (ticks per real tick multiplier)
  showMenu: boolean; // ESC menu
}

// Per-frame visual effects (renderer-owned, fed by GameEvents)
export interface VisualEffect {
  kind:
    | 'explosion' | 'spark' | 'splash' | 'nuke' | 'storm' | 'spore' | 'heal' | 'capture'
    | 'sell' | 'place' | 'promote'
    | 'spirit' | 'debris' | 'dust' | 'muzzle' | 'flicker' | 'cheer' | 'crate' | 'moveFlash' | 'taunt';
  pos: Vec2; // tile coords
  startedAt: number; // performance.now() ms
  duration: number; // ms
  scale: number;
  element: Element;
}

export const PLAYER_COLORS: { name: string; hex: string }[] = [
  { name: 'Crimson', hex: '#e8453c' },
  { name: 'Azure', hex: '#3c7be8' },
  { name: 'Emerald', hex: '#3ce86e' },
  { name: 'Gold', hex: '#e8c63c' },
];

// --- Helpers used across modules ----------------------------------------------

export function tileIndex(map: { w: number }, x: number, y: number): number {
  return (y | 0) * map.w + (x | 0);
}

export function inBounds(map: { w: number; h: number }, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.w && y < map.h;
}

export function dist(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function entityCenter(e: Entity, data: GameData): Vec2 {
  if (e.kind === 'building') {
    const def = data.buildings[e.defId];
    return { x: e.pos.x + def.footprint.w / 2, y: e.pos.y + def.footprint.h / 2 };
  }
  return { x: e.pos.x, y: e.pos.y };
}

export function isUnitDef(data: GameData, defId: string): boolean {
  return defId in data.units;
}
