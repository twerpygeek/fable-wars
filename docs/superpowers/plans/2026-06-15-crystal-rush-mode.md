# Crystal Rush Mode Plan

## Goal
Add a selectable Crystal Rush beta mode without deleting or weakening Classic RTS.

## Design
- Extend `GameConfig` with `mode?: 'classic' | 'crystalRush'`.
- Store Crystal Rush runtime data on `GameState.crystalRush`.
- Put Crystal Rush logic in `src/sim/modes/crystalRush.ts`, matching the repo's `src/sim` architecture.
- In Crystal Rush, skip manual production/economy/crates/superweapons and let the mode module handle waves, crystal income, AI upgrades, and base pressure.
- Keep the renderer unchanged.

## UI
- Add a main-menu mode selector.
- Add a compact Crystal Rush panel for stance, income, upgrades, and alive factions.
- Disable sidebar production and unit micro in Crystal Rush.

## Verification
- Add a headless AI-vs-AI Crystal Rush completion test.
- Run typecheck, build, and relevant headless tests.
