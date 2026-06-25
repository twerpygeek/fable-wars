// =============================================================================
// FABLE WARS — isometric camera math.
// Projection (see core/constants.ts):
//   screenX = ((x - y) * TILE_HALF_W - cam.x) * cam.zoom
//   screenY = ((x + y) * TILE_HALF_H - cam.y) * cam.zoom
// cam.x / cam.y are UNSCALED world-pixel offsets of the viewport's top-left
// corner; zoom scales the world around that corner. The tile-space point (x, y)
// is the TOP vertex of cell (x, y)'s diamond; the cell's visual center is the
// point (x + 0.5, y + 0.5).
// =============================================================================

import { TILE_HALF_H, TILE_HALF_W, TILE_W } from '../core/constants';
import type { Camera, GameMap, Vec2 } from '../core/types';

// 0.65 floor matches the C&C Remastered authenticity clamp (was 0.5; full
// zoom-out flattened the iso art and broke sprite readability).
export const MIN_ZOOM = 0.65;
export const CRYSTAL_RUSH_MIN_ZOOM = 0.48;
export const MAX_ZOOM = 1.5;

interface ClampCameraOptions {
  minZoom?: number;
}

/** Project a tile-space point to screen pixels. */
export function tileToScreen(cam: Camera, x: number, y: number): { sx: number; sy: number } {
  return {
    sx: ((x - y) * TILE_HALF_W - cam.x) * cam.zoom,
    sy: ((x + y) * TILE_HALF_H - cam.y) * cam.zoom,
  };
}

/** Inverse projection: screen pixels to float tile coordinates. */
export function screenToTile(cam: Camera, sx: number, sy: number): Vec2 {
  const wx = sx / cam.zoom + cam.x;
  const wy = sy / cam.zoom + cam.y;
  const tx = wx / TILE_HALF_W; // = x - y
  const ty = wy / TILE_HALF_H; // = x + y
  return { x: (tx + ty) / 2, y: (ty - tx) / 2 };
}

function clampAxis(v: number, min: number, max: number, view: number): number {
  const hi = max - view;
  if (hi <= min) return (min + hi) / 2; // viewport wider than world: center it
  return v < min ? min : v > hi ? hi : v;
}

/**
 * Keep the viewport inside (the bounding box of) the map diamond, with a
 * little margin so the player can see the map edge breathe. Also sanitizes
 * zoom into the supported 0.65–1.5 range.
 */
export function clampCamera(
  cam: Camera,
  map: GameMap,
  viewW: number,
  viewH: number,
  options: ClampCameraOptions = {}
): void {
  const minZoom = options.minZoom ?? MIN_ZOOM;
  if (!Number.isFinite(cam.zoom) || cam.zoom <= 0) cam.zoom = 1;
  if (cam.zoom < minZoom) cam.zoom = minZoom;
  if (cam.zoom > MAX_ZOOM) cam.zoom = MAX_ZOOM;
  if (!Number.isFinite(cam.x)) cam.x = 0;
  if (!Number.isFinite(cam.y)) cam.y = 0;

  const margin = TILE_W * 1.5; // world px of slack around the diamond
  const vw = viewW / cam.zoom;
  const vh = viewH / cam.zoom;

  // World-pixel bounds of the iso diamond (tile points (0,0)..(w,h)).
  const minX = -map.h * TILE_HALF_W - margin;
  const maxX = map.w * TILE_HALF_W + margin;
  const minY = -TILE_HALF_H * 6 - margin; // small allowance for tall sprites up top
  const maxY = (map.w + map.h) * TILE_HALF_H + TILE_HALF_H * 2 + margin;

  cam.x = clampAxis(cam.x, minX, maxX, vw);
  cam.y = clampAxis(cam.y, minY, maxY, vh);
}

export function fitCameraToTiles(
  cam: Camera,
  map: GameMap,
  points: Vec2[],
  viewW: number,
  viewH: number,
  options: ClampCameraOptions & { paddingPx?: number; maxZoom?: number } = {}
): void {
  if (points.length === 0) {
    clampCamera(cam, map, viewW, viewH, options);
    return;
  }
  const padding = options.paddingPx ?? TILE_W * 5;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const p of points) {
    const x = (p.x - p.y) * TILE_HALF_W;
    const y = (p.x + p.y) * TILE_HALF_H;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  const minZoom = options.minZoom ?? MIN_ZOOM;
  const maxZoom = options.maxZoom ?? MAX_ZOOM;
  const fitW = viewW / Math.max(1, maxX - minX + padding * 2);
  const fitH = viewH / Math.max(1, maxY - minY + padding * 2);
  cam.zoom = Math.max(minZoom, Math.min(maxZoom, fitW, fitH));
  cam.x = (minX + maxX) / 2 - viewW / (2 * cam.zoom);
  cam.y = (minY + maxY) / 2 - viewH / (2 * cam.zoom);
  clampCamera(cam, map, viewW, viewH, { minZoom });
}
