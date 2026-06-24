# Fable Wars Sprite Generation Guide

Use this file when regenerating unit or building art. The visual source of truth is:

`public/art/source/fable-wars-unit-concept-sheet.png`

Do not generate cute mascot units, parody creatures, chibi heads, round toy-like bodies, or anything that reads like a monster-catching game. Fable Wars units should look like pre-rendered 3D RTS pieces: dark fantasy silhouettes, readable at 64x64, premium Warcraft 3 / StarCraft 2 campaign mood, sharp armor, strong faction materials, and transparent backgrounds.

## Unit Style Block

> dark fantasy pre-rendered 3D real-time strategy unit sprite, viewed from a 3/4 high isometric camera, single unit centered, full body, sharp silhouette, realistic armor mass, lit from upper left, transparent background, no text, no logo, no ground shadow, original Fable Wars war unit, not cute, not chibi, not mascot-like

## Faction Materials

- Scorch Legion: dark obsidian stone, horned armor, glowing orange lava seams, ember vents, furnace cores.
- Tide Dominion: pale coral armor, aqua glass, blue crystal fins, water pressure cannons, reef plating.
- Verdant Swarm: living wood, moss, thorns, green heart-glow, branch-bone wings, root armor.

## Unit Subjects

Use the display name and role from `src/data/units.ts` as the subject. Examples:

- Cinder Imp: small obsidian ember infantry with molten cracks and clawed posture.
- Volt Cinder: crackling obsidian skirmisher with lava armor plates and lightning arcs.
- Coral Initiate: disciplined Tide infantry wrapped in pale coral armor and aqua glass.
- Reef Savant: salt-robed infiltrator with surgical tools and a blue crystal focus.
- Mossling: living-wood infantry grown around a toxic green heart.
- Bloom Siege: heavy artillery beast crowned with a war-flower cannon.

For production sprite sheets, generate one centered unit per tile. Do not use crowded lineup/collage output for final atlas sprites.

## Building Style Block

> dark fantasy pre-rendered 3D isometric RTS building sprite, true 2:1 isometric angle, single structure centered, base aligned to a diamond footprint, upper-left key light, faction material language, transparent background, no text, no logo, no ground plane outside the footprint

## Saving Files

Units:

`public/sprites/units/<unit_id>_<facing>_<frame>.png`

Minimum facings:

`s`, `sw`, `w`, `nw`, `n`

Buildings:

`public/sprites/buildings/<building_id>.png`

Update `public/sprites/manifest.json` after adding or changing sprites.
