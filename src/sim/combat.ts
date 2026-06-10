// =============================================================================
// POCKET ALERT — sim/combat.ts (Owner B)
// Targeting, firing, projectiles, damage/veterancy, engineer capture and
// passive healing (elite self-heal, Verdant regen, repair-depot aura).
//
// Per-tick flow (driven by sim/game.ts):
//   updateUnitCombat(state, data, e, events)  — every unit AND building
//   updateProjectiles(state, data, events)    — once, after unit brains
//
// Target acquisition scans are staggered on (tick + id) % 5 to spread cost.
// All transient bookkeeping that is NOT part of the serialized GameState
// (recent damager, capture channel attendance, projectile shooters) lives in
// a WeakMap keyed by the state object — derived caches only; losing them
// (e.g. on state reload) degrades nothing but target preference for a moment.
// Deterministic: tick counts + simRandom only (and none is needed here).
// =============================================================================

import type {
  Entity,
  EntityId,
  GameData,
  GameEvent,
  GameState,
  PlayerId,
  Projectile,
  UnitDef,
  Vec2,
  WeaponDef,
} from '../core/types';
import {
  ArmorClass,
  Element,
  MoveDomain,
  VetRank,
  WeaponClass,
  dist,
  entityCenter,
} from '../core/types';
import {
  CAPTURE_TICKS,
  ELITE_SELFHEAL_PER_TICK,
  REPAIR_DEPOT_HP_PER_TICK,
  REPAIR_DEPOT_RANGE,
  SPLASH_FALLOFF,
  VET_DAMAGE_BONUS,
  VET_KILL_THRESHOLDS,
  WEAPON_VS_ARMOR,
  elementMultiplier,
  scoreValue,
} from '../core/constants';
import { orderMove } from './movement';
import { isVisibleTo } from './fog';

/** Acquisition/repath decisions run when (tick + id) % STAGGER === 0. */
const STAGGER = 5;
/** "Damaged me recently" window for target preference (ticks, ~5s). */
const RECENT_DAMAGE_WINDOW = 75;
/** Auto-acquired targets are dropped beyond sight + leash tiles. */
const CHASE_LEASH = 3;
/** Verdant passive: regen after this many ticks without taking damage (~5s). */
const VERDANT_REGEN_DELAY = 75;
const VERDANT_REGEN_PER_TICK = 0.2;
/** Capture channel rates (percent per tick). */
const CAPTURE_GAIN_PER_TICK = 100 / CAPTURE_TICKS;
const CAPTURE_DECAY_PER_TICK = 2 * CAPTURE_GAIN_PER_TICK;
/** Projectile speeds at/above this resolve instantly (beam weapons). */
const INSTANT_SPEED = 90;
/** How often the derived-cache maps are swept of dead entries (ticks). */
const MEMO_PRUNE_INTERVAL = 150;

interface DamageInfo {
  lastDamagedTick: number;
  lastAttacker: EntityId | null;
  lastAttackerTick: number;
}

interface DepotInfo {
  owner: PlayerId;
  x: number;
  y: number;
}

interface SimMemo {
  /** victim id -> when/by whom it was last damaged. */
  damage: Map<EntityId, DamageInfo>;
  /** building id -> last tick an engineer channeled capture on it. */
  captureAttended: Map<EntityId, number>;
  /** projectile id -> firing entity id (for vet bonus + kill credit). */
  projShooter: Map<number, EntityId>;
  /** (player*2 + baseAttackFlag) -> last tick an underAttack event was sent. */
  underAttackTick: Map<number, number>;
  /** per-tick cache of operational repair depots. */
  depotsTick: number;
  depots: DepotInfo[];
  lastPruneTick: number;
}

const memoStore = new WeakMap<GameState, SimMemo>();

function memoOf(state: GameState): SimMemo {
  let m = memoStore.get(state);
  if (m === undefined) {
    m = {
      damage: new Map(),
      captureAttended: new Map(),
      projShooter: new Map(),
      underAttackTick: new Map(),
      depotsTick: -1,
      depots: [],
      lastPruneTick: -1,
    };
    memoStore.set(state, m);
  }
  return m;
}

// --- Small shared helpers ------------------------------------------------------

function liveEntity(state: GameState, id: EntityId): Entity | null {
  const e = state.entities.get(id);
  return e !== undefined && e.hp > 0 ? e : null;
}

function isAirEntity(data: GameData, e: Entity): boolean {
  if (e.kind !== 'unit') return false;
  const def = data.units[e.defId];
  return def !== undefined && def.domain === MoveDomain.AIR;
}

function canTargetEntity(data: GameData, weapon: WeaponDef, target: Entity): boolean {
  return isAirEntity(data, target) ? weapon.canTargetAir : weapon.canTargetGround;
}

/** Element a firing entity attacks with: unit def element, or the faction
 *  element for buildings (BuildingDef carries no element of its own). */
function attackElement(data: GameData, e: Entity): Element {
  if (e.kind === 'unit') {
    const def = data.units[e.defId];
    return def !== undefined ? def.element : Element.NEUTRAL;
  }
  const def = data.buildings[e.defId];
  if (def === undefined) return Element.NEUTRAL;
  const fac = data.factions[def.faction];
  return fac !== undefined ? fac.element : Element.NEUTRAL;
}

/**
 * Combat distance from a point to an entity. Units: distance to center.
 * Buildings: distance to the nearest point of the footprint rectangle, so
 * short-ranged (melee) attackers can actually reach large structures.
 */
function combatDistance(data: GameData, from: Vec2, target: Entity): number {
  if (target.kind === 'unit') return dist(from, target.pos);
  const def = data.buildings[target.defId];
  if (def === undefined) return dist(from, target.pos);
  const x0 = target.pos.x;
  const y0 = target.pos.y;
  const x1 = x0 + def.footprint.w;
  const y1 = y0 + def.footprint.h;
  const cx = Math.min(x1, Math.max(x0, from.x));
  const cy = Math.min(y1, Math.max(y0, from.y));
  const dx = from.x - cx;
  const dy = from.y - cy;
  return Math.sqrt(dx * dx + dy * dy);
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

function isLowPower(state: GameState, player: PlayerId): boolean {
  const p = state.players[player];
  return p !== undefined && p.powerConsumed > p.powerProduced;
}

// --- Damage ----------------------------------------------------------------------

/**
 * Apply damage to an entity. Final damage =
 *   rawDamage * WEAPON_VS_ARMOR[wc][armor] * elementMultiplier(elem, targetElem)
 *             * VET_DAMAGE_BONUS[attacker.vet] * attacker.buffs.fire
 *             / target.buffs.armor               (crate buffs; 1 = none)
 * Records the damager (for retaliation preference and Verdant regen reset),
 * emits a deduped `underAttack` for the victim's owner, and on a lethal hit
 * credits the attacker's kills + veterancy promotion plus the attacking
 * player's RA2-style stats (unitsKilled/buildingsKilled + scoreValue). The
 * corpse itself is removed by Owner A's cleanup phase (hp <= 0).
 */
export function dealDamage(
  state: GameState,
  data: GameData,
  targetId: EntityId,
  rawDamage: number,
  wc: WeaponClass,
  elem: Element,
  attacker: EntityId | null,
  events: GameEvent[],
): void {
  const target = state.entities.get(targetId);
  if (target === undefined || target.hp <= 0) return;
  const memo = memoOf(state);

  let armor: ArmorClass;
  let targetElem: Element;
  let isHarvester = false;
  if (target.kind === 'unit') {
    const def = data.units[target.defId];
    armor = def !== undefined ? def.armor : ArmorClass.LIGHT;
    targetElem = def !== undefined ? def.element : Element.NEUTRAL;
    isHarvester = def !== undefined && def.harvester !== undefined;
  } else {
    const def = data.buildings[target.defId];
    armor = def !== undefined ? def.armor : ArmorClass.BUILDING;
    targetElem = Element.NEUTRAL;
  }

  const atkEnt = attacker !== null ? state.entities.get(attacker) : undefined;
  const vetMult =
    atkEnt !== undefined && atkEnt.kind === 'unit' ? VET_DAMAGE_BONUS[atkEnt.vet] : 1.0;
  // Crate buffs: firepower multiplies outgoing, armor divides incoming.
  const fireMult = atkEnt !== undefined ? atkEnt.buffs.fire : 1.0;

  const dmg =
    (rawDamage * WEAPON_VS_ARMOR[wc][armor] * elementMultiplier(elem, targetElem) * vetMult * fireMult) /
    target.buffs.armor;
  if (dmg <= 0) return;
  target.hp -= dmg;

  // Remember who hit us (retaliation preference + Verdant regen reset).
  let info = memo.damage.get(targetId);
  if (info === undefined) {
    info = { lastDamagedTick: state.tick, lastAttacker: attacker, lastAttackerTick: state.tick };
    memo.damage.set(targetId, info);
  } else {
    info.lastDamagedTick = state.tick;
    if (attacker !== null) {
      info.lastAttacker = attacker;
      info.lastAttackerTick = state.tick;
    }
  }

  // underAttack for the victim's owner (max one per owner+flavor per tick;
  // the announcer applies its own long-window dedupe on top).
  const baseAttack = target.kind === 'building' || isHarvester;
  const uaKey = target.owner * 2 + (baseAttack ? 1 : 0);
  if (memo.underAttackTick.get(uaKey) !== state.tick) {
    memo.underAttackTick.set(uaKey, state.tick);
    events.push({
      type: 'underAttack',
      player: target.owner,
      pos: entityCenter(target, data),
      baseAttack,
    });
  }

  // Lethal hit: kill credit + veterancy + RA2-style score accounting.
  if (target.hp <= 0 && atkEnt !== undefined && atkEnt.owner !== target.owner) {
    atkEnt.kills += 1;
    const ap = state.players[atkEnt.owner];
    if (ap !== undefined) {
      if (target.kind === 'unit') ap.stats.unitsKilled += 1;
      else ap.stats.buildingsKilled += 1;
      const vdef = target.kind === 'unit' ? data.units[target.defId] : data.buildings[target.defId];
      if (vdef !== undefined) ap.stats.score += scoreValue(vdef);
    }
    if (atkEnt.kind === 'unit') {
      if (atkEnt.vet === VetRank.ROOKIE && atkEnt.kills >= VET_KILL_THRESHOLDS[0]) {
        atkEnt.vet = VetRank.VETERAN;
        events.push({ type: 'promotion', id: atkEnt.id, rank: VetRank.VETERAN });
      }
      if (atkEnt.vet === VetRank.VETERAN && atkEnt.kills >= VET_KILL_THRESHOLDS[1]) {
        atkEnt.vet = VetRank.ELITE;
        events.push({ type: 'promotion', id: atkEnt.id, rank: VetRank.ELITE });
      }
    }
  }
}

/** Splash around `center`: linear falloff from full at the epicenter to
 *  SPLASH_FALLOFF at the edge. Skips the firer's own entities (no self-splash;
 *  FFA, so there are no allies) and respects the air-vs-surface layer. */
function applySplash(
  state: GameState,
  data: GameData,
  center: Vec2,
  baseDamage: number,
  wc: WeaponClass,
  radius: number,
  elem: Element,
  firerOwner: PlayerId,
  attackerId: EntityId | null,
  excludeId: EntityId | null,
  isAirTarget: boolean,
  events: GameEvent[],
): void {
  if (radius <= 0) return;
  for (const e of state.entities.values()) {
    if (e.owner === firerOwner) continue;
    if (excludeId !== null && e.id === excludeId) continue;
    if (e.hp <= 0) continue;
    if (isAirEntity(data, e) !== isAirTarget) continue;
    const d = combatDistance(data, center, e);
    if (d > radius) continue;
    const falloff = 1 - (1 - SPLASH_FALLOFF) * Math.min(1, d / radius);
    dealDamage(state, data, e.id, baseDamage * falloff, wc, elem, attackerId, events);
  }
}

// --- Firing ---------------------------------------------------------------------

function fireWeapon(
  state: GameState,
  data: GameData,
  shooter: Entity,
  weapon: WeaponDef,
  target: Entity,
  events: GameEvent[],
): void {
  const memo = memoOf(state);
  const myC = entityCenter(shooter, data);
  const tc = entityCenter(target, data);
  const elem = attackElement(data, shooter);
  const isAirTarget = isAirEntity(data, target);
  const burst = weapon.burst !== undefined && weapon.burst > 1 ? weapon.burst : 1;

  events.push({
    type: 'shotFired',
    pos: { x: myC.x, y: myC.y },
    weaponClass: weapon.weaponClass,
    element: elem,
  });

  for (let i = 0; i < burst; i++) {
    if (weapon.projectileSpeed >= INSTANT_SPEED) {
      // Beam: resolves immediately.
      dealDamage(state, data, target.id, weapon.damage, weapon.weaponClass, elem, shooter.id, events);
      events.push({
        type: 'impact',
        pos: { x: tc.x, y: tc.y },
        weaponClass: weapon.weaponClass,
        element: elem,
        splash: weapon.splashRadius,
      });
      applySplash(
        state, data, tc, weapon.damage, weapon.weaponClass, weapon.splashRadius,
        elem, shooter.owner, shooter.id, target.id, isAirTarget, events,
      );
    } else {
      const proj: Projectile = {
        id: state.nextProjectileId++,
        pos: { x: myC.x, y: myC.y },
        dest: { x: tc.x, y: tc.y },
        targetId: target.id,
        speed: weapon.projectileSpeed,
        damage: weapon.damage,
        weaponClass: weapon.weaponClass,
        element: elem,
        splashRadius: weapon.splashRadius,
        owner: shooter.owner,
        sourceDefId: shooter.defId,
        isAirTarget,
      };
      state.projectiles.push(proj);
      memo.projShooter.set(proj.id, shooter.id);
    }
  }
  shooter.attackCooldown = weapon.cooldown;
}

/**
 * Force-fire at a ground point (attackGround order). Beam weapons resolve
 * their splash at the point immediately; projectile weapons fly to the point
 * with no homing target (targetId null) and splash on arrival. Always fires
 * at the surface layer.
 */
function fireAtGround(
  state: GameState,
  data: GameData,
  shooter: Entity,
  weapon: WeaponDef,
  dest: Vec2,
  events: GameEvent[],
): void {
  const memo = memoOf(state);
  const myC = entityCenter(shooter, data);
  const elem = attackElement(data, shooter);
  const burst = weapon.burst !== undefined && weapon.burst > 1 ? weapon.burst : 1;

  events.push({
    type: 'shotFired',
    pos: { x: myC.x, y: myC.y },
    weaponClass: weapon.weaponClass,
    element: elem,
  });

  for (let i = 0; i < burst; i++) {
    if (weapon.projectileSpeed >= INSTANT_SPEED) {
      events.push({
        type: 'impact',
        pos: { x: dest.x, y: dest.y },
        weaponClass: weapon.weaponClass,
        element: elem,
        splash: weapon.splashRadius,
      });
      applySplash(
        state, data, dest, weapon.damage, weapon.weaponClass, weapon.splashRadius,
        elem, shooter.owner, shooter.id, null, false, events,
      );
    } else {
      const proj: Projectile = {
        id: state.nextProjectileId++,
        pos: { x: myC.x, y: myC.y },
        dest: { x: dest.x, y: dest.y },
        targetId: null,
        speed: weapon.projectileSpeed,
        damage: weapon.damage,
        weaponClass: weapon.weaponClass,
        element: elem,
        splashRadius: weapon.splashRadius,
        owner: shooter.owner,
        sourceDefId: shooter.defId,
        isAirTarget: false,
      };
      state.projectiles.push(proj);
      memo.projShooter.set(proj.id, shooter.id);
    }
  }
  shooter.attackCooldown = weapon.cooldown;
}

// --- Target selection -------------------------------------------------------------

/** Validity of a sustained auto-acquired target: alive, targetable, still
 *  visible to the owner and within sight + leash of the unit. */
function autoTargetValid(
  state: GameState,
  data: GameData,
  u: Entity,
  def: UnitDef,
  weapon: WeaponDef,
  target: Entity,
): boolean {
  if (target.hp <= 0 || target.owner === u.owner) return false;
  if (!canTargetEntity(data, weapon, target)) return false;
  const tc = entityCenter(target, data);
  if (!isVisibleTo(state, u.owner, tc.x, tc.y)) return false;
  return combatDistance(data, entityCenter(u, data), target) <= def.sight + CHASE_LEASH;
}

/**
 * Auto-acquire the best enemy in sight: prefer whoever damaged this unit
 * recently, then enemy units over buildings, then the closest (id tiebreak
 * for determinism). Only targets visible to the owner are considered.
 */
function acquireTarget(
  state: GameState,
  data: GameData,
  u: Entity,
  sightRange: number,
  weapon: WeaponDef,
  unitsOnly: boolean,
): Entity | null {
  const memo = memoOf(state);
  const myC = entityCenter(u, data);
  const dmgInfo = memo.damage.get(u.id);
  const revengeId =
    dmgInfo !== undefined &&
    dmgInfo.lastAttacker !== null &&
    state.tick - dmgInfo.lastAttackerTick <= RECENT_DAMAGE_WINDOW
      ? dmgInfo.lastAttacker
      : null;

  let best: Entity | null = null;
  let bestPrio = Infinity;
  let bestDist = Infinity;
  for (const e of state.entities.values()) {
    if (e.owner === u.owner || e.hp <= 0) continue;
    if (e.kind === 'building' && unitsOnly) continue;
    const ownerState = state.players[e.owner];
    if (ownerState !== undefined && ownerState.eliminated) continue;
    if (!canTargetEntity(data, weapon, e)) continue;
    const d = combatDistance(data, myC, e);
    if (d > sightRange) continue;
    const c = entityCenter(e, data);
    if (!isVisibleTo(state, u.owner, c.x, c.y)) continue;
    const prio = e.id === revengeId ? 0 : e.kind === 'unit' ? 1 : 2;
    if (
      prio < bestPrio ||
      (prio === bestPrio && (d < bestDist || (d === bestDist && best !== null && e.id < best.id)))
    ) {
      best = e;
      bestPrio = prio;
      bestDist = d;
    }
  }
  return best;
}

// --- Engagement -------------------------------------------------------------------

/**
 * Close in on / fire at `target`. In weapon range: stop, face, fire when the
 * cooldown allows. Out of range (and chasing allowed): repath toward the
 * target on the stagger beat when there is no path or the target strayed
 * more than 2 tiles from where the current path was computed for.
 */
function engageTarget(
  state: GameState,
  data: GameData,
  u: Entity,
  weapon: WeaponDef,
  target: Entity,
  mayChase: boolean,
  stagger: boolean,
  events: GameEvent[],
): void {
  const myC = entityCenter(u, data);
  const tc = entityCenter(target, data);
  if (combatDistance(data, myC, target) <= weapon.range) {
    u.path = null;
    u.pathTarget = null;
    u.facing = lerpAngle(u.facing, Math.atan2(tc.y - myC.y, tc.x - myC.x), 0.5);
    if (u.attackCooldown <= 0) fireWeapon(state, data, u, weapon, target, events);
    return;
  }
  if (!mayChase || !stagger) return;
  const needRepath =
    u.path === null ||
    u.path.length === 0 ||
    u.pathTarget === null ||
    dist(u.pathTarget, tc) > 2;
  if (needRepath) {
    orderMove(state, data, u, { x: Math.floor(tc.x), y: Math.floor(tc.y) });
  }
}

/**
 * Force-fire engagement: path into weapon range of the ground point, then
 * hold and shell it. The order persists until replaced or stopped.
 */
function engageGround(
  state: GameState,
  data: GameData,
  u: Entity,
  weapon: WeaponDef,
  dest: Vec2,
  stagger: boolean,
  events: GameEvent[],
): void {
  const myC = entityCenter(u, data);
  if (dist(myC, dest) <= weapon.range) {
    u.path = null;
    u.pathTarget = null;
    u.facing = lerpAngle(u.facing, Math.atan2(dest.y - myC.y, dest.x - myC.x), 0.5);
    if (u.attackCooldown <= 0) fireAtGround(state, data, u, weapon, dest, events);
    return;
  }
  if (!stagger) return;
  const needRepath =
    u.path === null ||
    u.path.length === 0 ||
    u.pathTarget === null ||
    dist(u.pathTarget, dest) > 2;
  if (needRepath) {
    orderMove(state, data, u, { x: Math.floor(dest.x), y: Math.floor(dest.y) });
  }
}

// --- Passive healing ----------------------------------------------------------------

function refreshDepotCache(state: GameState, data: GameData, memo: SimMemo): void {
  if (memo.depotsTick === state.tick) return;
  memo.depotsTick = state.tick;
  memo.depots.length = 0;
  for (const e of state.entities.values()) {
    if (e.kind !== 'building' || e.hp <= 0 || e.buildProgress < 1) continue;
    const def = data.buildings[e.defId];
    if (def === undefined || def.isRepairDepot !== true) continue;
    const c = entityCenter(e, data);
    memo.depots.push({ owner: e.owner, x: c.x, y: c.y });
  }
}

function applyPassiveHealing(
  state: GameState,
  data: GameData,
  u: Entity,
  def: UnitDef,
  memo: SimMemo,
): void {
  if (u.hp >= u.maxHp) return;
  let heal = 0;
  if (u.vet === VetRank.ELITE) heal += ELITE_SELFHEAL_PER_TICK;
  if (def.faction === 'verdant') {
    const info = memo.damage.get(u.id);
    if (info === undefined || state.tick - info.lastDamagedTick >= VERDANT_REGEN_DELAY) {
      heal += VERDANT_REGEN_PER_TICK;
    }
  }
  if (def.domain === MoveDomain.GROUND) {
    refreshDepotCache(state, data, memo);
    const depots = memo.depots;
    for (let i = 0; i < depots.length; i++) {
      const dp = depots[i];
      if (dp.owner !== u.owner) continue;
      const dx = u.pos.x - dp.x;
      const dy = u.pos.y - dp.y;
      if (dx * dx + dy * dy <= REPAIR_DEPOT_RANGE * REPAIR_DEPOT_RANGE) {
        heal += REPAIR_DEPOT_HP_PER_TICK;
        break;
      }
    }
  }
  if (heal > 0) u.hp = Math.min(u.maxHp, u.hp + heal);
}

// --- Engineer capture ----------------------------------------------------------------

function updateCapture(
  state: GameState,
  data: GameData,
  u: Entity,
  targetId: EntityId,
  events: GameEvent[],
  memo: SimMemo,
): void {
  const target = liveEntity(state, targetId);
  if (target === null || target.kind !== 'building' || target.owner === u.owner) {
    u.orders.shift();
    u.path = null;
    u.pathTarget = null;
    return;
  }
  const tdef = data.buildings[target.defId];
  if (tdef === undefined) {
    u.orders.shift();
    return;
  }

  // Adjacent = engineer's tile touches the footprint ring (or overlaps it).
  const ex = Math.floor(u.pos.x);
  const ey = Math.floor(u.pos.y);
  const adjacent =
    ex >= target.pos.x - 1 &&
    ex <= target.pos.x + tdef.footprint.w &&
    ey >= target.pos.y - 1 &&
    ey <= target.pos.y + tdef.footprint.h;

  if (!adjacent) {
    const stagger = (state.tick + u.id) % STAGGER === 0;
    if ((u.path === null || u.path.length === 0) && stagger) {
      const tc = entityCenter(target, data);
      orderMove(state, data, u, { x: Math.floor(tc.x), y: Math.floor(tc.y) });
      if (u.path === null) u.orders.shift(); // unreachable: give up
    }
    return;
  }

  // Channel.
  u.path = null;
  u.pathTarget = null;
  const tc = entityCenter(target, data);
  u.facing = Math.atan2(tc.y - u.pos.y, tc.x - u.pos.x);
  target.captureProgress += CAPTURE_GAIN_PER_TICK;
  memo.captureAttended.set(target.id, state.tick);

  if (target.captureProgress >= 100) {
    const fromPlayer = target.owner;
    target.captureProgress = 0;
    target.owner = u.owner;
    target.repairing = false;
    target.targetId = null;
    target.rally = null;
    events.push({ type: 'buildingCaptured', byPlayer: u.owner, fromPlayer, id: target.id });
    // The engineer is consumed by the capture.
    events.push({
      type: 'entityDied',
      id: u.id,
      defId: u.defId,
      kind: 'unit',
      pos: { x: u.pos.x, y: u.pos.y },
      owner: u.owner,
    });
    state.entities.delete(u.id);
  }
}

/** Unattended capture progress decays at twice the channel rate. */
function decayCapture(state: GameState, b: Entity, memo: SimMemo): void {
  if (b.captureProgress <= 0) return;
  const attended = memo.captureAttended.get(b.id);
  // "Attended" covers this tick and the previous one to be robust to the
  // engineer-vs-building update order inside a tick.
  if (attended !== undefined && attended >= state.tick - 1) return;
  b.captureProgress = Math.max(0, b.captureProgress - CAPTURE_DECAY_PER_TICK);
}

// --- Building (defense) combat ----------------------------------------------------------

function updateBuildingCombat(
  state: GameState,
  data: GameData,
  b: Entity,
  events: GameEvent[],
  memo: SimMemo,
): void {
  decayCapture(state, b, memo);
  const def = data.buildings[b.defId];
  if (def === undefined || def.weapon === undefined) return;
  if (b.buildProgress < 1) return;
  if (def.needsPower === true && isLowPower(state, b.owner)) {
    b.targetId = null; // offline
    return;
  }
  const weapon = def.weapon;
  const myC = entityCenter(b, data);

  let target = b.targetId !== null ? liveEntity(state, b.targetId) : null;
  if (
    target !== null &&
    (target.owner === b.owner ||
      target.kind !== 'unit' || // defenses pick on units, not structures
      !canTargetEntity(data, weapon, target) ||
      combatDistance(data, myC, target) > weapon.range ||
      !isVisibleTo(state, b.owner, target.pos.x, target.pos.y))
  ) {
    target = null;
  }
  if (target === null && (state.tick + b.id) % STAGGER === 0) {
    target = acquireTarget(state, data, b, weapon.range, weapon, true);
  }
  b.targetId = target !== null ? target.id : null;
  if (target === null) return;

  const tc = entityCenter(target, data);
  b.facing = Math.atan2(tc.y - myC.y, tc.x - myC.x);
  if (b.attackCooldown <= 0) fireWeapon(state, data, b, weapon, target, events);
}

// --- Per-entity combat brain ----------------------------------------------------------

/**
 * Per-tick combat update for one entity (units AND buildings — armed
 * structures acquire and fire here too; sim/game.ts calls this for every
 * entity after movement).
 */
export function updateUnitCombat(
  state: GameState,
  data: GameData,
  u: Entity,
  events: GameEvent[],
): void {
  if (u.hp <= 0) return;
  if (u.attackCooldown > 0) u.attackCooldown -= 1;
  const memo = memoOf(state);

  if (u.kind === 'building') {
    updateBuildingCombat(state, data, u, events, memo);
    return;
  }

  const def = data.units[u.defId];
  if (def === undefined) return;

  applyPassiveHealing(state, data, u, def, memo);

  let order = u.orders.length > 0 ? u.orders[0] : null;
  if (order !== null && order.kind === 'stop') {
    u.orders.shift();
    u.path = null;
    u.pathTarget = null;
    u.targetId = null;
    order = u.orders.length > 0 ? u.orders[0] : null;
  }

  if (def.engineer === true && order !== null && order.kind === 'capture') {
    updateCapture(state, data, u, order.target, events, memo);
    return;
  }

  const weapon = def.weapon;
  if (weapon === undefined) {
    // Unarmed units can't force-fire; drop the order instead of freezing.
    if (order !== null && order.kind === 'attackGround') u.orders.shift();
    return; // harvesters, engineers without capture orders
  }

  const stagger = (state.tick + u.id) % STAGGER === 0;

  // Explicit force-fire at a ground point (persists until replaced/stopped).
  // Executes regardless of stance — it's an explicit order.
  if (order !== null && order.kind === 'attackGround') {
    u.targetId = null;
    engageGround(state, data, u, weapon, order.dest, stagger, events);
    return;
  }

  // Explicit attack order: chase the target anywhere until it dies.
  if (order !== null && order.kind === 'attack') {
    const target = liveEntity(state, order.target);
    if (target === null || target.owner === u.owner || !canTargetEntity(data, weapon, target)) {
      u.orders.shift();
      u.targetId = null;
      u.path = null;
      u.pathTarget = null;
      return;
    }
    u.targetId = target.id;
    engageTarget(state, data, u, weapon, target, true, stagger, events);
    return;
  }

  // Auto-acquiring stances: attackMove / guard / idle.
  const autoStance = order === null || order.kind === 'attackMove' || order.kind === 'guard';
  if (!autoStance) return; // move/harvest/returnCargo: no opportunistic fire

  // Hold-fire stance never auto-acquires (explicit orders handled above).
  if (u.stance === 'holdfire') {
    if (u.targetId !== null) {
      u.targetId = null;
      if (order === null || order.kind === 'guard') {
        u.path = null;
        u.pathTarget = null;
      }
    }
    return;
  }

  let target = u.targetId !== null ? liveEntity(state, u.targetId) : null;
  if (target !== null && !autoTargetValid(state, data, u, def, weapon, target)) {
    target = null;
    u.targetId = null;
    // Drop the pursuit path when the target is lost outside an attackMove
    // (attackMove resumes toward its destination via movement's self-heal).
    if (order === null || order.kind === 'guard') {
      u.path = null;
      u.pathTarget = null;
    }
  }
  if (target === null && stagger) {
    target = acquireTarget(state, data, u, def.sight, weapon, false);
    u.targetId = target !== null ? target.id : null;
  }
  if (target !== null) {
    engageTarget(state, data, u, weapon, target, true, stagger, events);
  }
}

// --- Projectiles --------------------------------------------------------------------

function impactProjectile(
  state: GameState,
  data: GameData,
  pr: Projectile,
  memo: SimMemo,
  events: GameEvent[],
): void {
  events.push({
    type: 'impact',
    pos: { x: pr.pos.x, y: pr.pos.y },
    weaponClass: pr.weaponClass,
    element: pr.element,
    splash: pr.splashRadius,
  });
  const attackerId = memo.projShooter.get(pr.id);
  const attacker = attackerId !== undefined ? attackerId : null;

  let directId: EntityId | null = null;
  if (pr.targetId !== null) {
    const t = liveEntity(state, pr.targetId);
    if (t !== null) {
      directId = t.id;
      dealDamage(state, data, t.id, pr.damage, pr.weaponClass, pr.element, attacker, events);
    }
  }
  applySplash(
    state, data, pr.pos, pr.damage, pr.weaponClass, pr.splashRadius,
    pr.element, pr.owner, attacker, directId, pr.isAirTarget, events,
  );
}

/** Sweep derived caches of entries whose entities/projectiles are gone. */
function pruneMemos(state: GameState, memo: SimMemo): void {
  if (state.tick - memo.lastPruneTick < MEMO_PRUNE_INTERVAL) return;
  memo.lastPruneTick = state.tick;
  for (const id of memo.damage.keys()) {
    if (!state.entities.has(id)) memo.damage.delete(id);
  }
  for (const id of memo.captureAttended.keys()) {
    if (!state.entities.has(id)) memo.captureAttended.delete(id);
  }
  if (memo.projShooter.size > 0) {
    const live = new Set<number>();
    for (let i = 0; i < state.projectiles.length; i++) live.add(state.projectiles[i].id);
    for (const id of memo.projShooter.keys()) {
      if (!live.has(id)) memo.projShooter.delete(id);
    }
  }
}

/**
 * Advance every projectile once per tick: home toward the live target's
 * center (or the recorded destination once the target is gone), and on
 * arrival emit the impact event and apply direct + splash damage. Splash
 * never harms the firer's own entities and respects the air/surface layer.
 * Superweapon marker projectiles (sourceDefId 'sw_*') ride this same pipeline
 * with attacker = null (no vet bonus, no kill credit).
 */
export function updateProjectiles(state: GameState, data: GameData, events: GameEvent[]): void {
  const memo = memoOf(state);
  const projs = state.projectiles;
  let write = 0;
  for (let i = 0; i < projs.length; i++) {
    const pr = projs[i];

    if (pr.targetId !== null) {
      const t = liveEntity(state, pr.targetId);
      if (t !== null) {
        const c = entityCenter(t, data);
        pr.dest.x = c.x;
        pr.dest.y = c.y;
      } else {
        pr.targetId = null; // continue to the last known position
      }
    }

    const dx = pr.dest.x - pr.pos.x;
    const dy = pr.dest.y - pr.pos.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= pr.speed) {
      pr.pos.x = pr.dest.x;
      pr.pos.y = pr.dest.y;
      impactProjectile(state, data, pr, memo, events);
      memo.projShooter.delete(pr.id);
      continue; // consumed
    }
    pr.pos.x += (dx / d) * pr.speed;
    pr.pos.y += (dy / d) * pr.speed;
    projs[write++] = pr;
  }
  projs.length = write;

  pruneMemos(state, memo);
}
