# Fable Wars: Crystal Rush Agency And Terrain Pass

Date: 2026-06-16

## Goal

Make Crystal Rush feel less like a spectator sim and more like a player-directed lane-push battle, while improving the in-game terrain from flat block tiles toward a pre-rendered RTS look.

## Decisions

- Add a player-controlled Deploy Wave action to Crystal Rush. It spends crystal credits, has a short cooldown, and sends an immediate extra wave using the player's current stance.
- Keep the Crystal Rush loop macro-focused. The player chooses stance, upgrades, defenses, and extra wave timing; individual unit micro remains out of scope for this mode.
- Reuse the existing wave, pathing, target, combat, and upgrade systems. No renderer rewrite, no WebGL, no new mechanics outside the mode flag.
- Remove classic RTS harvester guidance from Crystal Rush because the mode does not use manual harvesters.
- Generate a GPT Images terrain source sheet and commit both the source sheet and engine-ready transparent PNG tiles.
- Load terrain art through `public/sprites/manifest.json` so procedural terrain remains the fallback when an override is missing.

## Art Direction

- Target: pre-rendered fantasy RTS tiles, closer to Warcraft 3/Red Alert readability than voxel or Minecraft blocks.
- Lighting: top-left key light, soft contact shadows, readable silhouettes.
- Terrain pack: grass, dirt, sand, water, crystal-field ground, rock obstacle, and tree obstacle, each with three variants.

## Out Of Scope For This Pass

- Full 3D engine migration.
- Multiplayer.
- Replacing the entire unit roster.
- Changing Classic RTS mode behavior.

## Verification

- TypeScript typecheck.
- Crystal Rush headless completion sim.
- Production build with terrain assets copied into `dist`.
