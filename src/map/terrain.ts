// =============================================================================
// POCKET ALERT — terrain passability helpers.
// Pure functions over GameMap; used by pathfinding, placement and mapgen.
// =============================================================================

import { GameMap, MoveDomain, Terrain, inBounds, tileIndex } from '../core/types';

/**
 * Ground units may stand on GRASS, DIRT, SAND and CRYSTAL tiles.
 * WATER, ROCK and TREE block ground movement. Out-of-bounds is impassable.
 * Coordinates are integer tile coords (floats are floored).
 */
export function isGroundPassable(map: GameMap, x: number, y: number): boolean {
  if (!inBounds(map, x, y)) return false;
  const t = map.terrain[tileIndex(map, x, y)];
  return (
    t === Terrain.GRASS ||
    t === Terrain.DIRT ||
    t === Terrain.SAND ||
    t === Terrain.CRYSTAL
  );
}

/**
 * Naval units may only traverse WATER tiles. Out-of-bounds is impassable.
 */
export function isWaterPassable(map: GameMap, x: number, y: number): boolean {
  if (!inBounds(map, x, y)) return false;
  return map.terrain[tileIndex(map, x, y)] === Terrain.WATER;
}

/**
 * Domain-dispatching passability. AIR is always passable while in bounds.
 */
export function passableFor(
  map: GameMap,
  domain: MoveDomain,
  x: number,
  y: number,
): boolean {
  switch (domain) {
    case MoveDomain.AIR:
      return inBounds(map, x, y);
    case MoveDomain.WATER:
      return isWaterPassable(map, x, y);
    case MoveDomain.GROUND:
      return isGroundPassable(map, x, y);
  }
}
