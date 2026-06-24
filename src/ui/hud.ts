// =============================================================================
// FABLE WARS — HUD overlays: top-left status bar (match clock, unit count,
// smoothed FPS), a toast stack top-center, and a subtle vignette for
// atmosphere. DOM-only. Reads GameState, never mutates it.
// =============================================================================

import type { GameData, GameState, PlayerId, UIState } from '../core/types';
import { TICK_RATE, MAX_UNITS_PER_PLAYER } from '../core/constants';
import { getGuidance } from './guidance';

const STYLE_ID = 'pa-style-hud';

const CSS = `
.pa-hud-bar {
  position: absolute; top: 10px; left: 12px; z-index: 40;
  display: flex; gap: 14px; align-items: center;
  background: linear-gradient(180deg, rgba(23, 21, 22, 0.88), rgba(8, 9, 14, 0.82));
  border: 2px solid #282018; border-radius: 4px;
  padding: 5px 12px;
  font-family: Verdana, Geneva, sans-serif; font-size: 12px;
  color: #cfd6ff; letter-spacing: 1px;
  pointer-events: none; user-select: none;
  text-shadow: 0 1px 2px #000;
  box-shadow: inset 0 1px 0 rgba(255,237,190,0.16), inset 0 -2px 0 rgba(0,0,0,0.62), 0 2px 0 #050506, 0 8px 24px rgba(0,0,0,0.38);
}
.pa-hud-bar .pa-hud-cell { display: flex; gap: 5px; align-items: baseline; }
.pa-hud-bar .pa-hud-label { color: #6f78a8; font-size: 9px; text-transform: uppercase; }
.pa-hud-bar .pa-hud-clock { font-weight: bold; font-size: 13px; color: #ffffff; min-width: 44px; }
.pa-hud-toasts {
  position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
  z-index: 41; display: flex; flex-direction: column; gap: 6px; align-items: center;
  pointer-events: none;
}
.pa-guide {
  position: absolute; left: 12px; top: 52px; z-index: 42;
  box-sizing: border-box;
  width: min(360px, calc(100% - 224px));
  max-width: calc(100vw - 232px);
  background: linear-gradient(180deg, rgba(29, 26, 24, 0.96), rgba(9, 10, 15, 0.94));
  border: 2px solid #8f7348; border-radius: 4px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,237,190,0.15), inset 0 -2px 0 rgba(0,0,0,0.62);
  padding: 9px 11px; font-family: Verdana, Geneva, sans-serif;
  color: #dfe5ff; pointer-events: none; user-select: none;
  text-shadow: 0 1px 2px #000;
}
.pa-guide.hidden { display: none; }
.pa-guide.warn { border-color: #d88c4d; background: linear-gradient(180deg, rgba(51, 24, 10, 0.95), rgba(18, 10, 7, 0.92)); }
.pa-guide-title { font-size: 11px; font-weight: bold; letter-spacing: 1.4px; text-transform: uppercase; color: #fff; }
.pa-guide-body { margin-top: 4px; font-size: 10px; line-height: 1.45; color: #b9c5f5; }
.pa-guide.warn .pa-guide-body { color: #ffd9c4; }
.pa-guide-action {
  display: inline-block; margin-top: 7px; padding: 4px 8px;
  border: 1px solid rgba(255, 217, 94, 0.65); border-radius: 3px;
  background: linear-gradient(180deg, rgba(107, 78, 32, 0.82), rgba(36, 24, 12, 0.9));
  color: #fff3bf; font-size: 9px; font-weight: bold; letter-spacing: 1px; text-transform: uppercase;
  box-shadow: inset 0 1px 0 rgba(255,237,190,0.2), 0 2px 0 rgba(0,0,0,0.45);
}
@media (max-width: 980px) { .pa-guide { max-width: calc(100vw - 232px); } }
.pa-toast {
  font-family: Verdana, Geneva, sans-serif; font-size: 12px; letter-spacing: 1.5px;
  padding: 6px 16px; border-radius: 3px; border: 1px solid;
  background: rgba(16, 18, 32, 0.88); color: #d8deff; border-color: #3a3f66;
  text-shadow: 0 1px 2px #000; white-space: nowrap;
  animation: pa-toast-in 180ms ease-out;
}
.pa-toast.warn {
  color: #ffd9c4; border-color: #a03a20; background: rgba(46, 14, 6, 0.9);
  font-weight: bold;
}
.pa-toast.pa-toast-out { animation: pa-toast-out 400ms ease-in forwards; }
@keyframes pa-toast-in { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: none; } }
@keyframes pa-toast-out { to { opacity: 0; transform: translateY(-6px); } }
.pa-vignette {
  position: absolute; inset: 0; z-index: 30; pointer-events: none;
  background: radial-gradient(ellipse at center, rgba(0,0,0,0) 58%, rgba(4, 4, 12, 0.34) 100%);
}
`;

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

export class HUD {
  private data: GameData;
  private ui: UIState;
  private clockEl: HTMLSpanElement;
  private unitsEl: HTMLSpanElement;
  private fpsEl: HTMLSpanElement;
  private toastWrap: HTMLDivElement;
  private guideEl: HTMLDivElement;
  private guideTitleEl: HTMLDivElement;
  private guideBodyEl: HTMLDivElement;
  private guideActionEl: HTMLDivElement;

  // cached text so we only touch the DOM on change
  private shownClock = '';
  private shownUnits = '';
  private shownFps = '';
  private shownGuideKey = '';

  // smoothed FPS (cosmetic — high-res timers are fine in UI code)
  private lastFrameAt = 0;
  private fpsEma = 60;

  constructor(root: HTMLElement, data: GameData, ui: UIState) {
    this.data = data;
    this.ui = ui;
    ensureStyle();

    const vignette = document.createElement('div');
    vignette.className = 'pa-vignette';
    root.appendChild(vignette);

    const bar = document.createElement('div');
    bar.className = 'pa-hud-bar';

    const mkCell = (label: string): HTMLSpanElement => {
      const cell = document.createElement('span');
      cell.className = 'pa-hud-cell';
      const lab = document.createElement('span');
      lab.className = 'pa-hud-label';
      lab.textContent = label;
      const val = document.createElement('span');
      cell.appendChild(lab);
      cell.appendChild(val);
      bar.appendChild(cell);
      return val;
    };

    this.clockEl = mkCell('Time');
    this.clockEl.classList.add('pa-hud-clock');
    this.unitsEl = mkCell('Units');
    this.fpsEl = mkCell('FPS');
    root.appendChild(bar);
    this.guideEl = document.createElement('div');
    this.guideEl.className = 'pa-guide hidden';
    this.guideTitleEl = document.createElement('div');
    this.guideTitleEl.className = 'pa-guide-title';
    this.guideBodyEl = document.createElement('div');
    this.guideBodyEl.className = 'pa-guide-body';
    this.guideActionEl = document.createElement('div');
    this.guideActionEl.className = 'pa-guide-action';
    this.guideEl.append(this.guideTitleEl, this.guideBodyEl, this.guideActionEl);
    root.appendChild(this.guideEl);

    this.toastWrap = document.createElement('div');
    this.toastWrap.className = 'pa-hud-toasts';
    root.appendChild(this.toastWrap);
  }

  update(state: GameState, humanPlayer: PlayerId): void {
    // clock
    const totalSec = Math.floor(state.tick / TICK_RATE);
    const clock = `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, '0')}`;
    if (clock !== this.shownClock) {
      this.shownClock = clock;
      this.clockEl.textContent = clock;
    }

    // unit count (own living units)
    let units = 0;
    for (const e of state.entities.values()) {
      if (e.kind === 'unit' && e.owner === humanPlayer && e.hp > 0) units++;
    }
    const unitsText = `${units}/${MAX_UNITS_PER_PLAYER}`;
    if (unitsText !== this.shownUnits) {
      this.shownUnits = unitsText;
      this.unitsEl.textContent = unitsText;
    }

    // FPS — exponential moving average over frame deltas
    const now = performance.now();
    if (this.lastFrameAt > 0) {
      const dt = now - this.lastFrameAt;
      if (dt > 0 && dt < 1000) {
        this.fpsEma = this.fpsEma * 0.92 + (1000 / dt) * 0.08;
      }
    }
    this.lastFrameAt = now;
    const fpsText = String(Math.round(this.fpsEma));
    if (fpsText !== this.shownFps) {
      this.shownFps = fpsText;
      this.fpsEl.textContent = fpsText;
    }

    const guide = getGuidance(state, this.data, humanPlayer, this.ui);
    if (guide === null) {
      if (this.shownGuideKey !== '') {
        this.shownGuideKey = '';
        this.guideEl.className = 'pa-guide hidden';
      }
    } else {
      const key = `${guide.id}|${guide.severity}|${guide.title}|${guide.body}|${guide.action}`;
      if (key !== this.shownGuideKey) {
        this.shownGuideKey = key;
        this.guideEl.className = guide.severity === 'warn' ? 'pa-guide warn' : 'pa-guide';
        this.guideTitleEl.textContent = guide.title;
        this.guideBodyEl.textContent = guide.body;
        this.guideActionEl.textContent = guide.action;
      }
    }
  }

  toast(msg: string, kind: 'info' | 'warn'): void {
    // cap the stack: drop the oldest if crowded
    while (this.toastWrap.children.length >= 5) {
      this.toastWrap.firstElementChild?.remove();
    }
    const el = document.createElement('div');
    el.className = kind === 'warn' ? 'pa-toast warn' : 'pa-toast';
    el.textContent = msg;
    this.toastWrap.appendChild(el);
    window.setTimeout(() => el.classList.add('pa-toast-out'), 4000);
    window.setTimeout(() => el.remove(), 4450);
  }
}
