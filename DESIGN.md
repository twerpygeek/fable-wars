# Fable Wars — Game Design

RA2-style browser RTS with a dark fantasy, pre-rendered 3D war-beast identity. Resource =
**rift crystals**. Destroy every enemy structure to win. Classic pacing: 20–30 minute matches,
15 ticks/sec.

## Factions

| | 🔥 Scorch Legion | 🌊 Tide Dominion | 🌿 Verdant Swarm |
|---|---|---|---|
| Element | FIRE | WATER | GRASS |
| Identity | Brute force, heavy armor, raw damage (Soviet feel) | Tech, mobility, naval supremacy (Allied feel) | Cheap swarms, speed, regeneration (numbers win) |
| Superweapon | **Magma Strike** (nuke) | **Tsunami Surge** (storm) | **Sporestorm Bloom** (lingering DoT field) |
| Theme color | #ff5a2a | #2ab4ff | #4ade5a |
| Materials | obsidian, lava glow, ember vents | coral, shells, flowing water, glass | living wood, leaves, vines, petals |

Type triangle: FIRE→GRASS, GRASS→WATER, WATER→FIRE ×1.25 (reverse ×0.8). ELECTRIC→WATER ×1.25.
Faction quirks (implement in data, keep subtle): Scorch units +10% damage, −10% speed. Tide units
+10% speed, naval 15% cheaper. Verdant infantry 15% cheaper, all Verdant units regen 0.2 hp/tick
when out of combat 5s (data: model as elite-style regen flag — if contract lacks it, fold into
combat.ts elite self-heal check by faction).

## Complete unit roster (def ids are LAW — sprites, AI, data all key off these)

### Scorch Legion
| id | name | tab/tier | role | archetype (for sprites) |
|---|---|---|---|---|
| scorch_cinder_imp | Cinder Imp | inf t1 | basic ember trooper, FIRE CLAW | small obsidian imp, molten cracks, clawed stance |
| scorch_volt_cinder | Volt Cinder | inf t1 | shock trooper, ELECTRIC PIERCE, hits air | obsidian skirmisher, lava plates, lightning arcs |
| scorch_magma_brute | Magma Brute | inf t2 | flamer, BLAST, melts buildings/infantry | furnace-chested brute, black armor, orange core glow |
| scorch_ash_savant | Ash Savant | inf t1 | engineer — captures buildings | heat-masked infiltrator, dark robes, brass war tools |
| scorch_ember_hauler | Ember Hauler | veh t1 | HARVESTER (cap 700) | smoking coal tortoise w/ hopper |
| scorch_basalt_ram | Basalt Ram | veh t1 | main battle creature, CANNON MEDIUM | grey rock rhino, horn cannon |
| scorch_ashrunner | Ashrunner | veh t2 | fast raider, CLAW, harasses | black stone raider beast, ember mane, armored paws |
| scorch_storm_anvil | Storm Anvil | veh t2 | anti-air, PIERCE | magnetized anti-air construct, orange energy coils |
| scorch_caldera_titan | Caldera Titan | veh t3 | super-heavy, dual CANNON, HEAVY | huge red spiked behemoth |
| scorch_cinderwing | Cinderwing | air t2 | interceptor, PIERCE, AA+ground | charred scout flyer, ember-veined wings |
| scorch_solar_wyrm | Solar Wyrm | air t3 | heavy bomber, BLAST splash (Kirov-ish, slow) | molten firebird, broad burning wings, black armor bones |
| scorch_slag_barge | Slag Barge | naval t2 | gunboat, CANNON | volcanic crystal mortar mounted on a dark fire barge |
| scorch_ember_nautilus | Ember Nautilus | naval t2 | submarine, PIERCE, naval-only targets | dark shell raider, glowing hot core, submerged ambush profile |

### Tide Dominion
| id | name | tab/tier | role | archetype |
|---|---|---|---|---|
| tide_coral_initiate | Coral Initiate | inf t1 | basic water-gun trooper, WATER PIERCE | disciplined infantry in pale coral armor and aqua glass |
| tide_rill_lancer | Rill Lancer | inf t1 | anti-armor/AA bubble lance, PIERCE | quick aquatic lancer, spear profile, blue crystal fins |
| tide_breaker_guard | Breaker Guard | inf t2 | bruiser, CLAW, high hp | close-order guard, heavy coral gauntlets, wave armor |
| tide_reef_savant | Reef Savant | inf t1 | engineer | salt-robed infiltrator with surgical tools and blue crystal focus |
| tide_claw_harvester | Claw Harvester | veh t1 | HARVESTER (cap 700) | coral pincer crawler with crystal cargo frame |
| tide_glassfin_prowler | Glassfin Prowler | veh t1 | fast scout/raider, CLAW | sleek amphibious hunter, bright fins, aquatic armor |
| tide_coral_bulwark | Coral Bulwark | veh t2 | main battle creature, hydro CANNON | big turtle, twin shell cannons |
| tide_prism_array | Prism Array | veh t2 | anti-air, PIERCE | hovering anti-air focus with a blue refracting crystal core |
| tide_abyss_sovereign | Abyss Sovereign | veh t3 | heavy hover, CANNON+splash, HEAVY | blue whale w/ red runes, hovers |
| tide_reefwing | Reefwing | air t2 | interceptor | light interceptor with blade wings and water-glass feathers |
| tide_storm_bomber | Tide Bomber | air t3 | bomber, BLAST | heavy flyer with storm cargo belly and coral armor plates |
| tide_kraken_skiff | Kraken Skiff | naval t2 | mid gunship, PIERCE | surface raider with grasping coral limbs |
| tide_razortooth_sub | Razortooth Sub | naval t2 | fast sub, naval-only | armored prow predator with blue wake lines |
| tide_leviathan_ark | Leviathan Ark | naval t3 | capital ship, long-range BLAST bombardment | rearing blue sea serpent |

### Verdant Swarm
| id | name | tab/tier | role | archetype |
|---|---|---|---|---|
| verdant_mossling | Mossling | inf t1 | basic seed-spit, GRASS, extra cheap | living-wood infantry around a toxic green heart |
| verdant_thorn_wasp | Thorn Wasp | inf t1 | fast melee stinger, CLAW | needle-winged interceptor, branch armor, stinger lances |
| verdant_spore_pod | Spore Pod | inf t1 | anti-air spore flinger, PIERCE | small ranged organism with leaf crown and glowing spore sacs |
| verdant_briar_reaper | Briar Reaper | inf t2 | elite melee shredder, CLAW | bark-and-thorn assault unit with blade limbs |
| verdant_root_savant | Root Savant | inf t1 | engineer | quiet infiltrator with ritual tools and living-wood armor |
| verdant_grove_hauler | Grove Hauler | veh t1 | HARVESTER (cap 700) | harvesting beast with root armor and a crystal-fed engine heart |
| verdant_vine_stalker | Vine Stalker | veh t1 | fast raider, CLAW | fast Verdant striker with leaf blades and predatory crouch |
| verdant_bloom_siege | Bloom Siege | veh t2 | main battle creature, solar CANNON | big quad w/ pink flower cannon |
| verdant_tangle_mass | Tangle Mass | veh t2 | anti-air vine flak, PIERCE | creeping ambush mass of vines, roots, and glowing eyes |
| verdant_elder_husk | Elder Husk | veh t3 | colossal HP wall, CLAW, NEUTRAL elem, slow | giant sleepy teal bear |
| verdant_canopy_raptor | Canopy Raptor | air t2 | interceptor | brown/cream raptor bird |
| verdant_spore_moth | Spore Moth | air t3 | spore bomber, BLAST+lingering splash | dark-winged bomber with glowing pollen trails |
| verdant_bog_skiff | Bog Skiff | naval t2 | gunboat | small naval gunbeast grown around a floating root raft |
| verdant_mangrove_colossus | Mangrove Colossus | naval t3 | capital, dance-beam BLAST | half fortress, half overgrown nightmare |

## Buildings (ids: `<faction>_<key>`, all three factions have all 15)

| key | name pattern (Scorch / Tide / Verdant) | size | power | notes |
|---|---|---|---|---|
| conyard | Ember Citadel / Tide Citadel / Grove Citadel | 3×3 | +50 | isConYard; produces structure+defense tabs; hp 1500 |
| power | Geothermal Den / Tidal Generator / Sunbloom Grove | 2×2 | +150 | cost 600 |
| refinery | Rift Smeltery / Rift Distillery / Rift Arbor | 3×2 | −50 | isRefinery; cost 2000; free harvester |
| barracks | Ember Hatchery / Tide Hatchery / Grove Hatchery | 2×2 | −25 | produces infantry; cost 500 |
| factory | Evolution Forge / Evolution Bay / Evolution Glade | 3×3 | −50 | produces vehicle; cost 2000; needs refinery |
| radar | Scout Perch (all) | 2×2 | −50 | isRadar; needsPower; cost 1200; needs refinery; tier-2 gate |
| airpad | Sky Roost (all) | 2×2 | −50 | produces air; cost 1000; needs radar |
| navalyard | Reef Dock / Grand Marina / Lily Dock | 3×3 | −50 | produces naval; placeOnWater; cost 1000; needs refinery |
| techlab | Master Lab (all) | 2×2 | −100 | isTechLab; cost 2500; needs radar+factory; tier-3 + superweapon gate |
| repair | Care Center (all — pink roof, white cross) | 3×3 | −25 | isRepairDepot; cost 1200; needs factory |
| wall | Obsidian Wall / Coral Wall / Bramble Wall | 1×1 | 0 | cost 75; hp 400; defense tab |
| def_basic | Ember Turret / Bubble Cannon / Thorn Turret | 1×1 | −10 | cost 600; CANNON; needs barracks |
| def_adv | Flame Spout / Hydro Prism / Razorleaf Launcher | 1×1 | −50 | cost 1200; BLAST/beam, needsPower; needs radar |
| def_aa | Skyspark Tower / Geyser Battery / Sporeflak Pod | 1×1 | −25 | cost 800; PIERCE air-only; needs radar |
| sw | Volcano Silo / Tide Temple / The Great Tree | 3×3 | −150 | cost 3000; superweaponId; needs techlab; hp 1000 |

## Superweapons
| id | name | charge | effect |
|---|---|---|---|
| magma_strike | Magma Strike | 5.5 min | 3s incoming warning → epicenter 900 dmg, radius 6, BLAST FIRE |
| tsunami_surge | Tsunami Surge | 5.5 min | 8s of strikes: ~14 random bolts in radius 7, 180 dmg each, WATER |
| sporestorm | Sporestorm Bloom | 5 min | radius 6 field for 15s, ~25 dmg/sec GRASS to ground entities inside |

## Balance guidance (data module defaults; exact numbers tunable)
- buildTicks default: `secondsToTicks(cost / 30)`.
- Infantry: cost 150–400 (engineer 500), hp 80–220, speed 1.6–2.4 t/s, sight 6.
- Vehicles: cost 700–1000 (t1/t2), harvester 1000 (hp 600, unarmed), t3 1700–1900, hp 300–900 (Elder Husk 1600), speed 1.2–2.8.
- Air: cost 1000–1600, hp 200–360, speed 3.0–3.6, ignore terrain.
- Naval: cost 800–1100, capital 1800–2000, hp 400–1000; capitals range 9–10 (outrange defenses).
- Weapons: DPS ≈ cost/100 per second for combat units (tune by role: anti-X bonus comes from WEAPON_VS_ARMOR).
  Ranges: melee 1.2, infantry 4–5, tanks 5.5–6.5, AA 6–7, defenses 6.5–7, capital 9–10. Sight ≥ range+1.
- Economy: refinery + 2 harvesters ≈ 1500–2000 credits/min early game. STARTING_CREDITS 10000.
- Build icons must show cost; sidebar tooltip = name + blurb + cost + prereq reason when locked.

## Announcer script (audio/announcer.ts)
"Construction complete" • "New creature ready" • "Our base is under attack" • "Our harvester is under
attack" • "Insufficient funds" • "Low power" • "Power restored" • "Building captured" • "Enemy building
captured" • "Superweapon ready" • "Warning: enemy superweapon detected" • "Enemy superweapon launch
detected" • "Reinforcements have arrived" (game start) • "Enemy commander eliminated" • "Commander,
victory is ours!" • "Mission failed — our base has fallen."

## AI difficulty design (ai/ai.ts)
- **Easy:** thin fixed build order (power→refinery→barracks→a few defenses→factory), 1 refinery, attacks
  every ~4 min with whatever exists (min 5 units), never expands, never superweapon, no retreat, slow think.
- **Medium:** solid order (incl. radar, 2nd refinery, factory, airpad), keeps 3–4 harvesters, waves of
  10–14 mixed units every ~3 min at army threshold, defends base, rebuilds key losses, superweapon fired
  ≥60s after ready at largest visible base cluster, basic naval if shoreline base.
- **Hard:** optimized order, 2 refineries + expansion field coverage, continuous production from 2 factories,
  composition counters scouted enemy mix (anti-air if air-heavy etc.), dedicated harvester-snipe squad,
  multi-pronged attacks (split waves), retreats units <30% hp, fires superweapon on cooldown at
  refineries/conyard, AA coverage, naval pressure on water maps, engineer captures.
No resource cheating at any level. All read state only through explored/visible filters.
