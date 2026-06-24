// All sprite subjects from PROMPTS.md, structured for batch generation.
// Style blocks + faction clauses are applied by the driver (gen.mjs).

export const CREATURE_STYLE =
  'dark fantasy pre-rendered 3D real-time strategy unit sprite, viewed from a 3/4 ' +
  'high isometric camera, single unit centered, full body, realistic armor mass, ' +
  'sharp silhouette, premium Warcraft 3 and StarCraft 2 campaign art direction, ' +
  'lit from the upper left, crisp transparent game asset, no text, no logo, no ground shadow';

export const BUILDING_STYLE =
  'isometric video-game building sprite at a true 2:1 isometric angle (Red Alert 2 ' +
  'style), single structure centered, base sits on a diamond-shaped footprint, soft cel ' +
  'shading lit from the upper left, thin dark outline, saturated colors, clean game ' +
  'asset, no text, no ground plane outside the footprint';

// Original Fable Wars subjects + flat bg for clean keying.
export const DISTINCT = 'original Fable Wars dark fantasy war unit, not cute, not chibi, not mascot-like';
export const FLAT_BG = 'plain solid flat uniform light grey background';

export const FACTION_CLAUSE = {
  scorch: 'built from dark obsidian stone with glowing orange lava seams and ember vents',
  tide: 'built from white coral and aqua glass with flowing water channels',
  verdant: 'built from living wood and moss with leafy canopies and vines',
};

export const UNITS = {
  scorch_charmandar: 'Cinder Imp, a small obsidian ember infantry unit with molten cracks and clawed posture',
  scorch_peekachoo: 'Volt Cinder, a crackling obsidian skirmisher with lava armor plates and lightning arcs',
  scorch_magmarr: 'Magma Brute, heavy furnace-chested infantry with blackened armor and orange core glow',
  scorch_prof_cinder: 'Ash Savant, heat-masked infiltrator in dark robes and brass war tools',
  scorch_torkoala: 'Ember Hauler, slow lava-plated crystal harvester with a furnace shell and ore intake',
  scorch_ryhorrn: 'Basalt Ram, armored shock beast with a lava-lit horn and siege stance',
  scorch_arcanyne: 'Ashrunner, fast Scorch raider beast with black stone plates and ember mane',
  scorch_magnetonn: 'Storm Anvil, magnetized anti-air construct with obsidian shell and orange energy coils',
  scorch_groudonn: 'Caldera Titan, massive volcanic siege monster with horned armor and molten chest',
  scorch_zubattler: 'Cinderwing, charred scout flyer with batlike wings and ember-veined body',
  scorch_moltrez: 'Solar Wyrm, tier-three molten firebird with broad burning wings and black armor bones',
  scorch_magcarggo: 'Slag Barge, naval fire platform carrying a volcanic crystal mortar',
  scorch_slugmariner: 'Ember Nautilus, submerged raider with a dark shell and glowing hot core',

  tide_squirtul: 'Coral Initiate, disciplined Tide infantry wrapped in pale coral armor and aqua glass',
  tide_horsean: 'Rill Lancer, quick aquatic lancer with a spear profile and blue crystal fins',
  tide_polywrath: 'Breaker Guard, close-order Tide infantry with heavy coral gauntlets and wave armor',
  tide_prof_brine: 'Reef Savant, salt-robed infiltrator with surgical tools and blue crystal focus',
  tide_krabber: 'Claw Harvester, resource crawler with coral pincers and crystal cargo frame',
  tide_vaporeonix: 'Glassfin Prowler, fast amphibious hunter with bright fins and sleek aquatic armor',
  tide_blastoyse: 'Coral Bulwark, main battle shellback with pressure cannons and thick reef plates',
  tide_starmiez: 'Prism Array, hovering anti-air focus with a blue refracting crystal core',
  tide_kyogrre: 'Abyss Sovereign, huge Tide siege creature with whale-like mass and runed armor',
  tide_wingullet: 'Reefwing, light interceptor with blade wings and bright water-glass feathers',
  tide_pelipperator: 'Tide Bomber, heavy flyer with storm cargo belly and coral armor plates',
  tide_tentacrush: 'Kraken Skiff, surface raider with grasping coral limbs and close-range fury',
  tide_sharpeedo: 'Razortooth Sub, fast submerged predator with armored prow and blue wake lines',
  tide_gyarrados: 'Leviathan Ark, capital sea serpent warship carrying heavy Tide weaponry',

  verdant_bulbasore: 'Mossling, cheap living-wood infantry grown around a toxic green heart',
  verdant_beedrillz: 'Thorn Wasp, needle-winged interceptor with branch armor and stinger lances',
  verdant_oddishooter: 'Spore Pod, small ranged organism with a leaf crown and glowing spore sacs',
  verdant_scytherr: 'Briar Reaper, blade-limbed assault unit made of bark, thorns, and green light',
  verdant_prof_oakley: 'Root Savant, quiet infiltrator with ritual tools and living-wood armor',
  verdant_torterrar: 'Grove Hauler, harvesting beast with roots for armor and a crystal-fed engine heart',
  verdant_sceptilash: 'Vine Stalker, fast Verdant striker with leaf blades and predatory crouch',
  verdant_venosore: 'Bloom Siege, heavy artillery beast crowned with a war-flower cannon',
  verdant_tanglevine: 'Tangle Mass, creeping ambush unit made of vines, roots, and glowing eyes',
  verdant_snorlux: 'Elder Husk, towering living-wood bruiser with massive bark armor',
  verdant_pidgeottoh: 'Canopy Raptor, air-superiority hunter with branch-bone wings and green-lit eyes',
  verdant_butterfrei: 'Spore Moth, tier-three bomber with dark wings and glowing pollen trails',
  verdant_lotadder: 'Bog Skiff, small naval gunbeast grown around a floating root raft',
  verdant_ludicolossus: 'Mangrove Colossus, Verdant capital ship, half fortress and half overgrown nightmare',
};

// Generic building types (×3 factions). Subject gets the faction clause appended.
export const BUILDING_TYPES = {
  conyard: 'a massive command headquarters with a fortified central tower, construction crane on the roof, glowing power core, the most important building in an RTS base',
  power: 'a power plant with two fat reactor coils wrapped in glowing energy rings, humming with elemental energy',
  refinery: 'a crystal refinery with a tall storage silo, a conveyor belt, and a sparkling pile of cyan and violet rift crystals at its intake',
  barracks: 'a creature hatchery: a domed nest structure with three large speckled eggs nestled at its entrance',
  factory: 'a heavy war factory with a huge open garage door, rooftop crane, chimney vents, wide assembly hall',
  radar: 'a radar outpost with a large rotating dish antenna on a reinforced mast, blinking signal light',
  airpad: 'a flat landing pad with a glowing landing circle painted on it, small control hut and an orange windsock',
  navalyard: 'a naval drydock: two pier arms over open water with a gantry arch spanning them, mooring posts',
  techlab: 'a high-tech research lab with a glowing energy dome and two antenna spires, mysterious light pulsing inside',
  repair: 'a creature Care Center with a friendly pink roof, a white medical cross sign, and a small heart emblem over the door',
  wall: 'a single short segment of fortified wall, chunky and connectable, one tile wide',
  def_basic: 'a compact defensive turret: a rotating barrel cannon mounted on a low armored platform',
  def_adv: 'an advanced elemental defense tower: a tall pylon focusing a glowing energy orb at its tip, crackling with power',
  def_aa: 'an anti-air battery: a rack of three skyward-angled missile launchers on a swivel base, glowing missile tips',
};

// Faction-unique superweapons (clause already embedded).
export const SUPERWEAPONS = {
  scorch_sw: 'a doomsday volcano silo: an artificial volcano caldera brimming with lava, warning lights around the rim, built from dark obsidian with lava seams',
  tide_sw: 'a tsunami temple: a three-tiered white coral temple with a huge glowing water orb levitating above its peak',
  verdant_sw: 'a world-tree superweapon: a colossal ancient tree with a glowing green energy bloom in its canopy, roots gripping the ground',
};

// Build the full {id: prompt} maps the driver consumes.
export function buildUnitPrompts() {
  const out = {};
  for (const [id, subj] of Object.entries(UNITS)) {
    out[id] = `${CREATURE_STYLE}, ${subj}, ${DISTINCT}, ${FLAT_BG}`;
  }
  return out;
}

export function buildBuildingPrompts() {
  const out = {};
  for (const [type, subj] of Object.entries(BUILDING_TYPES)) {
    for (const fac of ['scorch', 'tide', 'verdant']) {
      out[`${fac}_${type}`] = `${BUILDING_STYLE}, ${subj}, ${FACTION_CLAUSE[fac]}, ${FLAT_BG}`;
    }
  }
  for (const [id, subj] of Object.entries(SUPERWEAPONS)) {
    out[id] = `${BUILDING_STYLE}, ${subj}, ${FLAT_BG}`;
  }
  return out;
}
