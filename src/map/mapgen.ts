// =============================================================================
// FABLE WARS — seeded procedural map generator.
// Deterministic: ALL randomness flows through one mulberry32(seed) stream.
// Pipeline: start positions → water (value-noise blobs) → guaranteed start
// lakes (medium/high) → dirt patches → start-zone clearing → sand shoreline →
// start crystal fields → neutral crystal fields → obstacle clusters →
// ground-connectivity corridors → crystal value fill.
// Generates a 96x96 map well under 100ms.
// =============================================================================

import { GameMap, Terrain, Vec2, inBounds } from '../core/types';
import { CRYSTAL_PER_TILE, MAP_SIZES } from '../core/constants';
import { mulberry32 } from '../core/rng';
import { isGroundPassable } from './terrain';

type Rng = () => number;
type WaterAmount = 'low' | 'medium' | 'high';

// --- Tuning -------------------------------------------------------------------

const WATER_FRACTION: Record<WaterAmount, number> = {
  low: 0.08,
  medium: 0.18,
  high: 0.3,
};

/** 12x12 buildable clear zone around each start: offsets relative to start. */
const CLEAR_LO = -6;
const CLEAR_HI = 5;
/** Euclidean radius around a start kept free of generated water (covers the
 *  clear-zone corners at sqrt(72) ≈ 8.49). */
const START_WATER_FREE_R = 9.5;
/** Start crystal field: ~20 tiles within 10 tiles of the start. */
const START_FIELD_SIZE = 20;
const START_FIELD_R = 10;
/** Neutral mid-map crystal fields: richer, ~30 tiles. */
const NEUTRAL_FIELD_SIZE = 30;
/** Shoreline guarantee at medium/high water. */
const SHORE_REGION_MIN = 30;
const SHORE_SEARCH_R = 22;

// --- Small helpers --------------------------------------------------------------

function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function shuffleInPlace<T>(rng: Rng, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

function isLandTerrain(t: number): boolean {
  return t === Terrain.GRASS || t === Terrain.DIRT || t === Terrain.SAND;
}

// --- Value noise -----------------------------------------------------------------

/** Smooth value noise: random lattice + smoothstep bilinear interpolation. */
function makeNoise(rng: Rng, n: number, cell: number): (x: number, y: number) => number {
  const c = Math.max(2, cell);
  const gw = Math.ceil(n / c) + 2;
  const lattice = new Float32Array(gw * gw);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rng();
  return (x: number, y: number): number => {
    const fx = x / c;
    const fy = y / c;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const i00 = lattice[y0 * gw + x0];
    const i10 = lattice[y0 * gw + x0 + 1];
    const i01 = lattice[(y0 + 1) * gw + x0];
    const i11 = lattice[(y0 + 1) * gw + x0 + 1];
    const a = i00 + (i10 - i00) * sx;
    const b = i01 + (i11 - i01) * sx;
    return a + (b - a) * sy;
  };
}

// --- Start positions ----------------------------------------------------------------

function clampStartCoord(v: number, n: number): number {
  // Keep the 12x12 clear zone (and a 1-tile rim) fully in bounds.
  return Math.max(7, Math.min(n - 8, Math.round(v)));
}

function pickStartPositions(rng: Rng, n: number, playerCount: number): Vec2[] {
  const m = Math.max(8, Math.round(n * 0.15));
  const lo = m;
  const hi = n - 1 - m;
  const corners: Vec2[] = [
    { x: lo, y: lo },
    { x: hi, y: lo },
    { x: hi, y: hi },
    { x: lo, y: hi },
  ];
  const midOf = (a: Vec2, b: Vec2): Vec2 => ({
    x: Math.round((a.x + b.x) / 2),
    y: Math.round((a.y + b.y) / 2),
  });

  let anchors: Vec2[];
  if (playerCount <= 1) {
    anchors = [corners[Math.floor(rng() * 4)]];
  } else if (playerCount === 2) {
    // Opposite corners-ish: pick one of the two diagonals.
    anchors = rng() < 0.5 ? [corners[0], corners[2]] : [corners[1], corners[3]];
  } else if (playerCount === 3) {
    // Triangle: two adjacent corners + midpoint of the opposite edge.
    const r = Math.floor(rng() * 4);
    anchors = [
      corners[r],
      corners[(r + 1) % 4],
      midOf(corners[(r + 2) % 4], corners[(r + 3) % 4]),
    ];
  } else {
    // Four corners, rotated for variety.
    const r = Math.floor(rng() * 4);
    anchors = [corners[r], corners[(r + 1) % 4], corners[(r + 2) % 4], corners[(r + 3) % 4]];
  }
  shuffleInPlace(rng, anchors); // randomize which player gets which spot

  const minD2 = (0.3 * n) * (0.3 * n);
  const jitter = Math.max(2, Math.round(n * 0.04));
  for (let attempt = 0; attempt < 24; attempt++) {
    const cand = anchors.map((a) => ({
      x: clampStartCoord(a.x + (rng() * 2 - 1) * jitter, n),
      y: clampStartCoord(a.y + (rng() * 2 - 1) * jitter, n),
    }));
    let ok = true;
    for (let i = 0; i < cand.length && ok; i++) {
      for (let j = i + 1; j < cand.length; j++) {
        if (dist2(cand[i].x, cand[i].y, cand[j].x, cand[j].y) < minD2) {
          ok = false;
          break;
        }
      }
    }
    if (ok) return cand;
  }
  // Fallback: un-jittered anchors always satisfy the spread requirement.
  return anchors.map((a) => ({ x: clampStartCoord(a.x, n), y: clampStartCoord(a.y, n) }));
}

// --- Masks ---------------------------------------------------------------------------

interface Masks {
  /** 1 inside any start's exact 12x12 clear zone. */
  zone: Uint8Array;
  /** 1 inside any start's clear zone padded by 2 tiles (obstacle exclusion). */
  zonePad: Uint8Array;
  /** 1 within START_WATER_FREE_R (Euclid) of any start (water exclusion). */
  nearStart: Uint8Array;
}

function buildMasks(w: number, h: number, starts: Vec2[]): Masks {
  const zone = new Uint8Array(w * h);
  const zonePad = new Uint8Array(w * h);
  const nearStart = new Uint8Array(w * h);
  const pad = 2;
  const nr = Math.ceil(START_WATER_FREE_R);
  const nr2 = START_WATER_FREE_R * START_WATER_FREE_R;
  for (const s of starts) {
    for (let y = Math.max(0, s.y + CLEAR_LO - pad); y <= Math.min(h - 1, s.y + CLEAR_HI + pad); y++) {
      for (let x = Math.max(0, s.x + CLEAR_LO - pad); x <= Math.min(w - 1, s.x + CLEAR_HI + pad); x++) {
        zonePad[y * w + x] = 1;
        if (
          x >= s.x + CLEAR_LO && x <= s.x + CLEAR_HI &&
          y >= s.y + CLEAR_LO && y <= s.y + CLEAR_HI
        ) {
          zone[y * w + x] = 1;
        }
      }
    }
    for (let y = Math.max(0, s.y - nr); y <= Math.min(h - 1, s.y + nr); y++) {
      for (let x = Math.max(0, s.x - nr); x <= Math.min(w - 1, s.x + nr); x++) {
        if (dist2(x, y, s.x, s.y) <= nr2) nearStart[y * w + x] = 1;
      }
    }
  }
  return { zone, zonePad, nearStart };
}

// --- Organic blob growth ----------------------------------------------------------------

/**
 * Grows an organic blob from a seed tile via randomized frontier expansion.
 * Collects up to `target` eligible tile indices WITHOUT mutating the map —
 * the caller applies the result only if it is large enough.
 */
function collectBlob(
  rng: Rng,
  w: number,
  h: number,
  seedX: number,
  seedY: number,
  target: number,
  eligible: (x: number, y: number) => boolean,
): number[] {
  const tiles: number[] = [];
  const seen = new Set<number>();
  const frontier: number[] = [];
  const seedIdx = seedY * w + seedX;
  seen.add(seedIdx);
  frontier.push(seedIdx);
  while (frontier.length > 0 && tiles.length < target) {
    const pick = Math.floor(rng() * frontier.length);
    const idx = frontier[pick];
    frontier[pick] = frontier[frontier.length - 1];
    frontier.pop();
    const x = idx % w;
    const y = (idx - x) / w;
    if (!eligible(x, y)) continue;
    tiles.push(idx);
    if (x > 0 && !seen.has(idx - 1)) { seen.add(idx - 1); frontier.push(idx - 1); }
    if (x < w - 1 && !seen.has(idx + 1)) { seen.add(idx + 1); frontier.push(idx + 1); }
    if (y > 0 && !seen.has(idx - w)) { seen.add(idx - w); frontier.push(idx - w); }
    if (y < h - 1 && !seen.has(idx + w)) { seen.add(idx + w); frontier.push(idx + w); }
  }
  return tiles;
}

// --- Water -----------------------------------------------------------------------------

function placeWater(rng: Rng, map: GameMap, amount: WaterAmount, masks: Masks): void {
  const { w, h } = map;
  const total = w * h;
  const frac = WATER_FRACTION[amount];
  const n1 = makeNoise(rng, Math.max(w, h), Math.max(6, Math.round(w / 5)));
  const n2 = makeNoise(rng, Math.max(w, h), Math.max(4, Math.round(w / 11)));
  const n3 = makeNoise(rng, Math.max(w, h), Math.max(3, Math.round(w / 22)));
  const field = new Float32Array(total);
  let eligibleCount = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      field[i] = 0.55 * n1(x, y) + 0.3 * n2(x, y) + 0.15 * n3(x, y);
      if (masks.nearStart[i] === 0) eligibleCount++;
    }
  }
  // Target the requested fraction of the WHOLE map, taken from eligible tiles
  // (capped so start-heavy small maps don't drown the middle entirely).
  const target = Math.min(Math.round(frac * total), Math.floor(eligibleCount * 0.55));
  if (target <= 0 || eligibleCount === 0) return;
  const vals = new Float32Array(eligibleCount);
  let k = 0;
  for (let i = 0; i < total; i++) if (masks.nearStart[i] === 0) vals[k++] = field[i];
  vals.sort();
  const threshold = vals[Math.min(target, eligibleCount) - 1];
  for (let i = 0; i < total; i++) {
    if (masks.nearStart[i] === 0 && field[i] <= threshold) map.terrain[i] = Terrain.WATER;
  }
}

/** Labels connected components among tiles matching `pass` (4-connectivity). */
function labelComponents(
  map: GameMap,
  pass: (x: number, y: number) => boolean,
): { labels: Int32Array; sizes: number[] } {
  const { w, h } = map;
  const total = w * h;
  const labels = new Int32Array(total).fill(-1);
  const sizes: number[] = [];
  const stack = new Int32Array(total);
  for (let start = 0; start < total; start++) {
    if (labels[start] !== -1) continue;
    const sx = start % w;
    const sy = (start - sx) / w;
    if (!pass(sx, sy)) continue;
    const label = sizes.length;
    let top = 0;
    stack[top++] = start;
    labels[start] = label;
    let size = 0;
    while (top > 0) {
      const idx = stack[--top];
      size++;
      const x = idx % w;
      const y = (idx - x) / w;
      if (x > 0 && labels[idx - 1] === -1 && pass(x - 1, y)) { labels[idx - 1] = label; stack[top++] = idx - 1; }
      if (x < w - 1 && labels[idx + 1] === -1 && pass(x + 1, y)) { labels[idx + 1] = label; stack[top++] = idx + 1; }
      if (y > 0 && labels[idx - w] === -1 && pass(x, y - 1)) { labels[idx - w] = label; stack[top++] = idx - w; }
      if (y < h - 1 && labels[idx + w] === -1 && pass(x, y + 1)) { labels[idx + w] = label; stack[top++] = idx + w; }
    }
    sizes.push(size);
  }
  return { labels, sizes };
}

function labelWater(map: GameMap): { labels: Int32Array; sizes: number[] } {
  return labelComponents(map, (x, y) => map.terrain[y * map.w + x] === Terrain.WATER);
}

function hasShorelineNear(
  map: GameMap,
  labels: Int32Array,
  sizes: number[],
  s: Vec2,
): boolean {
  const { w, h } = map;
  const r = SHORE_SEARCH_R;
  const r2 = r * r;
  for (let y = Math.max(0, s.y - r); y <= Math.min(h - 1, s.y + r); y++) {
    for (let x = Math.max(0, s.x - r); x <= Math.min(w - 1, s.x + r); x++) {
      if (dist2(x, y, s.x, s.y) > r2) continue;
      const lab = labels[y * w + x];
      if (lab >= 0 && sizes[lab] >= SHORE_REGION_MIN) return true;
    }
  }
  return false;
}

/** At medium/high water, every start must have a ≥30-tile WATER region within
 *  22 tiles so a naval yard is always placeable. Carve a lake if missing.
 *  Returns true if any lake was carved. */
function ensureStartLakes(rng: Rng, map: GameMap, starts: Vec2[], masks: Masks): boolean {
  let { labels, sizes } = labelWater(map);
  let carvedAny = false;
  for (const s of starts) {
    if (hasShorelineNear(map, labels, sizes, s)) continue;
    const freeR2 = START_WATER_FREE_R * START_WATER_FREE_R;
    const reach2 = (SHORE_SEARCH_R - 2) * (SHORE_SEARCH_R - 2);
    let carved = false;
    for (let attempt = 0; attempt < 16 && !carved; attempt++) {
      const ang = rng() * Math.PI * 2;
      const r = 12 + rng() * 5;
      const cx = Math.round(s.x + Math.cos(ang) * r);
      const cy = Math.round(s.y + Math.sin(ang) * r);
      if (cx < 2 || cy < 2 || cx > map.w - 3 || cy > map.h - 3) continue;
      const blob = collectBlob(rng, map.w, map.h, cx, cy, 44, (x, y) => {
        const i = y * map.w + x;
        if (masks.zone[i]) return false;
        if (map.terrain[i] === Terrain.CRYSTAL) return false;
        if (dist2(x, y, s.x, s.y) > reach2) return false;
        for (const o of starts) {
          if (dist2(x, y, o.x, o.y) < freeR2) return false;
        }
        return true;
      });
      if (blob.length >= SHORE_REGION_MIN + 4) {
        for (const i of blob) map.terrain[i] = Terrain.WATER;
        carved = true;
        carvedAny = true;
      }
    }
    if (carved) {
      const relabeled = labelWater(map);
      labels = relabeled.labels;
      sizes = relabeled.sizes;
    }
  }
  return carvedAny;
}

// --- Texture: dirt patches, start zones, shoreline -----------------------------------------

function paintDirt(rng: Rng, map: GameMap): void {
  const { w, h } = map;
  const total = w * h;
  const n1 = makeNoise(rng, Math.max(w, h), Math.max(5, Math.round(w / 7)));
  const n2 = makeNoise(rng, Math.max(w, h), Math.max(3, Math.round(w / 14)));
  const field = new Float32Array(total);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      field[y * w + x] = 0.65 * n1(x, y) + 0.35 * n2(x, y);
    }
  }
  const vals = field.slice();
  vals.sort();
  const threshold = vals[Math.floor(total * 0.22)];
  for (let i = 0; i < total; i++) {
    if (map.terrain[i] === Terrain.GRASS && field[i] <= threshold) {
      map.terrain[i] = Terrain.DIRT;
    }
  }
}

/** Safety pass: force every tile of each 12x12 start zone to GRASS/DIRT. */
function clearStartZones(map: GameMap, starts: Vec2[]): void {
  for (const s of starts) {
    for (let y = s.y + CLEAR_LO; y <= s.y + CLEAR_HI; y++) {
      for (let x = s.x + CLEAR_LO; x <= s.x + CLEAR_HI; x++) {
        if (!inBounds(map, x, y)) continue;
        const i = y * map.w + x;
        const t = map.terrain[i];
        if (t !== Terrain.GRASS && t !== Terrain.DIRT) map.terrain[i] = Terrain.GRASS;
      }
    }
  }
}

/** Ring every WATER body with SAND (8-neighbour land tiles become SAND). */
function paintShoreline(map: GameMap, masks: Masks): void {
  const { w, h } = map;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const t = map.terrain[i];
      if (t !== Terrain.GRASS && t !== Terrain.DIRT) continue;
      if (masks.zone[i]) continue; // keep start zones GRASS/DIRT
      let touchesWater = false;
      for (let dy = -1; dy <= 1 && !touchesWater; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (map.terrain[ny * w + nx] === Terrain.WATER) {
            touchesWater = true;
            break;
          }
        }
      }
      if (touchesWater) map.terrain[i] = Terrain.SAND;
    }
  }
}

// --- Crystal fields --------------------------------------------------------------------------

function placeStartCrystals(rng: Rng, map: GameMap, starts: Vec2[], masks: Masks): void {
  for (const s of starts) {
    let blob: number[] = [];
    for (let attempt = 0; attempt < 40 && blob.length < START_FIELD_SIZE; attempt++) {
      const ang = rng() * Math.PI * 2;
      const rad = 7.5 + rng() * 2;
      const sx = Math.round(s.x + Math.cos(ang) * rad);
      const sy = Math.round(s.y + Math.sin(ang) * rad);
      if (!inBounds(map, sx, sy)) continue;
      if (masks.zone[sy * map.w + sx]) continue;
      // Late attempts relax constraints: allow flooding water and a wider ring.
      const relaxed = attempt >= 28;
      const maxR = relaxed ? START_FIELD_R + 2 : START_FIELD_R;
      const maxR2 = maxR * maxR;
      const cand = collectBlob(rng, map.w, map.h, sx, sy, START_FIELD_SIZE, (x, y) => {
        const i = y * map.w + x;
        if (masks.zone[i]) return false;
        if (dist2(x, y, s.x, s.y) > maxR2) return false;
        const t = map.terrain[i];
        if (t === Terrain.CRYSTAL) return false;
        if (!relaxed && t === Terrain.WATER) return false;
        return true;
      });
      if (cand.length > blob.length) blob = cand;
    }
    for (const i of blob) map.terrain[i] = Terrain.CRYSTAL;
  }
}

function placeNeutralCrystals(rng: Rng, map: GameMap, starts: Vec2[], masks: Masks): void {
  const { w, h } = map;
  const want = 2 + Math.floor(rng() * 3); // 2..4 fields
  /** Compact fields: every tile within this radius of the field center. */
  const blobR2 = 7 * 7;
  /** Per-TILE clearance from starts so neutral fields never bleed into (or
   *  merge with) a start's own crystal field. */
  const startClear = Math.max(11, w * 0.2);
  const startClear2 = startClear * startClear;
  const placedCenters: Vec2[] = [];

  /** One field attempt batch; paints the best blob found if it is >= accept
   *  tiles. Returns true if a field was placed. */
  const tryPlace = (margin: number, gap: number, accept: number, attempts: number): boolean => {
    const gap2 = gap * gap;
    let best: number[] = [];
    let bestCenter: Vec2 | null = null;
    for (let attempt = 0; attempt < attempts && best.length < NEUTRAL_FIELD_SIZE; attempt++) {
      const cx = Math.round(w * (margin + rng() * (1 - 2 * margin)));
      const cy = Math.round(h * (margin + rng() * (1 - 2 * margin)));
      const ci = cy * w + cx;
      if (!isLandTerrain(map.terrain[ci]) || masks.zone[ci]) continue;
      let tooClose = false;
      for (const s of starts) {
        if (dist2(cx, cy, s.x, s.y) < startClear2) { tooClose = true; break; }
      }
      for (const c of placedCenters) {
        if (dist2(cx, cy, c.x, c.y) < gap2) { tooClose = true; break; }
      }
      if (tooClose) continue;
      const cand = collectBlob(rng, w, h, cx, cy, NEUTRAL_FIELD_SIZE, (x, y) => {
        const i = y * w + x;
        if (masks.zone[i]) return false;
        if (dist2(x, y, cx, cy) > blobR2) return false;
        for (const s of starts) {
          if (dist2(x, y, s.x, s.y) < startClear2) return false;
        }
        return isLandTerrain(map.terrain[i]);
      });
      if (cand.length > best.length) {
        best = cand;
        bestCenter = { x: cx, y: cy };
      }
    }
    if (best.length >= accept && bestCenter !== null) {
      for (const i of best) map.terrain[i] = Terrain.CRYSTAL;
      placedCenters.push(bestCenter);
      return true;
    }
    return false;
  };

  let made = 0;
  for (let f = 0; f < want; f++) {
    if (tryPlace(0.2, 14, 20, 30)) made++;
  }
  // Guarantee at least 2 fields on cramped maps by relaxing placement rules.
  if (made < 2 && tryPlace(0.15, 12, 16, 30)) made++;
  if (made < 2) tryPlace(0.12, 10, 12, 40);
}

// --- Obstacles ----------------------------------------------------------------------------------

function placeObstacles(rng: Rng, map: GameMap, masks: Masks): void {
  const { w, h } = map;
  const clusterCount = 6 + Math.floor(rng() * 5); // 6..10

  /** True if any 8-neighbour is already an obstacle — keeps clusters from
   *  growing into each other so they stay visually (and count as) distinct. */
  const touchesObstacle = (x: number, y: number): boolean => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const t = map.terrain[ny * w + nx];
        if (t === Terrain.TREE || t === Terrain.ROCK) return true;
      }
    }
    return false;
  };

  for (let c = 0; c < clusterCount; c++) {
    const kind = rng() < 0.62 ? Terrain.TREE : Terrain.ROCK;
    const size = 6 + Math.floor(rng() * 12); // 6..17
    for (let attempt = 0; attempt < 45; attempt++) {
      const sx = 1 + Math.floor(rng() * (w - 2));
      const sy = 1 + Math.floor(rng() * (h - 2));
      const si = sy * w + sx;
      const st = map.terrain[si];
      if (masks.zonePad[si] || (st !== Terrain.GRASS && st !== Terrain.DIRT)) continue;
      const blob = collectBlob(rng, w, h, sx, sy, size, (x, y) => {
        const i = y * w + x;
        if (masks.zonePad[i]) return false;
        if (touchesObstacle(x, y)) return false;
        const t = map.terrain[i];
        return t === Terrain.GRASS || t === Terrain.DIRT;
      });
      if (blob.length >= Math.min(4, size)) {
        for (const i of blob) map.terrain[i] = kind;
        break;
      }
    }
  }
}

// --- Connectivity --------------------------------------------------------------------------------

/** Converts blocking terrain (WATER/ROCK/TREE) at (x,y) to DIRT. */
function carveTile(map: GameMap, x: number, y: number): void {
  if (!inBounds(map, x, y)) return;
  const i = y * map.w + x;
  const t = map.terrain[i];
  if (t === Terrain.WATER || t === Terrain.ROCK || t === Terrain.TREE) {
    map.terrain[i] = Terrain.DIRT;
  }
}

/**
 * Multi-source 0-1 BFS over the WHOLE grid from every tile of `fromLabel`
 * until a tile of `toLabel` is reached, minimizing the number of blocking
 * tiles converted (passable tiles cost 0, WATER/ROCK/TREE cost 1). Corridors
 * therefore hug existing land and cross water at the narrowest neck, which
 * keeps carved causeways short and avoids shredding lakes. Then carves a
 * ~2-wide DIRT corridor along the found path.
 */
function carveCorridor(map: GameMap, labels: Int32Array, fromLabel: number, toLabel: number): void {
  const { w, h } = map;
  const total = w * h;
  const INF = 0x7fffffff;
  const dist = new Int32Array(total).fill(INF);
  const parent = new Int32Array(total).fill(-1); // -1 = source / unset
  const cap = total * 6;
  const deque = new Int32Array(cap);
  let head = cap >> 1;
  let tail = cap >> 1; // active window: [head, tail)
  for (let i = 0; i < total; i++) {
    if (labels[i] === fromLabel) {
      dist[i] = 0;
      deque[tail++] = i;
    }
  }
  const isBlocking = (i: number): boolean => {
    const t = map.terrain[i];
    return t === Terrain.WATER || t === Terrain.ROCK || t === Terrain.TREE;
  };
  let found = -1;
  while (head < tail && found < 0) {
    const idx = deque[head++];
    if (labels[idx] === toLabel) {
      found = idx;
      break;
    }
    const d = dist[idx];
    const x = idx % w;
    const y = (idx - x) / w;
    for (let dir = 0; dir < 4; dir++) {
      let ni = -1;
      if (dir === 0 && x > 0) ni = idx - 1;
      else if (dir === 1 && x < w - 1) ni = idx + 1;
      else if (dir === 2 && y > 0) ni = idx - w;
      else if (dir === 3 && y < h - 1) ni = idx + w;
      if (ni < 0) continue;
      const nd = d + (isBlocking(ni) ? 1 : 0);
      if (nd < dist[ni]) {
        dist[ni] = nd;
        parent[ni] = idx;
        if (nd === d && head > 0) deque[--head] = ni;
        else if (tail < cap) deque[tail++] = ni;
        else deque[--head] = ni; // capacity guard; cannot occur in practice
      }
    }
  }
  if (found < 0) return; // grid is fully connected as a graph; unreachable
  let cur = found;
  let guard = total + 1;
  while (cur >= 0 && guard-- > 0) {
    const x = cur % w;
    const y = (cur - x) / w;
    carveTile(map, x, y);
    carveTile(map, x + 1, y); // widen to ~2 tiles so units don't single-file
    carveTile(map, x, y + 1);
    if (dist[cur] === 0 && labels[cur] === fromLabel) break; // reached source
    cur = parent[cur];
  }
}

/**
 * Ensures ALL ground-passable land forms a single connected region (which
 * also guarantees every start position is mutually reachable by ground).
 * Repeatedly merges the largest stray component into the main one via
 * carved DIRT corridors.
 */
function ensureConnectivity(map: GameMap): void {
  for (let guard = 0; guard < 256; guard++) {
    const { labels, sizes } = labelComponents(map, (x, y) => isGroundPassable(map, x, y));
    if (sizes.length <= 1) return;
    let main = 0;
    for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[main]) main = i;
    let other = -1;
    for (let i = 0; i < sizes.length; i++) {
      if (i !== main && (other < 0 || sizes[i] > sizes[other])) other = i;
    }
    if (other < 0) return;
    carveCorridor(map, labels, other, main);
  }
}

// --- Crystal values --------------------------------------------------------------------------------

function fillCrystalValues(map: GameMap): void {
  const total = map.w * map.h;
  for (let i = 0; i < total; i++) {
    map.crystal[i] = map.terrain[i] === Terrain.CRYSTAL ? CRYSTAL_PER_TILE : 0;
  }
}

/**
 * Fairness pass: every start position gets (near-)equal harvestable value in
 * its opening radius. Whoever spawns where should not decide the match — the
 * poorest starts get their fields grown until they match the richest.
 */
function equalizeStartCrystals(rng: Rng, map: GameMap, starts: Vec2[]): void {
  const R = 14;
  const R2 = R * R;
  const valueNear = (s: Vec2): number => {
    let v = 0;
    for (let y = Math.max(0, s.y - R); y <= Math.min(map.h - 1, s.y + R); y++) {
      for (let x = Math.max(0, s.x - R); x <= Math.min(map.w - 1, s.x + R); x++) {
        if (dist2(x, y, s.x, s.y) <= R2) v += map.crystal[y * map.w + x];
      }
    }
    return v;
  };
  const target = Math.max(...starts.map(valueNear));
  for (const s of starts) {
    let v = valueNear(s);
    let guard = 0;
    while (v + CRYSTAL_PER_TILE / 2 < target && guard++ < 200) {
      // frontier: land tiles adjacent to an existing crystal tile, in radius,
      // outside the clear build zone around the start
      let best = -1;
      let bestD = Infinity;
      for (let y = Math.max(1, s.y - R); y <= Math.min(map.h - 2, s.y + R); y++) {
        for (let x = Math.max(1, s.x - R); x <= Math.min(map.w - 2, s.x + R); x++) {
          const i = y * map.w + x;
          const t = map.terrain[i];
          if (t !== Terrain.GRASS && t !== Terrain.DIRT && t !== Terrain.SAND) continue;
          const d2 = dist2(x, y, s.x, s.y);
          if (d2 > R2 || d2 < 36) continue; // keep the 6-tile build area clear
          const adj =
            map.terrain[i - 1] === Terrain.CRYSTAL ||
            map.terrain[i + 1] === Terrain.CRYSTAL ||
            map.terrain[i - map.w] === Terrain.CRYSTAL ||
            map.terrain[i + map.w] === Terrain.CRYSTAL;
          if (!adj) continue;
          const score = d2 + rng() * 8;
          if (score < bestD) {
            bestD = score;
            best = i;
          }
        }
      }
      if (best < 0) {
        // no frontier (field walled in) — seed a fresh tile on open land near the start
        for (let attempt = 0; attempt < 60 && best < 0; attempt++) {
          const ang = rng() * Math.PI * 2;
          const rad = 7 + rng() * 4;
          const x = Math.round(s.x + Math.cos(ang) * rad);
          const y = Math.round(s.y + Math.sin(ang) * rad);
          if (x < 1 || y < 1 || x >= map.w - 1 || y >= map.h - 1) continue;
          const i = y * map.w + x;
          const t = map.terrain[i];
          if (t === Terrain.GRASS || t === Terrain.DIRT || t === Terrain.SAND) best = i;
        }
        if (best < 0) break;
      }
      map.terrain[best] = Terrain.CRYSTAL;
      map.crystal[best] = CRYSTAL_PER_TILE;
      v += CRYSTAL_PER_TILE;
    }
  }
}

/** Debug helper: total remaining crystal value on the map. */
export function crystalTotal(map: GameMap): number {
  let sum = 0;
  for (let i = 0; i < map.crystal.length; i++) sum += map.crystal[i];
  return sum;
}

// --- Entry point ------------------------------------------------------------------------------------

export function generateMap(
  seed: number,
  size: 'S' | 'M' | 'L',
  water: 'low' | 'medium' | 'high',
  playerCount: number,
): GameMap {
  const n = MAP_SIZES[size];
  const rng = mulberry32(seed >>> 0);
  const count = Math.max(1, Math.min(4, Math.floor(playerCount)));

  const starts = pickStartPositions(rng, n, count);
  const map: GameMap = {
    w: n,
    h: n,
    terrain: new Uint8Array(n * n).fill(Terrain.GRASS),
    crystal: new Uint16Array(n * n),
    startPositions: starts,
  };
  const masks = buildMasks(n, n, starts);

  placeWater(rng, map, water, masks);
  if (water !== 'low') ensureStartLakes(rng, map, starts, masks);
  paintDirt(rng, map);
  clearStartZones(map, starts);
  paintShoreline(map, masks);
  placeStartCrystals(rng, map, starts, masks);
  placeNeutralCrystals(rng, map, starts, masks);
  placeObstacles(rng, map, masks);
  ensureConnectivity(map);
  if (water !== 'low') {
    // Late passes (crystals over water, connectivity causeways) can shrink or
    // split a start's guaranteed lake — re-check and re-carve until stable.
    for (let round = 0; round < 6; round++) {
      const carved = ensureStartLakes(rng, map, starts, masks);
      if (!carved) break;
      ensureConnectivity(map);
    }
    paintShoreline(map, masks); // re-ring any late-carved lakes with sand
  }
  fillCrystalValues(map);
  equalizeStartCrystals(rng, map, starts);

  return map;
}
