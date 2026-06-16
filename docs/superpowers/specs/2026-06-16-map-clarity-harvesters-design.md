# Fable Wars: Map Clarity And Harvester Reliability

Date: 2026-06-16

## Goal

Make the battlefield easier to understand at first glance and fix cases where harvesters appear idle near crystal fields.

## Design

- Crystal Rush gets camera-only controls so players can move the map without enabling individual unit micro.
- Crystal Rush starts the camera on the player's Citadel, not the center fight, so the player first understands which side is theirs.
- The Crystal Rush panel states the map controls directly: WASD, arrows, right-drag, and mouse wheel.
- The renderer adds world labels for `YOUR CITADEL` and `CENTRAL CRYSTAL`.
- The central objective gets a large crystal spire overlay so it reads as the resource objective instead of another patch of tile art.
- Generated terrain remains enabled for grass, dirt, sand, and water, but crystal, rock, and tree tiles use the engine's clean diamond painter to avoid square slab artifacts.
- Harvester target selection skips crystal tiles that pathfinding can only partially approach. A target is valid only when the path reaches the crystal tile or an adjacent mining tile.

## Verification

- A regression test creates a blocked crystal and a farther reachable crystal, then confirms the harvester mines the reachable one.
- Crystal Rush headless completion still resolves.
- TypeScript and production build pass.
- Browser text check confirms the Crystal Rush panel exposes the objective and map controls.
