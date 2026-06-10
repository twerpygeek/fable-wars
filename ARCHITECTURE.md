# Pocket Alert — Architecture Contract

RA2-style isometric RTS. Vanilla TypeScript + Canvas 2D, zero runtime deps, Vite build.
**Every module must compile against `src/core/types.ts` and `src/core/constants.ts` exactly as written.**
Read those two files before writing any code. Do not modify them — if a contract gap blocks you,
make the smallest reasonable local choice and note it in a code comment.

## Data flow (the law)

```
                    Command[]                GameEvent[]
  ui/input.ts  ───────────────►  sim/game.ts ───────────────►  audio/*, render/effects
  ai/ai.ts     ───────────────►  tickGame()
                                     │ mutates
                                     ▼
                                 GameState  ◄─── read-only ─── render/*, ui/*
```

- The sim is headless and deterministic: `tickGame(state, data, commands)` is the ONLY mutator.
- Renderer/UI read GameState directly but never write it.
- AI produces Commands only; its scratchpad is `player.aiMemory`.
- No module may use `Math.random()` in sim-affecting code — use `simRandom(state)` from core/rng.

## Module contracts (file ownership — write ONLY your files)

### src/data/ — factions, units, buildings, superweapons
Files: `data/factions.ts`, `data/units.ts`, `data/buildings.ts`, `data/index.ts`
```ts
// data/index.ts
export const DATA: GameData; // fully populated, validated (prerequisites exist, etc.)
export function defOf(defId: string): UnitDef | BuildingDef; // throws on unknown
```
Three factions (see DESIGN.md for rosters/identity). Def id convention: `<faction>_<name>` e.g.
`scorch_peekachoo`, `tide_navalyard`. Every def's `spriteKey` equals its `id`.

### src/map/ — terrain + procedural generation
Files: `map/mapgen.ts`, `map/terrain.ts`
```ts
// terrain.ts
export function isGroundPassable(map: GameMap, x: number, y: number): boolean; // tile-int coords
export function isWaterPassable(map: GameMap, x: number, y: number): boolean;
export function passableFor(map: GameMap, domain: MoveDomain, x: number, y: number): boolean; // AIR always true in-bounds
// mapgen.ts
export function generateMap(seed: number, size: 'S'|'M'|'L', water: 'low'|'medium'|'high', playerCount: number): GameMap;
```
Mapgen requirements: seeded via mulberry32(seed) only; symmetric-ish fairness (each start position
gets a clear 12x12 buildable area + a crystal field of ~20 tiles within 10 tiles); start positions
spread (corners/edges); water as coherent lakes/rivers scaled by `water` param — at 'medium'+ every
start position must have reachable shoreline (a WATER region of ≥ 30 tiles within 22 tiles of the start,
so naval yards are placeable); rocks/trees as scattered obstacle clusters; extra neutral crystal fields
mid-map; ALL land must be one connected region (flood-fill check, regenerate or carve if not).

### src/sim/pathfinding.ts
```ts
export function findPath(map: GameMap, domain: MoveDomain, from: Vec2, to: Vec2,
                         isBlocked?: (x: number, y: number) => boolean): Vec2[] | null;
// A* on tile grid, 8-directional, no corner cutting through impassables.
// AIR: return [to]. If `to` unreachable, path to nearest reachable tile (within 6 tiles of to); else null.
// Waypoints are tile centers (x+0.5 like coords NOT needed — use integer tile coords; movement.ts
// interpolates). Must handle 96x96 maps fast: binary heap, typed-array visited.
export function findNearestTile(map: GameMap, from: Vec2, pred: (x: number, y: number) => boolean, maxR?: number): Vec2 | null; // BFS ring search
```

### src/sim/ — core simulation (two owners)

**Owner A — files: `sim/game.ts`, `sim/entity.ts`, `sim/economy.ts`, `sim/production.ts`**
```ts
// game.ts
export function createGame(config: GameConfig, data: GameData): GameState;
// Spawns per player: ConYard placed at start position + 2 starting harvesters + STARTING_CREDITS.
export function tickGame(state: GameState, data: GameData, commands: Command[]): GameEvent[];
// Tick order: applyCommands → production → economy(power, harvest credit, repair) → unit brains
// (movement/combat via Owner B exports) → projectiles → captures → superweapons → fog → cleanup
// (deaths, elimination, winner) → occupancy rebuild. Collect events from all phases.
// entity.ts
export function spawnUnit(state: GameState, data: GameData, defId: string, owner: PlayerId, pos: Vec2): Entity;
export function spawnBuilding(state: GameState, data: GameData, defId: string, owner: PlayerId, pos: Vec2, instant?: boolean): Entity;
export function removeEntity(state: GameState, id: EntityId): void;
export function entitiesOf(state: GameState, player: PlayerId): Entity[];
export function buildingsOf(state: GameState, player: PlayerId): Entity[];
// production.ts
export function canQueue(state: GameState, data: GameData, player: PlayerId, defId: string): { ok: boolean; reason?: string };
// checks prerequisites (built+operational), tier gates (radar=>t2, techlab=>t3), credits not checked here (pay-as-you-build)
export function findPlacement(state: GameState, data: GameData, player: PlayerId, defId: string, near?: Vec2): Vec2 | null; // used by AI
export function isValidPlacement(state: GameState, data: GameData, player: PlayerId, defId: string, pos: Vec2): boolean;
// footprint passable & unoccupied & correct terrain (placeOnWater on WATER, else ground non-CRYSTAL),
// within BUILD_RADIUS of an own building, fully explored by that player.
```
Economy: harvester logic is an order-driven state machine (harvest → full → returnCargo → unload → repeat,
auto-retarget nearest crystal). Power: recompute produced/consumed; low power → production at
LOW_POWER_BUILD_FACTOR, radar off, needsPower defenses offline. Pay-as-you-build: queue progress
advances only while credits flow (cost/buildTicks per tick, fire `insufficientFunds` at most every 5s when starved).
Units: queue completes → spawn at producer building (rally applied). Structures: completes → `readyBuilding`,
wait for placeBuilding command. Selling: SELL_REFUND, units inside unaffected. ConYard death ≠ elimination;
elimination = zero buildings remaining.

**Owner B — files: `sim/movement.ts`, `sim/combat.ts`, `sim/fog.ts`, `sim/superweapons.ts`**
```ts
// movement.ts
export function updateUnitMovement(state: GameState, data: GameData, u: Entity, events: GameEvent[]): void;
// follows u.path at def.speed/TICK_RATE tiles per tick; soft collision (if next tile center occupied by
// stationary unit, sidestep or repath, honoring repathCooldown); sets facing from velocity.
export function orderMove(state: GameState, data: GameData, u: Entity, dest: Vec2): void; // computes path via pathfinding
// combat.ts
export function updateUnitCombat(state: GameState, data: GameData, u: Entity, events: GameEvent[]): void;
// target acquisition (attackMove/guard auto-acquire in sight; attack chases), range check via entityCenter,
// fire → spawn Projectile (homing for units, isAirTarget = target is AIR domain), cooldowns, stances.
export function updateProjectiles(state: GameState, data: GameData, events: GameEvent[]): void;
// move, hit, splash (SPLASH_FALLOFF at edge), damage = base * WEAPON_VS_ARMOR * elementMultiplier * VET bonus.
// kills credit attacker vet (promotion event). Buildings fight too (defense weapons need power if needsPower).
export function dealDamage(state: GameState, data: GameData, targetId: EntityId, rawDamage: number,
                           wc: WeaponClass, elem: Element, attacker: EntityId | null, events: GameEvent[]): void;
// fog.ts
export function updateFog(state: GameState, data: GameData): void; // visible from entity sight radii; explored |= visible
export function isVisibleTo(state: GameState, player: PlayerId, x: number, y: number): boolean;
// superweapons.ts
export function updateSuperweapons(state: GameState, data: GameData, events: GameEvent[]): void; // charge timers, ready events
export function launchSuperweapon(state: GameState, data: GameData, player: PlayerId, target: Vec2, events: GameEvent[]): void;
// nuke: big instant blast after 3s travel; storm: 8s of random strikes in radius; spore: lingering DoT field.
// Implement delayed effects as entries in player.aiMemory? NO — keep a module-level pending list keyed
// by state object? NO — store pending strikes in state via projectiles array (special sourceDefId 'sw_*').
```
Also: `capture` order — engineer adjacent to enemy building channels CAPTURE_TICKS then transfers owner
(engineer consumed). Repair depot heals nearby ground units. Elite self-heal.

### src/ai/ai.ts
```ts
export function aiThink(state: GameState, data: GameData, player: PlayerId): Command[];
// called every AI_THINK_INTERVAL[difficulty] ticks by main loop (not by sim).
```
Personality by difficulty (easy/medium/hard): build-order quality, expansion, wave size/timing,
harvester harassment (hard), retreat micro (hard), superweapon use (medium delayed/hard on cooldown; easy never),
naval/air usage scaling, rebuild destroyed key buildings, defend base when underAttack. No cheating:
AI sees only `player.explored`-gated info — use a helper that filters enemy entities by explored/visible.
Scout with cheap units. Keep state in `player.aiMemory` (typed locally via interface cast).

### src/render/ — isometric renderer (two owners)

**Owner C — files: `render/renderer.ts`, `render/camera.ts`, `render/effects.ts`, `render/minimap.ts`**
```ts
// camera.ts
export function tileToScreen(cam: Camera, x: number, y: number): { sx: number; sy: number }; // iso project
export function screenToTile(cam: Camera, sx: number, sy: number): Vec2; // inverse (float tile coords)
export function clampCamera(cam: Camera, map: GameMap, viewW: number, viewH: number): void;
// renderer.ts
export class Renderer {
  constructor(canvas: HTMLCanvasElement, data: GameData, sprites: SpriteAtlas);
  render(state: GameState, cam: Camera, ui: UIState, humanPlayer: PlayerId, nowMs: number, alpha: number): void;
  addEffect(fx: VisualEffect): void;
  handleEvents(events: GameEvent[], state: GameState, humanPlayer: PlayerId): void; // spawn VFX from events
}
// draw order: terrain (diamond tiles w/ texture variation, crystal sparkle) → grid-position-sorted
// entities & projectiles & building ghosts (depth sort key x+y) → air units → effects → fog shroud
// (explored=dim, unexplored=black, soft edges) → selection rings, health bars (when damaged or selected),
// vet chevrons, rally lines, placement ghost (green/red), drag-select rect, superweapon target reticle.
// Health bars: green>yellow>red. Player color outline/badge on every entity.
// minimap.ts
export class Minimap {
  constructor(canvas: HTMLCanvasElement);
  render(state: GameState, cam: Camera, humanPlayer: PlayerId, viewW: number, viewH: number): void; // terrain+entities dots+view rect; black if no radar
  minimapToTile(mx: number, my: number, state: GameState): Vec2;
}
```
Use offscreen-canvas caching for terrain (redraw only on crystal change/fog delta is fine to skip — fog drawn as overlay each frame is OK if cheap). 60fps target on a 96x96 map with 300 entities.

**Owner D — files: `render/sprites.ts`** (the art module — biggest craft burden)
```ts
export interface SpriteAtlas {
  // pre-rendered frames; key = def spriteKey
  getUnitSprite(key: string, facing8: number, frame: number, colorIdx: number): HTMLCanvasElement; // 8 facings, 2 walk frames + idle shares frame 0
  getBuildingSprite(key: string, colorIdx: number, constructed: boolean): HTMLCanvasElement;
  getTerrainTile(t: Terrain, variant: number): HTMLCanvasElement; // 3 variants each, iso diamonds TILE_W x TILE_H (+overhang for trees/rocks)
  getProjectileSprite(weaponClass: WeaponClass, element: Element): HTMLCanvasElement;
  getIcon(key: string): HTMLCanvasElement; // 56x42 sidebar build icons for every def + superweapon ids
}
export function buildSpriteAtlas(data: GameData): SpriteAtlas; // call once at load; pure canvas drawing
```
Style: chibi creature sprites — rounded bodies, big heads/eyes, elemental motifs (flame tails/manes for
scorch; fins/shells/bubbles for tide; leaves/vines/petals for verdant). Unit canvas 64x64 (infantry ~36px
tall, vehicles ~48, t3 ~58). Buildings iso-block structures w/ faction materials (obsidian+lava glow /
coral+water / wood+foliage), footprint-sized (footprint.w*TILE_HALF_W*2 wide). Player color as accent band
+ outline. Draw with gradients, shading (light from NW), 2px dark outline, NO raw rectangles-only
programmer art. Parameterize by def via a per-key drawing function table; mirror facings 5→8.

### src/ui/ — owner E — files: `ui/sidebar.ts`, `ui/hud.ts`, `ui/input.ts`, `ui/menu.ts`
DOM-based UI (divs/buttons over the canvas) for sidebar+menus; canvas HUD overlays handled by renderer.
```ts
// sidebar.ts
export class Sidebar {
  constructor(root: HTMLElement, data: GameData, icons: SpriteAtlas,
              dispatch: (c: Command) => void, getState: () => GameState, humanPlayer: PlayerId, ui: UIState);
  update(): void; // call each frame: credits ticker, power bar, queue progress, tab badges, superweapon button+timer
}
// RA2 layout: right column w/ minimap top, credits+power, tab strip (Structures/Defense/Inf/Veh/Air/Naval),
// scrollable icon grid (cost, name, greyed when locked w/ tooltip reason, progress overlay on items[0],
// READY flashing → click arms placement), repair/sell mode toggles, superweapon button w/ countdown.
// menu.ts
export class MenuManager {
  constructor(root: HTMLElement, onStartGame: (cfg: GameConfig) => void);
  showMainMenu(): void; showLobby(): void;
  showLoading(msg: string): void;
  showGameOver(victory: boolean, stats: string, onBackToMenu: () => void): void;
  showEscMenu(opts: { onResume: () => void; onSurrender: () => void; onQuit: () => void }): void; hideEscMenu(): void;
}
// Lobby: faction cards (3, with blurbs+rosters preview), player color, 1-3 AI slots (faction incl 'random',
// difficulty, color), map size, water amount, seed (random button + text input), Start button.
// Styled: dark military-command aesthetic w/ creature charm, CSS in ui/style injected <style>.
// input.ts
export class InputController {
  constructor(canvas: HTMLCanvasElement, cam: Camera, ui: UIState,
              getState: () => GameState, data: GameData, dispatch: (c: Command) => void, humanPlayer: PlayerId,
              sprites: SpriteAtlas);
  update(dtMs: number, viewW: number, viewH: number): void; // edge scroll + key scroll
}
// LMB: select / drag-select (own units; double-click = select same type on screen); with placingDefId → placeBuilding;
// sell/repair modes → apply; superweapon targeting → fireSuperweapon. RMB: context order (move/attack/
// harvest/capture per target under cursor) + queued with Shift; also cancels modes. A+LMB attackMove. S stop, G guard.
// Ctrl+1..9 set group, 1..9 recall, double-tap center. H center on ConYard. ESC menu. Keyboard scroll WASD/arrows.
// hud.ts — small canvas-top overlays not in sidebar:
export class HUD {
  constructor(root: HTMLElement);
  update(state: GameState, humanPlayer: PlayerId): void; // top bar: elapsed time, unit count, FPS; toast queue for events
  toast(msg: string, kind: 'info' | 'warn'): void;
}
```

### src/audio/ — owner F — files: `audio/sfx.ts`, `audio/music.ts`, `audio/announcer.ts`, `audio/audio.ts`
```ts
// audio.ts
export class AudioSystem {
  constructor();
  handleEvents(events: GameEvent[], state: GameState, humanPlayer: PlayerId, cam: Camera, viewW: number, viewH: number): void;
  setEnabled(sfx: boolean, music: boolean, voice: boolean): void;
  startMusic(): void; stopMusic(): void;
  resume(): void; // call on first user gesture (AudioContext unlock)
}
```
SFX: WebAudio-synthesized (oscillators+noise+filters+envelopes): per-weaponClass fire/impact sounds w/
element flavor, explosion (big for buildings), place/sell/click/error, superweapon alarms. Positional:
volume/pan by distance from camera center; cull off-screen quiet ones. Music: procedural chiptune-military
loop (minor key, driving bass + arp lead, ~115bpm) via scheduled WebAudio; subtle, loopable, with intensity
bump when underAttack recently. Announcer: speechSynthesis (deep/slow EVA-ish settings), priority queue,
no overlap, dedupe (UNDER_ATTACK_COOLDOWN), lines: "Construction complete", "Unit ready", "Our base is
under attack", "Insufficient funds", "Low power", "Superweapon ready"/"detected", "Building captured",
"Enemy commander eliminated", "Mission accomplished/failed", countdown at 10s for incoming superweapon.
Graceful no-voice fallback.

### src/main.ts + tests/headless.ts — integration owner (written LAST)
Game shell: menu → createGame → fixed-timestep loop (accumulator on TICK_MS * ui.gameSpeed; render every
frame with interpolation alpha) → collect commands from input + AIs (at their intervals) → tickGame →
feed events to renderer/audio/hud → victory/defeat screen. `window.__game = { state, data, dispatch }`
exposed for QA automation. tests/headless.ts: AI-vs-AI (no DOM) N-match harness, asserts a winner under
30 sim-minutes, prints per-match summary (winner, ticks, units built) — must run via `npm run test:headless`.

## Visual identity
Dark command-console UI (#0a0a12 bg, #1a1c2c panels, neon accent per faction), chunky beveled buttons,
Orbitron-ish feel using system fonts (font stack: 'Verdana, Geneva, sans-serif' + letterspacing; no webfont deps).
Terrain palette: lush saturated greens/sands, deep teal water — readable, cheerful, contrasts the dark UI.

## Hard rules
1. `npm run typecheck` must pass on your files against the contract — no `any` escape hatches on exports.
2. Sim code: no DOM, no Date.now/performance.now/Math.random — tick counts + simRandom only.
3. Renderer/UI/audio: never mutate GameState.
4. Only write YOUR files. Import other modules only via the signatures above.
5. Performance: no per-frame allocations in hot loops where avoidable; sprite lookups are pre-rendered canvases.
