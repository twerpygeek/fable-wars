// Fable Wars — application shell: menu → lobby → match loop → game over.
import type {
  Camera,
  Command,
  GameConfig,
  GameEvent,
  GameState,
  UIState,
} from './core/types';
import { TICK_MS, AI_THINK_INTERVAL } from './core/constants';
import { DATA } from './data/index';
import { createGame, tickGame } from './sim/game';
import { aiThink } from './ai/ai';
import {
  buildSpriteAtlas,
  loadSpriteOverrides,
  type SpriteAtlas,
  type SpriteOverrides,
} from './render/sprites';
import { showSpriteLab } from './render/spritelab';
import { Renderer } from './render/renderer';
import { Minimap } from './render/minimap';
import { clampCamera, tileToScreen } from './render/camera';
import { Sidebar } from './ui/sidebar';
import { HUD } from './ui/hud';
import { InputController } from './ui/input';
import { CameraControls } from './ui/cameraControls';
import { MenuManager } from './ui/menu';
import { WorldTooltip } from './ui/tooltip';
import { CrystalRushPanel } from './ui/crystalRushPanel';
import { recordMatch, type MatchResult } from './ui/history';
import { AudioSystem } from './audio/audio';
import { Element } from './core/types';
import { TICK_RATE } from './core/constants';
import { createOnlineCommandQueue, type OnlineMatchConnection } from './net/onlineCommands';
import { hashGameState } from './net/stateHash';

const app = document.getElementById('app')!;

let sprites: SpriteAtlas | null = null;
const audio = new AudioSystem();
const ONLINE_STATE_CHECK_INTERVAL = TICK_RATE * 4;

// Unlock WebAudio on first gesture.
const unlock = () => {
  audio.resume();
};
window.addEventListener('pointerdown', unlock);
window.addEventListener('keydown', unlock);

interface Match {
  state: GameState;
  stop: () => void;
}

let current: Match | null = null;
let overrides: SpriteOverrides | null = null;
const audioState = { sfx: true, music: true, voice: true };

const menus = new MenuManager(app, (cfg, online) => startMatch(cfg, online));
if (new URLSearchParams(location.search).has('spritelab')) {
  void loadSpriteOverrides().then((ov) => showSpriteLab(app, DATA, ov));
} else {
  menus.showMainMenu();
}

function freshUIState(): UIState {
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
  };
}

function startMatch(cfg: GameConfig, online?: OnlineMatchConnection): void {
  menus.showLoading('Generating battlefield…');
  // Yield to let the loading screen paint before heavy work.
  setTimeout(async () => {
    try {
      if (!sprites) {
        menus.showLoading('Hatching creatures…');
        overrides = await loadSpriteOverrides();
        sprites = buildSpriteAtlas(DATA, overrides);
      }
      const state = createGame(cfg, DATA);
      runMatch(state, online);
    } catch (err) {
      console.error('Failed to start match', err);
      menus.showMainMenu();
      alert('Failed to start match: ' + (err instanceof Error ? err.message : String(err)));
    }
  }, 50);
}

function runMatch(state: GameState, online?: OnlineMatchConnection): void {
  menus.hideMenus();
  const atlas = sprites!;
  const humanPlayer = Math.max(0, state.config.players.findIndex((p) => p.isHuman));

  // --- DOM scaffold for this match ---
  const matchRoot = document.createElement('div');
  matchRoot.id = 'match';
  matchRoot.style.cssText = 'position:absolute;inset:0;';
  app.appendChild(matchRoot);

  const canvas = document.createElement('canvas');
  matchRoot.appendChild(canvas);
  const resize = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  };
  resize();
  window.addEventListener('resize', resize);

  const ui = freshUIState();
  const cam: Camera = { x: 0, y: 0, zoom: 1 };
  const crystalRush = state.config.mode === 'crystalRush';
  const onCrystalRushKey = (e: KeyboardEvent) => {
    if (!crystalRush || e.key !== 'Escape') return;
    ui.showMenu = !ui.showMenu;
  };
  if (crystalRush) window.addEventListener('keydown', onCrystalRushKey);

  const pending: Command[] = [];
  const stateChecks = new Map<number, string>();
  const onlineQueue =
    online && crystalRush
      ? createOnlineCommandQueue({
          inputDelayTicks: 6,
          sendFrame: (tick, commands) => online.sendCommandFrame(tick, commands),
        })
      : null;
  online?.onCommandFrame((frame) => {
    if (!onlineQueue) return;
    onlineQueue.receiveFrame(frame);
  });
  const dispatch = (c: Command) => {
    if (onlineQueue && c.player === humanPlayer && c.type.startsWith('crystalRush')) {
      pending.push(...onlineQueue.dispatchLocal(state.tick, c));
      return;
    }
    pending.push(c);
    // Legacy acknowledgements for non-context paths that do not emit through
    // InputController.onCommandFeedback.
    if (c.type === 'issueOrder' && c.player === humanPlayer) {
      const o = c.order;
      if (o.kind === 'attackMove' || o.kind === 'attackGround') {
        renderer.addEffect({
          kind: 'moveFlash',
          pos: { x: o.dest.x, y: o.dest.y },
          startedAt: performance.now(),
          duration: 400,
          scale: 1,
          element: Element.GRASS,
        });
      }
    }
  };

  const renderer = new Renderer(canvas, DATA, atlas);
  const sidebar = crystalRush ? null : new Sidebar(matchRoot, DATA, atlas, dispatch, () => state, humanPlayer, ui);
  const minimap = sidebar === null ? null : new Minimap(sidebar.minimapCanvas);
  const hud = new HUD(matchRoot, DATA, ui);
  online?.onStateCheck((check) => {
    const localHash = stateChecks.get(check.tick);
    if (localHash !== undefined && localHash !== check.hash) {
      hud.toast('Online desync warning: this match no longer matches a peer.', 'warn');
      console.warn('Online desync warning', { tick: check.tick, localHash, remoteHash: check.hash });
    }
  });
  const input = crystalRush ? null : new InputController(canvas, cam, ui, () => state, DATA, dispatch, humanPlayer, atlas);
  const cameraControls = crystalRush ? new CameraControls(canvas, cam, () => state.map) : null;
  cameraControls?.enable();
  if (input !== null && sidebar !== null && minimap !== null) {
    input.bindMinimap(sidebar.minimapCanvas, minimap);
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
    input.enable();
  }
  const tooltip = crystalRush ? null : new WorldTooltip(matchRoot, DATA, () => state, humanPlayer);
  const rushPanel = crystalRush ? new CrystalRushPanel(matchRoot, dispatch, () => state, humanPlayer) : null;

  // Creature acknowledgement barks + cheer wiring.
  if (input !== null) {
    input.onSelectionAck = (defId) => audio.bark(defId);
    input.onCheer = (ids) => {
      audio.cheer();
      const nowMs = performance.now();
      ids.slice(0, 24).forEach((id, i) => {
        const u = state.entities.get(id);
        if (!u) return;
        renderer.addEffect({
          kind: 'cheer',
          pos: { x: u.pos.x, y: u.pos.y },
          startedAt: nowMs + i * 60,
          duration: 1200,
          scale: 1,
          element: Element.NEUTRAL,
        });
      });
    };
  }

  // Start on the human base. Crystal Rush labels and command cards point the
  // player toward the center objective, but first contact should answer
  // "which side is mine?"
  const ownConYard = [...state.entities.values()].find(
    (e) => e.owner === humanPlayer && e.kind === 'building' && DATA.buildings[e.defId]?.isConYard
  );
  const cameraTarget = ownConYard ? { x: ownConYard.pos.x + 1.5, y: ownConYard.pos.y + 1.5 } : null;
  if (cameraTarget !== null) {
    const { sx, sy } = tileToScreen({ x: 0, y: 0, zoom: cam.zoom }, cameraTarget.x, cameraTarget.y);
    cam.x = sx - canvas.width / 2;
    cam.y = sy - canvas.height / 2;
    clampCamera(cam, state.map, canvas.width, canvas.height);
  }

  audio.startMusic();

  // --- fixed-timestep loop ---
  let raf = 0;
  let last = performance.now();
  let acc = 0;
  let escShown = false;
  let over = false;
  let stopped = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    window.removeEventListener('keydown', onCrystalRushKey);
    input?.disable();
    cameraControls?.disable();
    tooltip?.destroy();
    rushPanel?.destroy();
    sidebar?.destroy();
    audio.stopMusic();
    matchRoot.remove();
    current = null;
  };

  const quitToMenu = () => {
    stop();
    menus.showMainMenu();
  };

  // AI taunt flavor: parody trash talk when the AI lands a meaningful blow.
  const TAUNTS = ['Ha ha ha!', 'You coward.', 'Was that your economy?', 'Surrender now!', 'Too easy.'];
  let lastTauntAt = 0;
  const maybeTaunt = (events: GameEvent[]) => {
    const nowMs = performance.now();
    if (nowMs - lastTauntAt < 25000) return;
    for (const ev of events) {
      if (ev.type !== 'entityDied' || ev.owner !== humanPlayer || ev.kind !== 'building') continue;
      const key = ev.defId.slice(ev.defId.indexOf('_') + 1);
      if (key !== 'refinery' && key !== 'conyard' && key !== 'sw') continue;
      const ai = state.players.find((p) => !p.isHuman && !p.eliminated);
      if (!ai) return;
      lastTauntAt = nowMs;
      const text = TAUNTS[Math.floor(Math.random() * TAUNTS.length)];
      hud.toast(`💬 ${ai.name}: "${text}"`, 'warn');
      audio.handleEvents(
        [{ type: 'aiTaunt', player: ai.id, text }],
        state,
        humanPlayer,
        cam,
        canvas.width,
        canvas.height,
      );
      return;
    }
  };

  const buildMatchResult = (winner: number | null): MatchResult => ({
    dateISO: new Date().toISOString(),
    seed: state.config.seed,
    mapSize: state.config.mapSize,
    water: state.config.waterAmount,
    crates: state.config.crates,
    durationSec: Math.round(state.tick / TICK_RATE),
    victory: winner === humanPlayer,
    players: state.players.map((p) => ({
      name: p.name,
      faction: p.faction,
      colorIdx: p.colorIdx,
      isHuman: p.isHuman,
      difficulty: p.difficulty,
      eliminated: p.eliminated,
      stats: { ...p.stats },
    })),
    humanIdx: humanPlayer,
  });

  const routeEvents = (events: GameEvent[]) => {
    renderer.handleEvents(events, state, humanPlayer);
    audio.handleEvents(events, state, humanPlayer, cam, canvas.width, canvas.height);
    input?.notifyEvents(events);
    maybeTaunt(events);
    for (const ev of events) {
      if (ev.type === 'gameOver' && !over) {
        over = true;
        const result = buildMatchResult(ev.winner);
        try {
          recordMatch(result);
        } catch (err) {
          console.warn('history record failed', err);
        }
        setTimeout(() => {
          stop();
          menus.showScoreScreen(
            result,
            () => {
              if (menus.lastConfig) startMatch(menus.lastConfig);
              else menus.showMainMenu();
            },
            () => menus.showMainMenu(),
          );
        }, 2500); // let the final explosion play out
      }
      if (ev.type === 'playerEliminated' && ev.player !== humanPlayer) {
        hud.toast(`${state.players[ev.player].name} has been eliminated!`, 'info');
      }
      if (ev.type === 'superweaponLaunched' && ev.byPlayer !== humanPlayer) {
        hud.toast('⚠ ENEMY SUPERWEAPON LAUNCHED', 'warn');
      }
      if (ev.type === 'cratePickup' && ev.player === humanPlayer) {
        hud.toast(ev.kind === 'money' ? `🎁 Crate: +$${ev.amount ?? 0}` : `🎁 Crate: ${ev.kind}!`, 'info');
      }
    }
  };

  const frame = (now: number) => {
    if (stopped) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(100, now - last);
    last = now;

    // ESC menu handling
    if (ui.showMenu && !escShown) {
      escShown = true;
      ui.paused = true;
      menus.showEscMenu({
        onResume: () => {
          ui.showMenu = false;
          ui.paused = false;
          escShown = false;
          menus.hideEscMenu();
        },
        onSurrender: () => {
          ui.showMenu = false;
          ui.paused = false;
          escShown = false;
          menus.hideEscMenu();
          dispatch({ type: 'surrender', player: humanPlayer });
        },
        onQuit: () => {
          menus.hideEscMenu();
          quitToMenu();
        },
        audioToggles: [
          {
            label: 'SFX',
            get: () => audioState.sfx,
            set: (on: boolean) => {
              audioState.sfx = on;
              audio.setEnabled(audioState.sfx, audioState.music, audioState.voice);
            },
          },
          {
            label: 'Music',
            get: () => audioState.music,
            set: (on: boolean) => {
              audioState.music = on;
              audio.setEnabled(audioState.sfx, audioState.music, audioState.voice);
            },
          },
          {
            label: 'Voice',
            get: () => audioState.voice,
            set: (on: boolean) => {
              audioState.voice = on;
              audio.setEnabled(audioState.sfx, audioState.music, audioState.voice);
            },
          },
        ],
      });
    } else if (!ui.showMenu && escShown) {
      escShown = false;
      ui.paused = false;
      menus.hideEscMenu();
    }

    if (!ui.paused && state.winner === null) {
      acc += dt * ui.gameSpeed;
      let safety = 0;
      // ?sandbox=1 disables AI thinking — a stable test bed for QA automation.
      const sandbox = new URLSearchParams(location.search).has('sandbox');
      while (acc >= TICK_MS && safety < 8) {
        // AI commands at each AI's think cadence
        for (const p of state.players) {
          if (crystalRush || sandbox || p.isHuman || p.eliminated || !p.difficulty) continue;
          if (state.tick % AI_THINK_INTERVAL[p.difficulty] === (p.id * 3) % AI_THINK_INTERVAL[p.difficulty]) {
            try {
              pending.push(...aiThink(state, DATA, p.id));
            } catch (err) {
              console.error('AI error (player ' + p.id + ')', err);
            }
          }
        }
        if (onlineQueue) pending.push(...onlineQueue.drain(state.tick));
        const commands = pending.splice(0, pending.length);
        const events = tickGame(state, DATA, commands);
        routeEvents(events);
        if (online && onlineQueue && state.tick % ONLINE_STATE_CHECK_INTERVAL === 0) {
          online.sendStateCheck(state.tick, hashGameState(state));
          stateChecks.set(state.tick, hashGameState(state));
          while (stateChecks.size > 8) stateChecks.delete(Math.min(...stateChecks.keys()));
        }
        acc -= TICK_MS;
        safety++;
      }
      if (safety >= 8) acc = 0; // dropped behind; don't spiral
    }

    input?.update(dt, canvas.width, canvas.height);
    cameraControls?.update(dt, canvas.width, canvas.height, ui.paused);
    clampCamera(cam, state.map, canvas.width, canvas.height);
    const alpha = Math.min(1, acc / TICK_MS);
    renderer.render(state, cam, ui, humanPlayer, now, alpha);
    minimap?.render(state, cam, humanPlayer, canvas.width, canvas.height);
    sidebar?.update();
    hud.update(state, humanPlayer);
    rushPanel?.update();
    tooltip?.update(input?.hoveredEntityId ?? null);
  };

  raf = requestAnimationFrame(frame);
  current = { state, stop };

  // QA / debugging hook
  (window as unknown as Record<string, unknown>).__game = {
    get state() {
      return current?.state ?? null;
    },
    data: DATA,
    dispatch,
    ui,
    cam,
    input,
    cameraControls,
    quitToMenu,
    // QA: advance the sim n ticks synchronously (rAF is suspended in hidden tabs).
    pump(n: number) {
      const sandbox = new URLSearchParams(location.search).has('sandbox');
      for (let i = 0; i < n && state.winner === null; i++) {
        for (const p of state.players) {
          if (crystalRush || sandbox || p.isHuman || p.eliminated || !p.difficulty) continue;
          if (state.tick % AI_THINK_INTERVAL[p.difficulty] === (p.id * 3) % AI_THINK_INTERVAL[p.difficulty]) {
            pending.push(...aiThink(state, DATA, p.id));
          }
        }
        routeEvents(tickGame(state, DATA, pending.splice(0, pending.length)));
      }
    },
  };
}

function formatClock(tick: number): string {
  const s = Math.floor(tick / 15);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
