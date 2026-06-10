// =============================================================================
// POCKET ALERT — isometric renderer. The player's entire view of the game.
//
// Render pass order:
//   1. terrain      — blitted from an offscreen full-map iso pre-render that is
//                     only repainted (regionally) when a crystal tile depletes
//   2. water        — animated shimmer highlights over precomputed water tiles
//   3. ground layer — depth-sorted buildings / units / projectiles (+ shadows)
//   4. air layer    — air units & anti-air projectiles, lifted off the ground
//   5. effects      — explosions, bolts, spores, glyphs (render/effects.ts)
//   6. fog          — 1px-per-tile shroud canvas drawn through the iso affine
//                     transform with smoothing for soft edges
//   7. overlays     — selection, health bars, chevrons, rally lines, placement
//                     ghost, sell/repair tint, superweapon reticle, drag rect
//   8. flashes      — full-screen superweapon warning / nuke arrival flashes
//
// Reads GameState, never writes it. Cosmetic timers/randomness allowed here.
// =============================================================================

import { HEALTH_RED, HEALTH_YELLOW, TILE_H, TILE_HALF_H, TILE_HALF_W, TILE_W } from '../core/constants';
import { ArmorClass, Element, MoveDomain, PLAYER_COLORS, Terrain, tileIndex } from '../core/types';
import type {
  BuildingDef,
  Camera,
  Crate,
  Entity,
  EntityId,
  GameData,
  GameEvent,
  GameMap,
  GameState,
  PlayerId,
  Projectile,
  UIState,
  VisualEffect,
} from '../core/types';
import type { SpriteAtlas } from './sprites';
import { EffectsSystem } from './effects';

const TAU = Math.PI * 2;
const SQRT2 = Math.SQRT2;
const EIGHTH = Math.PI / 4;
const BG_COLOR = '#04050a';
const FOG_UNEXPLORED_U32 = 0xff0a0605; // #05060a, opaque (little-endian RGBA)
const FOG_EXPLORED_U32 = 0x73000000; // rgba(0,0,0,0.45)
const GOLD = '#ffd24a';
const TERRAIN_TOP_PAD = 96; // room above row 0 for tree/rock overhang

interface SmoothRec {
  x: number;
  y: number;
  lastMoveMs: number;
  traveled: number; // accumulated drawn travel distance in tiles (walk-bob phase)
}

type DrawItem = Entity | Projectile | Crate;

function isEntityItem(it: DrawItem): it is Entity {
  const k = (it as Entity).kind;
  return k === 'unit' || k === 'building';
}

function isCrateItem(it: DrawItem): it is Crate {
  return (it as Crate).spawnedTick !== undefined;
}

// rules.ini ConditionYellow / ConditionRed thresholds
function healthColor(ratio: number): string {
  return ratio > HEALTH_YELLOW ? '#3ce86e' : ratio > HEALTH_RED ? '#e8c63c' : '#e8453c';
}

/** Cheap deterministic hash -> [0,1) for ambient critters (stable per seed/lane). */
function hash01(seed: number, lane: number): number {
  let x = (seed + Math.imul(lane | 0, 0x9e3779b9)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

const CRITTER_COLORS = ['#ffe9a8', '#ffc9e8', '#d6f0ff']; // butterfly wing tints

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private data: GameData;
  private atlas: SpriteAtlas;
  private effects = new EffectsSystem();

  // bound map + caches
  private boundMap: GameMap | null = null;
  private terrain: HTMLCanvasElement | null = null;
  private terrainCtx: CanvasRenderingContext2D | null = null;
  private terrainOX = 0; // canvas px of world-x origin in the terrain cache
  private pendingPatches: number[] = []; // packed tile indices to repaint (crystal depletion)
  private waterTiles: Int32Array = new Int32Array(0);
  private shoreMask: Uint8Array = new Uint8Array(0); // per waterTiles entry: 4-bit land-adjacency
  private shimmer: HTMLCanvasElement;

  // fog (1 px per tile)
  private fogCanvas: HTMLCanvasElement | null = null;
  private fogCtx: CanvasRenderingContext2D | null = null;
  private fogData: ImageData | null = null;
  private fog32: Uint32Array | null = null;

  // per-frame projection state (effective camera incl. shake)
  private camX = 0;
  private camY = 0;
  private zoom = 1;
  private vx0 = 0; // visible tile window (floats, unclamped)
  private vy0 = 0;
  private vx1 = 0;
  private vy1 = 0;
  private frameDt = 16;
  private frameCount = 0;

  // smooth unit motion: entity id -> last drawn tile pos
  private smooth = new Map<EntityId, SmoothRec>();

  // combat hit-flicker: entity id -> ms until which its sprite flashes white
  private flicker = new Map<EntityId, number>();
  private flickerScratch: HTMLCanvasElement | null = null;
  private flickerScratchCtx: CanvasRenderingContext2D | null = null;

  // build-up animation: building id -> buildProgress at the last dust puff
  private buildDustLast = new Map<EntityId, number>();

  // ambient / crate pre-rendered sprites
  private crateSprite: HTMLCanvasElement;
  private crateGlow: HTMLCanvasElement;
  private cloudShadow: HTMLCanvasElement;

  // reused draw lists (no per-frame allocation)
  private groundList: DrawItem[] = [];
  private airList: DrawItem[] = [];
  private selectedSet = new Set<EntityId>();
  private depthCompare: (a: DrawItem, b: DrawItem) => number;
  private anchor = { sx: 0, top: 0, ground: 0 }; // reused entity-anchor scratch
  private dashPattern = [6, 4];
  private playerHex: string[] = [];
  private playerFill: string[] = [];

  constructor(canvas: HTMLCanvasElement, data: GameData, sprites: SpriteAtlas) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('renderer: 2d context unavailable');
    this.ctx = ctx;
    this.data = data;
    this.atlas = sprites;
    this.depthCompare = (a, b) => this.depthOf(a) - this.depthOf(b);
    for (const c of PLAYER_COLORS) {
      const { r, g, b } = hexToRgb(c.hex);
      this.playerHex.push(c.hex);
      this.playerFill.push(`rgba(${r},${g},${b},0.28)`);
    }
    this.shimmer = this.renderShimmerSprite();
    this.crateSprite = this.renderCrateSprite();
    this.crateGlow = this.renderCrateGlow();
    this.cloudShadow = this.renderCloudShadow();
  }

  addEffect(fx: VisualEffect): void {
    this.effects.add(fx);
  }

  handleEvents(events: GameEvent[], state: GameState, humanPlayer: PlayerId): void {
    const now = performance.now();
    for (const ev of events) {
      if (ev.type === 'crystalDepleted') {
        this.pendingPatches.push(tileIndex(state.map, ev.pos.x, ev.pos.y));
      } else if (ev.type === 'impact') {
        // 80ms white hit-flicker on everything near the impact point
        const until = now + 80;
        for (const e of state.entities.values()) {
          let cx = e.pos.x;
          let cy = e.pos.y;
          let reach = 1.2;
          if (e.kind === 'building') {
            const bd = this.data.buildings[e.defId];
            if (bd) {
              cx += bd.footprint.w / 2;
              cy += bd.footprint.h / 2;
              reach += Math.max(bd.footprint.w, bd.footprint.h) / 2;
            }
          }
          const dx = cx - ev.pos.x;
          const dy = cy - ev.pos.y;
          if (dx * dx + dy * dy <= reach * reach) this.flicker.set(e.id, until);
        }
      }
    }
    this.effects.spawnFromEvents(events, state, this.data, humanPlayer, now);
  }

  render(
    state: GameState,
    cam: Camera,
    ui: UIState,
    humanPlayer: PlayerId,
    nowMs: number,
    alpha: number
  ): void {
    void alpha; // motion smoothing is handled by the per-entity lerp map below
    const ctx = this.ctx;
    const vw = ctx.canvas.width;
    const vh = ctx.canvas.height;
    if (vw === 0 || vh === 0) return;
    this.frameCount++;
    this.frameDt = Math.min(100, Math.max(1, nowMs - (this.lastNow || nowMs - 16)));
    this.lastNow = nowMs;

    if (state.map !== this.boundMap) this.bindMap(state);
    this.applyTerrainPatches(state.map);
    this.effects.update(nowMs);

    // effective camera = real camera + screen shake (shake in screen px)
    const shake = this.effects.shakeOffset(nowMs);
    this.zoom = cam.zoom;
    this.camX = cam.x + shake.x / cam.zoom;
    this.camY = cam.y + shake.y / cam.zoom;

    // visible tile window from the four viewport corners
    const t0x = this.invTileX(0, 0);
    const t0y = this.invTileY(0, 0);
    const t1x = this.invTileX(vw, 0);
    const t1y = this.invTileY(vw, 0);
    const t2x = this.invTileX(vw, vh);
    const t2y = this.invTileY(vw, vh);
    const t3x = this.invTileX(0, vh);
    const t3y = this.invTileY(0, vh);
    this.vx0 = Math.min(t0x, t1x, t2x, t3x) - 2;
    this.vx1 = Math.max(t0x, t1x, t2x, t3x) + 2;
    this.vy0 = Math.min(t0y, t1y, t2y, t3y) - 2;
    this.vy1 = Math.max(t0y, t1y, t2y, t3y) + 2;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, vw, vh);

    this.drawTerrain(vw, vh);
    this.drawWater(state, humanPlayer, nowMs, vw, vh);
    this.effects.drawGroundDecals(ctx, nowMs, this.camX, this.camY, this.zoom, vw, vh);
    this.buildDrawLists(state, ui, humanPlayer, nowMs, vw, vh);
    this.drawGroundLayer(state, nowMs);
    this.drawAirLayer(state, nowMs);
    this.effects.drawWorld(ctx, nowMs, this.camX, this.camY, this.zoom, vw, vh);
    this.drawAmbient(state, humanPlayer, nowMs, vw, vh);
    this.drawFog(state, humanPlayer);
    this.drawOverlays(state, ui, humanPlayer, nowMs, vw, vh);
    this.effects.drawScreenFlashes(ctx, nowMs, vw, vh);

    // periodic cleanup of per-entity records for dead entities / stale flickers
    if (this.frameCount % 150 === 0) {
      for (const id of this.smooth.keys()) {
        if (!state.entities.has(id)) this.smooth.delete(id);
      }
      for (const [id, until] of this.flicker) {
        if (nowMs >= until || !state.entities.has(id)) this.flicker.delete(id);
      }
      for (const id of this.buildDustLast.keys()) {
        if (!state.entities.has(id)) this.buildDustLast.delete(id);
      }
    }
  }

  private lastNow = 0;

  // --- projection helpers (inline math, no allocation) --------------------------

  private projX(x: number, y: number): number {
    return ((x - y) * TILE_HALF_W - this.camX) * this.zoom;
  }

  private projY(x: number, y: number): number {
    return ((x + y) * TILE_HALF_H - this.camY) * this.zoom;
  }

  private invTileX(sx: number, sy: number): number {
    const wx = sx / this.zoom + this.camX;
    const wy = sy / this.zoom + this.camY;
    return (wx / TILE_HALF_W + wy / TILE_HALF_H) / 2;
  }

  private invTileY(sx: number, sy: number): number {
    const wx = sx / this.zoom + this.camX;
    const wy = sy / this.zoom + this.camY;
    return (wy / TILE_HALF_H - wx / TILE_HALF_W) / 2;
  }

  // --- map binding / terrain cache ----------------------------------------------

  private bindMap(state: GameState): void {
    const m = state.map;
    this.boundMap = m;
    this.smooth.clear();
    this.pendingPatches.length = 0;

    // full-map iso pre-render (zoom 1); ~6144x3168 for a 96x96 map
    const w = (m.w + m.h) * TILE_HALF_W;
    const h = (m.w + m.h) * TILE_HALF_H + TERRAIN_TOP_PAD;
    this.terrain = document.createElement('canvas');
    this.terrain.width = w;
    this.terrain.height = h;
    const tctx = this.terrain.getContext('2d');
    if (!tctx) throw new Error('renderer: 2d context unavailable');
    this.terrainCtx = tctx;
    this.terrainOX = m.h * TILE_HALF_W;
    tctx.fillStyle = BG_COLOR;
    tctx.fillRect(0, 0, w, h);
    this.paintTerrainRegion(m, 0, 0, m.w - 1, m.h - 1, false);

    // precompute water tile list for the shimmer pass
    let count = 0;
    for (let i = 0; i < m.terrain.length; i++) {
      if (m.terrain[i] === Terrain.WATER) count++;
    }
    this.waterTiles = new Int32Array(count);
    let k = 0;
    for (let i = 0; i < m.terrain.length; i++) {
      if (m.terrain[i] === Terrain.WATER) this.waterTiles[k++] = i;
    }

    // shoreline mask per water tile: which diamond edges border land
    // (bit0 = N neighbor (x,y-1) -> top-right edge, bit1 = E -> bottom-right,
    //  bit2 = S -> bottom-left, bit3 = W -> top-left)
    this.shoreMask = new Uint8Array(count);
    const isLand = (xx: number, yy: number): boolean =>
      xx >= 0 && yy >= 0 && xx < m.w && yy < m.h && m.terrain[yy * m.w + xx] !== Terrain.WATER;
    for (let s = 0; s < this.waterTiles.length; s++) {
      const idx = this.waterTiles[s];
      const x = idx % m.w;
      const y = (idx / m.w) | 0;
      let mask = 0;
      if (isLand(x, y - 1)) mask |= 1;
      if (isLand(x + 1, y)) mask |= 2;
      if (isLand(x, y + 1)) mask |= 4;
      if (isLand(x - 1, y)) mask |= 8;
      this.shoreMask[s] = mask;
    }

    // fog buffer: 1 px per tile
    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = m.w;
    this.fogCanvas.height = m.h;
    const fctx = this.fogCanvas.getContext('2d');
    if (!fctx) throw new Error('renderer: 2d context unavailable');
    this.fogCtx = fctx;
    this.fogData = fctx.createImageData(m.w, m.h);
    this.fog32 = new Uint32Array(this.fogData.data.buffer);
    this.fog32.fill(FOG_UNEXPLORED_U32);
    fctx.putImageData(this.fogData, 0, 0);
  }

  /**
   * Paint tiles [x0..x1]x[y0..y1] into the terrain cache in iso depth order.
   * With `clip`, painting is confined to the region's own diamonds' bounding
   * box while tiles from a 3-tile margin are redrawn so tall tree/rock
   * overhang from behind is restored after a clear.
   */
  private paintTerrainRegion(
    m: GameMap,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    clip: boolean
  ): void {
    const tctx = this.terrainCtx;
    if (!tctx) return;
    x0 = Math.max(0, x0);
    y0 = Math.max(0, y0);
    x1 = Math.min(m.w - 1, x1);
    y1 = Math.min(m.h - 1, y1);
    if (x1 < x0 || y1 < y0) return;

    let dx0 = x0;
    let dy0 = y0;
    let dx1 = x1;
    let dy1 = y1;
    if (clip) {
      // Region bbox in cache px: horizontally the region's diamonds, vertically
      // from TERRAIN_TOP_PAD above the topmost vertex (covers tall overhang)
      // down to the bottommost diamond vertex.
      const rx = (x0 - y1 - 1) * TILE_HALF_W + this.terrainOX;
      const ry = (x0 + y0) * TILE_HALF_H; // = top vertex canvas-y minus TERRAIN_TOP_PAD
      const rw = (x1 - x0 + y1 - y0 + 2) * TILE_HALF_W;
      const rh = (x1 + y1 - x0 - y0) * TILE_HALF_H + TILE_H + TERRAIN_TOP_PAD;
      tctx.save();
      tctx.beginPath();
      tctx.rect(rx, ry, rw, rh);
      tctx.clip();
      tctx.fillStyle = BG_COLOR;
      tctx.fillRect(rx, ry, rw, rh);
      // Redraw a 4-tile margin so neighbours' overhang that pokes into the
      // cleared rect is restored (clip confines all painting to the rect).
      dx0 = Math.max(0, x0 - 4);
      dy0 = Math.max(0, y0 - 4);
      dx1 = Math.min(m.w - 1, x1 + 4);
      dy1 = Math.min(m.h - 1, y1 + 4);
    }

    for (let s = dx0 + dy0; s <= dx1 + dy1; s++) {
      const xs = Math.max(dx0, s - dy1);
      const xe = Math.min(dx1, s - dy0);
      for (let x = xs; x <= xe; x++) {
        const y = s - x;
        const i = y * m.w + x;
        let t = m.terrain[i] as Terrain;
        if (t === Terrain.CRYSTAL && m.crystal[i] === 0) t = Terrain.DIRT; // depleted field
        const variant = (x * 7 + y * 13 + ((x * 31 + y * 17) & 7)) % 3;
        const tile = this.atlas.getTerrainTile(t, variant);
        const cx = (x - y) * TILE_HALF_W + this.terrainOX;
        const cy = (x + y) * TILE_HALF_H + TERRAIN_TOP_PAD;
        // tile canvas bottom edge aligns with the cell diamond's bottom vertex
        tctx.drawImage(tile, cx - tile.width / 2, cy + TILE_H - tile.height);
      }
    }
    if (clip) tctx.restore();
  }

  private applyTerrainPatches(m: GameMap): void {
    if (this.pendingPatches.length === 0 || !this.terrainCtx) return;
    for (let i = 0; i < this.pendingPatches.length; i++) {
      const idx = this.pendingPatches[i];
      const x = idx % m.w;
      const y = (idx / m.w) | 0;
      this.paintTerrainRegion(m, x - 1, y - 1, x + 1, y + 1, true);
    }
    this.pendingPatches.length = 0;
  }

  private drawTerrain(vw: number, vh: number): void {
    const terrain = this.terrain;
    if (!terrain) return;
    const z = this.zoom;
    // source rect in terrain-cache px (world px + origin offsets)
    const srcX = this.camX + this.terrainOX;
    const srcY = this.camY + TERRAIN_TOP_PAD;
    const srcW = vw / z;
    const srcH = vh / z;
    const ix0 = Math.max(0, srcX);
    const iy0 = Math.max(0, srcY);
    const ix1 = Math.min(terrain.width, srcX + srcW);
    const iy1 = Math.min(terrain.height, srcY + srcH);
    if (ix1 <= ix0 || iy1 <= iy0) return;
    this.ctx.drawImage(
      terrain,
      ix0,
      iy0,
      ix1 - ix0,
      iy1 - iy0,
      (ix0 - srcX) * z,
      (iy0 - srcY) * z,
      (ix1 - ix0) * z,
      (iy1 - iy0) * z
    );
  }

  private renderShimmerSprite(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = 48;
    c.height = 12;
    const g = c.getContext('2d');
    if (!g) throw new Error('renderer: 2d context unavailable');
    const grad = g.createLinearGradient(0, 0, 48, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.5, 'rgba(220,250,255,0.9)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(24, 6, 23, 3, 0, 0, TAU);
    g.fill();
    g.beginPath();
    g.ellipse(18, 9, 10, 1.6, 0, 0, TAU);
    g.fill();
    return c;
  }

  /** Gift crate sprite at 2x (drawn at 0.5 scale): gold iso cube + ribbon + bow. */
  private renderCrateSprite(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = 40;
    c.height = 40;
    const g = c.getContext('2d');
    if (!g) throw new Error('renderer: 2d context unavailable');
    // iso cube: top diamond T(20,8) R(33,15) B(20,22) L(7,15); body 13px tall
    g.fillStyle = '#ffe892'; // top face
    g.beginPath();
    g.moveTo(20, 8);
    g.lineTo(33, 15);
    g.lineTo(20, 22);
    g.lineTo(7, 15);
    g.closePath();
    g.fill();
    g.fillStyle = '#d9a92e'; // left face
    g.beginPath();
    g.moveTo(7, 15);
    g.lineTo(20, 22);
    g.lineTo(20, 35);
    g.lineTo(7, 28);
    g.closePath();
    g.fill();
    g.fillStyle = '#b9851a'; // right face
    g.beginPath();
    g.moveTo(33, 15);
    g.lineTo(20, 22);
    g.lineTo(20, 35);
    g.lineTo(33, 28);
    g.closePath();
    g.fill();
    // ribbon: bands across the top + down both visible faces
    g.strokeStyle = '#ff4a6e';
    g.lineWidth = 3.5;
    g.beginPath();
    g.moveTo(13.5, 11.5); // across top, NW-SE
    g.lineTo(26.5, 18.5);
    g.moveTo(26.5, 11.5); // across top, NE-SW
    g.lineTo(13.5, 18.5);
    g.moveTo(13.5, 18.5); // down the left face
    g.lineTo(13.5, 31.5);
    g.moveTo(26.5, 18.5); // down the right face
    g.lineTo(26.5, 31.5);
    g.stroke();
    // bow knot on the top center
    g.fillStyle = '#ff7a96';
    g.beginPath();
    g.ellipse(20, 15, 3, 2.2, 0, 0, TAU);
    g.fill();
    // subtle silhouette outline
    g.strokeStyle = 'rgba(90,64,12,0.65)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(20, 8);
    g.lineTo(33, 15);
    g.lineTo(33, 28);
    g.lineTo(20, 35);
    g.lineTo(7, 28);
    g.lineTo(7, 15);
    g.closePath();
    g.stroke();
    return c;
  }

  /** Soft golden ground glow drawn under crates (alpha pulsed at draw time). */
  private renderCrateGlow(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const g = c.getContext('2d');
    if (!g) throw new Error('renderer: 2d context unavailable');
    const grad = g.createRadialGradient(32, 32, 1, 32, 32, 31);
    grad.addColorStop(0, 'rgba(255,210,74,0.9)');
    grad.addColorStop(0.45, 'rgba(255,210,74,0.4)');
    grad.addColorStop(1, 'rgba(255,210,74,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return c;
  }

  /** Large soft black blob for drifting cloud shadows (drawn at ~0.05 alpha). */
  private renderCloudShadow(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const g = c.getContext('2d');
    if (!g) throw new Error('renderer: 2d context unavailable');
    const grad = g.createRadialGradient(128, 128, 8, 128, 128, 127);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0.7)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    return c;
  }

  private drawWater(
    state: GameState,
    humanPlayer: PlayerId,
    nowMs: number,
    vw: number,
    vh: number
  ): void {
    const m = state.map;
    const explored = state.players[humanPlayer]?.explored;
    const z = this.zoom;
    const ctx = this.ctx;
    const x0 = this.vx0 - 1;
    const x1 = this.vx1 + 1;
    const y0 = this.vy0 - 1;
    const y1 = this.vy1 + 1;
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < this.waterTiles.length; k++) {
      const idx = this.waterTiles[k];
      const x = idx % m.w;
      const y = (idx / m.w) | 0;
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      if (explored && explored[idx] === 0) continue; // hidden under opaque shroud anyway
      // cell center of water tile (x, y)
      const sx = ((x - y) * TILE_HALF_W - this.camX) * z;
      const sy = ((x + y + 1) * TILE_HALF_H - this.camY) * z;
      if (sx < -60 || sx > vw + 60 || sy < -40 || sy > vh + 40) continue;
      const phase = nowMs * 0.0016 + ((x * 97 + y * 57) % 31) * 0.41;
      const a = 0.05 + 0.07 * Math.sin(phase);
      if (a > 0.015) {
        const wob = Math.sin(nowMs * 0.0007 + (x * 13 + y * 29) * 0.77) * 7 * z;
        ctx.globalAlpha = a;
        ctx.drawImage(this.shimmer, sx - 24 * z + wob, sy - 6 * z, 48 * z, 12 * z);
      }
      // shoreline foam: faint pulsing highlight on edges that border land
      const mask = this.shoreMask[k];
      if (mask !== 0) {
        const fa = 0.09 + 0.09 * Math.sin(nowMs * 0.0021 + ((x * 31 + y * 17) % 13) * 0.53);
        if (fa > 0.02) {
          const tY = sy - TILE_HALF_H * z; // top vertex
          const bY = sy + TILE_HALF_H * z; // bottom vertex
          const rX = sx + TILE_HALF_W * z; // right vertex
          const lX = sx - TILE_HALF_W * z; // left vertex
          ctx.globalAlpha = fa;
          ctx.strokeStyle = '#e6f9ff';
          ctx.lineWidth = Math.max(1, 1.4 * z);
          ctx.beginPath();
          if (mask & 1) {
            ctx.moveTo(sx, tY);
            ctx.lineTo(rX, sy);
          }
          if (mask & 2) {
            ctx.moveTo(rX, sy);
            ctx.lineTo(sx, bY);
          }
          if (mask & 4) {
            ctx.moveTo(sx, bY);
            ctx.lineTo(lX, sy);
          }
          if (mask & 8) {
            ctx.moveTo(lX, sy);
            ctx.lineTo(sx, tY);
          }
          ctx.stroke();
        }
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  // --- entity layers --------------------------------------------------------------

  private depthOf(it: DrawItem): number {
    if (isEntityItem(it)) {
      if (it.kind === 'building') {
        const def = this.data.buildings[it.defId];
        const fw = def ? def.footprint.w : 1;
        const fh = def ? def.footprint.h : 1;
        // building center, drawn just above units that share the same depth line
        return it.pos.x + it.pos.y + (fw + fh) / 2 + 0.001;
      }
      return it.pos.x + it.pos.y;
    }
    if (isCrateItem(it)) return it.pos.x + it.pos.y + 1; // crate sits at tile center
    return it.pos.x + it.pos.y + 0.0005;
  }

  private buildDrawLists(
    state: GameState,
    ui: UIState,
    humanPlayer: PlayerId,
    nowMs: number,
    vw: number,
    vh: number
  ): void {
    this.groundList.length = 0;
    this.airList.length = 0;
    this.selectedSet.clear();
    for (let i = 0; i < ui.selection.length; i++) this.selectedSet.add(ui.selection[i]);

    const z = this.zoom;
    const pad = 170 * z;
    const dt = this.frameDt;

    for (const e of state.entities.values()) {
      if (e.kind === 'building') {
        const def = this.data.buildings[e.defId];
        if (!def) continue;
        const cx = e.pos.x + def.footprint.w / 2;
        const cy = e.pos.y + def.footprint.h / 2;
        const sx = this.projX(cx, cy);
        const sy = this.projY(cx, cy);
        const span = (def.footprint.w + def.footprint.h) * TILE_HALF_W * z * 0.5 + pad;
        if (sx < -span || sx > vw + span || sy < -span || sy > vh + span) continue;
        this.groundList.push(e);
        continue;
      }
      // unit: advance smooth-motion record even while culled, so reappearing
      // units don't slide across the screen
      let rec = this.smooth.get(e.id);
      if (!rec) {
        rec = { x: e.pos.x, y: e.pos.y, lastMoveMs: 0, traveled: 0 };
        this.smooth.set(e.id, rec);
      }
      const dx = e.pos.x - rec.x;
      const dy = e.pos.y - rec.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > 4) {
        rec.x = e.pos.x; // teleport/spawn snap
        rec.y = e.pos.y;
      } else {
        const k = 1 - Math.exp(-dt / 55);
        rec.x += dx * k;
        rec.y += dy * k;
        rec.traveled += Math.sqrt(d2) * k; // walk-bob phase: tiles of drawn travel
      }
      if (d2 > 1e-6) rec.lastMoveMs = nowMs;

      const sx = this.projX(rec.x, rec.y);
      const sy = this.projY(rec.x, rec.y);
      if (sx < -pad || sx > vw + pad || sy < -pad || sy > vh + pad) continue;
      const def = this.data.units[e.defId];
      if (def && def.domain === MoveDomain.AIR) this.airList.push(e);
      else this.groundList.push(e);
    }

    for (let i = 0; i < state.projectiles.length; i++) {
      const p = state.projectiles[i];
      const sx = this.projX(p.pos.x, p.pos.y);
      const sy = this.projY(p.pos.x, p.pos.y);
      if (sx < -pad || sx > vw + pad || sy < -pad || sy > vh + pad) continue;
      if (p.isAirTarget) this.airList.push(p);
      else this.groundList.push(p);
    }

    // crates: depth-sorted with ground entities, only on explored tiles
    const exploredH = state.players[humanPlayer]?.explored;
    for (let i = 0; i < state.crates.length; i++) {
      const c = state.crates[i];
      if (exploredH && exploredH[tileIndex(state.map, c.pos.x, c.pos.y)] === 0) continue;
      const sx = this.projX(c.pos.x + 0.5, c.pos.y + 0.5);
      const sy = this.projY(c.pos.x + 0.5, c.pos.y + 0.5);
      if (sx < -60 * z || sx > vw + 60 * z || sy < -60 * z || sy > vh + 60 * z) continue;
      this.groundList.push(c);
    }

    this.groundList.sort(this.depthCompare);
    this.airList.sort(this.depthCompare);
  }

  private drawGroundLayer(state: GameState, nowMs: number): void {
    for (let i = 0; i < this.groundList.length; i++) {
      const it = this.groundList[i];
      if (isEntityItem(it)) {
        if (it.kind === 'building') this.drawBuilding(it, state, nowMs);
        else this.drawUnit(it, state, nowMs, false);
      } else if (isCrateItem(it)) {
        this.drawCrate(it, nowMs);
      } else {
        this.drawProjectile(it, nowMs, false);
      }
    }
  }

  private drawAirLayer(state: GameState, nowMs: number): void {
    for (let i = 0; i < this.airList.length; i++) {
      const it = this.airList[i];
      if (isEntityItem(it)) this.drawUnit(it, state, nowMs, true);
      else if (!isCrateItem(it)) this.drawProjectile(it, nowMs, true); // crates never fly
    }
  }

  private drawUnit(e: Entity, state: GameState, nowMs: number, air: boolean): void {
    const ctx = this.ctx;
    const z = this.zoom;
    const def = this.data.units[e.defId];
    if (!def) return;
    const rec = this.smooth.get(e.id);
    const px = rec ? rec.x : e.pos.x;
    const py = rec ? rec.y : e.pos.y;
    const sx = this.projX(px, py);
    const sy = this.projY(px, py);

    // shadow on the ground plane
    const big = def.armor === ArmorClass.HEAVY || def.tier === 3;
    const rx = (big ? 20 : def.tab === 'infantry' ? 11 : 16) * z;
    ctx.globalAlpha = air ? 0.18 : 0.26;
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.ellipse(sx, sy + (air ? 8 : 12) * z, rx * (air ? 0.7 : 1), rx * 0.42, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;

    // selection ring under the sprite
    if (this.selectedSet.has(e.id)) {
      const hex = this.playerHex[state.players[e.owner]?.colorIdx ?? 0] ?? '#ffffff';
      ctx.strokeStyle = hex;
      ctx.lineWidth = Math.max(1, 1.6 * z);
      ctx.globalAlpha = 0.95;
      ctx.beginPath();
      ctx.ellipse(sx, sy + (air ? 8 : 12) * z, rx + 4 * z, (rx + 4 * z) * 0.45, 0, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // facing (8 directions) + ~6Hz walk cycle while moving
    let f8 = Math.round(e.facing / EIGHTH) % 8;
    if (f8 < 0) f8 += 8;
    const moving = rec !== undefined && nowMs - rec.lastMoveMs < 140;
    const frame = moving || air ? (((nowMs + e.id * 53) / 160) | 0) % 2 : 0;
    const colorIdx = state.players[e.owner]?.colorIdx ?? 0;
    const spr = this.atlas.getUnitSprite(def.spriteKey, f8, frame, colorIdx);
    const dw = spr.width * z;
    const dh = spr.height * z;
    const bob = air ? Math.sin(nowMs * 0.004 + e.id * 1.3) * 2.5 * z : 0;
    // ground walk-bob: two footfalls per tile of travel, per-entity phase offset
    const walkBob =
      !air && moving && rec
        ? Math.abs(Math.sin(rec.traveled * TAU + e.id * 0.7)) * 2 * z
        : 0;
    const cyc = air ? sy - 26 * z + bob : sy - 4 * z - walkBob;
    const dxp = sx - dw / 2;
    const dyp = cyc - dh / 2;
    ctx.drawImage(spr, dxp, dyp, dw, dh);

    // combat hit-flicker: brief white flash composited over the sprite
    const until = this.flicker.get(e.id);
    if (until !== undefined) {
      if (nowMs < until) this.drawSpriteFlash(spr, dxp, dyp, dw, dh);
      else this.flicker.delete(e.id);
    }
  }

  private drawBuilding(e: Entity, state: GameState, nowMs: number): void {
    const ctx = this.ctx;
    const z = this.zoom;
    const def = this.data.buildings[e.defId];
    if (!def) return;
    const fw = def.footprint.w;
    const fh = def.footprint.h;
    const cx = e.pos.x + fw / 2;
    const cy = e.pos.y + fh / 2;
    const sx = this.projX(cx, cy);
    const syCenter = this.projY(cx, cy);
    const syBottom = this.projY(e.pos.x + fw, e.pos.y + fh);

    // selection ring around the footprint
    if (this.selectedSet.has(e.id)) {
      const hex = this.playerHex[state.players[e.owner]?.colorIdx ?? 0] ?? '#ffffff';
      const a = ((fw + fh) / 2) * TILE_HALF_W * z;
      ctx.strokeStyle = hex;
      ctx.lineWidth = Math.max(1, 1.6 * z);
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.ellipse(sx, syCenter, a, a * (TILE_HALF_H / TILE_HALF_W), 0, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    const constructed = e.buildProgress >= 1;
    const colorIdx = state.players[e.owner]?.colorIdx ?? 0;
    const spr = this.atlas.getBuildingSprite(def.spriteKey, colorIdx, constructed);
    const dw = spr.width * z;
    const dh = spr.height * z;
    if (constructed || e.buildProgress < 0.25) {
      // operational building, or early build-up: the construction-site scaffold
      ctx.drawImage(spr, sx - dw / 2, syBottom - dh, dw, dh);
    } else {
      // build-up animation: the finished structure rises out of the ground —
      // draw the final sprite cropped from the bottom by eased progress
      const fin = this.atlas.getBuildingSprite(def.spriteKey, colorIdx, true);
      const u = (e.buildProgress - 0.25) / 0.75;
      const eased = u * u * (3 - 2 * u); // smoothstep
      const visH = Math.max(1, Math.round(fin.height * eased));
      ctx.drawImage(
        fin,
        0,
        fin.height - visH,
        fin.width,
        visH,
        sx - (fin.width * z) / 2,
        syBottom - visH * z,
        fin.width * z,
        visH * z
      );
    }

    if (!constructed) {
      // dust puffs every ~15% of progress while the structure rises
      const last = this.buildDustLast.get(e.id);
      if (last === undefined) {
        this.buildDustLast.set(e.id, e.buildProgress);
      } else if (e.buildProgress - last >= 0.15) {
        this.buildDustLast.set(e.id, e.buildProgress);
        for (let d = 0; d < 2; d++) {
          this.effects.add({
            kind: 'dust',
            pos: { x: e.pos.x + Math.random() * fw, y: e.pos.y + Math.random() * fh },
            startedAt: nowMs + d * 90,
            duration: 650,
            scale: 0.8 + Math.random() * 0.5,
            element: Element.NEUTRAL,
          });
        }
      }
      // thin construction progress bar above the rising structure
      const bw = Math.max(26 * z, fw * TILE_W * 0.42 * z);
      this.drawBar(sx - bw / 2, syBottom - dh - 7 * z, bw, 3 * z, e.buildProgress, '#e8c63c');
    } else {
      if (this.buildDustLast.size > 0) this.buildDustLast.delete(e.id);
      // combat hit-flicker (completed buildings only; the rising crop skips it)
      const until = this.flicker.get(e.id);
      if (until !== undefined) {
        if (nowMs < until) this.drawSpriteFlash(spr, sx - dw / 2, syBottom - dh, dw, dh);
        else this.flicker.delete(e.id);
      }
    }

    if (e.repairing && constructed) {
      // pulsing gold wrench-cross while the owner pays for repairs
      const pulse = 0.55 + 0.45 * Math.sin(nowMs * 0.008);
      ctx.globalAlpha = pulse;
      ctx.fillStyle = GOLD;
      const gw = 9 * z;
      const gt = 2.5 * z;
      const gy = syBottom - dh - 12 * z;
      ctx.fillRect(sx - gw / 2, gy - gt / 2, gw, gt);
      ctx.fillRect(sx - gt / 2, gy - gw / 2, gt, gw);
      ctx.globalAlpha = 1;
    }

    if (e.captureProgress > 0) {
      // engineer capture channel: thin cyan bar
      const bw = Math.max(24 * z, fw * TILE_W * 0.36 * z);
      this.drawBar(sx - bw / 2, syBottom - dh - 12 * z, bw, 2.5 * z, e.captureProgress / 100, '#38e0ff');
    }
  }

  private drawProjectile(p: Projectile, nowMs: number, air: boolean): void {
    const ctx = this.ctx;
    const z = this.zoom;
    const sx = this.projX(p.pos.x, p.pos.y);
    const syG = this.projY(p.pos.x, p.pos.y);
    const elev = (air ? 30 : 12) * z;
    const sy = syG - elev;

    // direction of travel (for trails)
    let dirx = p.dest.x - p.pos.x;
    let diry = p.dest.y - p.pos.y;
    const dl = Math.hypot(dirx, diry);
    if (dl > 0.0001) {
      dirx /= dl;
      diry /= dl;
    } else {
      dirx = 1;
      diry = 0;
    }
    // screen-space trail direction (iso projection of the velocity)
    let tdx = (dirx - diry) * TILE_HALF_W;
    let tdy = (dirx + diry) * TILE_HALF_H;
    const tl = Math.hypot(tdx, tdy) || 1;
    tdx /= tl;
    tdy /= tl;

    if (p.sourceDefId.startsWith('sw_')) {
      // superweapon strike marker: dramatic pulsing glow + streaking trail
      const glow = this.effects.glowSprite(p.element);
      const pulse = 1 + 0.25 * Math.sin(nowMs * 0.02 + p.id);
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 3; i >= 1; i--) {
        const gx = sx - tdx * i * 12 * z;
        const gy = sy - tdy * i * 12 * z;
        const gr = (16 - i * 3.4) * z * pulse;
        ctx.globalAlpha = 0.5 - i * 0.13;
        ctx.drawImage(glow, gx - gr, gy - gr, gr * 2, gr * 2);
      }
      const gr = 17 * z * pulse;
      ctx.globalAlpha = 0.95;
      ctx.drawImage(glow, sx - gr, sy - gr, gr * 2, gr * 2);
      ctx.fillStyle = '#ffffff';
      const core = 4 * z;
      ctx.fillRect(sx - core / 2, sy - core / 2, core, core);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      return;
    }

    if (p.speed >= 90) {
      // beam: bright streak from source toward destination
      const ex = this.projX(p.dest.x, p.dest.y);
      const ey = this.projY(p.dest.x, p.dest.y) - elev;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2 * z;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      return;
    }

    // faint motion trail
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1, 1.2 * z);
    ctx.beginPath();
    ctx.moveTo(sx - tdx * 12 * z, sy - tdy * 12 * z);
    ctx.lineTo(sx, sy);
    ctx.stroke();
    ctx.globalAlpha = 1;

    const spr = this.atlas.getProjectileSprite(p.weaponClass, p.element);
    const dw = spr.width * z;
    const dh = spr.height * z;
    ctx.drawImage(spr, sx - dw / 2, sy - dh / 2, dw, dh);
  }

  /** Bobbing gift crate with a soft pulsing gold glow (pos = integer tile). */
  private drawCrate(c: Crate, nowMs: number): void {
    const ctx = this.ctx;
    const z = this.zoom;
    const sx = this.projX(c.pos.x + 0.5, c.pos.y + 0.5);
    const sy = this.projY(c.pos.x + 0.5, c.pos.y + 0.5);
    const bob = Math.sin(nowMs * 0.0032 + c.id * 1.7) * 2.2 * z;
    const pulse = 0.22 + 0.12 * Math.sin(nowMs * 0.005 + c.id);

    // pulsing gold glow on the ground
    const gr = 16 * z;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = pulse;
    ctx.drawImage(this.crateGlow, sx - gr, sy - gr * 0.55, gr * 2, gr * 1.1);
    ctx.globalCompositeOperation = 'source-over';

    // small contact shadow
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.ellipse(sx, sy + 3 * z, 7 * z, 3 * z, 0, 0, TAU);
    ctx.fill();

    // the crate itself (pre-rendered at 2x: 40px canvas -> ~20px on screen)
    ctx.globalAlpha = 1;
    const dw = this.crateSprite.width * 0.5 * z;
    const dh = this.crateSprite.height * 0.5 * z;
    ctx.drawImage(this.crateSprite, sx - dw / 2, sy - dh + 2 * z - bob, dw, dh);
  }

  /**
   * Composite a brief white flash over a sprite that was just drawn at the
   * given dest rect (combat hit-flicker). Uses one reused scratch canvas.
   */
  private drawSpriteFlash(
    spr: HTMLCanvasElement,
    dx: number,
    dy: number,
    dw: number,
    dh: number
  ): void {
    let fc = this.flickerScratch;
    let g = this.flickerScratchCtx;
    if (!fc || !g) {
      fc = document.createElement('canvas');
      fc.width = 256;
      fc.height = 256;
      g = fc.getContext('2d');
      if (!g) return;
      this.flickerScratch = fc;
      this.flickerScratchCtx = g;
    }
    if (fc.width < spr.width || fc.height < spr.height) {
      fc.width = Math.max(fc.width, spr.width);
      fc.height = Math.max(fc.height, spr.height); // resizing also clears
    }
    g.clearRect(0, 0, fc.width, fc.height);
    g.drawImage(spr, 0, 0);
    // source-in keeps white only where the sprite has alpha
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, fc.width, fc.height);
    g.globalCompositeOperation = 'source-over';
    const ctx = this.ctx;
    ctx.globalAlpha = 0.6;
    ctx.drawImage(fc, 0, 0, spr.width, spr.height, dx, dy, dw, dh);
    ctx.globalAlpha = 1;
  }

  // --- ambient layer (clouds + critters; foam lives in drawWater) -------------------

  private drawAmbient(
    state: GameState,
    humanPlayer: PlayerId,
    nowMs: number,
    vw: number,
    vh: number
  ): void {
    const ctx = this.ctx;
    const z = this.zoom;

    // (1) cloud shadows: 3 soft dark ellipses drifting ~4 px/s, world-anchored
    // and wrapped into the viewport (+margin) so one is always nearby.
    const margin = 480; // world px; >= cloud half-width so wraps happen off-screen
    const spanX = vw / z + margin * 2;
    const spanY = vh / z + margin * 2;
    const originX = this.camX - margin;
    const originY = this.camY - margin;
    for (let i = 0; i < 3; i++) {
      const speed = 4 * (0.7 + i * 0.3); // px/s
      const dirx = i === 1 ? -0.8 : 1;
      const diry = 0.35 + i * 0.18;
      const wx0 = i * 1733.7 + nowMs * 0.001 * speed * dirx;
      const wy0 = i * 911.3 + nowMs * 0.001 * speed * diry;
      const wx = originX + ((((wx0 - originX) % spanX) + spanX) % spanX);
      const wy = originY + ((((wy0 - originY) % spanY) + spanY) % spanY);
      const sx = (wx - this.camX) * z;
      const sy = (wy - this.camY) * z;
      const rw = (320 + i * 110) * z; // half-width
      ctx.globalAlpha = 0.05;
      ctx.drawImage(this.cloudShadow, sx - rw, sy - rw * 0.5, rw * 2, rw);
    }
    ctx.globalAlpha = 1;

    // (3) critters: up to 8 butterfly/bird dots over explored grass in view.
    // Skipped entirely on heavy frames.
    if (this.groundList.length + this.airList.length > 250) return;
    const m = state.map;
    const explored = state.players[humanPlayer]?.explored;
    if (!explored) return;
    const CELL = 16; // one or two critters per 16x16-tile cell
    const cx0 = Math.max(0, Math.floor(this.vx0 / CELL));
    const cy0 = Math.max(0, Math.floor(this.vy0 / CELL));
    const cx1 = Math.min(Math.floor((m.w - 1) / CELL), Math.floor(this.vx1 / CELL));
    const cy1 = Math.min(Math.floor((m.h - 1) / CELL), Math.floor(this.vy1 / CELL));
    let drawn = 0;
    for (let cy = cy0; cy <= cy1 && drawn < 8; cy++) {
      for (let cx = cx0; cx <= cx1 && drawn < 8; cx++) {
        const seed = ((cx * 73856093) ^ (cy * 19349663)) >>> 0;
        const nCr = hash01(seed, 0) > 0.55 ? 2 : 1;
        for (let j = 0; j < nCr && drawn < 8; j++) {
          const s2 = (seed + j * 977) >>> 0;
          const bird = hash01(s2, 3) > 0.65;
          // slow wandering loop around a fixed anchor in the cell
          const ax = cx * CELL + CELL * (0.2 + 0.6 * hash01(s2, 1));
          const ay = cy * CELL + CELL * (0.2 + 0.6 * hash01(s2, 2));
          const t = nowMs * 0.001;
          const w1 = (0.04 + 0.05 * hash01(s2, 4)) * TAU;
          const w2 = (0.03 + 0.05 * hash01(s2, 5)) * TAU;
          const wr = bird ? 5 : 3;
          const tx = ax + Math.sin(t * w1 + (s2 % 13)) * wr;
          const ty = ay + Math.cos(t * w2 + (s2 % 7)) * wr;
          const txi = tx | 0;
          const tyi = ty | 0;
          if (txi < 0 || tyi < 0 || txi >= m.w || tyi >= m.h) continue;
          const ti = tyi * m.w + txi;
          if (explored[ti] === 0) continue;
          if (m.terrain[ti] !== Terrain.GRASS) continue;
          const sx = this.projX(tx, ty);
          const sy = this.projY(tx, ty);
          if (sx < -20 || sx > vw + 20 || sy < -20 || sy > vh + 20) continue;
          const flut = Math.sin(nowMs * (bird ? 0.006 : 0.018) + s2);
          const alt =
            (bird ? 26 : 10) * z +
            (bird ? flut * 2 : Math.sin(nowMs * 0.005 + s2) * 3) * z;
          const size = (bird ? 2.6 : 2) * z;
          ctx.globalAlpha = 0.8;
          ctx.fillStyle = bird ? '#1c2030' : CRITTER_COLORS[s2 % 3];
          ctx.fillRect(sx - size / 2, sy - alt - size / 2, size, size);
          // wing flick: thin oscillating bar
          const ww = size * (0.8 + Math.abs(flut) * 1.2);
          ctx.fillRect(sx - ww, sy - alt - size * 0.2, ww * 2, Math.max(1, 0.8 * z));
          drawn++;
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  // --- fog of war -------------------------------------------------------------------

  private drawFog(state: GameState, humanPlayer: PlayerId): void {
    const m = state.map;
    const fog32 = this.fog32;
    const fogData = this.fogData;
    const fogCtx = this.fogCtx;
    const fogCanvas = this.fogCanvas;
    const me = state.players[humanPlayer];
    if (!fog32 || !fogData || !fogCtx || !fogCanvas || !me) return;

    // repaint only the visible tile window
    const x0 = Math.max(0, Math.floor(this.vx0) - 1);
    const y0 = Math.max(0, Math.floor(this.vy0) - 1);
    const x1 = Math.min(m.w - 1, Math.ceil(this.vx1) + 1);
    const y1 = Math.min(m.h - 1, Math.ceil(this.vy1) + 1);
    if (x1 < x0 || y1 < y0) return;
    const explored = me.explored;
    const visible = me.visible;
    for (let y = y0; y <= y1; y++) {
      const row = y * m.w;
      for (let x = x0; x <= x1; x++) {
        const i = row + x;
        fog32[i] = visible[i] !== 0 ? 0 : explored[i] !== 0 ? FOG_EXPLORED_U32 : FOG_UNEXPLORED_U32;
      }
    }
    fogCtx.putImageData(fogData, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);

    // draw the tile-grid fog through the iso affine transform; bilinear
    // smoothing of the 1px-per-tile buffer gives soft shroud edges
    const ctx = this.ctx;
    const z = this.zoom;
    ctx.setTransform(
      TILE_HALF_W * z,
      TILE_HALF_H * z,
      -TILE_HALF_W * z,
      TILE_HALF_H * z,
      -this.camX * z,
      -this.camY * z
    );
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(fogCanvas, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // --- overlays ------------------------------------------------------------------------

  private drawBar(x: number, y: number, w: number, h: number, ratio: number, color: string): void {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(8,10,16,0.82)';
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * Math.max(0, Math.min(1, ratio)), h);
  }

  /** Compute screen anchor for an entity into the reused scratch object. */
  private anchorOf(e: Entity): { sx: number; top: number; ground: number } {
    const z = this.zoom;
    const out = this.anchor;
    if (e.kind === 'building') {
      const def = this.data.buildings[e.defId];
      const fw = def ? def.footprint.w : 1;
      const fh = def ? def.footprint.h : 1;
      const spr = def
        ? this.atlas.getBuildingSprite(def.spriteKey, 0, e.buildProgress >= 1)
        : null;
      const sx = this.projX(e.pos.x + fw / 2, e.pos.y + fh / 2);
      const syBottom = this.projY(e.pos.x + fw, e.pos.y + fh);
      out.sx = sx;
      out.ground = syBottom;
      out.top = syBottom - (spr ? spr.height * z : 40 * z);
      return out;
    }
    const rec = this.smooth.get(e.id);
    const px = rec ? rec.x : e.pos.x;
    const py = rec ? rec.y : e.pos.y;
    const def = this.data.units[e.defId];
    const air = def !== undefined && def.domain === MoveDomain.AIR;
    const sx = this.projX(px, py);
    const sy = this.projY(px, py);
    out.sx = sx;
    out.ground = sy;
    out.top = sy - (air ? 26 * z : 4 * z) - 26 * z;
    return out;
  }

  private drawOverlays(
    state: GameState,
    ui: UIState,
    humanPlayer: PlayerId,
    nowMs: number,
    vw: number,
    vh: number
  ): void {
    const ctx = this.ctx;
    const z = this.zoom;

    // health bars + vet chevrons + rally for on-screen entities (reuse culled lists)
    this.drawEntityBadges(this.groundList, state, ui, humanPlayer, nowMs);
    this.drawEntityBadges(this.airList, state, ui, humanPlayer, nowMs);

    // placement ghost (+ weapon range preview for defenses)
    if (ui.placingDefId && ui.hoverTile) {
      this.drawPlacementRange(ui);
      this.drawPlacementGhost(state, ui, humanPlayer);
    }

    // sell / repair hover tint on own buildings
    if ((ui.sellMode || ui.repairMode) && ui.hoverTile) {
      this.drawModeHover(state, ui, humanPlayer);
    }

    // superweapon target reticle
    if (ui.targetingSuperweapon && ui.hoverTile) {
      const me = state.players[humanPlayer];
      const swDefId = me && me.superweapon ? me.superweapon.defId : null;
      const sw = swDefId ? this.data.superweapons[swDefId] : undefined;
      const radius = sw ? sw.radius : 4;
      const cx = Math.floor(ui.hoverTile.x) + 0.5;
      const cy = Math.floor(ui.hoverTile.y) + 0.5;
      const sx = this.projX(cx, cy);
      const sy = this.projY(cx, cy);
      const maxA = radius * SQRT2 * TILE_HALF_W * z;
      const maxB = radius * SQRT2 * TILE_HALF_H * z;
      ctx.strokeStyle = '#ff4040';
      // fixed outer ring at the true blast radius
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = Math.max(1, 2 * z);
      ctx.beginPath();
      ctx.ellipse(sx, sy, maxA, maxB, 0, 0, TAU);
      ctx.stroke();
      // pulsing inner rings
      for (let i = 0; i < 3; i++) {
        const pr = (nowMs * 0.0006 + i / 3) % 1;
        ctx.globalAlpha = (1 - pr) * 0.7;
        ctx.lineWidth = Math.max(1, 1.5 * z);
        ctx.beginPath();
        ctx.ellipse(sx, sy, maxA * pr, maxB * pr, 0, 0, TAU);
        ctx.stroke();
      }
      // crosshair
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(sx - 14 * z, sy);
      ctx.lineTo(sx + 14 * z, sy);
      ctx.moveTo(sx, sy - 8 * z);
      ctx.lineTo(sx, sy + 8 * z);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // drag-select rectangle (screen px)
    if (ui.dragStart && ui.dragEnd) {
      const x = Math.min(ui.dragStart.sx, ui.dragEnd.sx);
      const y = Math.min(ui.dragStart.sy, ui.dragEnd.sy);
      const w = Math.abs(ui.dragEnd.sx - ui.dragStart.sx);
      const h = Math.abs(ui.dragEnd.sy - ui.dragStart.sy);
      if (w > 2 || h > 2) {
        ctx.fillStyle = 'rgba(255,255,255,0.07)';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, w, h);
      }
    }
    void vw;
    void vh;
  }

  private drawEntityBadges(
    list: DrawItem[],
    state: GameState,
    ui: UIState,
    humanPlayer: PlayerId,
    nowMs: number
  ): void {
    const ctx = this.ctx;
    const z = this.zoom;
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      if (!isEntityItem(it)) continue;
      const e = it;
      const selected = this.selectedSet.has(e.id);
      const damaged = e.hp < e.maxHp;

      if (selected || damaged) {
        const a = this.anchorOf(e);
        let bw: number;
        if (e.kind === 'building') {
          const def = this.data.buildings[e.defId];
          const span = def ? def.footprint.w + def.footprint.h : 2;
          bw = Math.min(74 * z, span * TILE_HALF_W * z * 0.55);
        } else {
          const def = this.data.units[e.defId];
          bw = (def && (def.armor === ArmorClass.HEAVY || def.tier === 3) ? 34 : 26) * z;
        }
        const ratio = e.maxHp > 0 ? e.hp / e.maxHp : 0;
        this.drawBar(a.sx - bw / 2, a.top - 7 * z, bw, 3.2 * z, ratio, healthColor(ratio));

        // gold veterancy chevrons beside the bar
        if (e.kind === 'unit' && e.vet > 0) {
          ctx.strokeStyle = GOLD;
          ctx.lineWidth = Math.max(1, 1.6 * z);
          const cwd = 4 * z;
          const cht = 2.6 * z;
          for (let v = 0; v < e.vet; v++) {
            const py = a.top - 7 * z - 1 - v * 3.6 * z;
            const pxr = a.sx + bw / 2 + 5 * z;
            ctx.beginPath();
            ctx.moveTo(pxr - cwd, py);
            ctx.lineTo(pxr, py - cht);
            ctx.lineTo(pxr + cwd, py);
            ctx.stroke();
          }
        }
      } else if (e.kind === 'unit' && e.vet > 0) {
        // always show chevrons on veterans, even at full health
        const a = this.anchorOf(e);
        ctx.strokeStyle = GOLD;
        ctx.lineWidth = Math.max(1, 1.6 * z);
        const cwd = 4 * z;
        const cht = 2.6 * z;
        for (let v = 0; v < e.vet; v++) {
          const py = a.top - 2 * z - v * 3.6 * z;
          ctx.beginPath();
          ctx.moveTo(a.sx + 12 * z - cwd, py);
          ctx.lineTo(a.sx + 12 * z, py - cht);
          ctx.lineTo(a.sx + 12 * z + cwd, py);
          ctx.stroke();
        }
      }

      // hold-fire stance: small amber pause glyph above the health-bar spot
      if (e.kind === 'unit' && e.stance === 'holdfire') {
        const a = this.anchorOf(e);
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = '#ffb340';
        const gbw = 2 * z;
        const gbh = 5 * z;
        const gap = 2 * z;
        const gy = a.top - 11 * z; // just above the health bar at top-7z
        ctx.fillRect(a.sx - gap / 2 - gbw, gy - gbh, gbw, gbh);
        ctx.fillRect(a.sx + gap / 2, gy - gbh, gbw, gbh);
        ctx.globalAlpha = 1;
      }

      // rally flag + dashed line for selected own production buildings
      if (
        e.kind === 'building' &&
        selected &&
        e.owner === humanPlayer &&
        e.rally &&
        e.buildProgress >= 1
      ) {
        const def = this.data.buildings[e.defId];
        if (def && def.producesTabs && def.producesTabs.length > 0) {
          const hex = this.playerHex[state.players[humanPlayer]?.colorIdx ?? 0] ?? '#ffffff';
          const fw = def.footprint.w;
          const fh = def.footprint.h;
          const bx = this.projX(e.pos.x + fw / 2, e.pos.y + fh / 2);
          const by = this.projY(e.pos.x + fw / 2, e.pos.y + fh / 2);
          const rxT = Number.isInteger(e.rally.x) ? e.rally.x + 0.5 : e.rally.x;
          const ryT = Number.isInteger(e.rally.y) ? e.rally.y + 0.5 : e.rally.y;
          const rx = this.projX(rxT, ryT);
          const ry = this.projY(rxT, ryT);
          ctx.strokeStyle = hex;
          ctx.lineWidth = Math.max(1, 1.4 * z);
          ctx.globalAlpha = 0.85;
          ctx.setLineDash(this.dashPattern);
          ctx.lineDashOffset = -((nowMs * 0.02) % 20);
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(rx, ry);
          ctx.stroke();
          ctx.setLineDash([]);
          // flag pole + pennant
          ctx.beginPath();
          ctx.moveTo(rx, ry);
          ctx.lineTo(rx, ry - 16 * z);
          ctx.stroke();
          ctx.fillStyle = hex;
          const wave = Math.sin(nowMs * 0.006) * 1.5 * z;
          ctx.beginPath();
          ctx.moveTo(rx, ry - 16 * z);
          ctx.lineTo(rx + 10 * z, ry - 13 * z + wave);
          ctx.lineTo(rx, ry - 10 * z);
          ctx.closePath();
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
    }
    void ui;
  }

  /** Local per-tile placement check (terrain / occupancy / explored). */
  private placeTileOk(
    state: GameState,
    def: BuildingDef,
    x: number,
    y: number,
    humanPlayer: PlayerId
  ): boolean {
    const m = state.map;
    if (x < 0 || y < 0 || x >= m.w || y >= m.h) return false;
    const i = y * m.w + x;
    const me = state.players[humanPlayer];
    if (!me || me.explored[i] === 0) return false;
    const t = m.terrain[i];
    if (def.placeOnWater) {
      if (t !== Terrain.WATER) return false;
    } else {
      if (t !== Terrain.GRASS && t !== Terrain.DIRT && t !== Terrain.SAND) return false;
    }
    const occ = state.occupancy.get(i);
    return !occ || occ.length === 0;
  }

  /**
   * Range preview while placing a defense: the weapon-range circle in tile
   * space, pushed through the iso projection by sampling 32 points (a cheap,
   * exact ellipse).
   */
  private drawPlacementRange(ui: UIState): void {
    const defId = ui.placingDefId;
    const hover = ui.hoverTile;
    if (!defId || !hover) return;
    const def = this.data.buildings[defId];
    if (!def || !def.weapon) return;
    const r = def.weapon.range;
    const cx = Math.floor(hover.x) + def.footprint.w / 2;
    const cy = Math.floor(hover.y) + def.footprint.h / 2;
    const ctx = this.ctx;
    const z = this.zoom;
    ctx.beginPath();
    for (let k = 0; k <= 32; k++) {
      const ang = (k / 32) * TAU;
      const tx = cx + Math.cos(ang) * r;
      const ty = cy + Math.sin(ang) * r;
      const px = this.projX(tx, ty);
      const py = this.projY(tx, ty);
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(56,224,255,0.08)';
    ctx.fill();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = '#38e0ff';
    ctx.lineWidth = Math.max(1, 1.5 * z);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private drawPlacementGhost(state: GameState, ui: UIState, humanPlayer: PlayerId): void {
    const defId = ui.placingDefId;
    const hover = ui.hoverTile;
    if (!defId || !hover) return;
    const def = this.data.buildings[defId];
    if (!def) return;
    const ctx = this.ctx;
    const z = this.zoom;
    const tx = Math.floor(hover.x);
    const ty = Math.floor(hover.y);

    // per-tile diamonds over the footprint
    for (let j = 0; j < def.footprint.h; j++) {
      for (let i = 0; i < def.footprint.w; i++) {
        const x = tx + i;
        const y = ty + j;
        const ok = this.placeTileOk(state, def, x, y, humanPlayer);
        // overall-valid → green; otherwise locally-bad tiles bright red and
        // locally-fine tiles amber (e.g. blocked only by build radius)
        const fill = ui.placeValid
          ? 'rgba(74,222,90,0.34)'
          : ok
            ? 'rgba(232,164,60,0.30)'
            : 'rgba(232,69,60,0.40)';
        const stroke = ui.placeValid
          ? 'rgba(150,255,160,0.85)'
          : ok
            ? 'rgba(255,200,120,0.8)'
            : 'rgba(255,120,110,0.9)';
        const topX = this.projX(x, y);
        const topY = this.projY(x, y);
        ctx.fillStyle = fill;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = Math.max(1, 1.2 * z);
        ctx.beginPath();
        ctx.moveTo(topX, topY);
        ctx.lineTo(topX + TILE_HALF_W * z, topY + TILE_HALF_H * z);
        ctx.lineTo(topX, topY + TILE_H * z);
        ctx.lineTo(topX - TILE_HALF_W * z, topY + TILE_HALF_H * z);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }

    // semi-transparent building sprite on top
    const me = state.players[humanPlayer];
    const spr = this.atlas.getBuildingSprite(def.spriteKey, me ? me.colorIdx : 0, true);
    const sx = this.projX(tx + def.footprint.w / 2, ty + def.footprint.h / 2);
    const syBottom = this.projY(tx + def.footprint.w, ty + def.footprint.h);
    const dw = spr.width * z;
    const dh = spr.height * z;
    ctx.globalAlpha = 0.55;
    ctx.drawImage(spr, sx - dw / 2, syBottom - dh, dw, dh);
    ctx.globalAlpha = 1;
  }

  private drawModeHover(state: GameState, ui: UIState, humanPlayer: PlayerId): void {
    const hover = ui.hoverTile;
    if (!hover) return;
    const hx = Math.floor(hover.x);
    const hy = Math.floor(hover.y);
    // find an own, completed building whose footprint contains the hovered tile
    let target: Entity | null = null;
    let def: BuildingDef | null = null;
    for (const e of state.entities.values()) {
      if (e.kind !== 'building' || e.owner !== humanPlayer) continue;
      const d = this.data.buildings[e.defId];
      if (!d) continue;
      if (hx >= e.pos.x && hx < e.pos.x + d.footprint.w && hy >= e.pos.y && hy < e.pos.y + d.footprint.h) {
        target = e;
        def = d;
        break;
      }
    }
    if (!target || !def) return;
    const ctx = this.ctx;
    const z = this.zoom;
    const fw = def.footprint.w;
    const fh = def.footprint.h;
    const topX = this.projX(target.pos.x, target.pos.y);
    const topY = this.projY(target.pos.x, target.pos.y);
    const rightX = this.projX(target.pos.x + fw, target.pos.y);
    const rightY = this.projY(target.pos.x + fw, target.pos.y);
    const botX = this.projX(target.pos.x + fw, target.pos.y + fh);
    const botY = this.projY(target.pos.x + fw, target.pos.y + fh);
    const leftX = this.projX(target.pos.x, target.pos.y + fh);
    const leftY = this.projY(target.pos.x, target.pos.y + fh);
    const pulse = 0.22 + 0.1 * Math.sin(performance.now() * 0.008);
    ctx.fillStyle = ui.sellMode ? `rgba(255,210,74,${pulse})` : `rgba(74,222,90,${pulse})`;
    ctx.strokeStyle = ui.sellMode ? 'rgba(255,210,74,0.95)' : 'rgba(74,222,90,0.95)';
    ctx.lineWidth = Math.max(1, 1.6 * z);
    ctx.beginPath();
    ctx.moveTo(topX, topY);
    ctx.lineTo(rightX, rightY);
    ctx.lineTo(botX, botY);
    ctx.lineTo(leftX, leftY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}
