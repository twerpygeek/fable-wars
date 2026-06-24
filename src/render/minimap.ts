// =============================================================================
// FABLE WARS — minimap (radar). Top-down tile-grid view:
//   cached terrain downsample (1px per tile) → fog mask → entity dots
//   (buildings 2x2, units 1x1, player colors) → white camera diamond.
// No powered radar → animated static noise + "NO SIGNAL".
// =============================================================================

import { Terrain } from '../core/types';
import { PLAYER_COLORS } from '../core/types';
import type { Camera, GameMap, GameState, PlayerId, Vec2 } from '../core/types';
import { screenToTile } from './camera';

// Terrain palette (minimap-side; matches the lush/teal world palette in spirit).
const COL_GRASS = '#3fae4f';
const COL_DIRT = '#9a7748';
const COL_SAND = '#dcc77e';
const COL_WATER = '#0f6f86';
const COL_ROCK = '#7a8089';
const COL_TREE = '#1f7a33';
const COL_CRYSTAL = '#e86ad8';
const COL_UNEXPLORED = '#05060a';

/** '#rrggbb' -> little-endian RGBA u32 (0xAABBGGRR) for ImageData writes. */
function hexToU32(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0xff << 24) | (b << 16) | (g << 8) | r;
}

const TERRAIN_U32: number[] = [];
TERRAIN_U32[Terrain.GRASS] = hexToU32(COL_GRASS);
TERRAIN_U32[Terrain.DIRT] = hexToU32(COL_DIRT);
TERRAIN_U32[Terrain.SAND] = hexToU32(COL_SAND);
TERRAIN_U32[Terrain.WATER] = hexToU32(COL_WATER);
TERRAIN_U32[Terrain.ROCK] = hexToU32(COL_ROCK);
TERRAIN_U32[Terrain.TREE] = hexToU32(COL_TREE);
TERRAIN_U32[Terrain.CRYSTAL] = hexToU32(COL_CRYSTAL);
const UNEXPLORED_U32 = hexToU32(COL_UNEXPLORED);
const DIRT_U32 = hexToU32(COL_DIRT);

/** Darken an LE u32 color to 55% brightness (explored-but-fogged tiles). */
function darkenU32(c: number): number {
  const r = ((c & 0xff) * 141) >> 8;
  const g = (((c >> 8) & 0xff) * 141) >> 8;
  const b = (((c >> 16) & 0xff) * 141) >> 8;
  return (0xff << 24) | (b << 16) | (g << 8) | r;
}

const PLAYER_U32: number[] = PLAYER_COLORS.map((c) => hexToU32(c.hex));

export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  // map-sized compositing buffer (1 px per tile)
  private off: HTMLCanvasElement | null = null;
  private offCtx: CanvasRenderingContext2D | null = null;
  private img: ImageData | null = null;
  private px: Uint32Array | null = null;

  // cached terrain downsample
  private terrainPx: Uint32Array | null = null;
  private boundMap: GameMap | null = null;
  private crystalCount = -1;
  private frame = 0;

  // static-noise buffer for the no-radar state
  private noise: HTMLCanvasElement;
  private noiseCtx: CanvasRenderingContext2D;
  private noiseImg: ImageData;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('minimap: 2d context unavailable');
    this.ctx = ctx;
    this.noise = document.createElement('canvas');
    this.noise.width = 64;
    this.noise.height = 48;
    const nctx = this.noise.getContext('2d');
    if (!nctx) throw new Error('minimap: 2d context unavailable');
    this.noiseCtx = nctx;
    this.noiseImg = nctx.createImageData(64, 48);
  }

  /** Minimap canvas px -> float tile coords (clamped to the map). */
  minimapToTile(mx: number, my: number, state: GameState): Vec2 {
    const m = state.map;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const scale = Math.min(cw / m.w, ch / m.h);
    const ox = (cw - m.w * scale) / 2;
    const oy = (ch - m.h * scale) / 2;
    const x = (mx - ox) / scale;
    const y = (my - oy) / scale;
    return {
      x: Math.min(m.w - 0.001, Math.max(0, x)),
      y: Math.min(m.h - 0.001, Math.max(0, y)),
    };
  }

  render(state: GameState, cam: Camera, humanPlayer: PlayerId, viewW: number, viewH: number): void {
    const m = state.map;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    if (cw === 0 || ch === 0) return;
    this.frame++;

    const me = state.players[humanPlayer];
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.fillStyle = COL_UNEXPLORED;
    this.ctx.fillRect(0, 0, cw, ch);

    if (!me || !me.radarActive) {
      this.drawNoSignal(cw, ch);
      return;
    }

    this.ensureBuffers(m);
    this.refreshTerrainCache(m);
    const px = this.px;
    const img = this.img;
    const off = this.off;
    const offCtx = this.offCtx;
    const terrainPx = this.terrainPx;
    if (!px || !img || !off || !offCtx || !terrainPx) return;

    // --- terrain + fog compose ------------------------------------------------
    const n = m.w * m.h;
    const explored = me.explored;
    const visible = me.visible;
    for (let i = 0; i < n; i++) {
      if (explored[i] === 0) {
        px[i] = UNEXPLORED_U32;
      } else if (visible[i] === 0) {
        px[i] = darkenU32(terrainPx[i]);
      } else {
        px[i] = terrainPx[i];
      }
    }

    // --- entity dots ------------------------------------------------------------
    for (const e of state.entities.values()) {
      const mine = e.owner === humanPlayer;
      const color = PLAYER_U32[state.players[e.owner]?.colorIdx ?? 0] ?? PLAYER_U32[0];
      if (e.kind === 'building') {
        const bx = Math.floor(e.pos.x);
        const by = Math.floor(e.pos.y);
        const ci = by * m.w + bx;
        if (ci < 0 || ci >= n) continue;
        // buildings persist on radar once the area has been explored
        if (!mine && explored[ci] === 0) continue;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const x = bx + dx;
            const y = by + dy;
            if (x < 0 || y < 0 || x >= m.w || y >= m.h) continue;
            px[y * m.w + x] = color;
          }
        }
      } else {
        const x = Math.floor(e.pos.x);
        const y = Math.floor(e.pos.y);
        if (x < 0 || y < 0 || x >= m.w || y >= m.h) continue;
        const i = y * m.w + x;
        // enemy units only while actually visible
        if (!mine && visible[i] === 0) continue;
        px[i] = color;
      }
    }

    offCtx.putImageData(img, 0, 0);

    // --- upscale to the minimap canvas (crisp radar pixels) ---------------------
    const scale = Math.min(cw / m.w, ch / m.h);
    const ox = (cw - m.w * scale) / 2;
    const oy = (ch - m.h * scale) / 2;
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(off, 0, 0, m.w, m.h, ox, oy, m.w * scale, m.h * scale);

    // --- camera view diamond -----------------------------------------------------
    const c0 = screenToTile(cam, 0, 0);
    const c1 = screenToTile(cam, viewW, 0);
    const c2 = screenToTile(cam, viewW, viewH);
    const c3 = screenToTile(cam, 0, viewH);
    this.ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(ox + c0.x * scale, oy + c0.y * scale);
    this.ctx.lineTo(ox + c1.x * scale, oy + c1.y * scale);
    this.ctx.lineTo(ox + c2.x * scale, oy + c2.y * scale);
    this.ctx.lineTo(ox + c3.x * scale, oy + c3.y * scale);
    this.ctx.closePath();
    this.ctx.stroke();
  }

  // --- internals ----------------------------------------------------------------

  private ensureBuffers(m: GameMap): void {
    if (this.boundMap === m && this.off) return;
    this.boundMap = m;
    this.off = document.createElement('canvas');
    this.off.width = m.w;
    this.off.height = m.h;
    const ctx = this.off.getContext('2d');
    if (!ctx) throw new Error('minimap: 2d context unavailable');
    this.offCtx = ctx;
    this.img = ctx.createImageData(m.w, m.h);
    this.px = new Uint32Array(this.img.data.buffer);
    this.terrainPx = new Uint32Array(m.w * m.h);
    this.crystalCount = -1; // force terrain rebuild
  }

  /** Rebuild the cached terrain downsample when crystals deplete (checked ~4x/sec). */
  private refreshTerrainCache(m: GameMap): void {
    const needCheck = this.crystalCount < 0 || this.frame % 15 === 0;
    if (!needCheck || !this.terrainPx) return;
    let count = 0;
    const crystal = m.crystal;
    for (let i = 0; i < crystal.length; i++) {
      if (crystal[i] > 0) count++;
    }
    if (count === this.crystalCount) return;
    this.crystalCount = count;
    const t = m.terrain;
    const out = this.terrainPx;
    for (let i = 0; i < t.length; i++) {
      const ter = t[i];
      out[i] =
        ter === Terrain.CRYSTAL && crystal[i] === 0
          ? DIRT_U32
          : TERRAIN_U32[ter] ?? DIRT_U32;
    }
  }

  private drawNoSignal(cw: number, ch: number): void {
    // Subtle offline interference. Keep it dark so the minimap reads like a
    // powered-down radar pane instead of a broken image.
    const d = this.noiseImg.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = 8 + ((Math.random() * 28) | 0);
      d[i] = v;
      d[i + 1] = v + 3;
      d[i + 2] = v + 10;
      d[i + 3] = 255;
    }
    this.noiseCtx.putImageData(this.noiseImg, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.globalAlpha = 0.46;
    this.ctx.drawImage(this.noise, 0, 0, 64, 48, 0, 0, cw, ch);
    this.ctx.globalAlpha = 1;

    const g = this.ctx.createLinearGradient(0, 0, cw, ch);
    g.addColorStop(0, 'rgba(255,214,115,0.12)');
    g.addColorStop(0.42, 'rgba(20,24,38,0.52)');
    g.addColorStop(1, 'rgba(0,0,0,0.78)');
    this.ctx.fillStyle = g;
    this.ctx.fillRect(0, 0, cw, ch);

    // rolling scanline
    const t = performance.now();
    const sy = (t * 0.04) % ch;
    this.ctx.fillStyle = 'rgba(255,220,150,0.08)';
    this.ctx.fillRect(0, sy, cw, 2);

    // blinking offline label
    const blink = 0.55 + 0.45 * Math.sin(t * 0.004);
    this.ctx.globalAlpha = blink;
    this.ctx.fillStyle = '#d8c7a1';
    this.ctx.font = `bold ${Math.max(9, Math.floor(cw / 12))}px Verdana, Geneva, sans-serif`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText('RADAR OFFLINE', cw / 2, ch / 2);
    this.ctx.globalAlpha = 1;
    this.ctx.textAlign = 'start';
    this.ctx.textBaseline = 'alphabetic';
  }
}
