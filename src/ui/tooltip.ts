// =============================================================================
// POCKET ALERT — battlefield hover tooltip (Owner E).
// Cursor-following nameplate for the unit/building under the mouse: name,
// HP bar (rules.ini ConditionYellow/Red thresholds), gold veterancy chevrons,
// one-line blurb, and the owner's name in their player color for enemies.
// main.ts calls update(hoverId) every frame; the plate appears once the same
// entity has been hovered for 550ms and hides instantly when it changes.
// DOM is built once; per-frame work is cached comparisons plus a transform.
// =============================================================================

import type { EntityId, GameData, GameState, PlayerId } from '../core/types';
import { PLAYER_COLORS } from '../core/types';
import { HEALTH_RED, HEALTH_YELLOW } from '../core/constants';

const HOVER_DELAY_MS = 550; // RA2 used 2s; modern dwell per the research pass
const CURSOR_OFFSET = 14; // px from the pointer
const EDGE_PAD = 4; // viewport clamp margin

const HP_GREEN = '#5ee887';
const HP_YELLOW = '#ffd95e';
const HP_RED = '#e8453c';

const STYLE_ID = 'pa-style-worldtip';
const CSS = `
.pa-worldtip {
  position: fixed; left: 0; top: 0; z-index: 55; display: none;
  pointer-events: none; user-select: none; max-width: 240px; min-width: 120px;
  background: linear-gradient(180deg, #181b33 0%, #0e1020 100%);
  border: 1px solid #3a3f66; border-radius: 4px; box-shadow: 0 5px 16px rgba(0,0,0,0.6);
  padding: 6px 9px; font-family: Verdana, Geneva, sans-serif; color: #cfd6ff;
  will-change: transform;
}
.pa-worldtip .pa-wt-head { display: flex; align-items: baseline; gap: 6px; white-space: nowrap; }
.pa-worldtip .pa-wt-name { font-size: 11px; font-weight: bold; color: #fff; letter-spacing: 0.5px; }
.pa-worldtip .pa-wt-vet { font-size: 8px; color: #ffd95e; letter-spacing: 1px; text-shadow: 0 1px 2px #000; }
.pa-worldtip .pa-wt-hp { margin-top: 4px; height: 5px; background: #05060a; border: 1px solid #2a2d44; border-radius: 2px; overflow: hidden; }
.pa-worldtip .pa-wt-hp-fill { height: 100%; width: 100%; background: ${HP_GREEN}; }
.pa-worldtip .pa-wt-owner { margin-top: 4px; font-size: 8.5px; font-weight: bold; letter-spacing: 0.5px; text-shadow: 0 1px 2px #000; display: none; }
.pa-worldtip .pa-wt-blurb { margin-top: 4px; font-size: 9px; line-height: 1.4; color: #aeb6e2; }
`;

export class WorldTooltip {
  private data: GameData;
  private getState: () => GameState;
  private me: PlayerId;

  private el: HTMLDivElement;
  private nameEl: HTMLElement;
  private vetEl: HTMLElement;
  private hpFill: HTMLElement;
  private ownerEl: HTMLElement;
  private blurbEl: HTMLElement;

  // pointer tracking (cosmetic high-res timers/coords are fine in UI code)
  private mouseX = 0;
  private mouseY = 0;
  private hoverId: EntityId | null = null;
  private hoverSince = 0;
  private visible = false;

  // last-applied values so per-frame updates skip untouched DOM
  private lastName = '';
  private lastVet = -1;
  private lastHpPct = -1;
  private lastHpColor = '';
  private lastOwner = '';
  private lastOwnerColor = '';
  private lastX = -1;
  private lastY = -1;
  private sizeDirty = true;
  private w = 0;
  private h = 0;

  private onMove = (e: MouseEvent) => {
    this.mouseX = e.clientX;
    this.mouseY = e.clientY;
  };

  constructor(root: HTMLElement, data: GameData, getState: () => GameState, humanPlayer: PlayerId) {
    this.data = data;
    this.getState = getState;
    this.me = humanPlayer;

    if (!document.getElementById(STYLE_ID)) {
      const s = document.createElement('style');
      s.id = STYLE_ID;
      s.textContent = CSS;
      document.head.appendChild(s);
    }

    this.el = document.createElement('div');
    this.el.className = 'pa-worldtip';
    const head = document.createElement('div');
    head.className = 'pa-wt-head';
    this.nameEl = document.createElement('span');
    this.nameEl.className = 'pa-wt-name';
    this.vetEl = document.createElement('span');
    this.vetEl.className = 'pa-wt-vet';
    head.append(this.nameEl, this.vetEl);
    const hpWrap = document.createElement('div');
    hpWrap.className = 'pa-wt-hp';
    this.hpFill = document.createElement('div');
    this.hpFill.className = 'pa-wt-hp-fill';
    hpWrap.appendChild(this.hpFill);
    this.ownerEl = document.createElement('div');
    this.ownerEl.className = 'pa-wt-owner';
    this.blurbEl = document.createElement('div');
    this.blurbEl.className = 'pa-wt-blurb';
    this.el.append(head, hpWrap, this.ownerEl, this.blurbEl);
    root.appendChild(this.el);

    window.addEventListener('mousemove', this.onMove);
  }

  destroy(): void {
    window.removeEventListener('mousemove', this.onMove);
    this.el.remove();
  }

  /** Called every frame by main.ts with the entity id under the cursor. */
  update(hoverId: EntityId | null): void {
    const now = performance.now();
    if (hoverId !== this.hoverId) {
      this.hoverId = hoverId;
      this.hoverSince = now;
      if (this.visible) this.hide(); // hide instantly on change
    }
    if (this.hoverId === null) return;
    if (now - this.hoverSince < HOVER_DELAY_MS) return;

    const state = this.getState();
    const ent = state.entities.get(this.hoverId);
    if (!ent || ent.hp <= 0) {
      if (this.visible) this.hide();
      return;
    }
    const def = ent.kind === 'unit' ? this.data.units[ent.defId] : this.data.buildings[ent.defId];
    if (!def) {
      if (this.visible) this.hide();
      return;
    }

    // --- content (only touch DOM on change) ---
    if (this.lastName !== def.name) {
      this.lastName = def.name;
      this.nameEl.textContent = def.name;
      this.sizeDirty = true;
    }
    const vet = ent.kind === 'unit' ? ent.vet : 0;
    if (this.lastVet !== vet) {
      this.lastVet = vet;
      this.vetEl.textContent = '▲'.repeat(vet);
      this.sizeDirty = true;
    }
    const pct = Math.max(0, Math.min(1, ent.hp / Math.max(1, ent.maxHp)));
    const pctQ = Math.round(pct * 100);
    if (this.lastHpPct !== pctQ) {
      this.lastHpPct = pctQ;
      this.hpFill.style.width = `${pctQ}%`;
    }
    const hpColor = pct > HEALTH_YELLOW ? HP_GREEN : pct > HEALTH_RED ? HP_YELLOW : HP_RED;
    if (this.lastHpColor !== hpColor) {
      this.lastHpColor = hpColor;
      this.hpFill.style.background = hpColor;
    }
    if (this.blurbEl.textContent !== def.blurb) {
      this.blurbEl.textContent = def.blurb;
      this.sizeDirty = true;
    }
    let ownerName = '';
    let ownerColor = '';
    if (ent.owner !== this.me) {
      const op = state.players[ent.owner];
      if (op) {
        ownerName = op.name;
        ownerColor = PLAYER_COLORS[op.colorIdx]?.hex ?? '#cfd6ff';
      }
    }
    if (this.lastOwner !== ownerName || this.lastOwnerColor !== ownerColor) {
      this.lastOwner = ownerName;
      this.lastOwnerColor = ownerColor;
      this.ownerEl.textContent = ownerName;
      this.ownerEl.style.color = ownerColor;
      this.ownerEl.style.display = ownerName ? 'block' : 'none';
      this.sizeDirty = true;
    }

    // --- placement near the cursor, viewport-clamped (flip across the pointer) ---
    if (!this.visible) {
      this.visible = true;
      this.el.style.display = 'block';
      this.sizeDirty = true;
    }
    if (this.sizeDirty) {
      this.w = this.el.offsetWidth;
      this.h = this.el.offsetHeight;
      this.sizeDirty = false;
    }
    let x = this.mouseX + CURSOR_OFFSET;
    let y = this.mouseY + CURSOR_OFFSET;
    if (x + this.w > window.innerWidth - EDGE_PAD) x = this.mouseX - this.w - CURSOR_OFFSET;
    if (y + this.h > window.innerHeight - EDGE_PAD) y = this.mouseY - this.h - CURSOR_OFFSET;
    x = Math.max(EDGE_PAD, x);
    y = Math.max(EDGE_PAD, y);
    if (x !== this.lastX || y !== this.lastY) {
      this.lastX = x;
      this.lastY = y;
      this.el.style.transform = `translate(${x}px, ${y}px)`;
    }
  }

  private hide(): void {
    this.visible = false;
    this.el.style.display = 'none';
  }
}
