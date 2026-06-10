// All sprite subjects from PROMPTS.md, structured for batch generation.
// Style blocks + faction clauses are applied by the driver (gen.mjs).

export const CREATURE_STYLE =
  'chibi cartoon monster video-game sprite, viewed from a 3/4 high angle like an ' +
  'isometric real-time strategy game, single creature centered, full body, big round ' +
  'head with large glossy eyes, tiny body and stubby limbs, soft cel shading lit from ' +
  'the upper left, thin dark outline, vibrant saturated colors, clean polished game ' +
  'asset, no text, no logo, no ground shadow';

export const BUILDING_STYLE =
  'isometric video-game building sprite at a true 2:1 isometric angle (Red Alert 2 ' +
  'style), single structure centered, base sits on a diamond-shaped footprint, soft cel ' +
  'shading lit from the upper left, thin dark outline, saturated colors, clean game ' +
  'asset, no text, no ground plane outside the footprint';

// Strongly-inspired-but-legally-distinct + flat bg for clean keying.
export const DISTINCT = 'original creature design, strongly inspired but legally distinct, not an exact copy';
export const FLAT_BG = 'plain solid flat uniform light grey background';

export const FACTION_CLAUSE = {
  scorch: 'built from dark obsidian stone with glowing orange lava seams and ember vents',
  tide: 'built from white coral and aqua glass with flowing water channels',
  verdant: 'built from living wood and moss with leafy canopies and vines',
};

export const UNITS = {
  scorch_charmandar: 'a cheeky orange salamander hatchling standing upright, cream belly, small flame burning on its tail tip, mouth open in a tiny war cry',
  scorch_peekachoo: 'a yellow electric rodent soldier with long pointed ears, bright red sparking cheeks, jagged lightning-bolt tail, confident smirk, tiny sparks crackling around it',
  scorch_magmarr: 'a bulky red-orange brute with a flame plume burning on its head, thick arms, magma-cracked skin, breathing a wisp of fire',
  scorch_prof_cinder: 'a tiny human professor in a red lab coat and brass goggles, carrying a toolbox, determined expression, cartoon proportions with a big head',
  scorch_torkoala: 'a soot-grey tortoise with a smoking coal-fired furnace built into its shell and a small ore hopper on its back, sleepy but sturdy, embers drifting up',
  scorch_ryhorrn: 'a stocky grey rock-rhinoceros on four legs with a cannon-like horn on its snout, armored plates, low and tank-like',
  scorch_arcanyne: 'a sleek orange hound with black tiger stripes and a cream mane, mid-stride, fast and fierce, small flames at its paws',
  scorch_magnetonn: 'a floating machine creature made of three silver orbs with red-and-blue horseshoe magnets orbiting them, single big eye on the center orb, electric arcs',
  scorch_groudonn: 'a massive crimson bipedal behemoth with grey armor plates, white blade-like spikes, heavy claws, tiny fierce eyes, volcanic glow between its plates',
  scorch_zubattler: 'a small purple bat with huge ears, wide blue wing membranes, tiny fangs, flying pose seen slightly from above',
  scorch_moltrez: 'a blazing phoenix with a flame-crest head and golden belly, wide burning wings spread, seen from a high 3/4 angle as if flying below the camera',
  scorch_magcarggo: 'a droopy lava-slug with a smoking volcanic rock shell, riding on a small grey naval barge hull, leaving a wake',
  scorch_slugmariner: 'a grey slug-shaped mini-submarine with a periscope, one round porthole showing a creature eye inside, rivets along the hull, small bubbles',

  tide_squirtul: 'a small blue turtle soldier standing upright, cream belly shell, squirting a tiny jet of water from its mouth, plucky expression',
  tide_horsean: 'a pale-blue seahorse with a coiled tail and a tiny spiral horn snout, upright in a proud pose, bubbles around it',
  tide_polywrath: 'a burly dark-blue frog bruiser with a white spiral pattern on its belly, boxing stance, thick fists',
  tide_prof_brine: "a tiny human professor in a blue rain slicker and yellow sou'wester hat, carrying a toolbox, cartoon proportions with a big head",
  tide_krabber: 'an orange-red crab with one oversized claw and a woven cargo basket strapped to its back full of pink and cyan candy crystals',
  tide_vaporeonix: 'a sleek aqua quadruped with fish-fin ears, a mermaid-like finned tail, smooth glossy skin, poised mid-prowl',
  tide_blastoyse: 'a big heavy turtle with two steel water cannons emerging from the shoulders of its brown shell, braced firing stance',
  tide_starmiez: 'a purple ten-pointed star machine-creature with a glowing red gem core at the center, hovering, geometric and jewel-like',
  tide_kyogrre: 'a huge midnight-blue whale-leviathan with red glowing rune lines across its body, white underbelly, hovering above the ground on a cushion of mist',
  tide_wingullet: 'a small white seagull with blue-tipped wings, flying pose seen slightly from above, simple and clean',
  tide_pelipperator: 'a big-billed white pelican bomber with a blue saddle pouch, heavy bill like a cargo bay, flying pose seen slightly from above',
  tide_tentacrush: 'a blue jellyfish gunship with two large red orb gems and trailing tentacles, floating on the water surface on a small hull',
  tide_sharpeedo: 'a torpedo-shaped navy shark with a star-scarred snout, savage grin full of teeth, cutting through water, dorsal fin wake',
  tide_gyarrados: 'a furious blue sea-serpent rearing high out of the water, cream belly scutes, gaping fanged mouth, red whiskers, coiled body in the waves',

  verdant_bulbasore: 'a teal four-legged creature with a closed green flower bulb growing on its back, spotted skin, friendly determined face',
  verdant_beedrillz: 'a yellow-and-black hornet with two drill-lance forearms, transparent buzzing wings, hovering low in attack posture',
  verdant_oddishooter: 'a round blue radish-creature with a sprout of five broad leaves on its head, tiny feet, leaves angled upward like flak launchers',
  verdant_scytherr: 'a green praying-mantis warrior with two huge curved scythe blades for arms, cream torso, insect wings, battle stance',
  verdant_prof_oakley: 'a tiny human professor in a green field vest and straw hat, carrying a toolbox, cartoon proportions with a big head',
  verdant_torterrar: 'a giant moss-green tortoise with a small living tree and two harvest bins growing on its earthen shell, slow and mighty',
  verdant_sceptilash: 'a lean lime-green gecko sprinter with leaf blades along its forearms and tail, crouched in a running start',
  verdant_venosore: 'a big teal quadruped with a giant pink flower cannon blooming on its back, thick trunk legs, vines curling at its feet',
  verdant_tanglevine: 'a ball of blue tangled vines with two red shoe-like feet and hidden eyes peeking out, vine tendrils raised skyward like flak whips',
  verdant_snorlux: 'a colossal sleepy teal bear-creature sitting upright, cream belly, eyes closed, peaceful giant that could flatten a tank by leaning',
  verdant_pidgeottoh: 'a brown-and-cream raptor bird with a red-orange head crest, fierce eyes, flying pose seen slightly from above',
  verdant_butterfrei: 'a large purple butterfly with white spotted wings, red compound eyes, scales of glittering spore dust falling from its wings',
  verdant_lotadder: 'a blue lilypad duck-creature skimming the water on a leaf raft, broad lilypad hat, paddle feet, smug expression',
  verdant_ludicolossus: 'a jolly pineapple-bodied duck dancer with a huge sombrero made of a lilypad, mid-dance pose on a small barge, maracas optional',
};

// Generic building types (×3 factions). Subject gets the faction clause appended.
export const BUILDING_TYPES = {
  conyard: 'a massive command headquarters with a fortified central tower, construction crane on the roof, glowing power core, the most important building in an RTS base',
  power: 'a power plant with two fat reactor coils wrapped in glowing energy rings, humming with elemental energy',
  refinery: 'an ore refinery with a tall storage silo, a conveyor belt, and a sparkling pile of pink and cyan candy crystals at its intake',
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
