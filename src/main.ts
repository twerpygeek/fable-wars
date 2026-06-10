// Pocket Alert — application shell: menu → lobby → match loop → game over.
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
import { buildSpriteAtlas, type SpriteAtlas } from './render/sprites';
import { Renderer } from './render/renderer';
import { Minimap } from './render/minimap';
import { clampCamera, tileToScreen } from './render/camera';
import { Sidebar } from './ui/sidebar';
import { HUD } from './ui/hud';
import { InputController } from './ui/input';
import { MenuManager } from './ui/menu';
import { AudioSystem } from './audio/audio';

const app = document.getElementById('app')!;

let sprites: SpriteAtlas | null = null;
const audio = new AudioSystem();

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

const menus = new MenuManager(app, (cfg) => startMatch(cfg));
menus.showMainMenu();

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

function startMatch(cfg: GameConfig): void {
  menus.showLoading('Generating battlefield…');
  // Yield to let the loading screen paint before heavy work.
  setTimeout(() => {
    try {
      if (!sprites) {
        menus.showLoading('Hatching creatures…');
        sprites = buildSpriteAtlas(DATA);
      }
      const state = createGame(cfg, DATA);
      runMatch(state);
    } catch (err) {
      console.error('Failed to start match', err);
      menus.showMainMenu();
      alert('Failed to start match: ' + (err instanceof Error ? err.message : String(err)));
    }
  }, 50);
}

function runMatch(state: GameState): void {
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

  const pending: Command[] = [];
  const dispatch = (c: Command) => {
    pending.push(c);
  };

  const renderer = new Renderer(canvas, DATA, atlas);
  const sidebar = new Sidebar(matchRoot, DATA, atlas, dispatch, () => state, humanPlayer, ui);
  const minimap = new Minimap(sidebar.minimapCanvas);
  const hud = new HUD(matchRoot);
  const input = new InputController(canvas, cam, ui, () => state, DATA, dispatch, humanPlayer, atlas);
  input.bindMinimap(sidebar.minimapCanvas, minimap);
  input.enable();

  // Center camera on the human ConYard.
  const ownConYard = [...state.entities.values()].find(
    (e) => e.owner === humanPlayer && e.kind === 'building' && DATA.buildings[e.defId]?.isConYard
  );
  if (ownConYard) {
    const { sx, sy } = tileToScreen({ x: 0, y: 0, zoom: cam.zoom }, ownConYard.pos.x + 1.5, ownConYard.pos.y + 1.5);
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
    input.disable();
    audio.stopMusic();
    matchRoot.remove();
    current = null;
  };

  const quitToMenu = () => {
    stop();
    menus.showMainMenu();
  };

  const routeEvents = (events: GameEvent[]) => {
    renderer.handleEvents(events, state, humanPlayer);
    audio.handleEvents(events, state, humanPlayer, cam, canvas.width, canvas.height);
    input.notifyEvents(events);
    for (const ev of events) {
      if (ev.type === 'gameOver' && !over) {
        over = true;
        const victory = ev.winner === humanPlayer;
        const me = state.players[humanPlayer];
        const stats = `Creatures lost: ${me.stats.losses}   Kills: ${me.stats.kills}   Structures built: ${me.stats.built}   Time: ${formatClock(state.tick)}`;
        setTimeout(() => {
          stop();
          menus.showGameOver(victory, stats, () => menus.showMainMenu());
        }, 2500); // let the final explosion play out
      }
      if (ev.type === 'playerEliminated' && ev.player !== humanPlayer) {
        hud.toast(`${state.players[ev.player].name} has been eliminated!`, 'info');
      }
      if (ev.type === 'superweaponLaunched' && ev.byPlayer !== humanPlayer) {
        hud.toast('⚠ ENEMY SUPERWEAPON LAUNCHED', 'warn');
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
      });
    } else if (!ui.showMenu && escShown) {
      escShown = false;
      ui.paused = false;
      menus.hideEscMenu();
    }

    if (!ui.paused && state.winner === null) {
      acc += dt * ui.gameSpeed;
      let safety = 0;
      while (acc >= TICK_MS && safety < 8) {
        // AI commands at each AI's think cadence
        for (const p of state.players) {
          if (p.isHuman || p.eliminated || !p.difficulty) continue;
          if (state.tick % AI_THINK_INTERVAL[p.difficulty] === (p.id * 3) % AI_THINK_INTERVAL[p.difficulty]) {
            try {
              pending.push(...aiThink(state, DATA, p.id));
            } catch (err) {
              console.error('AI error (player ' + p.id + ')', err);
            }
          }
        }
        const commands = pending.splice(0, pending.length);
        const events = tickGame(state, DATA, commands);
        routeEvents(events);
        acc -= TICK_MS;
        safety++;
      }
      if (safety >= 8) acc = 0; // dropped behind; don't spiral
    }

    input.update(dt, canvas.width, canvas.height);
    clampCamera(cam, state.map, canvas.width, canvas.height);
    const alpha = Math.min(1, acc / TICK_MS);
    renderer.render(state, cam, ui, humanPlayer, now, alpha);
    minimap.render(state, cam, humanPlayer, canvas.width, canvas.height);
    sidebar.update();
    hud.update(state, humanPlayer);
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
    quitToMenu,
  };
}

function formatClock(tick: number): string {
  const s = Math.floor(tick / 15);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
