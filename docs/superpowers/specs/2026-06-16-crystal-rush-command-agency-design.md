# Fable Wars: Crystal Rush Command Agency

Date: 2026-06-16

## Goal

Make Crystal Rush feel playable instead of passive. The player should understand what they are trying to do, why a command matters, and what changes after pressing it.

## Design

- Replace the vague Deploy Wave control with three command cards:
  - Claim Crystal: sends a wave to the center objective to increase income.
  - Break Base: sends a wave at enemy bases to progress the win condition.
  - Balanced Push: splits pressure between income and elimination.
- Make the first command available immediately at match start. Waiting before the first meaningful click made the mode feel unresponsive.
- Keep command cards mounted in the DOM and update their text/state in place. Rebuilding the panel every frame can detach buttons mid-click.
- Add compact status readouts for crystal presence, player base health, enemy base health, and next auto wave timing.
- Keep Classic RTS unchanged, but continue using the shared terrain override pipeline so the GPT terrain pack appears in both modes.

## Non-Goals

- No individual unit micro in Crystal Rush.
- No WebGL or 3D engine migration.
- No new factions, multiplayer, or unit roster expansion in this pass.

## Verification

- A headless test confirms manual deploy can set a battle plan and spawn an immediate player wave.
- Browser verification confirms command cards are enabled at match start and enter cooldown after a click.
- Classic RTS browser verification confirms the base game still launches without the Crystal Rush panel.
