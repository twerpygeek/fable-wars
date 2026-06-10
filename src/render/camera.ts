// =============================================================================
// POCKET ALERT — isometric camera math.
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

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 1.5;

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
 * zoom into the supported 0.5–1.5 range.
 */
export function clampCamera(cam: Camera, map: GameMap, viewW: number, viewH: number): void {
  if (!Number.isFinite(cam.zoom) || cam.zoom <= 0) cam.zoom = 1;
  if (cam.zoom < MIN_ZOOM) cam.zoom = MIN_ZOOM;
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
