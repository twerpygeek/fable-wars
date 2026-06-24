// =============================================================================
// FABLE WARS — mouse/keyboard controller (Owner E).
// Translates raw input into UIState mutations + sim Commands. Never mutates
// GameState. Active only between enable()/disable() (match lifetime).
//
// Controls: LMB select / drag-select / dbl-click same-type; RMB click context
// order (move/attack/harvest/capture, Shift queues) or rally for selected
// producers; RMB drag = joystick pan (RA2 manual feature, suppresses the
// order); A+LMB attack-move; Ctrl+LMB or F+LMB force-fire (attackGround);
// S stop; G guard; H center ConYard; T select same type on screen (again
// within 400ms = map-wide); X scatter; C cheer; V stance toggle; Tab cycles
// production buildings; Ctrl+1..9 / 1..9 control groups (double-tap centers);
// ESC cancels modes / toggles menu; window-edge + W/D/arrow scroll at the
// constant RA2 rate (localStorage 'pa-scrollRate'); [ ] keyboard zoom;
// wheel zoom; Space jumps to last base attack.
//
// Edge scrolling (research-spec'd): 8px band at the BROWSER WINDOW edge,
// 120ms dwell, constant velocity scaled by 1/zoom, normalized diagonals.
// The sidebar column (right 200px) and any DOM UI over the canvas are hard
// deadzones — moving the mouse toward the sidebar never scrolls.
// =============================================================================

import type {
  Camera,
  Command,
  Entity,
  EntityId,
  GameData,
  GameEvent,
  GameState,
  Order,
  PlayerId,
  UIState,
  UnitStance,
  Vec2,
} from '../core/types';
import { MoveDomain, Terrain, entityCenter, inBounds, tileIndex } from '../core/types';
import {
  EDGE_SCROLL_BAND,
  EDGE_SCROLL_DWELL_MS,
  RMB_PAN_DEADZONE,
  RMB_PAN_MULT,
  SCROLL_RATE_DEFAULT,
  SCROLL_RATE_MAX,
  SCROLL_RATE_MIN,
  TILE_HALF_H,
  TILE_HALF_W,
} from '../core/constants';
import { MAX_ZOOM, MIN_ZOOM, clampCamera, screenToTile, tileToScreen } from '../render/camera';
import { isValidPlacement } from '../sim/production';
import { isVisibleTo } from '../sim/fog';
import { passableFor } from '../map/terrain';
import type { SpriteAtlas } from '../render/sprites';
import type { Minimap } from '../render/minimap';

const DRAG_THRESHOLD = 4; // px
const DOUBLE_MS = 350;
const TYPE_SELECT_DOUBLE_MS = 400; // second T within this = map-wide
const SIDEBAR_W = 200; // right column hard deadzone (matches .pa-side width)
const ACK_THROTTLE_MS = 300; // onSelectionAck rate limit
const SCROLL_RATE_KEY = 'pa-scrollRate'; // localStorage, px/s at zoom 1
const SCROLL_RATE_REREAD_MS = 1000; // re-read localStorage at most 1/s
const RMB_PAN_FULL_SPEED_PX = 120; // drag length for full pan speed

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

// --- RA2-style directional scroll cursors --------------------------------------
// 8 directions x {green, red(clamped)}, built once as inline SVG data URIs.
// Index 0 = N, then clockwise in 45° steps (NE, E, SE, S, SW, W, NW).

function scrollCursorCss(angleDeg: number, fill: string): string {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
    `<g transform="rotate(${angleDeg} 16 16)">` +
    `<path d="M16 3 L27 16.5 L20 16.5 L20 29 L12 29 L12 16.5 L5 16.5 Z" fill="${fill}" ` +
    'stroke="#0b0d16" stroke-width="2" stroke-linejoin="round"/>' +
    '</g></svg>';
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 16 16, default`;
}

const SCROLL_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];
const SCROLL_CURSORS_GREEN = SCROLL_ANGLES.map((a) => scrollCursorCss(a, '#3ce86e'));
const SCROLL_CURSORS_RED = SCROLL_ANGLES.map((a) => scrollCursorCss(a, '#e8453c'));

/** Map a (screen-space) direction vector to the nearest of 8 compass slots. */
function scrollDirIndex(dx: number, dy: number): number {
  // atan2: 0 = +x (E); shift so N = 0, clockwise.
  return (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 10) % 8;
}

export class InputController {
  private canvas: HTMLCanvasElement;
  private cam: Camera;
  private ui: UIState;
  private getState: () => GameState;
  private data: GameData;
  private dispatch: (c: Command) => void;
  private me: PlayerId;

  private enabled = false;
  private mouse = { x: 0, y: 0, inside: false, down: false };
  private client = { x: 0, y: 0 }; // window coords (edge band, RMB pan)
  private keys = new Set<string>();
  private attackMoveArmed = false;
  private lastClick = { time: 0, defId: '' };
  private lastGroupTap = { time: 0, num: -1 };
  private lastTypeSelect = { time: 0, defId: '' }; // T double-tap tracking
  private lastAttackPos: Vec2 | null = null;
  private minimapEl: HTMLCanvasElement | null = null;
  private minimap: Minimap | null = null;

  // edge scroll / RMB pan scratch
  private edgeDwellMs = 0; // continuous time in the edge band
  private rmb = { down: false, sx: 0, sy: 0, panning: false }; // window coords
  private scrollRate = SCROLL_RATE_DEFAULT;
  private scrollRateReadAt = -Infinity;

  // hover probe scratch
  private frameCount = 0;
  private lastHoverProbe = { x: -1, y: -1 };
  private lastAckAt = -Infinity;
  private prodCycle = -1; // Tab cycle pointer

  // --- public hooks (wired by main.ts) ------------------------------------------
  /** Entity under the cursor (any visible unit/building) — battlefield tooltips
   *  read this each frame. Refreshed in update(); null over sidebar/DOM UI. */
  public hoveredEntityId: EntityId | null = null;
  /** C key: cheer — no sim effect; main.ts wires visuals/audio for these units. */
  public onCheer: ((ids: EntityId[]) => void) | null = null;
  /** Fired when the player actively selects own units (click / drag / group
   *  recall / T), with the first selected unit's defId. Throttled to 300ms. */
  public onSelectionAck: ((defId: string) => void) | null = null;
  public onCommandFeedback: ((kind: CommandFeedbackKind, pos: Vec2) => void) | null = null;

  // bound listeners (so disable() can remove them)
  private onMouseDown = (e: MouseEvent) => this.handleMouseDown(e);
  private onMouseMove = (e: MouseEvent) => this.handleMouseMove(e);
  private onMouseUp = (e: MouseEvent) => this.handleMouseUp(e);
  private onContextMenu = (e: MouseEvent) => e.preventDefault(); // orders resolve on RMB-up
  private onWheel = (e: WheelEvent) => this.handleWheel(e);
  private onKeyDown = (e: KeyboardEvent) => this.handleKeyDown(e);
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());
  private onDocLeave = () => {
    this.mouse.inside = false;
    this.edgeDwellMs = 0;
  };
  private onBlur = () => {
    // Alt-tab safety: held keys / buttons would otherwise stick forever.
    this.keys.clear();
    this.mouse.down = false;
    this.rmb.down = false;
    this.rmb.panning = false;
    this.edgeDwellMs = 0;
  };
  private onMiniDown = (e: MouseEvent) => this.handleMinimapMouse(e);
  private onMiniMove = (e: MouseEvent) => {
    if (e.buttons & 1) this.handleMinimapMouse(e);
  };
  private onMiniContext = (e: MouseEvent) => {
    e.preventDefault();
    this.handleMinimapOrder(e);
  };

  constructor(
    canvas: HTMLCanvasElement,
    cam: Camera,
    ui: UIState,
    getState: () => GameState,
    data: GameData,
    dispatch: (c: Command) => void,
    humanPlayer: PlayerId,
    _sprites: SpriteAtlas,
  ) {
    this.canvas = canvas;
    this.cam = cam;
    this.ui = ui;
    this.getState = getState;
    this.data = data;
    this.dispatch = dispatch;
    this.me = humanPlayer;
  }

  private feedback(kind: CommandFeedbackKind, pos: Vec2 | null): void {
    if (pos !== null && this.onCommandFeedback) this.onCommandFeedback(kind, pos);
  }

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.documentElement.addEventListener('mouseleave', this.onDocLeave);
  }

  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.canvas.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.documentElement.removeEventListener('mouseleave', this.onDocLeave);
    if (this.minimapEl) {
      this.minimapEl.removeEventListener('mousedown', this.onMiniDown);
      this.minimapEl.removeEventListener('mousemove', this.onMiniMove);
      this.minimapEl.removeEventListener('contextmenu', this.onMiniContext);
    }
  }

  bindMinimap(canvas: HTMLCanvasElement, minimap: Minimap): void {
    this.minimapEl = canvas;
    this.minimap = minimap;
    canvas.addEventListener('mousedown', this.onMiniDown);
    canvas.addEventListener('mousemove', this.onMiniMove);
    canvas.addEventListener('contextmenu', this.onMiniContext);
  }

  /** Track sim events: Space jumps to the latest base-attack location. */
  notifyEvents(events: GameEvent[]): void {
    for (const ev of events) {
      if (ev.type === 'underAttack' && ev.player === this.me) this.lastAttackPos = ev.pos;
      if (ev.type === 'superweaponLaunched') this.lastAttackPos = ev.target;
    }
  }

  /** Per-frame: scrolling (edge/key/RMB-pan), hover refresh, selection hygiene. */
  update(dtMs: number, viewW: number, viewH: number): void {
    if (!this.enabled || this.ui.paused) return;
    const now = performance.now();
    const dt = dtMs / 1000;
    const state = this.getState();
    const rate = this.readScrollRate(now);
    this.frameCount++;

    // --- camera scrolling ---------------------------------------------------
    // One intent vector from keyboard + edge band; RMB joystick pan overrides.
    let dirX = 0;
    let dirY = 0;
    let speed = rate; // px/s at zoom 1 — constant, no acceleration (RA2)
    let panning = false;

    if (this.keys.has('w') || this.keys.has('arrowup')) dirY -= 1;
    if (this.keys.has('arrowdown')) dirY += 1;
    if (this.keys.has('arrowleft')) dirX -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) dirX += 1;
    // WASD: W/D scroll; A is attack-move arm, S is stop — arrows cover all four.

    // Edge band with dwell; suppressed while a mouse button drag is active.
    let edge: { dx: number; dy: number } | null = null;
    if (this.mouse.inside && !this.mouse.down && !this.rmb.down) edge = this.edgeScrollDir();
    this.edgeDwellMs = edge !== null ? this.edgeDwellMs + dtMs : 0;
    const edgeEngaged = edge !== null && this.edgeDwellMs >= EDGE_SCROLL_DWELL_MS;
    if (edge !== null && edgeEngaged) {
      dirX += edge.dx;
      dirY += edge.dy;
    }

    // RMB joystick pan: direction = drag vector from the press point, speed
    // ramps with drag length up to scrollRate * RMB_PAN_MULT.
    if (this.rmb.down && this.rmb.panning) {
      const vx = this.client.x - this.rmb.sx;
      const vy = this.client.y - this.rmb.sy;
      const len = Math.hypot(vx, vy);
      if (len > 0.5) {
        dirX = vx / len;
        dirY = vy / len;
        speed = rate * RMB_PAN_MULT * Math.min(1, len / RMB_PAN_FULL_SPEED_PX);
        panning = true;
      }
    }

    let scrollCursor: string | null = null;
    const dirLen = Math.hypot(dirX, dirY);
    if (dirLen > 0 && dt > 0) {
      const nx = dirX / dirLen; // normalized: diagonals aren't faster
      const ny = dirY / dirLen;
      const step = (speed * dt) / this.cam.zoom;
      const bx = this.cam.x;
      const by = this.cam.y;
      this.cam.x += nx * step;
      this.cam.y += ny * step;
      clampCamera(this.cam, state.map, viewW, viewH);
      const moved = Math.hypot(this.cam.x - bx, this.cam.y - by);
      const clamped = moved < step * 0.25; // pinned against the map bounds
      if (panning || edgeEngaged) {
        scrollCursor = (clamped ? SCROLL_CURSORS_RED : SCROLL_CURSORS_GREEN)[scrollDirIndex(nx, ny)];
      }
    }

    // --- hover tile + placement validity --------------------------------------
    const t = screenToTile(this.cam, this.mouse.x, this.mouse.y);
    const tile = { x: Math.floor(t.x), y: Math.floor(t.y) };
    this.ui.hoverTile = inBounds(state.map, tile.x, tile.y) ? tile : null;
    if (this.ui.placingDefId && this.ui.hoverTile) {
      this.ui.placeValid = isValidPlacement(state, this.data, this.me, this.ui.placingDefId, this.ui.hoverTile);
    }

    // Hovered entity for battlefield tooltips — cheap: re-pick only when the
    // mouse moved or every ~6 frames (entities move under a still cursor).
    if (
      this.mouse.x !== this.lastHoverProbe.x ||
      this.mouse.y !== this.lastHoverProbe.y ||
      this.frameCount % 6 === 0
    ) {
      this.lastHoverProbe = { x: this.mouse.x, y: this.mouse.y };
      const overUI = !this.mouse.inside || this.client.x >= window.innerWidth - SIDEBAR_W;
      const hov = overUI ? null : this.pickEntity(state, 'any');
      this.hoveredEntityId = hov ? hov.id : null;
    }

    // Drop dead/foreign ids from selection.
    this.ui.selection = this.ui.selection.filter((id) => {
      const e = state.entities.get(id);
      return e !== undefined && e.hp > 0 && e.owner === this.me;
    });

    // Cursor priority: active scroll arrow > mode crosshairs > force-fire > default.
    this.canvas.style.cursor =
      scrollCursor ??
      (this.ui.placingDefId || this.ui.targetingSuperweapon || this.attackMoveArmed
        ? 'crosshair'
        : this.ui.sellMode || this.ui.repairMode
          ? 'pointer'
          : this.forceFireHeld(state)
            ? 'crosshair'
            : 'default');
  }

  // --- edge scrolling --------------------------------------------------------------

  /**
   * Direction implied by the window-edge band, or null. Hard deadzones: the
   * sidebar column (right 200px) and any DOM element layered over the canvas
   * (toasts, menus) — moving the mouse toward the sidebar must never scroll.
   */
  private edgeScrollDir(): { dx: number; dy: number } | null {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const cx = this.client.x;
    const cy = this.client.y;
    let dx = 0;
    let dy = 0;
    if (cx <= EDGE_SCROLL_BAND) dx = -1;
    else if (cx >= w - 1 - EDGE_SCROLL_BAND) dx = 1;
    if (cy <= EDGE_SCROLL_BAND) dy = -1;
    else if (cy >= h - 1 - EDGE_SCROLL_BAND) dy = 1;
    if (dx === 0 && dy === 0) return null;
    if (cx >= w - SIDEBAR_W) return null; // sidebar column
    const el = document.elementFromPoint(
      Math.max(0, Math.min(w - 1, cx)),
      Math.max(0, Math.min(h - 1, cy)),
    );
    if (el !== this.canvas) return null; // pointer over DOM UI
    return { dx, dy };
  }

  /** Scroll Rate option (px/s at zoom 1) — localStorage, re-read at most 1/s. */
  private readScrollRate(now: number): number {
    if (now - this.scrollRateReadAt >= SCROLL_RATE_REREAD_MS) {
      this.scrollRateReadAt = now;
      let v = NaN;
      try {
        const raw = localStorage.getItem(SCROLL_RATE_KEY);
        if (raw !== null) v = Number(raw);
      } catch {
        /* storage blocked — keep default */
      }
      this.scrollRate =
        Number.isFinite(v) && v > 0
          ? Math.max(SCROLL_RATE_MIN, Math.min(SCROLL_RATE_MAX, v))
          : SCROLL_RATE_DEFAULT;
    }
    return this.scrollRate;
  }

  // --- mouse ---------------------------------------------------------------------

  private handleMouseDown(e: MouseEvent): void {
    if (this.ui.paused) return;
    if (e.button === 2) {
      // RMB: candidate joystick pan; the context order resolves on mouseup.
      this.rmb = { down: true, sx: e.clientX, sy: e.clientY, panning: false };
      return;
    }
    if (e.button !== 0) return;
    const state = this.getState();
    this.mouse.down = true;

    // Mode clicks resolve on mousedown (RA2 feel).
    if (this.ui.placingDefId) {
      const tile = this.ui.hoverTile;
      if (tile && this.ui.placeValid) {
        const defId = this.ui.placingDefId;
        this.dispatch({ type: 'placeBuilding', player: this.me, defId, pos: tile });
        this.feedback('place', { x: tile.x + 0.5, y: tile.y + 0.5 });
        const def = this.data.buildings[defId];
        if (!(e.shiftKey && def && def.cost <= 100)) this.ui.placingDefId = null; // shift chains walls
      }
      return;
    }
    if (this.ui.targetingSuperweapon) {
      const tile = this.ui.hoverTile;
      if (tile) {
        this.dispatch({ type: 'fireSuperweapon', player: this.me, target: { x: tile.x + 0.5, y: tile.y + 0.5 } });
        this.feedback('superweapon', { x: tile.x + 0.5, y: tile.y + 0.5 });
        this.ui.targetingSuperweapon = false;
      }
      return;
    }
    if (this.ui.sellMode || this.ui.repairMode) {
      const b = this.pickEntity(state, 'building');
      if (b && b.owner === this.me) {
        const kind = this.ui.sellMode ? 'sell' : 'repair';
        this.dispatch(
          this.ui.sellMode
            ? { type: 'sell', player: this.me, buildingId: b.id }
            : { type: 'toggleRepair', player: this.me, buildingId: b.id },
        );
        this.feedback(kind, entityCenter(b, this.data));
      }
      return;
    }
    if (this.attackMoveArmed) {
      const tile = this.ui.hoverTile;
      if (tile) this.issueToSelection({ kind: 'attackMove', dest: { x: tile.x + 0.5, y: tile.y + 0.5 } }, e.shiftKey);
      this.attackMoveArmed = false;
      return;
    }
    // Force-fire: Ctrl+LMB or held-F+LMB = attackGround at the hovered tile
    // (macOS turns Ctrl+click into a right-click, hence the F alias).
    if ((e.ctrlKey || this.keys.has('f')) && this.ui.hoverTile) {
      const ids = this.armedSelectedUnitIds(state);
      if (ids.length > 0) {
        const tile = this.ui.hoverTile;
        this.dispatch({
          type: 'issueOrder',
          player: this.me,
          unitIds: ids,
          order: { kind: 'attackGround', dest: { x: tile.x + 0.5, y: tile.y + 0.5 } },
          queued: e.shiftKey,
        });
        return;
      }
    }
    this.ui.dragStart = { sx: e.offsetX, sy: e.offsetY };
    this.ui.dragEnd = null;
  }

  private handleMouseMove(e: MouseEvent): void {
    this.client.x = e.clientX;
    this.client.y = e.clientY;
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = e.clientX - rect.left;
    this.mouse.y = e.clientY - rect.top;
    this.mouse.inside =
      e.clientX >= rect.left && e.clientX < rect.right && e.clientY >= rect.top && e.clientY < rect.bottom;
    if (this.rmb.down && (e.buttons & 2) === 0) {
      // RMB was released outside the window (mouseup lost) — stop the pan.
      this.rmb.down = false;
      this.rmb.panning = false;
    } else if (this.rmb.down && !this.rmb.panning) {
      // Past the deadzone the press becomes a pan (sticky until release).
      if (Math.hypot(e.clientX - this.rmb.sx, e.clientY - this.rmb.sy) > RMB_PAN_DEADZONE) {
        this.rmb.panning = true;
      }
    }
    if (this.mouse.down && this.ui.dragStart) {
      const dx = this.mouse.x - this.ui.dragStart.sx;
      const dy = this.mouse.y - this.ui.dragStart.sy;
      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
        this.ui.dragEnd = { sx: this.mouse.x, sy: this.mouse.y };
      }
    }
  }

  private handleMouseUp(e: MouseEvent): void {
    if (e.button === 2) {
      const wasDown = this.rmb.down;
      const wasPanning = this.rmb.panning;
      this.rmb.down = false;
      this.rmb.panning = false;
      // A pan consumes the click; a quick RMB click issues the context order.
      if (!wasDown || wasPanning || this.ui.paused) return;
      if (document.elementFromPoint(e.clientX, e.clientY) !== this.canvas) return;
      this.performContextAction(e.shiftKey);
      return;
    }
    if (e.button !== 0) return;
    this.mouse.down = false;
    if (this.ui.paused) {
      this.ui.dragStart = this.ui.dragEnd = null;
      return;
    }
    const state = this.getState();

    if (this.ui.dragStart && this.ui.dragEnd) {
      // Box select own units.
      const x0 = Math.min(this.ui.dragStart.sx, this.ui.dragEnd.sx);
      const y0 = Math.min(this.ui.dragStart.sy, this.ui.dragEnd.sy);
      const x1 = Math.max(this.ui.dragStart.sx, this.ui.dragEnd.sx);
      const y1 = Math.max(this.ui.dragStart.sy, this.ui.dragEnd.sy);
      const picked: EntityId[] = [];
      for (const ent of state.entities.values()) {
        if (ent.kind !== 'unit' || ent.owner !== this.me || ent.hp <= 0) continue;
        const { sx, sy } = tileToScreen(this.cam, ent.pos.x, ent.pos.y);
        if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) picked.push(ent.id);
      }
      if (picked.length > 0) {
        this.ui.selection = e.shiftKey ? [...new Set([...this.ui.selection, ...picked])] : picked;
        this.ackSelection();
      } else if (!e.shiftKey) {
        this.ui.selection = [];
      }
    } else if (this.ui.dragStart) {
      // Plain click: pick entity.
      const hit = this.pickEntity(state, 'any');
      const now = performance.now();
      if (hit && hit.owner === this.me) {
        const dbl = now - this.lastClick.time < DOUBLE_MS && this.lastClick.defId === hit.defId;
        if (dbl && hit.kind === 'unit') {
          // Select all of same type on screen.
          const same: EntityId[] = [];
          for (const ent of state.entities.values()) {
            if (ent.kind !== 'unit' || ent.owner !== this.me || ent.defId !== hit.defId || ent.hp <= 0) continue;
            const { sx, sy } = tileToScreen(this.cam, ent.pos.x, ent.pos.y);
            if (sx >= 0 && sx <= this.canvas.width && sy >= 0 && sy <= this.canvas.height) same.push(ent.id);
          }
          this.ui.selection = same;
          this.ackSelection();
        } else if (e.shiftKey) {
          this.ui.selection = this.ui.selection.includes(hit.id)
            ? this.ui.selection.filter((i) => i !== hit.id)
            : [...this.ui.selection, hit.id];
        } else {
          this.ui.selection = [hit.id];
          this.ackSelection();
        }
        this.lastClick = { time: now, defId: hit.defId };
      } else if (!e.shiftKey) {
        this.ui.selection = [];
      }
    }
    this.ui.dragStart = this.ui.dragEnd = null;
  }

  /** Quick RMB click: cancel any armed mode, else issue the context order. */
  private performContextAction(queued: boolean): void {
    if (this.ui.placingDefId || this.ui.sellMode || this.ui.repairMode || this.ui.targetingSuperweapon || this.attackMoveArmed) {
      const tile = this.ui.hoverTile;
      this.ui.placingDefId = null;
      this.ui.sellMode = false;
      this.ui.repairMode = false;
      this.ui.targetingSuperweapon = false;
      this.attackMoveArmed = false;
      this.feedback('cancel', tile ? { x: tile.x + 0.5, y: tile.y + 0.5 } : null);
      return;
    }
    const state = this.getState();
    const tile = this.ui.hoverTile;
    if (!tile) return;

    const selected = this.ui.selection
      .map((id) => state.entities.get(id))
      .filter((x): x is Entity => x !== undefined && x.owner === this.me && x.hp > 0);
    if (selected.length === 0) return;

    const units = selected.filter((s) => s.kind === 'unit');
    const buildings = selected.filter((s) => s.kind === 'building');
    if (units.length === 0 && buildings.length > 0) {
      // Rally for selected production structures.
      let rallied = false;
      for (const b of buildings) {
        const def = this.data.buildings[b.defId];
        if (def.producesTabs && def.producesTabs.length > 0) {
          this.dispatch({ type: 'setRally', player: this.me, buildingId: b.id, pos: { x: tile.x + 0.5, y: tile.y + 0.5 } });
          rallied = true;
        }
      }
      if (rallied) this.feedback('rally', { x: tile.x + 0.5, y: tile.y + 0.5 });
      return;
    }

    this.contextOrder(state, units, tile, queued);
  }

  private contextOrder(state: GameState, units: Entity[], tile: Vec2, queued: boolean): void {
    const target = this.pickEntity(state, 'any');
    const dest = { x: tile.x + 0.5, y: tile.y + 0.5 };

    // Enemy target → attack (engineers capture buildings instead).
    if (target && target.owner !== this.me && isVisibleTo(state, this.me, Math.floor(tile.x), Math.floor(tile.y))) {
      const engineers = units.filter((u) => this.data.units[u.defId]?.engineer);
      const fighters = units.filter((u) => !this.data.units[u.defId]?.engineer);
      if (target.kind === 'building' && engineers.length > 0) {
        this.dispatch({
          type: 'issueOrder',
          player: this.me,
          unitIds: engineers.map((u) => u.id),
          order: { kind: 'capture', target: target.id },
          queued,
        });
        this.feedback('capture', entityCenter(target, this.data));
      }
      if (fighters.length > 0) {
        this.dispatch({
          type: 'issueOrder',
          player: this.me,
          unitIds: fighters.map((u) => u.id),
          order: { kind: 'attack', target: target.id },
          queued,
        });
        this.feedback('attack', entityCenter(target, this.data));
      }
      return;
    }

    // Crystal tile → harvesters harvest, the rest move.
    const terr = state.map.terrain[tileIndex(state.map, tile.x, tile.y)];
    const harvesters = units.filter((u) => this.data.units[u.defId]?.harvester);
    if (terr === Terrain.CRYSTAL && harvesters.length > 0) {
      this.dispatch({
        type: 'issueOrder',
        player: this.me,
        unitIds: harvesters.map((u) => u.id),
        order: { kind: 'harvest', tile: { x: Math.floor(tile.x), y: Math.floor(tile.y) } },
        queued,
      });
      this.feedback('harvest', dest);
      const rest = units.filter((u) => !this.data.units[u.defId]?.harvester);
      if (rest.length > 0) {
        this.dispatch({ type: 'issueOrder', player: this.me, unitIds: rest.map((u) => u.id), order: { kind: 'move', dest }, queued });
        this.feedback('move', dest);
      }
      return;
    }

    this.dispatch({
      type: 'issueOrder',
      player: this.me,
      unitIds: units.map((u) => u.id),
      order: { kind: 'move', dest },
      queued,
    });
    this.feedback('move', dest);
  }

  private handleWheel(e: WheelEvent): void {
    e.preventDefault();
    if (this.ui.paused) return;
    const before = screenToTile(this.cam, this.mouse.x, this.mouse.y);
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    this.cam.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.cam.zoom * factor));
    // Keep the tile under the cursor anchored.
    this.cam.x = (before.x - before.y) * TILE_HALF_W - this.mouse.x / this.cam.zoom;
    this.cam.y = (before.x + before.y) * TILE_HALF_H - this.mouse.y / this.cam.zoom;
  }

  /** [ / ] keyboard zoom: ±0.1 steps, anchored at the viewport center. */
  private zoomStep(delta: number): void {
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;
    const before = screenToTile(this.cam, cx, cy);
    this.cam.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.cam.zoom + delta));
    this.cam.x = (before.x - before.y) * TILE_HALF_W - cx / this.cam.zoom;
    this.cam.y = (before.x + before.y) * TILE_HALF_H - cy / this.cam.zoom;
  }

  // --- minimap -------------------------------------------------------------------

  private handleMinimapMouse(e: MouseEvent): void {
    if (e.button === 2 || !this.minimap) return;
    const state = this.getState();
    if (!state.players[this.me].radarActive) return;
    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    const t = this.minimap.minimapToTile(e.clientX - rect.left, e.clientY - rect.top, state);
    this.centerOn(t);
  }

  private handleMinimapOrder(e: MouseEvent): void {
    if (!this.minimap) return;
    const state = this.getState();
    if (!state.players[this.me].radarActive) return;
    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    const t = this.minimap.minimapToTile(e.clientX - rect.left, e.clientY - rect.top, state);
    const units = this.ui.selection
      .map((id) => state.entities.get(id))
      .filter((x): x is Entity => x !== undefined && x.kind === 'unit' && x.owner === this.me);
    if (units.length === 0) return;
    this.dispatch({
      type: 'issueOrder',
      player: this.me,
      unitIds: units.map((u) => u.id),
      order: { kind: 'attackMove', dest: { x: t.x, y: t.y } },
      queued: e.shiftKey,
    });
  }

  // --- keyboard ------------------------------------------------------------------

  private handleKeyDown(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const k = e.key.toLowerCase();
    this.keys.add(k);

    if (k === 'escape') {
      if (this.ui.placingDefId || this.ui.sellMode || this.ui.repairMode || this.ui.targetingSuperweapon || this.attackMoveArmed) {
        this.ui.placingDefId = null;
        this.ui.sellMode = false;
        this.ui.repairMode = false;
        this.ui.targetingSuperweapon = false;
        this.attackMoveArmed = false;
      } else {
        this.ui.showMenu = !this.ui.showMenu;
      }
      e.preventDefault();
      return;
    }
    if (this.ui.paused) return;

    const state = this.getState();
    if (k === 'a') this.attackMoveArmed = true;
    else if (k === 's') this.issueToSelection({ kind: 'stop' }, false);
    else if (k === 'g') this.issueToSelection({ kind: 'guard' }, false);
    else if (k === 'h') {
      const con = [...state.entities.values()].find(
        (ent) => ent.owner === this.me && ent.kind === 'building' && this.data.buildings[ent.defId]?.isConYard,
      );
      if (con) this.centerOn(entityCenter(con, this.data));
    } else if (k === '[') this.zoomStep(-0.1);
    else if (k === ']') this.zoomStep(0.1);
    else if (k === 't') this.selectSameType(state);
    else if (k === 'x') this.scatterSelection(state);
    else if (k === 'c') {
      // Cheer: pure flair, no sim effect — main.ts wires visuals/audio.
      const ids = this.ownSelectedUnitIds(state);
      if (ids.length > 0 && this.onCheer) this.onCheer(ids);
    } else if (k === 'v') this.toggleStance(state);
    else if (k === 'tab') {
      this.cycleProduction(state);
      e.preventDefault();
    } else if (k === ' ') {
      if (this.lastAttackPos) this.centerOn(this.lastAttackPos);
      e.preventDefault();
    } else if (/^[1-9]$/.test(k)) {
      const n = Number(k);
      if (e.ctrlKey || e.metaKey) {
        this.ui.controlGroups[n] = [...this.ui.selection];
        e.preventDefault();
      } else {
        const group = (this.ui.controlGroups[n] ?? []).filter((id) => {
          const ent = state.entities.get(id);
          return ent !== undefined && ent.hp > 0 && ent.owner === this.me;
        });
        this.ui.controlGroups[n] = group;
        if (group.length > 0) {
          this.ui.selection = [...group];
          this.ackSelection();
          const now = performance.now();
          if (this.lastGroupTap.num === n && now - this.lastGroupTap.time < DOUBLE_MS) {
            const first = state.entities.get(group[0]);
            if (first) this.centerOn(entityCenter(first, this.data));
          }
          this.lastGroupTap = { time: now, num: n };
        }
      }
    }
  }

  // --- selection / order helpers ----------------------------------------------------

  /**
   * T: select all units of the first selected unit's type on screen; a second
   * press within 400ms — or with a same-type multi-selection already — goes
   * map-wide (RA2 Remastered behavior).
   */
  private selectSameType(state: GameState): void {
    const first = this.ui.selection
      .map((id) => state.entities.get(id))
      .find((ent): ent is Entity => ent !== undefined && ent.kind === 'unit' && ent.owner === this.me && ent.hp > 0);
    if (!first) return;
    const now = performance.now();
    const sameTypeAlready =
      this.ui.selection.length > 1 &&
      this.ui.selection.every((id) => state.entities.get(id)?.defId === first.defId);
    const mapWide =
      sameTypeAlready ||
      (this.lastTypeSelect.defId === first.defId && now - this.lastTypeSelect.time < TYPE_SELECT_DOUBLE_MS);
    const picked: EntityId[] = [];
    for (const ent of state.entities.values()) {
      if (ent.kind !== 'unit' || ent.owner !== this.me || ent.defId !== first.defId || ent.hp <= 0) continue;
      if (!mapWide) {
        const { sx, sy } = tileToScreen(this.cam, ent.pos.x, ent.pos.y);
        if (sx < 0 || sx > this.canvas.width || sy < 0 || sy > this.canvas.height) continue;
      }
      picked.push(ent.id);
    }
    if (picked.length > 0) {
      this.ui.selection = picked;
      this.ackSelection();
    }
    this.lastTypeSelect = { time: now, defId: first.defId };
  }

  /**
   * X: scatter — each selected unit moves to a free passable tile 1–2 tiles
   * away, fanned out by selection index so the group spreads instead of
   * re-clumping. Client-side only: plain move orders, no sim support needed.
   */
  private scatterSelection(state: GameState): void {
    const units = this.ui.selection
      .map((id) => state.entities.get(id))
      .filter((x): x is Entity => x !== undefined && x.kind === 'unit' && x.owner === this.me && x.hp > 0);
    if (units.length === 0) return;
    const claimed = new Set<number>(); // tiles already taken this scatter
    units.forEach((u, i) => {
      const def = this.data.units[u.defId];
      const domain = def !== undefined ? def.domain : MoveDomain.GROUND;
      const ux = Math.floor(u.pos.x);
      const uy = Math.floor(u.pos.y);
      const baseAngle = (i / units.length) * Math.PI * 2 + 0.61; // offset: unit 0 isn't always due +x
      let dest: Vec2 | null = null;
      // Rings of 8 directions at ~1 then ~2 tiles (rounded to tile centers).
      search: for (const r of [1.2, 2.2]) {
        for (let j = 0; j < 8; j++) {
          const ang = baseAngle + (j * Math.PI) / 4;
          const tx = Math.round(ux + Math.cos(ang) * r);
          const ty = Math.round(uy + Math.sin(ang) * r);
          if (tx === ux && ty === uy) continue;
          if (!inBounds(state.map, tx, ty)) continue;
          const key = tileIndex(state.map, tx, ty);
          if (claimed.has(key)) continue;
          if (!passableFor(state.map, domain, tx, ty)) continue;
          if (!this.tileFreeOfBuildings(state, tx, ty)) continue;
          claimed.add(key);
          dest = { x: tx + 0.5, y: ty + 0.5 };
          break search;
        }
      }
      if (dest) {
        this.dispatch({ type: 'issueOrder', player: this.me, unitIds: [u.id], order: { kind: 'move', dest }, queued: false });
        this.feedback('move', dest);
      }
    });
  }

  /** V: flip the selection between aggressive and hold-fire (first unit decides). */
  private toggleStance(state: GameState): void {
    const ids: EntityId[] = [];
    let firstStance: UnitStance | null = null;
    for (const id of this.ui.selection) {
      const ent = state.entities.get(id);
      if (!ent || ent.kind !== 'unit' || ent.owner !== this.me || ent.hp <= 0) continue;
      if (firstStance === null) firstStance = ent.stance;
      ids.push(id);
    }
    if (ids.length === 0 || firstStance === null) return;
    const stance: UnitStance = firstStance === 'aggressive' ? 'holdfire' : 'aggressive';
    this.dispatch({ type: 'setStance', player: this.me, unitIds: ids, stance });
  }

  /** Tab: cycle the camera across own operational production buildings. */
  private cycleProduction(state: GameState): void {
    const prods: Entity[] = [];
    for (const ent of state.entities.values()) {
      if (ent.kind !== 'building' || ent.owner !== this.me || ent.hp <= 0 || ent.buildProgress < 1) continue;
      const def = this.data.buildings[ent.defId];
      if (!def) continue;
      if (def.isConYard || (def.producesTabs !== undefined && def.producesTabs.length > 0)) prods.push(ent);
    }
    if (prods.length === 0) return;
    prods.sort((a, b) => a.id - b.id); // stable order regardless of Map iteration
    this.prodCycle = (this.prodCycle + 1) % prods.length;
    this.centerOn(entityCenter(prods[this.prodCycle], this.data));
  }

  private issueToSelection(order: Order, queued: boolean): void {
    const state = this.getState();
    const ids = this.ownSelectedUnitIds(state);
    if (ids.length > 0) this.dispatch({ type: 'issueOrder', player: this.me, unitIds: ids, order, queued });
  }

  private ownSelectedUnitIds(state: GameState): EntityId[] {
    return this.ui.selection.filter((id) => {
      const ent = state.entities.get(id);
      return ent !== undefined && ent.kind === 'unit' && ent.owner === this.me && ent.hp > 0;
    });
  }

  /** Selected own units that can force-fire: armed, not harvester/engineer. */
  private armedSelectedUnitIds(state: GameState): EntityId[] {
    return this.ui.selection.filter((id) => {
      const ent = state.entities.get(id);
      if (!ent || ent.kind !== 'unit' || ent.owner !== this.me || ent.hp <= 0) return false;
      const def = this.data.units[ent.defId];
      return def !== undefined && def.weapon !== undefined && !def.harvester && !def.engineer;
    });
  }

  private forceFireHeld(state: GameState): boolean {
    if (!this.keys.has('control') && !this.keys.has('f')) return false;
    return this.armedSelectedUnitIds(state).length > 0;
  }

  /** Notify main.ts of an active own-unit selection (lead unit responds). */
  private ackSelection(): void {
    if (!this.onSelectionAck) return;
    const now = performance.now();
    if (now - this.lastAckAt < ACK_THROTTLE_MS) return;
    const state = this.getState();
    const first = state.entities.get(this.ui.selection[0]);
    if (first && first.kind === 'unit' && first.owner === this.me && first.hp > 0) {
      this.lastAckAt = now;
      this.onSelectionAck(first.defId);
    }
  }

  private tileFreeOfBuildings(state: GameState, x: number, y: number): boolean {
    const occ = state.occupancy.get(tileIndex(state.map, x, y));
    if (!occ) return true;
    for (const id of occ) {
      const ent = state.entities.get(id);
      if (ent && ent.kind === 'building' && ent.hp > 0) return false;
    }
    return true;
  }

  private centerOn(tile: Vec2): void {
    this.cam.x = (tile.x - tile.y) * TILE_HALF_W - this.canvas.width / (2 * this.cam.zoom);
    this.cam.y = (tile.x + tile.y) * TILE_HALF_H - this.canvas.height / (2 * this.cam.zoom);
  }

  /**
   * Pick the entity under the cursor: buildings via footprint occupancy,
   * units by nearest screen-space distance (preferring units, then higher
   * depth so the visually-front entity wins).
   */
  private pickEntity(state: GameState, kind: 'any' | 'building'): Entity | null {
    const t = screenToTile(this.cam, this.mouse.x, this.mouse.y);
    const tx = Math.floor(t.x);
    const ty = Math.floor(t.y);

    // Units first (within ~26px screen distance), visually closest wins.
    if (kind !== 'building') {
      let best: Entity | null = null;
      let bestScore = Infinity;
      for (const ent of state.entities.values()) {
        if (ent.kind !== 'unit' || ent.hp <= 0) continue;
        if (ent.owner !== this.me && !isVisibleTo(state, this.me, Math.round(ent.pos.x), Math.round(ent.pos.y))) continue;
        const { sx, sy } = tileToScreen(this.cam, ent.pos.x, ent.pos.y);
        const d = Math.hypot(sx - this.mouse.x, sy - (this.mouse.y + 14)); // sprites sit above the tile point
        if (d < 26 * this.cam.zoom && d - (ent.pos.x + ent.pos.y) * 0.01 < bestScore) {
          best = ent;
          bestScore = d - (ent.pos.x + ent.pos.y) * 0.01;
        }
      }
      if (best) return best;
    }

    // Buildings via occupancy (covers the whole footprint).
    if (inBounds(state.map, tx, ty)) {
      const occ = state.occupancy.get(tileIndex(state.map, tx, ty));
      if (occ) {
        for (const id of occ) {
          const ent = state.entities.get(id);
          if (!ent || ent.kind !== 'building' || ent.hp <= 0) continue;
          if (ent.owner !== this.me && !isVisibleTo(state, this.me, tx, ty)) continue;
          return ent;
        }
      }
    }
    return null;
  }
}
