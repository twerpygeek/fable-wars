// =============================================================================
// POCKET ALERT — mouse/keyboard controller (Owner E).
// Translates raw input into UIState mutations + sim Commands. Never mutates
// GameState. Active only between enable()/disable() (match lifetime).
//
// Controls: LMB select / drag-select / dbl-click same-type; RMB context order
// (move/attack/harvest/capture, Shift queues) or rally for selected producers;
// A+LMB attack-move; S stop; G guard; H center ConYard; Ctrl+1..9 / 1..9
// control groups (double-tap centers); ESC cancels modes / toggles menu;
// edge + WASD/arrow scroll; wheel zoom; Space jumps to last base attack.
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
  Vec2,
} from '../core/types';
import { Terrain, entityCenter, inBounds, tileIndex } from '../core/types';
import { TILE_HALF_H, TILE_HALF_W } from '../core/constants';
import { MAX_ZOOM, MIN_ZOOM, screenToTile, tileToScreen } from '../render/camera';
import { isValidPlacement } from '../sim/production';
import { isVisibleTo } from '../sim/fog';
import type { SpriteAtlas } from '../render/sprites';
import type { Minimap } from '../render/minimap';

const EDGE_MARGIN = 24; // px
const SCROLL_SPEED = 1100; // world px/sec at zoom 1
const DRAG_THRESHOLD = 4; // px
const DOUBLE_MS = 350;

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
  private keys = new Set<string>();
  private attackMoveArmed = false;
  private lastClick = { time: 0, defId: '' };
  private lastGroupTap = { time: 0, num: -1 };
  private lastAttackPos: Vec2 | null = null;
  private minimapEl: HTMLCanvasElement | null = null;
  private minimap: Minimap | null = null;

  // bound listeners (so disable() can remove them)
  private onMouseDown = (e: MouseEvent) => this.handleMouseDown(e);
  private onMouseMove = (e: MouseEvent) => this.handleMouseMove(e);
  private onMouseUp = (e: MouseEvent) => this.handleMouseUp(e);
  private onContextMenu = (e: MouseEvent) => this.handleContextMenu(e);
  private onWheel = (e: WheelEvent) => this.handleWheel(e);
  private onKeyDown = (e: KeyboardEvent) => this.handleKeyDown(e);
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());
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

  /** Per-frame: edge/key scrolling, hover refresh, selection hygiene. */
  update(dtMs: number, viewW: number, viewH: number): void {
    if (!this.enabled || this.ui.paused) return;
    const dt = dtMs / 1000;
    let dx = 0;
    let dy = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) dy -= 1;
    if (this.keys.has('s') && !this.keys.has('shift')) {
      /* 's' is stop; scrolling uses arrows only for down */
    }
    if (this.keys.has('arrowdown')) dy += 1;
    if (this.keys.has('a') === false) {
      if (this.keys.has('arrowleft')) dx -= 1;
    } else if (this.keys.has('arrowleft')) dx -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) dx += 1;
    // WASD: W/D used above; A is attack-move arm, S is stop — arrows cover all four.
    if (this.mouse.inside && !this.mouse.down) {
      if (this.mouse.x < EDGE_MARGIN) dx -= 1;
      else if (this.mouse.x > viewW - EDGE_MARGIN - 200) dx += 1; // 200px sidebar
      if (this.mouse.y < EDGE_MARGIN) dy -= 1;
      else if (this.mouse.y > viewH - EDGE_MARGIN) dy += 1;
    }
    if (dx !== 0 || dy !== 0) {
      const v = (SCROLL_SPEED * dt) / this.cam.zoom;
      this.cam.x += dx * v;
      this.cam.y += dy * v;
    }

    // Hover tile + placement validity.
    const state = this.getState();
    const t = screenToTile(this.cam, this.mouse.x, this.mouse.y);
    const tile = { x: Math.floor(t.x), y: Math.floor(t.y) };
    this.ui.hoverTile = inBounds(state.map, tile.x, tile.y) ? tile : null;
    if (this.ui.placingDefId && this.ui.hoverTile) {
      this.ui.placeValid = isValidPlacement(state, this.data, this.me, this.ui.placingDefId, this.ui.hoverTile);
    }

    // Drop dead/foreign ids from selection.
    this.ui.selection = this.ui.selection.filter((id) => {
      const e = state.entities.get(id);
      return e !== undefined && e.hp > 0 && e.owner === this.me;
    });

    this.canvas.style.cursor =
      this.ui.placingDefId || this.ui.targetingSuperweapon
        ? 'crosshair'
        : this.attackMoveArmed
          ? 'crosshair'
          : this.ui.sellMode || this.ui.repairMode
            ? 'pointer'
            : 'default';
  }

  // --- mouse ---------------------------------------------------------------------

  private handleMouseDown(e: MouseEvent): void {
    if (e.button !== 0 || this.ui.paused) return;
    const state = this.getState();
    this.mouse.down = true;

    // Mode clicks resolve on mousedown (RA2 feel).
    if (this.ui.placingDefId) {
      const tile = this.ui.hoverTile;
      if (tile && this.ui.placeValid) {
        const defId = this.ui.placingDefId;
        this.dispatch({ type: 'placeBuilding', player: this.me, defId, pos: tile });
        const def = this.data.buildings[defId];
        if (!(e.shiftKey && def && def.cost <= 100)) this.ui.placingDefId = null; // shift chains walls
      }
      return;
    }
    if (this.ui.targetingSuperweapon) {
      const tile = this.ui.hoverTile;
      if (tile) {
        this.dispatch({ type: 'fireSuperweapon', player: this.me, target: { x: tile.x + 0.5, y: tile.y + 0.5 } });
        this.ui.targetingSuperweapon = false;
      }
      return;
    }
    if (this.ui.sellMode || this.ui.repairMode) {
      const b = this.pickEntity(e, state, 'building');
      if (b && b.owner === this.me) {
        this.dispatch(
          this.ui.sellMode
            ? { type: 'sell', player: this.me, buildingId: b.id }
            : { type: 'toggleRepair', player: this.me, buildingId: b.id },
        );
      }
      return;
    }
    if (this.attackMoveArmed) {
      const tile = this.ui.hoverTile;
      if (tile) this.issueToSelection({ kind: 'attackMove', dest: { x: tile.x + 0.5, y: tile.y + 0.5 } }, e.shiftKey);
      this.attackMoveArmed = false;
      return;
    }
    this.ui.dragStart = { sx: e.offsetX, sy: e.offsetY };
    this.ui.dragEnd = null;
  }

  private handleMouseMove(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = e.clientX - rect.left;
    this.mouse.y = e.clientY - rect.top;
    this.mouse.inside =
      e.clientX >= rect.left && e.clientX < rect.right && e.clientY >= rect.top && e.clientY < rect.bottom;
    if (this.mouse.down && this.ui.dragStart) {
      const dx = this.mouse.x - this.ui.dragStart.sx;
      const dy = this.mouse.y - this.ui.dragStart.sy;
      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
        this.ui.dragEnd = { sx: this.mouse.x, sy: this.mouse.y };
      }
    }
  }

  private handleMouseUp(e: MouseEvent): void {
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
      } else if (!e.shiftKey) {
        this.ui.selection = [];
      }
    } else if (this.ui.dragStart) {
      // Plain click: pick entity.
      const hit = this.pickEntity(e, state, 'any');
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
        } else if (e.shiftKey) {
          this.ui.selection = this.ui.selection.includes(hit.id)
            ? this.ui.selection.filter((i) => i !== hit.id)
            : [...this.ui.selection, hit.id];
        } else {
          this.ui.selection = [hit.id];
        }
        this.lastClick = { time: now, defId: hit.defId };
      } else if (!e.shiftKey) {
        this.ui.selection = [];
      }
    }
    this.ui.dragStart = this.ui.dragEnd = null;
  }

  private handleContextMenu(e: MouseEvent): void {
    e.preventDefault();
    if (this.ui.paused) return;
    // RMB cancels any armed mode first.
    if (this.ui.placingDefId || this.ui.sellMode || this.ui.repairMode || this.ui.targetingSuperweapon || this.attackMoveArmed) {
      this.ui.placingDefId = null;
      this.ui.sellMode = false;
      this.ui.repairMode = false;
      this.ui.targetingSuperweapon = false;
      this.attackMoveArmed = false;
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
      for (const b of buildings) {
        const def = this.data.buildings[b.defId];
        if (def.producesTabs && def.producesTabs.length > 0) {
          this.dispatch({ type: 'setRally', player: this.me, buildingId: b.id, pos: { x: tile.x + 0.5, y: tile.y + 0.5 } });
        }
      }
      return;
    }

    this.contextOrder(state, units, tile, e.shiftKey, e);
  }

  private contextOrder(state: GameState, units: Entity[], tile: Vec2, queued: boolean, e: MouseEvent): void {
    const target = this.pickEntity(e, state, 'any');
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
      }
      if (fighters.length > 0) {
        this.dispatch({
          type: 'issueOrder',
          player: this.me,
          unitIds: fighters.map((u) => u.id),
          order: { kind: 'attack', target: target.id },
          queued,
        });
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
      const rest = units.filter((u) => !this.data.units[u.defId]?.harvester);
      if (rest.length > 0) {
        this.dispatch({ type: 'issueOrder', player: this.me, unitIds: rest.map((u) => u.id), order: { kind: 'move', dest }, queued });
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

  // --- helpers --------------------------------------------------------------------

  private issueToSelection(order: Order, queued: boolean): void {
    const state = this.getState();
    const ids = this.ui.selection.filter((id) => {
      const ent = state.entities.get(id);
      return ent !== undefined && ent.kind === 'unit' && ent.owner === this.me && ent.hp > 0;
    });
    if (ids.length > 0) this.dispatch({ type: 'issueOrder', player: this.me, unitIds: ids, order, queued });
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
  private pickEntity(e: MouseEvent, state: GameState, kind: 'any' | 'building'): Entity | null {
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
