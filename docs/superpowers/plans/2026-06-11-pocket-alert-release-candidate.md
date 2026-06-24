# Pocket Alert Release-Candidate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a public-quality Pocket Alert upgrade with first-minute guidance, clearer command/combat feedback, stronger presentation, more trustworthy AI difficulty, verified builds, and Vercel deployment.

**Architecture:** Keep the existing deterministic sim and Canvas/DOM split. Add guidance as read-only UI derivation, route new command feedback through existing renderer effects, tune AI through command-only logic and data/constants, and keep deployment as static Vite output.

**Tech Stack:** Vite 6, TypeScript, Canvas 2D, DOM UI, Node/tsx test scripts, Vercel static deployment.

---

## Scope Check

The approved spec spans playability, graphics, match flow, and deployment. Treat this as one release-candidate plan because every task produces a working increment and the final acceptance gate needs all pieces together. Do not rewrite the engine or change sim ownership rules.

## Quality Bar

This pass is not done when it merely compiles. Treat "best" as a quality ratchet: the first minute must clearly guide a new player, commands must visibly acknowledge intent, combat must read at a glance, hard AI must behave like a higher difficulty in sampled matches, the UI must survive both `1280x720` and `960x720`, and the deployed Vercel build must start a skirmish without console errors.

## File Structure

- Create `src/ui/guidance.ts`: read-only first-minute guidance helper. No DOM and no sim mutation.
- Create `tests/guidance.ts`: headless tests for guidance milestones.
- Modify `src/ui/hud.ts`: render guidance panel and keep existing HUD/toast behavior.
- Modify `src/main.ts`: pass `DATA`/`ui` into HUD and route command feedback callbacks into renderer effects.
- Modify `src/ui/input.ts`: emit command feedback for move, attack, harvest, capture, rally, place, repair, sell, cancel, and superweapon actions.
- Modify `src/render/effects.ts`: strengthen existing event effects and add command acknowledgement treatment using existing `VisualEffect.kind` values.
- Modify `src/render/renderer.ts`: improve selected/target/rally readability without changing state.
- Modify `src/ui/sidebar.ts`: make locked, ready, progress, and repeat states easier to scan.
- Modify `src/ui/menu.ts`: improve lobby/default presentation and loading copy while keeping the game as the first screen.
- Modify `src/ai/ai.ts`: tune hard/medium behavior so difficulty labels match outcomes more reliably.
- Modify `tests/balance.ts`: turn balance expectations into an executable acceptance gate.
- Modify `package.json`: add focused test scripts.

## Task 1: Guidance Helper With Headless Tests

**Files:**
- Create: `src/ui/guidance.ts`
- Create: `tests/guidance.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing guidance test**

Create `tests/guidance.ts`:

```ts
import assert from 'node:assert/strict';
import type { UIState } from '../src/core/types';
import { DATA } from '../src/data/index';
import { createGame } from '../src/sim/game';
import { getGuidance } from '../src/ui/guidance';

function ui(overrides: Partial<UIState> = {}): UIState {
  return {
    selection: [],
    controlGroups: {},
    placingDefId: null,
    placeValid: false,
    sellMode: false,
    repairMode: false,
    targetingSuperweapon: false,
    hoverTile: null,
    dragStart: null,
    dragEnd: null,
    paused: false,
    gameSpeed: 1,
    showMenu: false,
    ...overrides,
  };
}

function game() {
  return createGame(
    {
      seed: 20260611,
      mapSize: 'S',
      waterAmount: 'low',
      crates: false,
      players: [
        { faction: 'scorch', isHuman: true, difficulty: null, colorIdx: 0, name: 'Commander' },
        { faction: 'tide', isHuman: false, difficulty: 'medium', colorIdx: 1, name: 'AI' },
      ],
    },
    DATA,
  );
}

{
  const state = game();
  const msg = getGuidance(state, DATA, 0, ui());
  assert.equal(msg?.id, 'select-start');
  assert.equal(msg?.severity, 'info');
}

{
  const state = game();
  const msg = getGuidance(state, DATA, 0, ui({ selection: [1] }));
  assert.equal(msg?.id, 'build-power');
}

{
  const state = game();
  const p = state.players[0];
  p.queues.structure.items.push('scorch_power');
  const msg = getGuidance(state, DATA, 0, ui({ selection: [1] }));
  assert.equal(msg?.id, 'build-refinery');
}

{
  const state = game();
  const p = state.players[0];
  p.powerProduced = 25;
  p.powerConsumed = 90;
  const msg = getGuidance(state, DATA, 0, ui({ selection: [1] }));
  assert.equal(msg?.id, 'low-power');
  assert.equal(msg?.severity, 'warn');
}

console.log('PASS guidance');
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
PATH=/Users/iangoh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH \
/Users/iangoh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
/Users/iangoh/Documents/Codex/2026-06-11/goal-my-friend-open-source-this/work/.tools/npm-cli/bin/npm-cli.js \
exec tsx tests/guidance.ts
```

Expected: FAIL because `src/ui/guidance.ts` does not exist.

- [ ] **Step 3: Implement the guidance helper**

Create `src/ui/guidance.ts`:

```ts
import { TICK_RATE } from '../core/constants';
import type { GameData, GameState, PlayerId, ProductionTab, UIState } from '../core/types';

export interface GuidanceMessage {
  id: string;
  title: string;
  body: string;
  severity: 'info' | 'warn';
}

const STRUCTURE: ProductionTab = 'structure';
const VEHICLE: ProductionTab = 'vehicle';

function queuedOrReady(state: GameState, player: PlayerId, defId: string): boolean {
  const p = state.players[player];
  for (const q of Object.values(p.queues)) {
    if (q.readyBuilding === defId || q.items.includes(defId)) return true;
  }
  return false;
}

function hasBuilding(state: GameState, player: PlayerId, defId: string): boolean {
  for (const e of state.entities.values()) {
    if (e.kind === 'building' && e.owner === player && e.defId === defId && e.hp > 0) return true;
  }
  return false;
}

function hasOrQueuedStructure(state: GameState, player: PlayerId, key: string): boolean {
  const faction = state.players[player].faction;
  const defId = `${faction}_${key}`;
  return hasBuilding(state, player, defId) || queuedOrReady(state, player, defId);
}

function ownUnitCount(state: GameState, player: PlayerId, pred: (defId: string) => boolean): number {
  let n = 0;
  for (const e of state.entities.values()) {
    if (e.kind === 'unit' && e.owner === player && e.hp > 0 && pred(e.defId)) n++;
  }
  return n;
}

function queuedUnits(state: GameState, player: PlayerId, tab: ProductionTab): number {
  return state.players[player].queues[tab].items.length;
}

export function getGuidance(
  state: GameState,
  data: GameData,
  humanPlayer: PlayerId,
  ui: UIState,
): GuidanceMessage | null {
  if (state.winner !== null || ui.paused || ui.showMenu) return null;
  const p = state.players[humanPlayer];
  const faction = p.faction;
  const firstMinute = state.tick < TICK_RATE * 75;

  if (p.powerProduced < p.powerConsumed) {
    return {
      id: 'low-power',
      title: 'Power shortage',
      body: 'Build another power plant. Low power slows production and shuts down advanced systems.',
      severity: 'warn',
    };
  }

  const harvesters = ownUnitCount(state, humanPlayer, (defId) => data.units[defId]?.harvester !== undefined);
  if (harvesters === 0 && queuedUnits(state, humanPlayer, VEHICLE) === 0) {
    return {
      id: 'rebuild-harvester',
      title: 'No harvesters',
      body: 'Queue a harvester from the vehicle tab or protect your economy before attacking.',
      severity: 'warn',
    };
  }

  if (!firstMinute) return null;

  if (ui.selection.length === 0) {
    return {
      id: 'select-start',
      title: 'Start by selecting',
      body: 'Drag-select your creatures or click the Citadel, then right-click to move or set rally points.',
      severity: 'info',
    };
  }

  if (!hasOrQueuedStructure(state, humanPlayer, 'power')) {
    return {
      id: 'build-power',
      title: 'Build power',
      body: `Open BLD and queue ${data.buildings[`${faction}_power`].name} so your base can expand.`,
      severity: 'info',
    };
  }

  if (!hasOrQueuedStructure(state, humanPlayer, 'refinery')) {
    return {
      id: 'build-refinery',
      title: 'Start your economy',
      body: `Queue ${data.buildings[`${faction}_refinery`].name} near Rare Candy crystals.`,
      severity: 'info',
    };
  }

  if (!hasOrQueuedStructure(state, humanPlayer, 'barracks')) {
    return {
      id: 'build-barracks',
      title: 'Train defenders',
      body: `Queue ${data.buildings[`${faction}_barracks`].name}, then make a few infantry before the first raid.`,
      severity: 'info',
    };
  }

  if (p.credits >= 2500 && p.queues[STRUCTURE].items.length === 0 && p.queues[STRUCTURE].readyBuilding === null) {
    return {
      id: 'spend-bank',
      title: 'Spend your bank',
      body: 'You have enough credits to expand production, defenses, or tech. Idle credits do not win battles.',
      severity: 'info',
    };
  }

  return null;
}
```

- [ ] **Step 4: Add a script for the guidance test**

Modify `package.json` scripts:

```json
"test:guidance": "tsx tests/guidance.ts"
```

Keep the existing scripts and add this next to `test:headless`.

- [ ] **Step 5: Run guidance test and commit**

Run:

```bash
PATH=/Users/iangoh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH \
/Users/iangoh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
/Users/iangoh/Documents/Codex/2026-06-11/goal-my-friend-open-source-this/work/.tools/npm-cli/bin/npm-cli.js \
run test:guidance
```

Expected: `PASS guidance`.

Commit:

```bash
git add package.json src/ui/guidance.ts tests/guidance.ts
git commit -m "feat: add first-minute guidance helper"
```

## Task 2: HUD Guidance Panel

**Files:**
- Modify: `src/ui/hud.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Update HUD constructor and imports**

Modify the top of `src/ui/hud.ts`:

```ts
import type { GameData, GameState, PlayerId, UIState } from '../core/types';
import { TICK_RATE, MAX_UNITS_PER_PLAYER } from '../core/constants';
import { getGuidance } from './guidance';
```

Change class fields and constructor:

```ts
  private data: GameData;
  private ui: UIState;
  private guideEl: HTMLDivElement;
  private guideTitleEl: HTMLDivElement;
  private guideBodyEl: HTMLDivElement;
  private shownGuideId = '';

  constructor(root: HTMLElement, data: GameData, ui: UIState) {
    this.data = data;
    this.ui = ui;
```

- [ ] **Step 2: Add guidance CSS**

Append to the HUD CSS string:

```css
.pa-guide {
  position: absolute; left: 12px; top: 52px; z-index: 42;
  width: min(360px, calc(100vw - 232px));
  background: linear-gradient(180deg, rgba(17, 23, 38, 0.94), rgba(8, 10, 18, 0.91));
  border: 1px solid #4a7dff; border-radius: 4px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.08);
  padding: 9px 11px; font-family: Verdana, Geneva, sans-serif;
  color: #dfe5ff; pointer-events: none; user-select: none;
  text-shadow: 0 1px 2px #000;
}
.pa-guide.hidden { display: none; }
.pa-guide.warn { border-color: #ff8a3c; background: linear-gradient(180deg, rgba(51, 24, 10, 0.95), rgba(18, 10, 7, 0.92)); }
.pa-guide-title { font-size: 11px; font-weight: bold; letter-spacing: 1.4px; text-transform: uppercase; color: #fff; }
.pa-guide-body { margin-top: 4px; font-size: 10px; line-height: 1.45; color: #b9c5f5; }
.pa-guide.warn .pa-guide-body { color: #ffd9c4; }
@media (max-width: 980px) { .pa-guide { width: 300px; font-size: 10px; } }
```

- [ ] **Step 3: Create the guidance DOM and render it**

In the constructor after `root.appendChild(bar);`, add:

```ts
    this.guideEl = document.createElement('div');
    this.guideEl.className = 'pa-guide hidden';
    this.guideTitleEl = document.createElement('div');
    this.guideTitleEl.className = 'pa-guide-title';
    this.guideBodyEl = document.createElement('div');
    this.guideBodyEl.className = 'pa-guide-body';
    this.guideEl.append(this.guideTitleEl, this.guideBodyEl);
    root.appendChild(this.guideEl);
```

At the end of `update()`, before it returns, add:

```ts
    const guide = getGuidance(state, this.data, humanPlayer, this.ui);
    if (guide === null) {
      if (this.shownGuideId !== '') {
        this.shownGuideId = '';
        this.guideEl.className = 'pa-guide hidden';
      }
    } else if (guide.id !== this.shownGuideId) {
      this.shownGuideId = guide.id;
      this.guideEl.className = guide.severity === 'warn' ? 'pa-guide warn' : 'pa-guide';
      this.guideTitleEl.textContent = guide.title;
      this.guideBodyEl.textContent = guide.body;
    }
```

- [ ] **Step 4: Wire HUD from main**

In `src/main.ts`, replace:

```ts
  const hud = new HUD(matchRoot);
```

with:

```ts
  const hud = new HUD(matchRoot, DATA, ui);
```

- [ ] **Step 5: Verify and commit**

Run:

```bash
PATH=/Users/iangoh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH \
/Users/iangoh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
/Users/iangoh/Documents/Codex/2026-06-11/goal-my-friend-open-source-this/work/.tools/npm-cli/bin/npm-cli.js \
run build
```

Expected: TypeScript and Vite build pass.

Commit:

```bash
git add src/ui/hud.ts src/main.ts
git commit -m "feat: show contextual first-minute guidance"
```

## Task 3: Command Feedback Hooks

**Files:**
- Modify: `src/ui/input.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Add input feedback types and callback**

In `src/ui/input.ts`, add after constants:

```ts
export type CommandFeedbackKind =
  | 'move'
  | 'attack'
  | 'harvest'
  | 'capture'
  | 'rally'
  | 'place'
  | 'repair'
  | 'sell'
  | 'superweapon'
  | 'cancel';
```

Inside `InputController`, add:

```ts
  public onCommandFeedback: ((kind: CommandFeedbackKind, pos: Vec2) => void) | null = null;

  private feedback(kind: CommandFeedbackKind, pos: Vec2 | null): void {
    if (pos !== null && this.onCommandFeedback) this.onCommandFeedback(kind, pos);
  }
```

- [ ] **Step 2: Emit feedback for direct mode actions**

Add feedback calls in `handleMouseDown()`:

```ts
        this.feedback('place', { x: tile.x + 0.5, y: tile.y + 0.5 });
```

after successful `placeBuilding`.

```ts
        this.feedback('superweapon', { x: tile.x + 0.5, y: tile.y + 0.5 });
```

after successful `fireSuperweapon`.

```ts
        this.feedback(this.ui.sellMode ? 'sell' : 'repair', entityCenter(b, this.data));
```

after successful sell/repair dispatch.

```ts
      this.feedback('cancel', this.ui.hoverTile ? { x: this.ui.hoverTile.x + 0.5, y: this.ui.hoverTile.y + 0.5 } : null);
```

when RMB cancels an armed mode in `performContextAction()`.

- [ ] **Step 3: Emit feedback for context orders**

In `performContextAction()`, after each successful rally dispatch, add:

```ts
          this.feedback('rally', { x: tile.x + 0.5, y: tile.y + 0.5 });
```

In `contextOrder()`, add:

```ts
        this.feedback('capture', entityCenter(target, this.data));
```

after capture dispatch.

```ts
        this.feedback('attack', entityCenter(target, this.data));
```

after attack dispatch.

```ts
      this.feedback('harvest', { x: Math.floor(tile.x) + 0.5, y: Math.floor(tile.y) + 0.5 });
```

after harvest dispatch.

```ts
    this.feedback('move', dest);
```

after normal move dispatch.

- [ ] **Step 4: Route feedback into renderer effects**

In `src/main.ts`, add to the input setup:

```ts
  input.onCommandFeedback = (kind, pos) => {
    const nowFx = performance.now();
    const fxKind =
      kind === 'repair'
        ? 'heal'
        : kind === 'sell'
          ? 'sell'
          : kind === 'place'
            ? 'place'
            : kind === 'capture'
              ? 'capture'
              : 'moveFlash';
    renderer.addEffect({
      kind: fxKind,
      pos,
      startedAt: nowFx,
      duration: kind === 'attack' || kind === 'superweapon' ? 520 : 420,
      scale: kind === 'superweapon' ? 1.8 : kind === 'attack' ? 1.25 : 1,
      element:
        kind === 'attack' || kind === 'superweapon'
          ? DATA.factions[state.players[humanPlayer].faction].element
          : Element.NEUTRAL,
    });
  };
```

- [ ] **Step 5: Verify and commit**

Run:

```bash
PATH=/Users/iangoh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH \
/Users/iangoh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
/Users/iangoh/Documents/Codex/2026-06-11/goal-my-friend-open-source-this/work/.tools/npm-cli/bin/npm-cli.js \
run build
```

Expected: build passes.

Commit:

```bash
git add src/ui/input.ts src/main.ts
git commit -m "feat: add clear command acknowledgement feedback"
```

## Task 4: Premium HUD, Sidebar, And Menu Scanability

**Files:**
- Modify: `src/ui/sidebar.ts`
- Modify: `src/ui/menu.ts`

- [ ] **Step 1: Improve sidebar visual state CSS**

In `src/ui/sidebar.ts`, update these CSS rules:

```css
.pa-item {
  position: relative; border: 1px solid #343a63; border-radius: 4px;
  background: linear-gradient(180deg, #1a1d36 0%, #111426 100%);
  cursor: pointer; overflow: hidden; min-height: 74px;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.05);
}
.pa-item:hover { border-color: #6f9dff; box-shadow: 0 0 10px rgba(74,125,255,0.24), inset 0 1px 0 rgba(255,255,255,0.08); }
.pa-item.locked { opacity: 0.46; filter: grayscale(0.75) contrast(0.82); cursor: not-allowed; }
.pa-item.locked::after {
  content: ''; position: absolute; inset: 0;
  background: repeating-linear-gradient(135deg, rgba(0,0,0,0.18) 0 6px, transparent 6px 12px);
  pointer-events: none;
}
.pa-item.ready { border-color: #ffd95e; animation: pa-ready-pulse 650ms infinite alternate; }
.pa-item .pa-prog { position: absolute; left: 0; bottom: 16px; height: 4px; width: 0%; background: linear-gradient(90deg,#4a7dff,#9bc0ff); }
.pa-item .pa-item-name { font-size: 7.5px; text-align: center; padding: 3px 1px 4px; color: #c4ccf4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pa-item .pa-inf { position: absolute; top: 2px; left: 4px; font-size: 14px; font-weight: bold; color: #ffd95e;
  text-shadow: 0 1px 3px #000, 0 0 8px rgba(255,217,94,0.65); display: none; pointer-events: none; }
```

- [ ] **Step 2: Improve menu/lobby first impression**

In `src/ui/menu.ts`, update `.pa-panel`, `.pa-title`, and `.pa-btn.primary`:

```css
.pa-panel { position: relative; z-index: 2; background: rgba(13, 16, 30, 0.94); border: 1px solid #343a63; border-radius: 8px;
  padding: 28px 34px; box-shadow: 0 24px 70px rgba(0,0,0,0.68), inset 0 1px 0 rgba(255,255,255,0.06); max-height: 92vh; overflow-y: auto; scrollbar-width: thin; }
.pa-title { font-size: 44px; font-weight: bold; letter-spacing: 8px; text-align: center; color: #fff;
  text-shadow: 0 0 24px #4a7dff, 0 2px 0 #000; margin: 0 0 2px; }
.pa-btn.primary { background: linear-gradient(180deg, #34753a 0%, #1f4f24 100%); border-color: #6af079; font-weight: bold; }
```

Change the loading tip text selection to include a first-action tip:

```ts
const TIPS = [
  'First minute: power, refinery, barracks. Then scout before the first raid.',
  'Right-click crystals with harvesters to claim a Candy field deliberately.',
  'Volt Cinder hits air AND ground. The cheeks are not just for show.',
  'Low power slows construction and shuts down radar and advanced defenses.',
  'Harvesters auto-return to the nearest Candy Refinery. Protect them!',
  'Engineers (the Professors) capture enemy buildings. Escort them well.',
  'Fire beats Grass, Grass beats Water, Water beats Fire. +25% damage.',
  'Veteran creatures deal +25% damage. Elites self-heal. Keep them alive.',
  'Sell unwanted structures for half their cost — fast cash in a pinch.',
  'Press H to jump to your Citadel. Space jumps to the last attack.',
  'Hard AI snipes harvesters. Wall in your Candy fields or guard them.',
];
```

- [ ] **Step 3: Verify and commit**

Run:

```bash
PATH=/Users/iangoh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH \
/Users/iangoh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
/Users/iangoh/Documents/Codex/2026-06-11/goal-my-friend-open-source-this/work/.tools/npm-cli/bin/npm-cli.js \
run build
```

Expected: build passes and sidebar/menu CSS compiles in the TS template strings.

Commit:

```bash
git add src/ui/sidebar.ts src/ui/menu.ts
git commit -m "style: sharpen command UI readability"
```

## Task 5: Stronger Combat And Selection Readability

**Files:**
- Modify: `src/render/effects.ts`
- Modify: `src/render/renderer.ts`

- [ ] **Step 1: Add secondary impact sparks**

In `src/render/effects.ts`, inside `case 'impact'`, after the existing main `this.add({ kind, ... })`, add:

```ts
          if (ev.weaponClass !== WeaponClass.CLAW) {
            this.add({
              kind: ev.element === Element.WATER ? 'splash' : 'spark',
              pos: { x: ev.pos.x + 0.08, y: ev.pos.y - 0.08 },
              startedAt: now + 35,
              duration: 260,
              scale: 0.55 + ev.splash * 0.2,
              element: ev.element,
            });
          }
```

If `WeaponClass` is not imported in `effects.ts`, add it to the existing import from `../core/types`.

- [ ] **Step 2: Make selected units easier to track**

In `src/render/renderer.ts`, find the selected entity overlay block around health bars and selection rings. Strengthen selected rings by using:

```ts
ctx.globalAlpha = selected ? 0.95 : 0.55;
ctx.strokeStyle = selected ? this.playerHex[e.owner] : 'rgba(255,255,255,0.45)';
ctx.lineWidth = Math.max(1.25, 2.4 * z);
```

Keep the existing ellipse dimensions and restore `ctx.globalAlpha = 1` after drawing.

- [ ] **Step 3: Verify and commit**

Run:

```bash
PATH=/Users/iangoh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH \
/Users/iangoh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
/Users/iangoh/Documents/Codex/2026-06-11/goal-my-friend-open-source-this/work/.tools/npm-cli/bin/npm-cli.js \
run build
```

Expected: build passes.

Commit:

```bash
git add src/render/effects.ts src/render/renderer.ts
git commit -m "feat: improve combat and selection readability"
```

## Task 6: Balance Gate And AI Difficulty Tuning

**Files:**
- Modify: `tests/balance.ts`
- Modify: `package.json`
- Modify: `src/ai/ai.ts`

- [ ] **Step 1: Make balance expectations executable**

At the end of `tests/balance.ts`, replace the final two console lines with:

```ts
const hardTarget = Math.ceil(REPS * 3 * 0.66);
const mediumTarget = Math.ceil(REPS * 3 * 0.66);
console.log(`\nfaction wins (hard mirror-cross): ${JSON.stringify(fw)}`);
console.log(`hard beat medium in ${hardOk}/${REPS * 3}; medium beat easy in ${medOk}/${REPS * 3}`);
if (hardOk < hardTarget || medOk < mediumTarget) {
  console.error(
    `FAIL: expected hard>=${hardTarget}/${REPS * 3} and medium>=${mediumTarget}/${REPS * 3}, ` +
      `got hard=${hardOk}, medium=${medOk}`,
  );
  process.exit(1);
}
console.log('PASS balance');
```

Add this script to `package.json`:

```json
"test:balance": "tsx tests/balance.ts --reps 2 --maxMin 35"
```

- [ ] **Step 2: Run balance and verify current behavior**

Run:

```bash
PATH=/Users/iangoh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH \
/Users/iangoh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
/Users/iangoh/Documents/Codex/2026-06-11/goal-my-friend-open-source-this/work/.tools/npm-cli/bin/npm-cli.js \
run test:balance
```

Expected before tuning: likely FAIL or marginal hard-vs-medium result. Record the hard/medium counts in the commit notes if they are surprising.

- [ ] **Step 3: Tune difficulty parameters**

In `src/ai/ai.ts`, update `PARAMS`:

```ts
  medium: {
    harvTarget: 4,
    waveIntervalTicks: secondsToTicks(195),
    waveMin: 11,
    creditReserve: 120,
    scout: true,
    navalAir: true,
    airCap: 3,
    navalCap: 3,
    sw: 'delayed',
    retreatMicro: false,
    engineer: false,
    repair: false,
    reinforce: false,
    flank: false,
    defendSeconds: 12,
  },
  hard: {
    harvTarget: 5,
    waveIntervalTicks: secondsToTicks(85),
    waveMin: 14,
    creditReserve: 250,
    scout: true,
    navalAir: true,
    airCap: 5,
    navalCap: 4,
    sw: 'instant',
    retreatMicro: true,
    engineer: true,
    repair: true,
    reinforce: true,
    flank: true,
    defendSeconds: 22,
  },
```

Update jitter constants:

```ts
const WAVE_THRESHOLD_JITTER = 0.22;
const RUSH_POOL_FRACTION = 0.62;
```

- [ ] **Step 4: Run balance until the gate passes**

Run:

```bash
PATH=/Users/iangoh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH \
/Users/iangoh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
/Users/iangoh/Documents/Codex/2026-06-11/goal-my-friend-open-source-this/work/.tools/npm-cli/bin/npm-cli.js \
run test:balance
```

Expected: `PASS balance`.

If the gate still fails because hard loses too often, make only targeted AI parameter changes in this order and rerun after each. First change the hard `PARAMS` fields to:

```ts
waveIntervalTicks: secondsToTicks(78),
waveMin: 13,
```

If hard still misses the target, change the medium `PARAMS` fields to:

```ts
waveIntervalTicks: secondsToTicks(210),
waveMin: 12,
```

Do not weaken easy unless medium fails to beat easy.

- [ ] **Step 5: Commit balance gate and tuning**

Run:

```bash
PATH=/Users/iangoh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH \
/Users/iangoh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
/Users/iangoh/Documents/Codex/2026-06-11/goal-my-friend-open-source-this/work/.tools/npm-cli/bin/npm-cli.js \
run test:headless -- --matches 3 --maxMin 30 --seed 42
```

Expected: `PASS`.

Commit:

```bash
git add package.json tests/balance.ts src/ai/ai.ts
git commit -m "fix: make AI difficulty ordering more reliable"
```

## Task 7: Full Verification And Browser Smoke

**Files:**
- Modify only files needed to fix verification failures.

- [ ] **Step 1: Run all local automated checks**

Run:

```bash
PATH=/Users/iangoh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH \
/Users/iangoh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
/Users/iangoh/Documents/Codex/2026-06-11/goal-my-friend-open-source-this/work/.tools/npm-cli/bin/npm-cli.js \
run test:guidance
```

Expected: `PASS guidance`.

Run:

```bash
PATH=/Users/iangoh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH \
/Users/iangoh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
/Users/iangoh/Documents/Codex/2026-06-11/goal-my-friend-open-source-this/work/.tools/npm-cli/bin/npm-cli.js \
run test:headless -- --matches 3 --maxMin 30 --seed 42
```

Expected: `PASS`.

Run:

```bash
PATH=/Users/iangoh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH \
/Users/iangoh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
/Users/iangoh/Documents/Codex/2026-06-11/goal-my-friend-open-source-this/work/.tools/npm-cli/bin/npm-cli.js \
run test:balance
```

Expected: `PASS balance`.

Run:

```bash
PATH=/Users/iangoh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH \
/Users/iangoh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
/Users/iangoh/Documents/Codex/2026-06-11/goal-my-friend-open-source-this/work/.tools/npm-cli/bin/npm-cli.js \
run build
```

Expected: Vite production build succeeds and writes `dist/`.

- [ ] **Step 2: Run browser smoke at 1280x720 and 960x720**

Start dev server:

```bash
PATH=/Users/iangoh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH \
/Users/iangoh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
/Users/iangoh/Documents/Codex/2026-06-11/goal-my-friend-open-source-this/work/.tools/npm-cli/bin/npm-cli.js \
run dev -- --host 127.0.0.1 --port 5173
```

Browser smoke requirements:

- Menu shows `POCKET ALERT` and `Skirmish`.
- Default skirmish starts.
- HUD shows clock, unit count, FPS, and the first guidance panel.
- Sidebar remains usable at `1280x720`.
- Sidebar and guidance remain usable at `960x720`.
- Console has no `error` or `warning` entries.

- [ ] **Step 3: Commit verification-only fixes**

If browser smoke requires a fix, commit it:

```bash
git add src
git commit -m "fix: address release candidate smoke issues"
```

If no fixes are needed, do not create an empty commit.

## Task 8: Vercel Production Deployment

**Files:**
- Modify: `vercel.json` only if Vercel cannot infer Vite static output.

- [ ] **Step 1: Install or run Vercel CLI without committing it**

Use the existing temporary npm CLI and do not write the token to any file:

```bash
PATH=/Users/iangoh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH \
/Users/iangoh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
/Users/iangoh/Documents/Codex/2026-06-11/goal-my-friend-open-source-this/work/.tools/npm-cli/bin/npm-cli.js \
exec --yes vercel@54.11.1 -- --version
```

Expected: prints `54.11.1` or newer compatible Vercel CLI version.

- [ ] **Step 2: Deploy production build**

Run from repo root with the token in the environment. Deploy the exact verified `dist/` static directory:

```bash
PATH=/Users/iangoh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH \
VERCEL_TOKEN="$VERCEL_TOKEN" \
/Users/iangoh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
/Users/iangoh/Documents/Codex/2026-06-11/goal-my-friend-open-source-this/work/.tools/npm-cli/bin/npm-cli.js \
exec --yes vercel@54.11.1 -- deploy dist --prod --yes --token "$VERCEL_TOKEN"
```

Expected: Vercel prints a production deployment URL. Do not paste the token in logs, files, or final notes.

If Vercel asks for output settings or deploys the wrong directory, add `vercel.json`:

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite"
}
```

Then run:

```bash
git add vercel.json
git commit -m "chore: configure vercel static deployment"
```

and redeploy.

- [ ] **Step 3: Verify deployed URL**

Open the deployed URL in the in-app browser and verify:

- Page title is `Pocket Alert — Creature Command`.
- Menu loads.
- A default skirmish starts.
- No browser console errors appear.

- [ ] **Step 4: Final status**

Run:

```bash
git status --short --branch
git log --oneline -8
```

Expected: only intentional commits are ahead of `origin/main`; no untracked build output, `.vercel`, or secret files.

Report:

- Deployed URL.
- Verification commands that passed.
- Any residual known risk.
