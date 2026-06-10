// =============================================================================
// POCKET ALERT — complete building roster: 15 keys x 3 factions = 45 defs.
// Ids follow `<faction>_<key>` (e.g. 'tide_navalyard'). Stats are identical
// across factions for a given key (faction quirks apply to units only);
// names, blurbs and projectile flavor vary.
// =============================================================================

import { ArmorClass, WeaponClass } from '../core/types';
import type { BuildingDef, FactionId, ProductionTab, WeaponDef } from '../core/types';
import { secondsToTicks } from '../core/constants';

const bt = (cost: number): number => secondsToTicks(cost / 30);

const FACTION_IDS: FactionId[] = ['scorch', 'tide', 'verdant'];

interface BuildingWeaponSpec {
  damage: number;
  range: number;
  cooldown: number;
  weaponClass: WeaponClass;
  splashRadius: number;
  canTargetGround: boolean;
  canTargetAir: boolean;
  // projectile flavor varies per faction (beam vs lobbed shot)
  projectileSpeed: Record<FactionId, number>;
}

interface BuildingSpec {
  key: string;
  names: Record<FactionId, string>;
  blurbs: Record<FactionId, string>;
  tab: Extract<ProductionTab, 'structure' | 'defense'>;
  cost: number;
  hp: number;
  sight: number;
  footprint: { w: number; h: number };
  power: number;
  // prerequisite keys (faction prefix applied automatically); ConYard implied
  prereqKeys: string[];
  // depth in the tech tree, drives uiOrder = depth*10000 + cost
  depth: number;
  needsPower?: boolean;
  isConYard?: boolean;
  isRefinery?: boolean;
  isRadar?: boolean;
  isTechLab?: boolean;
  isRepairDepot?: boolean;
  producesTabs?: ProductionTab[];
  placeOnWater?: boolean;
  // superweapon id per faction (sw building only)
  superweaponIds?: Record<FactionId, string>;
  weapon?: BuildingWeaponSpec;
}

const SPECS: BuildingSpec[] = [
  {
    key: 'conyard',
    names: { scorch: 'Ember Citadel', tide: 'Tide Citadel', verdant: 'Grove Citadel' },
    blurbs: {
      scorch: 'Obsidian nerve center — the war starts and ends here, preferably with lava.',
      tide: 'Coral command spire; runs the entire war without spilling its water.',
      verdant: 'A fortress that grew here on purpose. Headquarters with deep roots.',
    },
    tab: 'structure',
    cost: 3000, // rebuildable expansion HQ (MCV-priced); requires a factory
    hp: 1500,
    sight: 8,
    footprint: { w: 3, h: 3 },
    power: 50,
    prereqKeys: ['factory'],
    depth: 3,
    isConYard: true,
    producesTabs: ['structure', 'defense'],
  },
  {
    key: 'power',
    names: { scorch: 'Geothermal Den', tide: 'Tidal Generator', verdant: 'Sunbloom Grove' },
    blurbs: {
      scorch: "Taps the planet's anger issues for clean-ish energy.",
      tide: 'Moon-powered turbines. The moon was not consulted.',
      verdant: 'Sunflowers doing energy-sector work for free.',
    },
    tab: 'structure',
    cost: 600,
    hp: 750,
    sight: 5,
    footprint: { w: 2, h: 2 },
    power: 150,
    prereqKeys: [],
    depth: 1,
  },
  {
    key: 'refinery',
    names: { scorch: 'Candy Smeltery', tide: 'Candy Distillery', verdant: 'Candy Arbor' },
    blurbs: {
      scorch: 'Melts rare candy into cold, hard credits. Smells like burnt sugar.',
      tide: 'Triple-distilled crystal candy, aged into pure liquidity.',
      verdant: 'Composts crystal candy into credits. Organic, free-range economics.',
    },
    tab: 'structure',
    cost: 2000,
    hp: 1200,
    sight: 6,
    footprint: { w: 3, h: 2 },
    power: -50,
    prereqKeys: [],
    depth: 1,
    isRefinery: true, // spawns a free harvester when built
  },
  {
    key: 'barracks',
    names: { scorch: 'Ember Hatchery', tide: 'Tide Hatchery', verdant: 'Grove Hatchery' },
    blurbs: {
      scorch: 'Incubates angry critters at fire-code-violating temperatures.',
      tide: 'Spawns disciplined troopers. The water is fine; the troopers are not.',
      verdant: 'Sprouts soldiers by the seed packet. Just add water and rage.',
    },
    tab: 'structure',
    cost: 500,
    hp: 800,
    sight: 6,
    footprint: { w: 2, h: 2 },
    power: -25,
    prereqKeys: [],
    depth: 1,
    producesTabs: ['infantry'],
  },
  {
    key: 'factory',
    names: { scorch: 'Evolution Forge', tide: 'Evolution Bay', verdant: 'Evolution Glade' },
    blurbs: {
      scorch: 'Hammers creatures into bigger, angrier creatures. Sparks included.',
      tide: 'Precision creature engineering with a sea-view warranty.',
      verdant: 'Where creatures grow into their second, much worse form.',
    },
    tab: 'structure',
    cost: 2000,
    hp: 1250,
    sight: 6,
    footprint: { w: 3, h: 3 },
    power: -50,
    prereqKeys: ['refinery'],
    depth: 2,
    producesTabs: ['vehicle'],
  },
  {
    key: 'radar',
    names: { scorch: 'Scout Perch', tide: 'Scout Perch', verdant: 'Scout Perch' },
    blurbs: {
      scorch: 'A very tall perch with a very nosy firebird. Unlocks tier-2 toys.',
      tide: 'All-seeing seabird HQ; gossips about enemy movements in real time.',
      verdant: 'The canopy sees all. The canopy tells all. Tier 2 unlocked.',
    },
    tab: 'structure',
    cost: 1200,
    hp: 900,
    sight: 9,
    footprint: { w: 2, h: 2 },
    power: -50,
    prereqKeys: ['refinery'],
    depth: 2,
    needsPower: true,
    isRadar: true, // tier-2 gate
  },
  {
    key: 'airpad',
    names: { scorch: 'Sky Roost', tide: 'Sky Roost', verdant: 'Sky Roost' },
    blurbs: {
      scorch: 'Flaming wings park here between arson runs.',
      tide: 'Gull traffic control: takeoffs hourly, landings optional.',
      verdant: 'A cozy roost for birds with bombing licenses.',
    },
    tab: 'structure',
    cost: 1000,
    hp: 850,
    sight: 6,
    footprint: { w: 2, h: 2 },
    power: -50,
    prereqKeys: ['radar'],
    depth: 3,
    producesTabs: ['air'],
  },
  {
    key: 'navalyard',
    names: { scorch: 'Reef Dock', tide: 'Grand Marina', verdant: 'Lily Dock' },
    blurbs: {
      scorch: "Launches lava-powered hulls that really shouldn't float, yet do.",
      tide: 'Five-star berths for the finest fleet on any tide.',
      verdant: 'Shipwright services by ducks, for ducks. Surprisingly seaworthy.',
    },
    tab: 'structure',
    cost: 1000,
    hp: 1100,
    sight: 6,
    footprint: { w: 3, h: 3 },
    power: -50,
    prereqKeys: ['refinery'],
    depth: 2,
    placeOnWater: true,
    producesTabs: ['naval'],
  },
  {
    key: 'techlab',
    names: { scorch: 'Master Lab', tide: 'Master Lab', verdant: 'Master Lab' },
    blurbs: {
      scorch: 'Forbidden science, mandatory oven mitts. Tier 3 unlocked.',
      tide: 'Peer-reviewed superweapons and tier-3 tech, served ice cold.',
      verdant: 'Botany taken much, much too far. Tier 3 unlocked.',
    },
    tab: 'structure',
    cost: 2500,
    hp: 900,
    sight: 6,
    footprint: { w: 2, h: 2 },
    power: -100,
    prereqKeys: ['radar', 'factory'],
    depth: 3,
    isTechLab: true, // tier-3 + superweapon gate
  },
  {
    key: 'repair',
    names: { scorch: 'Care Center', tide: 'Care Center', verdant: 'Care Center' },
    blurbs: {
      scorch: 'Pink roof, white cross, fireproof bandages. Creatures leave good as new.',
      tide: 'Spa day for battle damage; nurses certified in hull and shell.',
      verdant: 'Kisses dents better with bandages and chlorophyll.',
    },
    tab: 'structure',
    cost: 1200,
    hp: 1000,
    sight: 6,
    footprint: { w: 3, h: 3 },
    power: -25,
    prereqKeys: ['factory'],
    depth: 3,
    isRepairDepot: true,
  },
  {
    key: 'wall',
    names: { scorch: 'Obsidian Wall', tide: 'Coral Wall', verdant: 'Bramble Wall' },
    blurbs: {
      scorch: 'Cooled lava with a grudge. Walks not, blocks always.',
      tide: 'Grown, not built. The reef holds the line.',
      verdant: 'A hedge with strong opinions about trespassing.',
    },
    tab: 'defense',
    cost: 75,
    hp: 400,
    sight: 1,
    footprint: { w: 1, h: 1 },
    power: 0,
    prereqKeys: [],
    depth: 1,
  },
  {
    key: 'def_basic',
    names: { scorch: 'Ember Turret', tide: 'Bubble Cannon', verdant: 'Thorn Turret' },
    blurbs: {
      scorch: 'Point-defense flame mortar; warranty void if touched.',
      tide: 'Fires artisanal high-pressure bubbles. They pop tanks.',
      verdant: 'Spits thorns at trespassers. The garden bites back.',
    },
    tab: 'defense',
    cost: 600,
    hp: 500,
    sight: 8,
    footprint: { w: 1, h: 1 },
    power: -10,
    prereqKeys: ['barracks'],
    depth: 2,
    weapon: {
      damage: 13,
      range: 6.5,
      cooldown: 24,
      weaponClass: WeaponClass.CANNON,
      splashRadius: 0,
      canTargetGround: true,
      canTargetAir: false,
      projectileSpeed: { scorch: 0.6, tide: 0.6, verdant: 0.6 },
    },
  },
  {
    key: 'def_adv',
    names: { scorch: 'Flame Spout', tide: 'Hydro Prism', verdant: 'Razorleaf Launcher' },
    blurbs: {
      scorch: "A tame mini-volcano. 'Tame' is doing heavy lifting.",
      tide: 'Refracts seawater into a beam of pure plumbing violence.',
      verdant: 'A leaf blower rated for war crimes.',
    },
    tab: 'defense',
    cost: 1200,
    hp: 700,
    sight: 8,
    footprint: { w: 1, h: 1 },
    power: -50,
    prereqKeys: ['radar'],
    depth: 3,
    needsPower: true,
    weapon: {
      damage: 30,
      range: 7,
      cooldown: 30,
      weaponClass: WeaponClass.BLAST,
      splashRadius: 1.0,
      canTargetGround: true,
      canTargetAir: false,
      projectileSpeed: { scorch: 0.5, tide: 99, verdant: 0.6 }, // Hydro Prism is a beam
    },
  },
  {
    key: 'def_aa',
    names: { scorch: 'Skyspark Tower', tide: 'Geyser Battery', verdant: 'Sporeflak Pod' },
    blurbs: {
      scorch: 'A lightning rod that returns to sender.',
      tide: 'Anti-air plumbing: yeets boiling seawater at pilots.',
      verdant: 'Pollen season, concentrated, aimed upward.',
    },
    tab: 'defense',
    cost: 800,
    hp: 550,
    sight: 8,
    footprint: { w: 1, h: 1 },
    power: -25,
    prereqKeys: ['radar'],
    depth: 3,
    weapon: {
      damage: 9,
      range: 7,
      cooldown: 12,
      weaponClass: WeaponClass.PIERCE,
      splashRadius: 0,
      canTargetGround: false,
      canTargetAir: true,
      projectileSpeed: { scorch: 99, tide: 0.9, verdant: 0.9 }, // Skyspark zaps instantly
    },
  },
  {
    key: 'sw',
    names: { scorch: 'Volcano Silo', tide: 'Tide Temple', verdant: 'The Great Tree' },
    blurbs: {
      scorch: 'Stores one (1) apocalypse. A fresh eruption every five and a half minutes.',
      tide: 'Prays to the moon for an eight-second weather apocalypse.',
      verdant: 'Old growth, older grudge. Blooms a sporestorm on command.',
    },
    tab: 'structure',
    cost: 3000,
    hp: 1000,
    sight: 6,
    footprint: { w: 3, h: 3 },
    power: -150,
    prereqKeys: ['techlab'],
    depth: 4,
    superweaponIds: { scorch: 'magma_strike', tide: 'tsunami_surge', verdant: 'sporestorm' },
  },
];

function buildWeapon(spec: BuildingWeaponSpec, faction: FactionId): WeaponDef {
  return {
    damage: spec.damage,
    range: spec.range,
    cooldown: spec.cooldown,
    weaponClass: spec.weaponClass,
    projectileSpeed: spec.projectileSpeed[faction],
    splashRadius: spec.splashRadius,
    canTargetGround: spec.canTargetGround,
    canTargetAir: spec.canTargetAir,
  };
}

export const BUILDINGS: Record<string, BuildingDef> = {};

for (const spec of SPECS) {
  for (const faction of FACTION_IDS) {
    const id = `${faction}_${spec.key}`;
    const def: BuildingDef = {
      id,
      name: spec.names[faction],
      blurb: spec.blurbs[faction],
      faction,
      tab: spec.tab,
      cost: spec.cost,
      buildTicks: bt(spec.cost),
      hp: spec.hp,
      sight: spec.sight,
      footprint: { w: spec.footprint.w, h: spec.footprint.h },
      power: spec.power,
      armor: ArmorClass.BUILDING,
      prerequisites: spec.prereqKeys.map((k) => `${faction}_${k}`),
      spriteKey: id,
      uiOrder: spec.depth * 10000 + spec.cost,
    };
    if (spec.weapon !== undefined) def.weapon = buildWeapon(spec.weapon, faction);
    if (spec.needsPower) def.needsPower = true;
    if (spec.isConYard) def.isConYard = true;
    if (spec.isRefinery) def.isRefinery = true;
    if (spec.isRadar) def.isRadar = true;
    if (spec.isTechLab) def.isTechLab = true;
    if (spec.isRepairDepot) def.isRepairDepot = true;
    if (spec.producesTabs !== undefined) def.producesTabs = [...spec.producesTabs];
    if (spec.placeOnWater) def.placeOnWater = true;
    if (spec.superweaponIds !== undefined) def.superweaponId = spec.superweaponIds[faction];
    BUILDINGS[id] = def;
  }
}
