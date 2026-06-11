# Pocket Alert Release-Candidate Upgrade Design

Date: 2026-06-11

## Context

Pocket Alert is a Vite + TypeScript + Canvas 2D browser RTS with a headless deterministic sim, generated/provided creature sprites, DOM UI, procedural maps, AI skirmish, and Vercel-ready static output. Baseline checks before this spec:

- `npm run build` passes.
- `npm run test:headless -- --matches 3 --maxMin 30 --seed 42` passes.
- `npm run test:headless -- --matches 6 --maxMin 30 --seed 9001` passes.
- Local browser launch reaches the skirmish UI with no console errors.
- The current match UI is dense and powerful, but the first playable minute does not strongly coach player action.
- AI match samples show hard AI losing to medium AI in several hard-vs-medium pairings, so difficulty consistency needs real tuning.

The existing module split is strong and should be preserved:

- `src/sim/*` remains the only mutator of `GameState`.
- `src/ai/ai.ts` produces commands only and respects fog-gated knowledge.
- `src/render/*` reads state and owns visual feedback.
- `src/ui/*` owns DOM menus, HUD, sidebar, tooltips, and player input.
- `src/data/*` owns unit, building, faction, and superweapon balance data.

## Goal

Create a public-quality release-candidate pass that makes Pocket Alert more immediately playable, visually readable, and satisfying to deploy and share. The upgrade should keep the current browser RTS architecture, avoid a rewrite, and improve the shipped game experience across four areas:

1. Playability and first-minute clarity.
2. Battlefield graphics, feedback, and UI polish.
3. AI, balance, and match pacing consistency.
4. Production build and Vercel deployment readiness.

## Non-Goals

- Do not replace Canvas 2D with WebGL or a new engine.
- Do not add multiplayer, accounts, persistence servers, or backend services.
- Do not introduce copyrighted art, names, audio, or external runtime asset dependencies.
- Do not refactor unrelated systems outside the files needed for playability, graphics, match flow, verification, and deployment.

## Design

### First-Minute Playability

The game should help a new player make sensible first actions without pausing the RTS fantasy. Add lightweight in-match guidance that appears during the first minute and then gets out of the way. The guidance should point toward concrete actions such as building power, refinery, barracks, using selection, and protecting harvesters. It should live in UI/HUD code and read state to decide what to show; it must not mutate sim state.

Command feedback should become more legible. Move, attack, harvest, capture, rally, repair, sell, and superweapon targeting should produce clear cursor/reticle/acknowledgement feedback where the current implementation is subtle. This should build on `InputController`, `HUD`, `WorldTooltip`, and `Renderer` overlays rather than adding a parallel input system.

Selection and combat readability should improve in busy scenes. Selected units, damaged entities, veterans, hold-fire stance, target intent, and rally lines should remain visible without overwhelming the terrain. Any new overlays should scale with zoom and avoid hiding the unit silhouettes.

### Visual and Audio Experience

The visual pass should prioritize readability before spectacle. Terrain should feel richer through subtle variation and atmosphere, while preserving clear passability and crystal visibility. Combat should gain stronger impact timing through muzzle flashes, projectile trails, explosion/spore/water/fire treatments, screen shake restraint, and hit confirmation.

UI styling should remain command-console inspired but become more premium and easier to scan. The sidebar should keep its 200px RA2-style footprint, but locked/ready/progress/repeat states must be visually distinct. Menu and loading surfaces should improve perceived polish without becoming a marketing landing page.

Audio changes should reinforce important state changes without spam. Existing `audio/*` systems should be reused; new sounds or barks should obey existing cooldown and priority behavior.

### Match Flow and Balance

Difficulty labels should be trustworthy. Hard should beat medium more often than not in mirror and cross-faction headless samples; medium should reliably beat easy. Hard does not need to win every match, but it should not routinely lose because of opening order stalls, poor defense response, or weak army conversion.

The first 5 minutes should consistently produce a readable RTS arc:

- Player and AI establish economy.
- Scouting or early harassment is possible but not instantly decisive by accident.
- The first attack wave is noticeable and survivable with reasonable play.
- Tech escalation, air/naval options, and superweapons remain reachable in normal-length matches.

Faction identity should be preserved:

- Scorch: slower, tougher, direct damage.
- Tide: mobile, technical, naval-friendly.
- Verdant: cheaper, faster, swarm/regeneration pressure.

Balance changes should happen in `src/data/*`, `src/core/constants.ts`, and targeted AI logic only when tests or observed behavior justify them. Avoid broad number churn without an acceptance signal.

### Deployment

The repo should remain deployable as a static Vite app. Vercel deployment should use the production `dist/` output produced by `npm run build`. Any Vercel-specific config should be added only if the default Vite behavior is insufficient. Secrets and local Vercel metadata must remain uncommitted.

The provided Vercel token should be used only as an environment variable for deployment commands and must not be written into files or repeated in logs/final notes.

## Architecture And Data Flow

New playability guidance should be modeled as UI state derived from `GameState`, not new simulation state. Implement this as a small UI helper that computes guidance milestones from read-only state, for example:

- Has the player selected units?
- Is a power plant queued or built?
- Is a refinery queued, ready, or placed?
- Are harvesters alive and active?
- Is the player floating credits with idle production?
- Is the base under attack?

Renderer upgrades should remain cosmetic and event-driven. Combat effects should continue flowing from `GameEvent[]` into `Renderer.handleEvents()` and `EffectsSystem`, preserving deterministic sim behavior.

AI tuning should remain command-only. Persistent AI data stays in `player.aiMemory`; no module-level mutable state should be introduced.

Build/deploy work should stay outside game runtime code unless configuration is required.

## Error Handling

The game should fail gracefully in user-facing surfaces:

- If audio cannot unlock or samples fail to load, gameplay continues.
- If sprite overrides fail, generated canvas fallback sprites continue to work.
- If the browser viewport is short, the sidebar remains scrollable and controls remain reachable.
- If Vercel deployment fails, the build artifact remains locally verified and the failure should be reported without exposing secrets.

## Testing And Acceptance

Implementation is acceptable only when current evidence proves the upgrade did not break the baseline and improved the targeted experience:

- `npm run build` passes.
- `npm run test:headless -- --matches 3 --maxMin 30 --seed 42` passes.
- `npm exec tsx tests/balance.ts -- --reps 2 --maxMin 35` runs and reports difficulty ordering/faction data. The target is hard beating medium in at least 4 of 6 sampled hard-vs-medium mirror series and medium beating easy in at least 4 of 6 sampled medium-vs-easy mirror series.
- Browser smoke test reaches the menu, starts a default skirmish, and reports no console errors.
- In-match UI remains usable at 1280x720 and 960x720.
- The first-minute guidance appears early, advances or dismisses based on state, and does not block normal RTS control.
- Production deployment to Vercel succeeds and the deployed URL serves the built game.

## Implementation Boundaries

Expected files to touch:

- `src/ui/menu.ts`
- `src/ui/hud.ts`
- `src/ui/input.ts`
- `src/ui/sidebar.ts`
- `src/ui/tooltip.ts`
- `src/render/renderer.ts`
- `src/render/effects.ts`
- `src/render/sprites.ts`
- `src/ai/ai.ts`
- `src/data/units.ts`
- `src/data/buildings.ts`
- `src/core/constants.ts`
- `tests/headless.ts`
- `tests/balance.ts`
- deployment config only if verification shows it is needed

Files outside those areas should be changed only when directly required by the implementation plan.

## Open Questions Resolved By This Design

- Priority is a balanced release-candidate pass across playability, visuals, match flow, and deployment.
- The existing architecture stays in place.
- AI/balance consistency is in scope because baseline evidence shows hard-vs-medium inconsistency.
- Vercel deployment is in scope, but secrets remain outside the repo.
