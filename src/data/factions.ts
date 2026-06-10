// =============================================================================
// POCKET ALERT — faction + superweapon definitions.
// Three factions per DESIGN.md. Superweapon defs live here because each
// faction is identified by exactly one superweapon.
// =============================================================================

import { Element } from '../core/types';
import type { FactionDef, FactionId, SuperweaponDef } from '../core/types';
import { secondsToTicks } from '../core/constants';

export const FACTIONS: Record<FactionId, FactionDef> = {
  scorch: {
    id: 'scorch',
    name: 'Scorch Legion',
    element: Element.FIRE,
    superweaponId: 'magma_strike',
    blurb: 'Brute force with a burn ward: heavy armor, heavier tempers, zero fire-safety training.',
    themeColor: '#ff5a2a',
  },
  tide: {
    id: 'tide',
    name: 'Tide Dominion',
    element: Element.WATER,
    superweaponId: 'tsunami_surge',
    blurb: 'High tech, high tide — precision-engineered naval supremacy, served chilled.',
    themeColor: '#2ab4ff',
  },
  verdant: {
    id: 'verdant',
    name: 'Verdant Swarm',
    element: Element.GRASS,
    superweaponId: 'sporestorm',
    blurb: 'The lawn fights back. Cheap, fast, endless — your enemies make great compost.',
    themeColor: '#4ade5a',
  },
};

// Superweapons (see DESIGN.md):
// - magma_strike: 3s incoming warning, then a single epicenter blast.
//   `damage` = epicenter damage; `durationTicks` = incoming-warning travel time.
// - tsunami_surge: storm of ~14 random bolts over `durationTicks`.
//   `damage` = damage of each individual bolt (180 per DESIGN.md).
// - sporestorm: lingering DoT field for `durationTicks`.
//   `damage` = total damage dealt to a ground entity sitting in the field for
//   the full duration (25 dmg/sec * 15 s = 375).
export const SUPERWEAPONS: Record<string, SuperweaponDef> = {
  magma_strike: {
    id: 'magma_strike',
    name: 'Magma Strike',
    chargeTicks: secondsToTicks(330), // 5.5 min
    radius: 6,
    damage: 900,
    kind: 'nuke',
    durationTicks: secondsToTicks(3),
  },
  tsunami_surge: {
    id: 'tsunami_surge',
    name: 'Tsunami Surge',
    chargeTicks: secondsToTicks(330), // 5.5 min
    radius: 7,
    damage: 180, // per bolt, ~14 bolts over the duration
    kind: 'storm',
    durationTicks: secondsToTicks(8),
  },
  sporestorm: {
    id: 'sporestorm',
    name: 'Sporestorm Bloom',
    chargeTicks: secondsToTicks(300), // 5 min
    radius: 6,
    damage: 375, // total over full duration => 25 dmg/sec
    kind: 'spore',
    durationTicks: secondsToTicks(15),
  },
};
