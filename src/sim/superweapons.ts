// =============================================================================
// POCKET ALERT — sim/superweapons.ts (Owner B)
// Superweapon charging, ready events and launches.
//
// Delayed strike effects are encoded as special marker Projectiles with
// sourceDefId 'sw_<superweaponId>' pushed into state.projectiles; the normal
// projectile pipeline (sim/combat.ts updateProjectiles) moves them and applies
// impact damage, which keeps all pending effects inside GameState (replay /
// serialization safe). Marker speeds are tuned so each strike arrives at its
// scheduled tick. All randomness via simRandom(state).
// =============================================================================

import type {
  Entity,
  GameData,
  GameEvent,
  GameState,
  PlayerId,
  Projectile,
  SuperweaponDef,
  Vec2,
} from '../core/types';
import { Element, WeaponClass, entityCenter } from '../core/types';
import { simRandom } from '../core/rng';

/** Number of bolts in a 'storm' launch (DESIGN.md: ~14 over 8s). */
const STORM_STRIKES = 14;
/** Splash radius of an individual storm bolt. */
const STORM_BOLT_SPLASH = 1.6;
/** Number of damage pulses in a 'spore' launch (DESIGN.md: 15s field, 25/s). */
const SPORE_PULSES = 15;
/** Visual drop heights (tiles) the marker projectiles fall from. */
const NUKE_DROP_HEIGHT = 18;
const STORM_DROP_HEIGHT = 9;
const SPORE_DROP_HEIGHT = 8;

/** Marker prefix; renderer/effects key off sourceDefId === 'sw_<id>'. */
function markerId(swId: string): string {
  return 'sw_' + swId;
}

/** Find a player's operational superweapon building (built, alive). */
function findSwBuilding(
  state: GameState,
  data: GameData,
  player: PlayerId,
): { building: Entity; swId: string } | null {
  for (const e of state.entities.values()) {
    if (e.owner !== player || e.kind !== 'building' || e.hp <= 0) continue;
    if (e.buildProgress < 1) continue;
    const def = data.buildings[e.defId];
    if (def === undefined || def.superweaponId === undefined) continue;
    return { building: e, swId: def.superweaponId };
  }
  return null;
}

/**
 * Per-tick superweapon bookkeeping for every player: initialize the charge
 * when an operational superweapon building exists, emit `superweaponReady`
 * exactly once when the charge completes, and clear the slot when the
 * building is gone. Mirrors readyAtTick onto the building's swChargeTick so
 * the renderer/sidebar can show the countdown.
 */
export function updateSuperweapons(state: GameState, data: GameData, events: GameEvent[]): void {
  for (let i = 0; i < state.players.length; i++) {
    const p = state.players[i];
    if (p.eliminated) {
      p.superweapon = null;
      continue;
    }
    const found = findSwBuilding(state, data, p.id);
    if (found === null) {
      p.superweapon = null;
      continue;
    }
    const swDef = data.superweapons[found.swId];
    if (swDef === undefined) {
      p.superweapon = null;
      continue;
    }
    if (p.superweapon === null || p.superweapon.defId !== found.swId) {
      p.superweapon = {
        defId: found.swId,
        readyAtTick: state.tick + swDef.chargeTicks,
        charging: true,
      };
    }
    if (p.superweapon.charging && state.tick >= p.superweapon.readyAtTick) {
      p.superweapon.charging = false;
      events.push({ type: 'superweaponReady', player: p.id, defId: found.swId });
    }
    found.building.swChargeTick = p.superweapon.readyAtTick;
  }
}

function spawnMarker(
  state: GameState,
  owner: PlayerId,
  swId: string,
  origin: Vec2,
  dest: Vec2,
  arriveTicks: number,
  damage: number,
  weaponClass: WeaponClass,
  element: Element,
  splashRadius: number,
): void {
  const dx = dest.x - origin.x;
  const dy = dest.y - origin.y;
  const d = Math.max(0.001, Math.sqrt(dx * dx + dy * dy));
  const ticks = Math.max(1, arriveTicks);
  const proj: Projectile = {
    id: state.nextProjectileId++,
    pos: { x: origin.x, y: origin.y },
    dest: { x: dest.x, y: dest.y },
    targetId: null,
    speed: d / ticks, // always far below the >=90 instant-beam threshold
    damage,
    weaponClass,
    element,
    splashRadius,
    owner,
    sourceDefId: markerId(swId),
    isAirTarget: false, // superweapons strike the surface layer
  };
  state.projectiles.push(proj);
}

function launchNuke(
  state: GameState,
  data: GameData,
  player: PlayerId,
  swDef: SuperweaponDef,
  target: Vec2,
): void {
  // Launch visually from the silo when it exists, arcing in over ~3s.
  const found = findSwBuilding(state, data, player);
  const origin: Vec2 =
    found !== null
      ? entityCenter(found.building, data)
      : { x: target.x, y: target.y - NUKE_DROP_HEIGHT };
  // Keep a minimum travel distance so very close shots still read as a launch.
  if (Math.abs(origin.x - target.x) < 2 && Math.abs(origin.y - target.y) < 2) {
    origin.y = target.y - NUKE_DROP_HEIGHT;
  }
  spawnMarker(
    state,
    player,
    swDef.id,
    origin,
    target,
    Math.max(1, swDef.durationTicks), // ~3s incoming warning / travel
    swDef.damage, // 900 at epicenter, linear falloff to edge via splash rules
    WeaponClass.BLAST,
    Element.FIRE,
    swDef.radius,
  );
}

function launchStorm(
  state: GameState,
  data: GameData,
  player: PlayerId,
  swDef: SuperweaponDef,
  target: Vec2,
): void {
  void data;
  const w = state.map.w;
  const h = state.map.h;
  for (let i = 0; i < STORM_STRIKES; i++) {
    // Random point in the storm radius (area-uniform), clamped in-bounds.
    const angle = simRandom(state) * Math.PI * 2;
    const r = Math.sqrt(simRandom(state)) * swDef.radius;
    const px = Math.min(w - 0.5, Math.max(0.5, target.x + Math.cos(angle) * r));
    const py = Math.min(h - 0.5, Math.max(0.5, target.y + Math.sin(angle) * r));
    // Stagger arrivals evenly across the storm duration (~8s).
    const arrive = Math.max(1, Math.round(((i + 1) / STORM_STRIKES) * swDef.durationTicks));
    spawnMarker(
      state,
      player,
      swDef.id,
      { x: px, y: py - STORM_DROP_HEIGHT },
      { x: px, y: py },
      arrive,
      swDef.damage, // 180 per bolt
      WeaponClass.BLAST,
      Element.WATER,
      STORM_BOLT_SPLASH,
    );
  }
}

function launchSpore(
  state: GameState,
  data: GameData,
  player: PlayerId,
  swDef: SuperweaponDef,
  target: Vec2,
): void {
  void data;
  const pulseDamage = Math.max(1, Math.round(swDef.damage / SPORE_PULSES)); // ~25 per pulse
  for (let i = 0; i < SPORE_PULSES; i++) {
    // One field-wide pulse roughly every second for the full duration (~15s).
    const arrive = Math.max(1, Math.round(((i + 1) / SPORE_PULSES) * swDef.durationTicks));
    spawnMarker(
      state,
      player,
      swDef.id,
      { x: target.x, y: target.y - SPORE_DROP_HEIGHT },
      { x: target.x, y: target.y },
      arrive,
      pulseDamage,
      WeaponClass.PIERCE,
      Element.GRASS,
      swDef.radius, // each pulse covers the whole field
    );
  }
}

/**
 * Fire a player's superweapon at `target` (tile coords). Only succeeds when
 * the charge is complete; emits `superweaponLaunched`, encodes the delayed
 * strikes as marker projectiles, then restarts the charge.
 */
export function launchSuperweapon(
  state: GameState,
  data: GameData,
  player: PlayerId,
  target: Vec2,
  events: GameEvent[],
): void {
  const p = state.players[player];
  if (p === undefined || p.eliminated) return;
  const sw = p.superweapon;
  if (sw === null || sw.charging || state.tick < sw.readyAtTick) return;
  const swDef = data.superweapons[sw.defId];
  if (swDef === undefined) return;

  // Snap the target to a tile center inside the map.
  const tx = Math.min(state.map.w - 1, Math.max(0, Math.floor(target.x))) + 0.5;
  const ty = Math.min(state.map.h - 1, Math.max(0, Math.floor(target.y))) + 0.5;
  const tgt: Vec2 = { x: tx, y: ty };

  events.push({
    type: 'superweaponLaunched',
    byPlayer: player,
    defId: sw.defId,
    target: { x: tgt.x, y: tgt.y },
  });

  switch (swDef.kind) {
    case 'nuke':
      launchNuke(state, data, player, swDef, tgt);
      break;
    case 'storm':
      launchStorm(state, data, player, swDef, tgt);
      break;
    case 'spore':
      launchSpore(state, data, player, swDef, tgt);
      break;
  }

  // Restart the charge cycle.
  p.superweapon = {
    defId: sw.defId,
    readyAtTick: state.tick + swDef.chargeTicks,
    charging: true,
  };
  const found = findSwBuilding(state, data, player);
  if (found !== null) found.building.swChargeTick = p.superweapon.readyAtTick;
}
