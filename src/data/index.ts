// =============================================================================
// POCKET ALERT — game data assembly + validation.
// Exports the fully populated, validated GameData. Validation runs at module
// init and throws a descriptive Error on any contract violation so bad data
// can never reach the sim.
// =============================================================================

import type { BuildingDef, FactionId, GameData, ProductionTab, UnitDef, WeaponDef } from '../core/types';
import { FACTIONS, SUPERWEAPONS } from './factions';
import { UNITS } from './units';
import { BUILDINGS } from './buildings';

const FACTION_IDS: FactionId[] = ['scorch', 'tide', 'verdant'];
const UNIT_TABS: ProductionTab[] = ['infantry', 'vehicle', 'air', 'naval'];
const BUILDING_TABS: ProductionTab[] = ['structure', 'defense'];

const EXPECTED_UNIT_COUNT = 41;
const EXPECTED_BUILDING_COUNT = 45; // 15 keys x 3 factions
const EXPECTED_SUPERWEAPON_COUNT = 3;

function validateWeapon(owner: string, w: WeaponDef, problems: string[]): void {
  if (w.damage <= 0) problems.push(`${owner}: weapon damage must be > 0 (got ${w.damage})`);
  if (w.range <= 0) problems.push(`${owner}: weapon range must be > 0 (got ${w.range})`);
  if (w.cooldown <= 0) problems.push(`${owner}: weapon cooldown must be > 0 (got ${w.cooldown})`);
  if (w.projectileSpeed <= 0) problems.push(`${owner}: projectileSpeed must be > 0 (got ${w.projectileSpeed})`);
  if (w.splashRadius < 0) problems.push(`${owner}: splashRadius must be >= 0 (got ${w.splashRadius})`);
  if (!w.canTargetGround && !w.canTargetAir) {
    problems.push(`${owner}: weapon can target neither ground nor air`);
  }
  if (w.burst !== undefined && w.burst < 1) problems.push(`${owner}: burst must be >= 1 (got ${w.burst})`);
}

function validate(data: GameData): void {
  const problems: string[] = [];
  const unitList = Object.values(data.units);
  const buildingList = Object.values(data.buildings);
  const swList = Object.values(data.superweapons);

  // --- counts -----------------------------------------------------------------
  if (unitList.length !== EXPECTED_UNIT_COUNT) {
    problems.push(`expected ${EXPECTED_UNIT_COUNT} units, found ${unitList.length}`);
  }
  if (buildingList.length !== EXPECTED_BUILDING_COUNT) {
    problems.push(`expected ${EXPECTED_BUILDING_COUNT} buildings, found ${buildingList.length}`);
  }
  if (swList.length !== EXPECTED_SUPERWEAPON_COUNT) {
    problems.push(`expected ${EXPECTED_SUPERWEAPON_COUNT} superweapons, found ${swList.length}`);
  }
  for (const f of FACTION_IDS) {
    if (!(f in data.factions)) problems.push(`missing faction '${f}'`);
  }

  // --- factions ----------------------------------------------------------------
  for (const f of Object.values(data.factions)) {
    if (!(f.superweaponId in data.superweapons)) {
      problems.push(`faction '${f.id}': superweaponId '${f.superweaponId}' does not exist`);
    }
  }

  // --- superweapons -------------------------------------------------------------
  for (const [key, sw] of Object.entries(data.superweapons)) {
    if (sw.id !== key) problems.push(`superweapon key '${key}' != id '${sw.id}'`);
    if (sw.chargeTicks <= 0) problems.push(`superweapon '${key}': chargeTicks must be > 0`);
    if (sw.radius <= 0) problems.push(`superweapon '${key}': radius must be > 0`);
    if (sw.damage <= 0) problems.push(`superweapon '${key}': damage must be > 0`);
    if (sw.durationTicks <= 0) problems.push(`superweapon '${key}': durationTicks must be > 0`);
  }

  // --- shared def checks ----------------------------------------------------------
  const checkCommon = (kind: string, key: string, d: UnitDef | BuildingDef): void => {
    const where = `${kind} '${key}'`;
    if (d.id !== key) problems.push(`${where}: record key != def id '${d.id}'`);
    if (d.spriteKey !== d.id) problems.push(`${where}: spriteKey '${d.spriteKey}' must equal id`);
    if (!d.id.startsWith(`${d.faction}_`)) {
      problems.push(`${where}: id must be prefixed with faction '${d.faction}_'`);
    }
    if (!FACTION_IDS.includes(d.faction)) problems.push(`${where}: unknown faction '${d.faction}'`);
    if (d.cost <= 0) problems.push(`${where}: cost must be > 0 (got ${d.cost})`);
    if (d.buildTicks <= 0) problems.push(`${where}: buildTicks must be > 0 (got ${d.buildTicks})`);
    if (d.hp <= 0) problems.push(`${where}: hp must be > 0 (got ${d.hp})`);
    if (d.sight < 0) problems.push(`${where}: sight must be >= 0 (got ${d.sight})`);
    if (d.name.length === 0) problems.push(`${where}: empty name`);
    if (d.blurb.length === 0) problems.push(`${where}: empty blurb`);
    for (const p of d.prerequisites) {
      const pre = data.buildings[p];
      if (pre === undefined) {
        problems.push(`${where}: prerequisite '${p}' is not a known building def`);
      } else if (pre.faction !== d.faction) {
        problems.push(`${where}: prerequisite '${p}' belongs to faction '${pre.faction}'`);
      }
    }
  };

  // Which tabs does each faction have a producer for?
  const producedTabs = new Map<FactionId, Set<ProductionTab>>();
  for (const f of FACTION_IDS) producedTabs.set(f, new Set());
  for (const b of buildingList) {
    if (b.producesTabs === undefined) continue;
    const set = producedTabs.get(b.faction);
    if (set !== undefined) for (const t of b.producesTabs) set.add(t);
  }

  // --- units -----------------------------------------------------------------------
  for (const [key, u] of Object.entries(data.units)) {
    const where = `unit '${key}'`;
    checkCommon('unit', key, u);
    if (!UNIT_TABS.includes(u.tab)) problems.push(`${where}: invalid unit tab '${u.tab}'`);
    if (u.speed <= 0) problems.push(`${where}: speed must be > 0 (got ${u.speed})`);
    if (u.harvester !== undefined) {
      if (u.harvester.capacity <= 0) problems.push(`${where}: harvester capacity must be > 0`);
      if (u.weapon !== undefined) problems.push(`${where}: harvesters must be unarmed`);
    }
    if (u.engineer === true && u.weapon !== undefined) {
      problems.push(`${where}: engineers must be unarmed`);
    }
    if (u.weapon !== undefined) validateWeapon(where, u.weapon, problems);
    const tabs = producedTabs.get(u.faction);
    if (tabs !== undefined && !tabs.has(u.tab)) {
      problems.push(`${where}: no '${u.faction}' building produces tab '${u.tab}'`);
    }
  }

  // --- buildings ----------------------------------------------------------------------
  for (const [key, b] of Object.entries(data.buildings)) {
    const where = `building '${key}'`;
    checkCommon('building', key, b);
    if (!BUILDING_TABS.includes(b.tab)) problems.push(`${where}: invalid building tab '${b.tab}'`);
    if (b.footprint.w < 1 || b.footprint.h < 1) {
      problems.push(`${where}: footprint must be at least 1x1`);
    }
    if (b.weapon !== undefined) validateWeapon(where, b.weapon, problems);
    if (b.superweaponId !== undefined && !(b.superweaponId in data.superweapons)) {
      problems.push(`${where}: superweaponId '${b.superweaponId}' does not exist`);
    }
    if (b.producesTabs !== undefined) {
      for (const t of b.producesTabs) {
        if (!UNIT_TABS.includes(t) && !BUILDING_TABS.includes(t)) {
          problems.push(`${where}: producesTabs contains invalid tab '${t}'`);
        }
      }
    }
    // buildings themselves must be producible: someone must produce their tab
    const tabs = producedTabs.get(b.faction);
    if (tabs !== undefined && !tabs.has(b.tab)) {
      problems.push(`${where}: no '${b.faction}' building produces tab '${b.tab}'`);
    }
  }

  // --- per-faction completeness ------------------------------------------------------
  for (const f of FACTION_IDS) {
    const fBuildings = buildingList.filter((b) => b.faction === f);
    const fUnits = unitList.filter((u) => u.faction === f);
    const countFlag = (pred: (b: BuildingDef) => boolean): number => fBuildings.filter(pred).length;

    if (countFlag((b) => b.isConYard === true) !== 1) problems.push(`faction '${f}': must have exactly 1 ConYard`);
    if (countFlag((b) => b.isRefinery === true) !== 1) problems.push(`faction '${f}': must have exactly 1 refinery`);
    if (countFlag((b) => b.isRadar === true) !== 1) problems.push(`faction '${f}': must have exactly 1 radar`);
    if (countFlag((b) => b.isTechLab === true) !== 1) problems.push(`faction '${f}': must have exactly 1 tech lab`);
    if (countFlag((b) => b.isRepairDepot === true) !== 1) problems.push(`faction '${f}': must have exactly 1 repair depot`);
    if (countFlag((b) => b.placeOnWater === true) !== 1) problems.push(`faction '${f}': must have exactly 1 naval yard`);
    if (fBuildings.length !== 15) problems.push(`faction '${f}': expected 15 buildings, found ${fBuildings.length}`);

    const swBuildings = fBuildings.filter((b) => b.superweaponId !== undefined);
    const factionDef = data.factions[f];
    if (swBuildings.length !== 1) {
      problems.push(`faction '${f}': must have exactly 1 superweapon building (found ${swBuildings.length})`);
    } else {
      const swb = swBuildings[0];
      if (swb !== undefined && swb.superweaponId !== factionDef.superweaponId) {
        problems.push(
          `faction '${f}': superweapon building charges '${String(swb.superweaponId)}' but faction lists '${factionDef.superweaponId}'`,
        );
      }
    }

    if (fUnits.filter((u) => u.harvester !== undefined).length !== 1) {
      problems.push(`faction '${f}': must have exactly 1 harvester unit`);
    }
    if (fUnits.filter((u) => u.engineer === true).length !== 1) {
      problems.push(`faction '${f}': must have exactly 1 engineer unit`);
    }
    // every unit tab must be coverable so all sidebar tabs work
    for (const t of UNIT_TABS) {
      if (!fUnits.some((u) => u.tab === t)) problems.push(`faction '${f}': no units in tab '${t}'`);
    }
  }

  // --- id collisions between units and buildings ----------------------------------------
  for (const id of Object.keys(data.units)) {
    if (id in data.buildings) problems.push(`id '${id}' exists as both unit and building`);
  }

  if (problems.length > 0) {
    throw new Error(`GameData validation failed (${problems.length} problem(s)):\n - ${problems.join('\n - ')}`);
  }
}

export const DATA: GameData = {
  factions: FACTIONS,
  units: UNITS,
  buildings: BUILDINGS,
  superweapons: SUPERWEAPONS,
};

validate(DATA);

/** Look up any unit or building def by id. Throws on unknown ids. */
export function defOf(defId: string): UnitDef | BuildingDef {
  const u = DATA.units[defId];
  if (u !== undefined) return u;
  const b = DATA.buildings[defId];
  if (b !== undefined) return b;
  throw new Error(`Unknown def id: '${defId}'`);
}
