// =============================================================================
// POCKET ALERT — tuning constants. Balance lives here and in src/data/*.
// =============================================================================

import { ArmorClass, Element, WeaponClass } from './types';

// --- Simulation ---------------------------------------------------------------

export const TICK_RATE = 15; // sim ticks per second
export const TICK_MS = 1000 / TICK_RATE;

export const secondsToTicks = (s: number): number => Math.round(s * TICK_RATE);

// --- Isometric projection -------------------------------------------------------
// screenX = (x - y) * TILE_HALF_W ; screenY = (x + y) * TILE_HALF_H

export const TILE_W = 64;
export const TILE_H = 32;
export const TILE_HALF_W = TILE_W / 2;
export const TILE_HALF_H = TILE_H / 2;

export const MAP_SIZES: Record<'S' | 'M' | 'L', number> = { S: 56, M: 72, L: 96 };

// --- Economy --------------------------------------------------------------------

export const STARTING_CREDITS = 10000;
export const CRYSTAL_PER_TILE = 5000; // total value of a fresh crystal tile
export const HARVEST_PER_TICK = 25; // crystal mined per tick while harvesting
export const UNLOAD_PER_TICK = 80; // credits banked per tick at refinery
export const LOW_POWER_BUILD_FACTOR = 0.4; // production speed when power is low
export const SELL_REFUND = 0.5; // fraction of cost refunded
export const REPAIR_HP_PER_TICK = 2; // building repair speed
export const REPAIR_COST_PER_HP = 0.25; // credits per hp repaired
export const REPAIR_DEPOT_HP_PER_TICK = 3; // free healing near repair depot
export const REPAIR_DEPOT_RANGE = 3; // tiles

// --- Combat ---------------------------------------------------------------------

// damageMultiplier[weaponClass][armorClass]
export const WEAPON_VS_ARMOR: number[][] = [
  // LIGHT MEDIUM HEAVY BUILDING
  [1.25, 0.75, 0.5, 0.5], // CLAW
  [0.7, 1.25, 1.0, 0.8], // CANNON
  [0.8, 0.9, 0.9, 1.5], // BLAST
  [1.0, 1.0, 0.9, 0.7], // PIERCE
];

// elementMultiplier(attacker, defender)
export function elementMultiplier(atk: Element, def: Element): number {
  if (atk === Element.FIRE && def === Element.GRASS) return 1.25;
  if (atk === Element.GRASS && def === Element.WATER) return 1.25;
  if (atk === Element.WATER && def === Element.FIRE) return 1.25;
  if (atk === Element.FIRE && def === Element.WATER) return 0.8;
  if (atk === Element.WATER && def === Element.GRASS) return 0.8;
  if (atk === Element.GRASS && def === Element.FIRE) return 0.8;
  if (atk === Element.ELECTRIC && def === Element.WATER) return 1.25;
  return 1.0;
}

export const VET_DAMAGE_BONUS = [1.0, 1.25, 1.5]; // by VetRank
export const VET_KILL_THRESHOLDS = [3, 8]; // kills to reach VETERAN, ELITE
export const ELITE_SELFHEAL_PER_TICK = 0.5; // hp/tick for elite units
export const SPLASH_FALLOFF = 0.5; // damage fraction at splash edge

// --- Building / placement --------------------------------------------------------

export const BUILD_RADIUS = 7; // tiles from any own building edge
export const CAPTURE_TICKS = secondsToTicks(5); // engineer capture channel time
export const UNDER_ATTACK_COOLDOWN = secondsToTicks(15); // announcer dedupe

// --- Fog of war -------------------------------------------------------------------

export const SHROUD_NONE = 0;
export const SHROUD_EXPLORED = 1;
export const SHROUD_VISIBLE = 2;

// --- Limits -----------------------------------------------------------------------

export const MAX_UNITS_PER_PLAYER = 120;
export const MAX_QUEUE_LENGTH = 8;

// --- AI ---------------------------------------------------------------------------

export const AI_THINK_INTERVAL: Record<'easy' | 'medium' | 'hard', number> = {
  easy: secondsToTicks(3),
  medium: secondsToTicks(1.5),
  hard: secondsToTicks(0.75),
};
