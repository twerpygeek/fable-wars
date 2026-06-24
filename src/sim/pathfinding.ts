// =============================================================================
// FABLE WARS — sim/pathfinding.ts
// A* pathfinding on the tile grid. 8-directional with octile heuristic,
// diagonal cost sqrt(2), no corner-cutting (a diagonal step requires both
// orthogonal neighbors to be walkable). Binary min-heap + typed scratch
// arrays reused across calls (module-level cache keyed by map size) keep it
// allocation-light and fast (<2ms typical on 96x96).
//
// Deterministic: no wall-clock time, no randomness — pure function of inputs.
// =============================================================================

import type { GameMap, Vec2 } from '../core/types';
import { MoveDomain } from '../core/types';
import { isGroundPassable, isWaterPassable } from '../map/terrain';

const SQRT2 = Math.SQRT2;

/** Hard cap on A* node expansions; beyond this we return a best-effort
 *  partial path toward the explored node closest to the goal. */
const NODE_CAP = 20000;

/** If the goal tile itself is blocked/impassable, retarget to the nearest
 *  walkable tile within this Chebyshev radius before searching. */
const RETARGET_RADIUS = 6;

/** If the goal is truly unreachable (search exhausted), accept the closest
 *  reached tile only if it is within this Chebyshev radius of the goal. */
const UNREACHABLE_ACCEPT_RADIUS = 6;

// Neighbor tables: 4 orthogonals first, then 4 diagonals. Fixed order keeps
// tie-breaking deterministic.
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];
const STEP_COST = [1, 1, 1, 1, SQRT2, SQRT2, SQRT2, SQRT2];

// --- Reusable scratch buffers, cached per map size ---------------------------

interface Scratch {
  /** g-score per tile (valid only when stamp[i] === gen). */
  g: Float64Array;
  /** parent tile index per tile, -1 = none (valid only when stamped). */
  parent: Int32Array;
  /** generation stamp — avoids clearing the arrays between calls. */
  stamp: Int32Array;
  /** closed flag per tile (valid only when stamped). */
  closed: Uint8Array;
  /** path reconstruction buffer (tile indices). */
  pathBuf: Int32Array;
  // binary min-heap (lazy deletion: duplicates allowed, closed nodes skipped)
  heapNodes: Int32Array;
  heapCost: Float64Array;
  heapSize: number;
  /** current generation counter for `stamp`. */
  gen: number;
}

const scratchCache = new Map<number, Scratch>();

function getScratch(w: number, h: number): Scratch {
  const key = w * 0x10000 + h;
  let s = scratchCache.get(key);
  if (s === undefined) {
    const n = w * h;
    s = {
      g: new Float64Array(n),
      parent: new Int32Array(n),
      stamp: new Int32Array(n),
      closed: new Uint8Array(n),
      pathBuf: new Int32Array(n),
      heapNodes: new Int32Array(n),
      heapCost: new Float64Array(n),
      heapSize: 0,
      gen: 0,
    };
    scratchCache.set(key, s);
  }
  s.gen++;
  if (s.gen >= 0x7fffffff) {
    // practically unreachable, but keep the stamp scheme sound forever
    s.stamp.fill(0);
    s.gen = 1;
  }
  s.heapSize = 0;
  return s;
}

// --- Binary min-heap ----------------------------------------------------------

function heapPush(s: Scratch, node: number, cost: number): void {
  if (s.heapSize === s.heapNodes.length) {
    const grownNodes = new Int32Array(s.heapNodes.length * 2);
    grownNodes.set(s.heapNodes);
    s.heapNodes = grownNodes;
    const grownCost = new Float64Array(s.heapCost.length * 2);
    grownCost.set(s.heapCost);
    s.heapCost = grownCost;
  }
  const nodes = s.heapNodes;
  const costs = s.heapCost;
  let i = s.heapSize++;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (costs[p] <= cost) break;
    nodes[i] = nodes[p];
    costs[i] = costs[p];
    i = p;
  }
  nodes[i] = node;
  costs[i] = cost;
}

function heapPop(s: Scratch): number {
  const nodes = s.heapNodes;
  const costs = s.heapCost;
  const top = nodes[0];
  const last = --s.heapSize;
  if (last > 0) {
    const node = nodes[last];
    const cost = costs[last];
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      if (l >= last) break;
      const r = l + 1;
      const c = r < last && costs[r] < costs[l] ? r : l;
      if (costs[c] >= cost) break;
      nodes[i] = nodes[c];
      costs[i] = costs[c];
      i = c;
    }
    nodes[i] = node;
    costs[i] = cost;
  }
  return top;
}

// --- Line of sight (string-pulling support) ------------------------------------

/**
 * Tile-grid line walkability from (x0,y0) to (x1,y1), exclusive of the start
 * tile. Bresenham with combined diagonal steps; every diagonal step requires
 * both orthogonal side tiles to be walkable (same no-corner-cutting rule as
 * the A* expansion), so a smoothed path is always traversable by the same
 * movement rules. Conservative (slightly stricter than the exact continuous
 * segment), which is the safe direction for unit movement.
 */
function lineWalkable(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  walk: (x: number, y: number) => boolean,
): boolean {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x1 > x0 ? 1 : -1;
  const sy = y1 > y0 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;
  while (x !== x1 || y !== y1) {
    const e2 = 2 * err;
    let steppedX = false;
    let steppedY = false;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
      steppedX = true;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
      steppedY = true;
    }
    if (steppedX && steppedY) {
      // diagonal step: both orthogonal companions must be walkable
      if (!walk(x - sx, y) || !walk(x, y - sy)) return false;
    }
    if (!walk(x, y)) return false;
  }
  return true;
}

function clampInt(v: number, lo: number, hi: number): number {
  const f = Math.floor(v);
  return f < lo ? lo : f > hi ? hi : f;
}

// --- Public API -----------------------------------------------------------------

/**
 * A* path on the tile grid for the given movement domain.
 *
 * - AIR: returns `[goal]` (clamped in-bounds) — air ignores terrain.
 * - GROUND uses isGroundPassable, WATER uses isWaterPassable; `isBlocked`
 *   (e.g. unit occupancy) is consulted in addition to terrain passability.
 * - Blocked/impassable goal: retargets to the nearest walkable tile within
 *   6 tiles (ring search) before searching; if none exists, returns null.
 * - Unreachable goal after a full search: returns a path to the closest
 *   reached tile if it lies within 6 tiles of the goal, else null.
 * - Node-cap hit (~20000 expansions): best-effort partial path toward the
 *   explored node closest to the goal.
 * - Result waypoints are integer tile coords, excluding the start tile,
 *   smoothed by line-of-sight string-pulling to avoid zigzag. An empty array
 *   means "already at the destination tile".
 */
export function findPath(
  map: GameMap,
  domain: MoveDomain,
  from: Vec2,
  to: Vec2,
  isBlocked?: (x: number, y: number) => boolean,
): Vec2[] | null {
  const w = map.w;
  const h = map.h;
  let tx = clampInt(to.x, 0, w - 1);
  let ty = clampInt(to.y, 0, h - 1);

  if (domain === MoveDomain.AIR) {
    return [{ x: tx, y: ty }];
  }

  const sx = clampInt(from.x, 0, w - 1);
  const sy = clampInt(from.y, 0, h - 1);

  const passable = domain === MoveDomain.WATER ? isWaterPassable : isGroundPassable;
  const walk = (x: number, y: number): boolean =>
    x >= 0 &&
    y >= 0 &&
    x < w &&
    y < h &&
    passable(map, x, y) &&
    (isBlocked === undefined || !isBlocked(x, y));

  // Retarget a blocked/impassable goal to the nearest walkable tile nearby.
  if (!walk(tx, ty)) {
    const alt = findNearestTile(map, { x: tx, y: ty }, walk, RETARGET_RADIUS);
    if (alt === null) return null;
    tx = alt.x;
    ty = alt.y;
  }

  if (sx === tx && sy === ty) return [];

  const s = getScratch(w, h);
  const g = s.g;
  const parent = s.parent;
  const stamp = s.stamp;
  const closed = s.closed;
  const gen = s.gen;

  // Octile heuristic: max(dx,dy) + (sqrt2 - 1) * min(dx,dy).
  const hOf = (x: number, y: number): number => {
    const dx = Math.abs(x - tx);
    const dy = Math.abs(y - ty);
    return dx > dy ? dx + (SQRT2 - 1) * dy : dy + (SQRT2 - 1) * dx;
  };

  const startIdx = sy * w + sx;
  const goalIdx = ty * w + tx;

  stamp[startIdx] = gen;
  g[startIdx] = 0;
  parent[startIdx] = -1;
  closed[startIdx] = 0;
  heapPush(s, startIdx, hOf(sx, sy));

  let bestIdx = startIdx;
  let bestH = hOf(sx, sy);
  let bestG = 0;
  let expanded = 0;
  let found = false;
  let capped = false;

  while (s.heapSize > 0) {
    const cur = heapPop(s);
    // Lazy deletion: every heap entry was stamped this generation, so the
    // closed flag is trustworthy here.
    if (closed[cur] === 1) continue;
    closed[cur] = 1;

    if (cur === goalIdx) {
      found = true;
      bestIdx = cur;
      break;
    }

    const cx = cur % w;
    const cy = (cur / w) | 0;
    const cg = g[cur];
    const ch = hOf(cx, cy);
    if (ch < bestH || (ch === bestH && cg < bestG)) {
      bestH = ch;
      bestG = cg;
      bestIdx = cur;
    }

    expanded++;
    if (expanded >= NODE_CAP) {
      capped = true;
      break;
    }

    for (let d = 0; d < 8; d++) {
      const nx = cx + DX[d];
      const ny = cy + DY[d];
      if (!walk(nx, ny)) continue;
      if (d >= 4) {
        // no corner cutting: both orthogonal companions must be walkable
        if (!walk(cx + DX[d], cy) || !walk(cx, cy + DY[d])) continue;
      }
      const ni = ny * w + nx;
      if (stamp[ni] !== gen) {
        stamp[ni] = gen;
        g[ni] = Infinity;
        parent[ni] = -1;
        closed[ni] = 0;
      } else if (closed[ni] === 1) {
        continue;
      }
      const ng = cg + STEP_COST[d];
      if (ng < g[ni]) {
        g[ni] = ng;
        parent[ni] = cur;
        heapPush(s, ni, ng + hOf(nx, ny));
      }
    }
  }

  let endIdx: number;
  if (found) {
    endIdx = goalIdx;
  } else {
    endIdx = bestIdx;
    if (endIdx === startIdx) return null; // no progress possible at all
    if (!capped) {
      // Search exhausted: goal genuinely unreachable. Only accept the closest
      // reached tile if it is near the goal; otherwise report failure.
      const bx = endIdx % w;
      const by = (endIdx / w) | 0;
      const cheb = Math.max(Math.abs(bx - tx), Math.abs(by - ty));
      if (cheb > UNREACHABLE_ACCEPT_RADIUS) return null;
    }
  }

  // Reconstruct start..end into the scratch buffer (backwards, then reverse).
  const pathBuf = s.pathBuf;
  let count = 0;
  for (let i = endIdx; i !== -1; i = parent[i]) pathBuf[count++] = i;
  for (let a = 0, b = count - 1; a < b; a++, b--) {
    const t = pathBuf[a];
    pathBuf[a] = pathBuf[b];
    pathBuf[b] = t;
  }
  // count >= 2 here: start !== end was guaranteed above.

  // String-pulling: greedily extend a sight-line from the current anchor and
  // emit a waypoint only where line of sight breaks. Consecutive path tiles
  // always have LOS by construction, so the previous tile is always a valid
  // anchor when the line breaks. Waypoints exclude the start tile.
  const out: Vec2[] = [];
  let anchorX = sx;
  let anchorY = sy;
  let prevX = pathBuf[1] % w;
  let prevY = (pathBuf[1] / w) | 0;
  for (let k = 2; k < count; k++) {
    const idx = pathBuf[k];
    const x = idx % w;
    const y = (idx / w) | 0;
    if (!lineWalkable(anchorX, anchorY, x, y, walk)) {
      out.push({ x: prevX, y: prevY });
      anchorX = prevX;
      anchorY = prevY;
    }
    prevX = x;
    prevY = y;
  }
  out.push({ x: prevX, y: prevY });
  return out;
}

/**
 * Outward BFS ring search from `from` (inclusive) for the nearest tile
 * satisfying `pred`, up to Chebyshev radius `maxR` (default 30). Within the
 * search, "nearest" is by euclidean distance (deterministic scan-order
 * tie-break). Returns integer tile coords or null.
 */
export function findNearestTile(
  map: GameMap,
  from: Vec2,
  pred: (x: number, y: number) => boolean,
  maxR = 30,
): Vec2 | null {
  const w = map.w;
  const h = map.h;
  const cx = clampInt(from.x, 0, w - 1);
  const cy = clampInt(from.y, 0, h - 1);
  if (pred(cx, cy)) return { x: cx, y: cy };

  let bestX = -1;
  let bestY = -1;
  let bestD2 = Infinity;

  const consider = (x: number, y: number): void => {
    if (!pred(x, y)) return;
    const dx = x - cx;
    const dy = y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      bestX = x;
      bestY = y;
    }
  };

  // Rings beyond the farthest in-bounds extent contain no tiles.
  const maxExtent = Math.max(cx, w - 1 - cx, cy, h - 1 - cy);
  const rMax = maxR < maxExtent ? maxR : maxExtent;

  for (let r = 1; r <= rMax; r++) {
    // Every tile on ring r has euclidean distance >= r, so once the best
    // found is <= r it cannot be beaten by this or any farther ring.
    if (bestD2 <= r * r) break;
    const yTop = cy - r;
    const yBot = cy + r;
    const x0 = cx - r < 0 ? 0 : cx - r;
    const x1 = cx + r >= w ? w - 1 : cx + r;
    if (yTop >= 0) for (let x = x0; x <= x1; x++) consider(x, yTop);
    if (yBot < h) for (let x = x0; x <= x1; x++) consider(x, yBot);
    const xL = cx - r;
    const xR = cx + r;
    const y0 = cy - r + 1 < 0 ? 0 : cy - r + 1;
    const y1 = cy + r - 1 >= h ? h - 1 : cy + r - 1;
    if (xL >= 0) for (let y = y0; y <= y1; y++) consider(xL, y);
    if (xR < w) for (let y = y0; y <= y1; y++) consider(xR, y);
  }

  return bestX >= 0 ? { x: bestX, y: bestY } : null;
}
