// =============================================================================
// POCKET ALERT — procedural sprite atlas (Owner D, "the art department").
//
// Every sprite is drawn once with Canvas 2D and cached. Deterministic: all
// noise comes from mulberry32 seeded by the sprite key.
//
// Anchoring conventions (must match render/renderer.ts):
//  - terrain tiles: canvas horizontally centered on the diamond, bottom edge
//    on the cell diamond's BOTTOM vertex (tall canvases overhang upward).
//  - unit sprites: 64x64, CENTER-anchored; creature feet ~y=52.
//  - building sprites: bottom edge aligned to the footprint diamond's bottom
//    vertex, horizontally centered on the footprint CENTER.
//  - projectiles: small center-anchored canvases.
//  - icons: 56x42 cards (cloned per call — safe to append to the DOM).
//
// Facing convention: index = round(facing / (PI/4)) % 8 with facing 0 = +x
// axis (screen ESE). 0=E 1=SE 2=S 3=SW 4=W 5=NW 6=N 7=NE. We draw S, SW, W,
// NW, N and mirror horizontally for E, SE, NE.
// =============================================================================

import type { GameData, UnitDef } from '../core/types';
import { Element, PLAYER_COLORS, Terrain, WeaponClass } from '../core/types';
import { TILE_H, TILE_HALF_H, TILE_HALF_W, TILE_W } from '../core/constants';
import { hashSeed, mulberry32 } from '../core/rng';

export interface SpriteAtlas {
  getUnitSprite(key: string, facing8: number, frame: number, colorIdx: number): HTMLCanvasElement;
  getBuildingSprite(key: string, colorIdx: number, constructed: boolean): HTMLCanvasElement;
  getTerrainTile(t: Terrain, variant: number): HTMLCanvasElement;
  getProjectileSprite(weaponClass: WeaponClass, element: Element): HTMLCanvasElement;
  getObjectiveSprite(key: string): HTMLCanvasElement | null;
  getIcon(key: string): HTMLCanvasElement;
}

// --- custom art overrides (see SPRITES.md) ----------------------------------------
// PNGs under public/sprites/ replace procedural art per def id; anything not
// provided falls back to the code-drawn sprite. manifest.json declares what
// exists so we never fire hundreds of speculative 404s.

export interface UnitOverride {
  imgs: Map<string, HTMLImageElement>; // key: `${dir}_${frame}`, dir in e,se,s,sw,w,nw,n,ne
  frames: number;
}

export interface SpriteOverrides {
  units: Map<string, UnitOverride>;
  buildings: Map<string, HTMLImageElement>;
  terrain: Map<string, HTMLImageElement>;
  objectives: Map<string, HTMLImageElement>;
}

interface SpriteManifest {
  units?: Record<string, { facings: string[]; frames?: number }>;
  buildings?: string[];
  terrain?: Record<string, { variants?: number }>;
  objectives?: string[];
}

const TERRAIN_KEYS: Record<number, string> = {
  [Terrain.GRASS]: 'grass',
  [Terrain.DIRT]: 'dirt',
  [Terrain.SAND]: 'sand',
  [Terrain.WATER]: 'water',
  [Terrain.ROCK]: 'rock',
  [Terrain.TREE]: 'tree',
  [Terrain.CRYSTAL]: 'crystal',
};

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Fetch public/sprites/manifest.json and every image it declares. */
export async function loadSpriteOverrides(base = '/sprites'): Promise<SpriteOverrides | null> {
  let manifest: SpriteManifest;
  try {
    const res = await fetch(`${base}/manifest.json`, { cache: 'no-cache' });
    if (!res.ok) return null;
    manifest = (await res.json()) as SpriteManifest;
  } catch {
    return null;
  }
  const out: SpriteOverrides = { units: new Map(), buildings: new Map(), terrain: new Map(), objectives: new Map() };
  const jobs: Promise<void>[] = [];
  for (const [id, spec] of Object.entries(manifest.units ?? {})) {
    const frames = Math.max(1, Math.min(4, spec.frames ?? 1));
    const ov: UnitOverride = { imgs: new Map(), frames };
    out.units.set(id, ov);
    for (const dir of spec.facings) {
      for (let f = 0; f < frames; f++) {
        jobs.push(
          loadImage(`${base}/units/${id}_${dir}_${f}.png`).then((img) => {
            if (img) ov.imgs.set(`${dir}_${f}`, img);
          }),
        );
      }
    }
  }
  for (const id of manifest.buildings ?? []) {
    jobs.push(
      loadImage(`${base}/buildings/${id}.png`).then((img) => {
        if (img) out.buildings.set(id, img);
      }),
    );
  }
  for (const [id, spec] of Object.entries(manifest.terrain ?? {})) {
    const variants = Math.max(1, Math.min(8, spec.variants ?? 1));
    for (let v = 0; v < variants; v++) {
      jobs.push(
        loadImage(`${base}/terrain/${id}_${v}.png`).then((img) => {
          if (img) out.terrain.set(`${id}_${v}`, img);
        }),
      );
    }
  }
  for (const id of manifest.objectives ?? []) {
    jobs.push(
      loadImage(`${base}/objectives/${id}.png`).then((img) => {
        if (img) out.objectives.set(id, img);
      }),
    );
  }
  await Promise.all(jobs);
  const total =
    [...out.units.values()].reduce((s, u) => s + u.imgs.size, 0) +
    out.buildings.size +
    out.terrain.size +
    out.objectives.size;
  if (total === 0) return null;
  console.info(`[sprites] loaded ${total} custom sprite images`);
  return out;
}

const DIR_NAMES = ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne'] as const;
const MIRROR_DIR: Record<string, string> = { e: 'w', se: 'sw', ne: 'nw' };
const USE_GENERATED_UNIT_OVERRIDES = true;

/** Expected building override canvas box for a footprint (see SPRITES.md). */
export function buildingSpriteBox(fw: number, fh: number, kind: string): { w: number; h: number } {
  const bodyH = kind === 'wall' ? 26 : kind === 'sw' || kind === 'conyard' ? 84 : 64;
  return { w: (fw + fh) * TILE_HALF_W + 8, h: (fw + fh) * TILE_HALF_H + bodyH };
}

type Ctx = CanvasRenderingContext2D;

function canvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  return [c, ctx];
}

function shade(hex: string, f: number): string {
  // f>0 lighten toward white, f<0 darken toward black
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255,
    g = (n >> 8) & 255,
    b = n & 255;
  if (f >= 0) {
    r += (255 - r) * f;
    g += (255 - g) * f;
    b += (255 - b) * f;
  } else {
    r *= 1 + f;
    g *= 1 + f;
    b *= 1 + f;
  }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

// --- creature visual configs -----------------------------------------------------

type Archetype = 'biped' | 'quad' | 'bird' | 'serpent' | 'blob' | 'turtle' | 'prof' | 'machine';

interface CreatureCfg {
  arch: Archetype;
  base: string; // main body color
  belly?: string;
  accent?: string; // markings / accessory color
  size: number; // body height px (chibi total)
  ears?: 'point' | 'round' | 'long' | 'leaf' | 'none';
  tail?: 'flame' | 'zap' | 'fin' | 'leaf' | 'plain' | 'none';
  horn?: boolean;
  shellCannons?: boolean; // turtle shoulder cannons
  bulb?: boolean; // back bulb / flower
  flower?: boolean;
  wings?: boolean;
  scythes?: boolean;
  cheeks?: string; // cheek dot color
  flameHead?: boolean;
  magnets?: boolean; // machine: orbiting magnet orbs
  sombrero?: boolean;
  boat?: boolean; // sits on a hull (naval surface)
  sub?: boolean; // submarine silhouette
  big?: boolean; // tier-3 bulk
}

const CREATURES: Record<string, CreatureCfg> = {
  // SCORCH
  scorch_charmandar: { arch: 'biped', base: '#f08030', belly: '#ffd79b', size: 34, tail: 'flame', cheeks: '#ff9e54' },
  scorch_peekachoo: { arch: 'biped', base: '#ffd83c', belly: '#fff1b8', size: 32, ears: 'long', tail: 'zap', cheeks: '#ff4040' },
  scorch_magmarr: { arch: 'biped', base: '#e05038', belly: '#ffb04a', size: 38, flameHead: true, tail: 'flame' },
  scorch_prof_cinder: { arch: 'prof', base: '#c03028', accent: '#f8d030', size: 33 },
  scorch_torkoala: { arch: 'turtle', base: '#5a4a42', belly: '#c8a888', accent: '#ff5a2a', size: 36 },
  scorch_ryhorrn: { arch: 'quad', base: '#9aa0aa', belly: '#c9ced8', size: 38, horn: true },
  scorch_arcanyne: { arch: 'quad', base: '#f08030', belly: '#f8e0a0', accent: '#2e2030', size: 36, tail: 'plain' },
  scorch_magnetonn: { arch: 'machine', base: '#b8c0d0', accent: '#3858f0', size: 34, magnets: true },
  scorch_groudonn: { arch: 'biped', base: '#d03028', belly: '#8a1c14', accent: '#dcdcdc', size: 48, horn: true, big: true, tail: 'plain' },
  scorch_zubattler: { arch: 'bird', base: '#7038f8', belly: '#a890f0', size: 30, wings: true, ears: 'point' },
  scorch_moltrez: { arch: 'bird', base: '#ff7a2a', belly: '#ffd83c', size: 44, wings: true, flameHead: true, big: true },
  scorch_magcarggo: { arch: 'blob', base: '#e0503a', belly: '#5a4a42', size: 34, boat: true, flameHead: true },
  scorch_slugmariner: { arch: 'blob', base: '#8a8fa0', belly: '#b9bece', size: 32, sub: true },
  // TIDE
  tide_squirtul: { arch: 'biped', base: '#58a8e0', belly: '#f8e8b0', size: 33, tail: 'plain' },
  tide_horsean: { arch: 'serpent', base: '#68b8e8', belly: '#cfeaff', size: 34 },
  tide_polywrath: { arch: 'biped', base: '#3868a8', belly: '#e8e8f0', size: 38, big: false },
  tide_prof_brine: { arch: 'prof', base: '#2a6ab8', accent: '#ffd83c', size: 33 },
  tide_krabber: { arch: 'machine', base: '#e86a4a', accent: '#f8d8a8', size: 34 },
  tide_vaporeonix: { arch: 'quad', base: '#58c8d8', belly: '#cfeaff', size: 34, ears: 'leaf', tail: 'fin' },
  tide_blastoyse: { arch: 'turtle', base: '#3888c8', belly: '#e8d8a8', size: 40, shellCannons: true },
  tide_starmiez: { arch: 'machine', base: '#8a5ad8', accent: '#ff4060', size: 34 },
  tide_kyogrre: { arch: 'serpent', base: '#2858c8', belly: '#e8eaf2', accent: '#ff3038', size: 48, big: true },
  tide_wingullet: { arch: 'bird', base: '#e8ecf2', belly: '#ffffff', accent: '#58a8e0', size: 30, wings: true },
  tide_pelipperator: { arch: 'bird', base: '#e8ecf2', belly: '#ffd83c', accent: '#3868a8', size: 42, wings: true, big: true },
  tide_tentacrush: { arch: 'blob', base: '#5a7ae0', accent: '#e03050', size: 36, boat: true },
  tide_sharpeedo: { arch: 'blob', base: '#4868b8', belly: '#e8eaf2', size: 34, sub: true },
  tide_gyarrados: { arch: 'serpent', base: '#3878d8', belly: '#f0e8c8', accent: '#e03050', size: 50, big: true, boat: true },
  // VERDANT
  verdant_bulbasore: { arch: 'quad', base: '#58c8a8', belly: '#a8e8c8', size: 32, bulb: true },
  verdant_beedrillz: { arch: 'bird', base: '#f8d030', accent: '#2e2030', size: 32, wings: true, scythes: true },
  verdant_oddishooter: { arch: 'blob', base: '#4a68b8', accent: '#58c850', size: 28, ears: 'leaf' },
  verdant_scytherr: { arch: 'biped', base: '#78c850', belly: '#d8e8b0', size: 38, scythes: true, wings: true },
  verdant_prof_oakley: { arch: 'prof', base: '#48803a', accent: '#e8d8a8', size: 33 },
  verdant_torterrar: { arch: 'turtle', base: '#5a8a4a', belly: '#c8b888', accent: '#4ade5a', size: 38 },
  verdant_sceptilash: { arch: 'biped', base: '#58c850', belly: '#c8e8a0', size: 34, tail: 'leaf' },
  verdant_venosore: { arch: 'quad', base: '#48a868', belly: '#a8d8b0', size: 42, flower: true, big: true },
  verdant_tanglevine: { arch: 'blob', base: '#3858c0', accent: '#58c850', size: 32 },
  verdant_snorlux: { arch: 'biped', base: '#386878', belly: '#f0e8d8', size: 50, ears: 'round', big: true },
  verdant_pidgeottoh: { arch: 'bird', base: '#c8a060', belly: '#f0e0c0', accent: '#e05038', size: 32, wings: true },
  verdant_butterfrei: { arch: 'bird', base: '#7a5ad8', belly: '#e8ecf2', size: 36, wings: true, ears: 'point', big: true },
  verdant_lotadder: { arch: 'blob', base: '#4a98c8', accent: '#58c850', size: 32, boat: true },
  verdant_ludicolossus: { arch: 'blob', base: '#58a858', belly: '#f8d030', size: 42, sombrero: true, boat: true, big: true },
};

const WORLD_CREATURES: Record<string, CreatureCfg> = {
  // SCORCH: obsidian bodies, molten cores, brutal silhouettes
  scorch_charmandar: { arch: 'biped', base: '#2a2024', belly: '#ff6a22', accent: '#ffb13c', size: 35, tail: 'flame', horn: true },
  scorch_peekachoo: { arch: 'machine', base: '#31262a', accent: '#ffcf3c', size: 32, magnets: true },
  scorch_magmarr: { arch: 'biped', base: '#33242a', belly: '#ff7a28', accent: '#ffcf5a', size: 39, flameHead: true, horn: true },
  scorch_prof_cinder: { arch: 'prof', base: '#3a2528', accent: '#ff8c32', size: 34, flameHead: true },
  scorch_torkoala: { arch: 'turtle', base: '#30282a', belly: '#ff6a22', accent: '#ffb13c', size: 38, shellCannons: true },
  scorch_ryhorrn: { arch: 'quad', base: '#312a2e', belly: '#5a4246', accent: '#ff6a22', size: 40, horn: true },
  scorch_arcanyne: { arch: 'quad', base: '#35262a', belly: '#ff8c32', accent: '#141015', size: 37, tail: 'flame', horn: true },
  scorch_magnetonn: { arch: 'machine', base: '#393238', accent: '#ffcf3c', size: 35, magnets: true },
  scorch_groudonn: { arch: 'biped', base: '#211a1d', belly: '#ff5a1f', accent: '#f5c46b', size: 50, horn: true, big: true, tail: 'plain', flameHead: true },
  scorch_zubattler: { arch: 'bird', base: '#302432', belly: '#ff6a22', accent: '#f5c46b', size: 32, wings: true, horn: true },
  scorch_moltrez: { arch: 'bird', base: '#2b2024', belly: '#ff8c32', accent: '#ffd36b', size: 46, wings: true, flameHead: true, big: true },
  scorch_magcarggo: { arch: 'blob', base: '#2a2024', belly: '#ff5a1f', accent: '#ffb13c', size: 36, boat: true, flameHead: true },
  scorch_slugmariner: { arch: 'blob', base: '#343039', belly: '#ff6a22', accent: '#ffb13c', size: 34, sub: true },
  // TIDE: pale coral armor, aqua cores, predatory sea shapes
  tide_squirtul: { arch: 'biped', base: '#d9e7e9', belly: '#3fd3e7', accent: '#0b5f72', size: 34, horn: true },
  tide_horsean: { arch: 'serpent', base: '#79d9e8', belly: '#eafcff', accent: '#23a8c5', size: 36, horn: true },
  tide_polywrath: { arch: 'biped', base: '#2a6475', belly: '#8ff0f5', accent: '#eafcff', size: 39, horn: true },
  tide_prof_brine: { arch: 'prof', base: '#2a6475', accent: '#8ff0f5', size: 34 },
  tide_krabber: { arch: 'machine', base: '#cfe7e8', belly: '#7fe6ef', accent: '#1d7c91', size: 35, scythes: true },
  tide_vaporeonix: { arch: 'quad', base: '#5dc7d8', belly: '#eafcff', accent: '#1d7c91', size: 36, tail: 'fin', horn: true },
  tide_blastoyse: { arch: 'turtle', base: '#e7edf0', belly: '#59d8e8', accent: '#23849a', size: 42, shellCannons: true },
  tide_starmiez: { arch: 'machine', base: '#d9e7e9', accent: '#39d8ef', size: 35, magnets: true },
  tide_kyogrre: { arch: 'serpent', base: '#265f75', belly: '#eafcff', accent: '#39d8ef', size: 50, big: true, horn: true },
  tide_wingullet: { arch: 'bird', base: '#e7edf0', belly: '#92f0f5', accent: '#26788d', size: 32, wings: true },
  tide_pelipperator: { arch: 'bird', base: '#d9e7e9', belly: '#7fe6ef', accent: '#1d7c91', size: 44, wings: true, big: true },
  tide_tentacrush: { arch: 'blob', base: '#34788b', belly: '#8ff0f5', accent: '#eafcff', size: 37, boat: true, scythes: true },
  tide_sharpeedo: { arch: 'blob', base: '#214d64', belly: '#eafcff', accent: '#39d8ef', size: 35, sub: true },
  tide_gyarrados: { arch: 'serpent', base: '#276f89', belly: '#d9fbff', accent: '#39d8ef', size: 52, big: true, boat: true, horn: true },
  // VERDANT: living wood, moss plates, toxic green cores
  verdant_bulbasore: { arch: 'quad', base: '#5b4a2f', belly: '#4ed66a', accent: '#b8df78', size: 34, bulb: true, horn: true },
  verdant_beedrillz: { arch: 'bird', base: '#5f6f33', belly: '#b8df78', accent: '#d8f277', size: 34, wings: true, scythes: true },
  verdant_oddishooter: { arch: 'blob', base: '#344a30', belly: '#4ed66a', accent: '#b8df78', size: 31, ears: 'leaf' },
  verdant_scytherr: { arch: 'biped', base: '#40522f', belly: '#6ee47a', accent: '#d8f277', size: 40, scythes: true, wings: true, horn: true },
  verdant_prof_oakley: { arch: 'prof', base: '#4b3a2a', accent: '#66df70', size: 34 },
  verdant_torterrar: { arch: 'turtle', base: '#4b3a2a', belly: '#66df70', accent: '#a7d96a', size: 40, bulb: true, shellCannons: true },
  verdant_sceptilash: { arch: 'biped', base: '#42532f', belly: '#6ee47a', accent: '#d8f277', size: 36, tail: 'leaf', horn: true },
  verdant_venosore: { arch: 'quad', base: '#4b3a2a', belly: '#66df70', accent: '#d8f277', size: 44, flower: true, big: true, horn: true },
  verdant_tanglevine: { arch: 'blob', base: '#2d3f2b', belly: '#4ed66a', accent: '#b8df78', size: 34, scythes: true },
  verdant_snorlux: { arch: 'biped', base: '#3f4a32', belly: '#8adf74', accent: '#d8f277', size: 52, big: true, horn: true },
  verdant_pidgeottoh: { arch: 'bird', base: '#55452d', belly: '#84dd72', accent: '#d8f277', size: 34, wings: true, horn: true },
  verdant_butterfrei: { arch: 'bird', base: '#385232', belly: '#7ee176', accent: '#d8f277', size: 38, wings: true, big: true },
  verdant_lotadder: { arch: 'blob', base: '#3c5833', belly: '#66df70', accent: '#d8f277', size: 34, boat: true },
  verdant_ludicolossus: { arch: 'blob', base: '#4b3a2a', belly: '#77df6c', accent: '#d8f277', size: 44, boat: true, big: true, bulb: true },
};

// --- faction building themes -----------------------------------------------------

interface Theme {
  wallA: string; // light wall face
  wallB: string; // dark wall face
  roof: string;
  glow: string;
  trim: string;
}
const THEMES: Record<string, Theme> = {
  scorch: { wallA: '#7a5564', wallB: '#4e3442', roof: '#8d6a76', glow: '#ff5a2a', trim: '#2a1c24' },
  tide: { wallA: '#dde6ee', wallB: '#9fb4c6', roof: '#b9d0e0', glow: '#2ab4ff', trim: '#6e90aa' },
  verdant: { wallA: '#8a6a44', wallB: '#5c4630', roof: '#6e8a3e', glow: '#4ade5a', trim: '#3e3020' },
};

// =============================================================================
// Atlas implementation
// =============================================================================

class Atlas implements SpriteAtlas {
  private data: GameData;
  private ov: SpriteOverrides | null;
  private unitCache = new Map<string, HTMLCanvasElement>();
  private buildingCache = new Map<string, HTMLCanvasElement>();
  private terrainCache = new Map<string, HTMLCanvasElement>();
  private objectiveCache = new Map<string, HTMLCanvasElement>();
  private projCache = new Map<string, HTMLCanvasElement>();
  private iconCache = new Map<string, HTMLCanvasElement>();

  constructor(data: GameData, overrides: SpriteOverrides | null = null) {
    this.data = data;
    this.ov = overrides;
  }

  // --- units ----------------------------------------------------------------------

  getUnitSprite(key: string, facing8: number, frame: number, colorIdx: number): HTMLCanvasElement {
    const f = ((facing8 % 8) + 8) % 8;
    const ovUnit = USE_GENERATED_UNIT_OVERRIDES ? this.ov?.units.get(key) : undefined;
    const fr = ovUnit ? ((frame % ovUnit.frames) + ovUnit.frames) % ovUnit.frames : frame & 1;
    const ck = `${key}|${f}|${fr}|${colorIdx}`;
    let c = this.unitCache.get(ck);
    if (c) return c;

    // custom art override: use the player's PNG when provided for this facing
    if (ovUnit) {
      const dir = DIR_NAMES[f];
      let img = ovUnit.imgs.get(`${dir}_${fr}`) ?? ovUnit.imgs.get(`${dir}_0`);
      let mirrored = false;
      if (!img && MIRROR_DIR[dir]) {
        const m = MIRROR_DIR[dir];
        img = ovUnit.imgs.get(`${m}_${fr}`) ?? ovUnit.imgs.get(`${m}_0`);
        mirrored = true;
      }
      if (!img) {
        // Partial art packs: a lone front view beats mixing in procedural art —
        // reuse 's' (or anything available) for the missing facings.
        img = ovUnit.imgs.get(`s_${fr}`) ?? ovUnit.imgs.get('s_0') ?? ovUnit.imgs.values().next().value;
        mirrored = false;
      }
      if (img) {
        const [cv, ctx] = canvas(64, 64);
        const scale = Math.min(64 / img.width, 64 / img.height);
        const dw = img.width * scale;
        const dh = img.height * scale;
        ctx.save();
        if (mirrored) {
          ctx.translate(64, 0);
          ctx.scale(-1, 1);
        }
        ctx.drawImage(img, (64 - dw) / 2, 64 - dh - 6, dw, dh); // feet land near y=52
        ctx.restore();
        drawPlayerBand(ctx, 32, 48, 10, PLAYER_COLORS[colorIdx]?.hex ?? '#ffffff');
        this.unitCache.set(ck, cv);
        return cv;
      }
    }

    // canonical dirs: 2(S) 3(SW) 4(W) 5(NW) 6(N); mirror 0<-4, 1<-3, 7<-5
    const mirrorOf: Record<number, number> = { 0: 4, 1: 3, 7: 5 };
    if (f in mirrorOf) {
      const src = this.getUnitSprite(key, mirrorOf[f], fr, colorIdx);
      const [mc, mctx] = canvas(src.width, src.height);
      mctx.translate(src.width, 0);
      mctx.scale(-1, 1);
      mctx.drawImage(src, 0, 0);
      this.unitCache.set(ck, mc);
      return mc;
    }

    const cfg = WORLD_CREATURES[key] ?? CREATURES[key] ?? { arch: 'blob' as Archetype, base: '#c0c0c0', size: 32 };
    const [cv, ctx] = canvas(64, 64);
    drawCreature(ctx, cfg, f, fr, PLAYER_COLORS[colorIdx]?.hex ?? '#ffffff', key);
    this.unitCache.set(ck, cv);
    return cv;
  }

  // --- objectives -----------------------------------------------------------------

  getObjectiveSprite(key: string): HTMLCanvasElement | null {
    let c = this.objectiveCache.get(key);
    if (c) return c;
    const img = this.ov?.objectives.get(key);
    if (!img) return null;
    const [cv, ctx] = canvas(img.width, img.height);
    ctx.drawImage(img, 0, 0);
    this.objectiveCache.set(key, cv);
    return cv;
  }

  // --- buildings ------------------------------------------------------------------

  getBuildingSprite(key: string, colorIdx: number, constructed: boolean): HTMLCanvasElement {
    const ck = `${key}|${colorIdx}|${constructed ? 1 : 0}`;
    let c = this.buildingCache.get(ck);
    if (c) return c;
    const def = this.data.buildings[key];
    const fw = def?.footprint.w ?? 2;
    const fh = def?.footprint.h ?? 2;
    const faction = key.split('_')[0];
    const kind = key.slice(faction.length + 1);
    const theme = THEMES[faction] ?? THEMES.scorch;
    const { w: W, h: H } = buildingSpriteBox(fw, fh, kind);
    const [cv, ctx] = canvas(W, H);
    const bvx = W / 2 + ((fw - fh) / 2) * TILE_HALF_W; // bottom vertex x
    const bvy = H - 2;
    const hex = PLAYER_COLORS[colorIdx]?.hex ?? '#fff';

    // custom art override (constructed state only; the scaffold/egg stays procedural)
    const ovImg = constructed ? this.ov?.buildings.get(key) : undefined;
    if (ovImg) {
      const scale = Math.min(W / ovImg.width, H / ovImg.height);
      const dw = ovImg.width * scale;
      const dh = ovImg.height * scale;
      ctx.drawImage(ovImg, (W - dw) / 2, H - dh, dw, dh); // bottom-anchored
      banner(ctx, bvx, bvy - 3, hex);
      this.buildingCache.set(ck, cv);
      return cv;
    }

    if (constructed) {
      drawBuilding(ctx, kind, theme, fw, fh, bvx, bvy, hex, key);
    } else {
      drawConstructionSite(ctx, theme, fw, fh, bvx, bvy, key);
    }
    this.buildingCache.set(ck, cv);
    return cv;
  }

  // --- terrain ---------------------------------------------------------------------

  getTerrainTile(t: Terrain, variant: number): HTMLCanvasElement {
    const ck = `${t}|${variant % 3}`;
    let c = this.terrainCache.get(ck);
    if (c) return c;
    // Some generated terrain tiles carried baked square borders that broke the
    // iso read when repeated. Keep the best natural overrides, but use the
    // engine's clean diamond painter for resource fields, blockers, and dirt.
    const key =
      t === Terrain.CRYSTAL || t === Terrain.ROCK || t === Terrain.TREE || t === Terrain.DIRT
        ? undefined
        : TERRAIN_KEYS[t];
    const img = key ? this.ov?.terrain.get(`${key}_${variant % 3}`) : undefined;
    if (img) {
      const [cv, ctx] = canvas(img.width, img.height);
      ctx.drawImage(img, 0, 0);
      this.terrainCache.set(ck, cv);
      return cv;
    }
    c = drawTerrain(t, variant % 3);
    this.terrainCache.set(ck, c);
    return c;
  }

  // --- projectiles -------------------------------------------------------------------

  getProjectileSprite(weaponClass: WeaponClass, element: Element): HTMLCanvasElement {
    const ck = `${weaponClass}|${element}`;
    let c = this.projCache.get(ck);
    if (c) return c;
    c = drawProjectile(weaponClass, element);
    this.projCache.set(ck, c);
    return c;
  }

  // --- icons ----------------------------------------------------------------------------

  getIcon(key: string): HTMLCanvasElement {
    let master = this.iconCache.get(key);
    if (!master) {
      master = this.renderIcon(key);
      this.iconCache.set(key, master);
    }
    // Clone: callers append icons into the DOM; the cache must stay intact.
    const [c, ctx] = canvas(master.width, master.height);
    ctx.drawImage(master, 0, 0);
    return c;
  }

  private renderIcon(key: string): HTMLCanvasElement {
    const [c, ctx] = canvas(56, 42);
    const faction = key.split('_')[0];
    const theme = THEMES[faction];
    const accent = theme ? theme.glow : '#8a5ad8';
    const g = ctx.createLinearGradient(0, 0, 0, 42);
    g.addColorStop(0, shade('#1a1c2c', 0.12));
    g.addColorStop(1, '#10111e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 56, 42);
    // subtle accent glow corner
    const rg = ctx.createRadialGradient(46, 8, 2, 46, 8, 30);
    rg.addColorStop(0, accent + '55');
    rg.addColorStop(1, 'transparent');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, 56, 42);

    if (this.data.units[key]) {
      const spr = this.getUnitSprite(key, 2, 0, 0);
      ctx.drawImage(spr, 4, -8, 56, 56);
    } else if (this.data.buildings[key]) {
      const spr = this.getBuildingSprite(key, 0, true);
      const scale = Math.min(48 / spr.width, 38 / spr.height);
      const dw = spr.width * scale;
      const dh = spr.height * scale;
      ctx.drawImage(spr, (56 - dw) / 2, 42 - dh - 1, dw, dh);
    } else {
      // superweapon icons
      drawSuperweaponIcon(ctx, key);
    }
    ctx.strokeStyle = '#3a3f66';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, 55, 41);
    return c;
  }
}

export function buildSpriteAtlas(data: GameData, overrides: SpriteOverrides | null = null): SpriteAtlas {
  const atlas = new Atlas(data, overrides);
  // Warm the caches that gate first paint (terrain + icons are demanded in bulk).
  for (const t of [Terrain.GRASS, Terrain.DIRT, Terrain.SAND, Terrain.WATER, Terrain.ROCK, Terrain.TREE, Terrain.CRYSTAL]) {
    for (let v = 0; v < 3; v++) atlas.getTerrainTile(t, v);
  }
  return atlas;
}

// =============================================================================
// Creature painter
// =============================================================================

function drawCreature(ctx: Ctx, cfg: CreatureCfg, dir: number, frame: number, playerHex: string, key: string): void {
  const rnd = mulberry32(hashSeed(key));
  void rnd;
  const feetY = 52;
  const size = cfg.size;
  const bob = frame === 1 ? 1.6 : 0;
  const cx = 32;
  // dir: 2=S 3=SW 4=W 5=NW 6=N
  const profile = dir === 4;
  const back = dir === 5 || dir === 6;
  const lean = dir === 3 ? -2 : dir === 5 ? -2 : 0;

  if (cfg.sub) return drawSubSprite(ctx, cfg, frame, playerHex);
  if (cfg.boat) drawHull(ctx, cfg, frame, playerHex);
  const baseY = cfg.boat ? feetY - 10 : feetY;

  switch (cfg.arch) {
    case 'prof':
      return drawProf(ctx, cfg, dir, frame, playerHex);
    case 'machine':
      return drawMachine(ctx, cfg, frame, playerHex, key);
    case 'quad':
      return drawQuad(ctx, cfg, dir, frame, playerHex, baseY);
    case 'bird':
      return drawBird(ctx, cfg, dir, frame, playerHex, baseY);
    case 'serpent':
      return drawSerpent(ctx, cfg, dir, frame, playerHex, baseY);
    case 'turtle':
      return drawTurtle(ctx, cfg, dir, frame, playerHex, baseY);
    default: {
      // biped / blob share a body-plan: round body + big head
      const bodyH = size * (cfg.arch === 'blob' ? 0.9 : 0.55);
      const bodyW = size * (cfg.big ? 0.62 : 0.5);
      const headR = size * (cfg.arch === 'blob' ? 0 : 0.30);
      const bodyCy = baseY - bodyH / 2 - bob;

      // legs (biped, hidden for blob)
      if (cfg.arch === 'biped') {
        ctx.fillStyle = shade(cfg.base, -0.25);
        const lo = frame === 1 ? 2.5 : 0;
        ellipse(ctx, cx - bodyW * 0.32 + lean, baseY - 2 + (frame === 1 ? -1 : 0), 4.6, 5.5);
        ellipse(ctx, cx + bodyW * 0.32 + lean + lo * 0.3, baseY - 2 + (frame === 1 ? 1 : 0), 4.6, 5.5);
      }

      // tail behind body
      drawTail(ctx, cfg, cx + (back ? 6 : -bodyW * 0.7) + lean, bodyCy + bodyH * 0.2, frame, back);

      // body
      paintBall(ctx, cx + lean, bodyCy, bodyW, bodyH * 0.62, cfg.base);
      if (cfg.belly && !back) {
        ctx.fillStyle = cfg.belly;
        ellipse(ctx, cx + lean + (profile ? 3 : 0), bodyCy + bodyH * 0.12, bodyW * 0.55, bodyH * 0.4);
      }

      // scythe arms
      if (cfg.scythes) {
        ctx.strokeStyle = shade(cfg.belly ?? '#d8e8b0', -0.1);
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(cx + lean + s * bodyW * 0.55, bodyCy);
          ctx.quadraticCurveTo(cx + lean + s * (bodyW * 0.55 + 7), bodyCy - 9, cx + lean + s * (bodyW * 0.55 + 3), bodyCy - 13);
          ctx.stroke();
        }
        ctx.lineCap = 'butt';
      }

      // head
      if (headR > 0) {
        const headCy = bodyCy - bodyH * 0.62 - headR * 0.55 + (frame === 1 ? -0.7 : 0);
        drawEars(ctx, cfg, cx + lean, headCy, headR, back);
        paintBall(ctx, cx + lean, headCy, headR * 1.15, headR, cfg.base);
        if (cfg.flameHead) drawFlame(ctx, cx + lean, headCy - headR - 3, 9, frame);
        if (cfg.horn) {
          ctx.fillStyle = shade(cfg.base, 0.35);
          tri(ctx, cx + lean, headCy - headR - 6, 4.5, 9);
        }
        if (!back) drawFace(ctx, cfg, cx + lean, headCy, headR, profile);
      } else if (cfg.ears === 'leaf') {
        // oddish-style leaf sprouts on a blob
        ctx.strokeStyle = '#58c850';
        ctx.lineWidth = 2.6;
        for (let i = -2; i <= 2; i++) {
          ctx.beginPath();
          ctx.moveTo(cx + lean + i * 3, bodyCy - bodyH * 0.5);
          ctx.quadraticCurveTo(cx + lean + i * 6, bodyCy - bodyH * 0.5 - 9 - (frame === 1 ? 1 : 0), cx + lean + i * 7, bodyCy - bodyH * 0.5 - 12);
          ctx.stroke();
        }
        if (!back) drawFace(ctx, cfg, cx + lean, bodyCy - 2, bodyW * 0.5, profile);
      } else if (cfg.arch === 'blob' && !back) {
        drawFace(ctx, cfg, cx + lean, bodyCy - 2, bodyW * 0.55, profile);
      }

      if (cfg.bulb) {
        paintBall(ctx, cx + lean - (back ? 0 : 6), bodyCy - bodyH * 0.55, 8, 7, '#3aa088');
        ctx.fillStyle = '#7ad8a8';
        ellipse(ctx, cx + lean - (back ? 0 : 6), bodyCy - bodyH * 0.62, 4, 3.4);
      }
      if (cfg.flower) {
        const fx = cx + lean - (back ? 0 : 8);
        const fy = bodyCy - bodyH * 0.7;
        ctx.fillStyle = '#ff7aa8';
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + (frame === 1 ? 0.2 : 0);
          ellipse(ctx, fx + Math.cos(a) * 6, fy + Math.sin(a) * 4.6, 4, 3);
        }
        ctx.fillStyle = '#ffd83c';
        ellipse(ctx, fx, fy, 3.4, 3);
      }
      if (cfg.sombrero) {
        const hy = bodyCy - bodyH * 0.62 - (headR > 0 ? headR * 1.4 : 4);
        ctx.fillStyle = '#e8c63c';
        ellipse(ctx, cx + lean, hy + 3, 15, 4.6);
        ctx.fillStyle = '#d8a82c';
        ellipse(ctx, cx + lean, hy, 6.5, 5);
      }
      break;
    }
  }
  drawPlayerBand(ctx, cx + lean, baseY - 5, size * 0.32, playerHex);
}

function paintBall(ctx: Ctx, x: number, y: number, rx: number, ry: number, color: string): void {
  const g = ctx.createRadialGradient(x - rx * 0.35, y - ry * 0.45, rx * 0.2, x, y, rx * 1.25);
  g.addColorStop(0, shade(color, 0.35));
  g.addColorStop(0.55, color);
  g.addColorStop(1, shade(color, -0.32));
  ctx.fillStyle = g;
  ellipse(ctx, x, y, rx, ry);
  ctx.strokeStyle = shade(color, -0.55);
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
}

function ellipse(ctx: Ctx, x: number, y: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

function tri(ctx: Ctx, x: number, yTop: number, halfW: number, h: number): void {
  ctx.beginPath();
  ctx.moveTo(x, yTop);
  ctx.lineTo(x - halfW, yTop + h);
  ctx.lineTo(x + halfW, yTop + h);
  ctx.closePath();
  ctx.fill();
}

function drawFace(ctx: Ctx, cfg: CreatureCfg, x: number, y: number, r: number, profile: boolean): void {
  const eyeY = y - r * 0.1;
  const eyes = profile ? [{ ex: x + r * 0.45 }] : [{ ex: x - r * 0.42 }, { ex: x + r * 0.42 }];
  const glow = cfg.accent ?? cfg.belly ?? '#ffd24a';
  ctx.save();
  ctx.shadowColor = glow;
  ctx.shadowBlur = 5;
  for (const { ex } of eyes) {
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, r * 0.33, r * 0.12, profile ? 0.12 : 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff4b8';
    ctx.beginPath();
    ctx.ellipse(ex + r * 0.08, eyeY - r * 0.02, r * 0.12, r * 0.04, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  if (cfg.cheeks && !profile) {
    ctx.fillStyle = cfg.cheeks;
    ellipse(ctx, x - r * 0.78, y + r * 0.28, r * 0.18, r * 0.15);
    ellipse(ctx, x + r * 0.78, y + r * 0.28, r * 0.18, r * 0.15);
  }
  ctx.strokeStyle = shade(cfg.base, -0.65);
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(x - (profile ? 0 : r * 0.24), y + r * 0.38);
  ctx.lineTo(x + (profile ? r * 0.42 : r * 0.24), y + r * 0.34);
  ctx.stroke();
}

function drawEars(ctx: Ctx, cfg: CreatureCfg, x: number, y: number, r: number, back: boolean): void {
  void back;
  if (!cfg.ears || cfg.ears === 'none') return;
  ctx.fillStyle = shade(cfg.base, -0.08);
  if (cfg.ears === 'long') {
    ctx.save();
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(x + s * r * 0.7, y - r * 1.15, r * 0.22, r * 0.75, s * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#1a1626';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(x + s * r * 0.86, y - r * 1.62, r * 0.16, r * 0.26, s * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  } else if (cfg.ears === 'point') {
    for (const s of [-1, 1]) tri(ctx, x + s * r * 0.62, y - r * 1.5, r * 0.3, r * 0.7);
  } else if (cfg.ears === 'round') {
    for (const s of [-1, 1]) ellipse(ctx, x + s * r * 0.75, y - r * 0.85, r * 0.32, r * 0.32);
  } else if (cfg.ears === 'leaf') {
    ctx.fillStyle = '#58c850';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(x + s * r * 0.7, y - r * 0.95, r * 0.2, r * 0.5, s * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawTail(ctx: Ctx, cfg: CreatureCfg, x: number, y: number, frame: number, back: boolean): void {
  if (!cfg.tail || cfg.tail === 'none') return;
  const sway = frame === 1 ? 2 : 0;
  if (cfg.tail === 'flame') {
    ctx.strokeStyle = shade(cfg.base, -0.15);
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.moveTo(x + 4, y + 4);
    ctx.quadraticCurveTo(x - 4, y - 2, x - 6 + sway, y - 10);
    ctx.stroke();
    drawFlame(ctx, x - 6 + sway, y - 13, 7, frame);
  } else if (cfg.tail === 'zap') {
    ctx.strokeStyle = '#e8b820';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + 4, y + 4);
    ctx.lineTo(x - 2 + sway, y - 2);
    ctx.lineTo(x + 2 + sway, y - 7);
    ctx.lineTo(x - 4 + sway, y - 14);
    ctx.stroke();
  } else if (cfg.tail === 'fin' || cfg.tail === 'leaf') {
    ctx.fillStyle = cfg.tail === 'fin' ? shade(cfg.base, 0.2) : '#58c850';
    ctx.beginPath();
    ctx.ellipse(x - 2 + sway, y - 2, 7, 4, -0.6, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.strokeStyle = shade(cfg.base, -0.12);
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.moveTo(x + 3, y + 3);
    ctx.quadraticCurveTo(x - 5, y + 2 - sway, x - 8 + sway, y - 4);
    ctx.stroke();
  }
  void back;
}

function drawFlame(ctx: Ctx, x: number, y: number, size: number, frame: number): void {
  const wob = frame === 1 ? 1.4 : 0;
  const g = ctx.createRadialGradient(x, y, 1, x, y, size);
  g.addColorStop(0, '#fff3a0');
  g.addColorStop(0.5, '#ffb02a');
  g.addColorStop(1, '#ff4a1a');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x, y - size - wob);
  ctx.quadraticCurveTo(x + size * 0.8, y - size * 0.2, x, y + size * 0.55);
  ctx.quadraticCurveTo(x - size * 0.8, y - size * 0.2 - wob, x, y - size - wob);
  ctx.fill();
}

function drawQuad(ctx: Ctx, cfg: CreatureCfg, dir: number, frame: number, playerHex: string, feetY: number): void {
  const cx = 32;
  const size = cfg.size;
  const back = dir === 5 || dir === 6;
  const profile = dir === 4;
  const bob = frame === 1 ? 1.2 : 0;
  const bodyW = size * 0.62;
  const bodyH = size * 0.42;
  const bodyCy = feetY - bodyH * 0.7 - 4 - bob;

  // legs
  ctx.fillStyle = shade(cfg.base, -0.28);
  const stride = frame === 1 ? 3 : 0;
  ellipse(ctx, cx - bodyW * 0.55 + stride, feetY - 2.4, 3.8, 5);
  ellipse(ctx, cx + bodyW * 0.55 - stride, feetY - 2.4, 3.8, 5);
  ellipse(ctx, cx - bodyW * 0.3 - stride, feetY - 1.6, 3.8, 4.4);
  ellipse(ctx, cx + bodyW * 0.3 + stride, feetY - 1.6, 3.8, 4.4);

  drawTail(ctx, cfg, cx - bodyW * 0.85, bodyCy, frame, back);
  paintBall(ctx, cx, bodyCy, bodyW, bodyH, cfg.base);
  if (cfg.belly && !back) {
    ctx.fillStyle = cfg.belly;
    ellipse(ctx, cx, bodyCy + bodyH * 0.35, bodyW * 0.6, bodyH * 0.4);
  }
  if (cfg.accent) {
    // stripes
    ctx.strokeStyle = cfg.accent;
    ctx.lineWidth = 2.4;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(cx + i * 8 - 3, bodyCy - bodyH * 0.8);
      ctx.quadraticCurveTo(cx + i * 8, bodyCy, cx + i * 8 - 2, bodyCy + bodyH * 0.5);
      ctx.stroke();
    }
  }
  // bulb / flower back features
  if (cfg.bulb) {
    paintBall(ctx, cx, bodyCy - bodyH - 4, 8.5, 7.5, '#3aa088');
    ctx.fillStyle = '#7ad8a8';
    tri(ctx, cx, bodyCy - bodyH - 13, 4, 6);
  }
  if (cfg.flower) {
    const fy = bodyCy - bodyH - 7;
    ctx.fillStyle = '#ff7aa8';
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      ellipse(ctx, cx + Math.cos(a) * 8, fy + Math.sin(a) * 5.4, 4.6, 3.4);
    }
    ctx.fillStyle = '#ffd83c';
    ellipse(ctx, cx, fy, 4, 3.4);
  }
  // head at front (screen-left for W, lower-front for S)
  const hx = profile ? cx + bodyW * 0.78 : cx + (back ? -1 : 1) * bodyW * 0.05;
  const hy = back ? bodyCy - bodyH * 0.9 : bodyCy - bodyH * 0.55;
  const hr = size * 0.26;
  drawEars(ctx, cfg, hx, hy, hr, back);
  paintBall(ctx, hx, hy, hr * 1.1, hr, cfg.base);
  if (cfg.horn) {
    ctx.fillStyle = '#e8e4da';
    tri(ctx, hx + (profile ? hr * 0.8 : 0), hy - hr - 5, 3.6, 8);
  }
  if (!back) drawFace(ctx, cfg, hx, hy, hr, profile);
  drawPlayerBand(ctx, cx, feetY - 4, size * 0.34, playerHex);
}

function drawBird(ctx: Ctx, cfg: CreatureCfg, dir: number, frame: number, playerHex: string, feetY: number): void {
  const cx = 32;
  const size = cfg.size;
  const back = dir === 5 || dir === 6;
  const profile = dir === 4;
  const flap = frame === 1 ? -5 : 3;
  const bodyCy = feetY - size * 0.55;
  // wings
  ctx.fillStyle = shade(cfg.base, -0.12);
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + s * size * 0.42, bodyCy + flap * 0.4, size * 0.34, size * 0.16, s * (0.5 + (frame === 1 ? 0.35 : 0)), 0, Math.PI * 2);
    ctx.fill();
  }
  if (cfg.scythes) {
    ctx.strokeStyle = '#d8d8e0';
    ctx.lineWidth = 2.8;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + s * 4, bodyCy + 4);
      ctx.lineTo(cx + s * 11, bodyCy + 12);
      ctx.stroke();
    }
  }
  // body + head
  paintBall(ctx, cx, bodyCy, size * 0.38, size * 0.34, cfg.base);
  if (cfg.belly && !back) {
    ctx.fillStyle = cfg.belly;
    ellipse(ctx, cx, bodyCy + size * 0.12, size * 0.24, size * 0.18);
  }
  const hy = bodyCy - size * 0.34;
  const hr = size * 0.24;
  drawEars(ctx, cfg, cx, hy, hr, back);
  paintBall(ctx, cx, hy, hr * 1.05, hr, cfg.base);
  if (cfg.flameHead) drawFlame(ctx, cx, hy - hr - 3, 8, frame);
  if (!back) {
    drawFace(ctx, cfg, cx, hy, hr, profile);
    // beak
    ctx.fillStyle = cfg.accent ?? '#e8a020';
    tri(ctx, cx + (profile ? hr : 0), hy + hr * 0.5, 3.2, 5);
  }
  drawPlayerBand(ctx, cx, feetY - 2, size * 0.3, playerHex);
}

function drawSerpent(ctx: Ctx, cfg: CreatureCfg, dir: number, frame: number, playerHex: string, feetY: number): void {
  const cx = 32;
  const size = cfg.size;
  const back = dir === 5 || dir === 6;
  const profile = dir === 4;
  const sway = frame === 1 ? 2.4 : 0;
  // coiled body: three descending balls
  paintBall(ctx, cx + 5, feetY - size * 0.16, size * 0.3, size * 0.16, cfg.base);
  paintBall(ctx, cx - 4 + sway * 0.4, feetY - size * 0.34, size * 0.26, size * 0.16, cfg.base);
  // neck + head rearing up
  ctx.strokeStyle = cfg.base;
  ctx.lineWidth = size * 0.22;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - 2, feetY - size * 0.36);
  ctx.quadraticCurveTo(cx + 2 + sway, feetY - size * 0.66, cx + sway, feetY - size * 0.82);
  ctx.stroke();
  ctx.lineCap = 'butt';
  if (cfg.belly && !back) {
    ctx.fillStyle = cfg.belly;
    ellipse(ctx, cx + 4, feetY - size * 0.14, size * 0.2, size * 0.09);
  }
  const hr = size * 0.2;
  const hy = feetY - size * 0.86;
  paintBall(ctx, cx + sway, hy, hr * 1.15, hr, cfg.base);
  if (cfg.accent) {
    ctx.fillStyle = cfg.accent;
    ellipse(ctx, cx + sway, hy - hr * 0.7, hr * 0.5, hr * 0.3);
  }
  // fins
  ctx.fillStyle = shade(cfg.base, 0.25);
  for (const s of [-1, 1]) tri(ctx, cx + sway + s * hr * 0.9, hy - hr * 0.9, hr * 0.3, hr * 0.8);
  if (!back) drawFace(ctx, cfg, cx + sway, hy, hr, profile);
  drawPlayerBand(ctx, cx, feetY - 3, size * 0.3, playerHex);
}

function drawTurtle(ctx: Ctx, cfg: CreatureCfg, dir: number, frame: number, playerHex: string, feetY: number): void {
  const cx = 32;
  const size = cfg.size;
  const back = dir === 5 || dir === 6;
  const profile = dir === 4;
  const bob = frame === 1 ? 1 : 0;
  const shellW = size * 0.58;
  const shellH = size * 0.4;
  const shellCy = feetY - shellH * 0.75 - 3 - bob;
  // feet
  ctx.fillStyle = shade(cfg.base, -0.2);
  const stride = frame === 1 ? 2.5 : 0;
  ellipse(ctx, cx - shellW * 0.6 + stride, feetY - 2, 4, 4.6);
  ellipse(ctx, cx + shellW * 0.6 - stride, feetY - 2, 4, 4.6);
  // shell
  paintBall(ctx, cx, shellCy, shellW, shellH, shade(cfg.base, -0.1));
  ctx.strokeStyle = shade(cfg.base, -0.45);
  ctx.lineWidth = 1.4;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(cx + i * shellW * 0.45, shellCy - shellH * 0.7);
    ctx.lineTo(cx + i * shellW * 0.5, shellCy + shellH * 0.6);
    ctx.stroke();
  }
  // belly rim
  ctx.fillStyle = cfg.belly ?? '#e8d8a8';
  ellipse(ctx, cx, shellCy + shellH * 0.55, shellW * 0.85, shellH * 0.32);
  // harvester hopper / coal pile (accent) on back
  if (cfg.accent) {
    const g = ctx.createRadialGradient(cx, shellCy - shellH * 0.7, 1, cx, shellCy - shellH * 0.7, 9);
    g.addColorStop(0, shade(cfg.accent, 0.3));
    g.addColorStop(1, cfg.accent);
    ctx.fillStyle = g;
    ellipse(ctx, cx, shellCy - shellH * 0.75, 8.5, 6);
  }
  if (cfg.shellCannons) {
    ctx.fillStyle = '#6a727f';
    for (const s of [-1, 1]) {
      ctx.save();
      ctx.translate(cx + s * shellW * 0.5, shellCy - shellH * 0.85);
      ctx.rotate(s * -0.5);
      ctx.fillRect(-2.2, -10, 4.4, 11);
      ctx.restore();
    }
  }
  // head
  const hx = profile ? cx + shellW * 0.85 : cx;
  const hy = back ? shellCy - shellH : shellCy - shellH * 0.55;
  const hr = size * 0.2;
  paintBall(ctx, hx, hy, hr * 1.05, hr, cfg.base);
  if (!back) drawFace(ctx, cfg, hx, hy, hr, profile);
  drawPlayerBand(ctx, cx, feetY - 3, size * 0.32, playerHex);
}

function drawProf(ctx: Ctx, cfg: CreatureCfg, dir: number, frame: number, playerHex: string): void {
  const cx = 32;
  const feetY = 52;
  const back = dir === 5 || dir === 6;
  const profile = dir === 4;
  const bob = frame === 1 ? 1.2 : 0;
  // legs
  ctx.fillStyle = '#2a2438';
  const lo = frame === 1 ? 2.4 : 0;
  ctx.fillRect(cx - 4.6, feetY - 9 + (frame === 1 ? -1 : 0), 3.4, 8);
  ctx.fillRect(cx + 1.2 + lo * 0.3, feetY - 9 + (frame === 1 ? 1 : 0), 3.4, 8);
  // lab coat body
  const g = ctx.createLinearGradient(cx, feetY - 26, cx, feetY - 6);
  g.addColorStop(0, '#f2f3f7');
  g.addColorStop(1, '#c9ccd8');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(cx - 7, feetY - 24 - bob);
  ctx.lineTo(cx + 7, feetY - 24 - bob);
  ctx.lineTo(cx + 9, feetY - 7);
  ctx.lineTo(cx - 9, feetY - 7);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#8a8da0';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  // colored shirt stripe
  if (!back) {
    ctx.fillStyle = cfg.base;
    ctx.fillRect(cx - 2, feetY - 23 - bob, 4, 14);
  }
  // head + hat
  const hy = feetY - 30 - bob;
  paintBall(ctx, cx, hy, 7.2, 6.6, '#f0c8a0');
  if (!back) drawFace(ctx, { ...cfg, cheeks: undefined }, cx, hy, 6, profile);
  ctx.fillStyle = cfg.base;
  ellipse(ctx, cx, hy - 5.4, 8.4, 2.6); // brim
  ctx.fillStyle = shade(cfg.base, -0.15);
  ellipse(ctx, cx, hy - 7.4, 5, 3.4); // crown
  // goggles accent
  if (cfg.accent && !back) {
    ctx.strokeStyle = cfg.accent;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(cx - 2.6, hy - 3.2, 2, 0, Math.PI * 2);
    ctx.arc(cx + 2.6, hy - 3.2, 2, 0, Math.PI * 2);
    ctx.stroke();
  }
  // toolbox
  ctx.fillStyle = playerHex;
  ctx.fillRect(cx + 8, feetY - 12, 6.5, 5);
  ctx.strokeStyle = '#1a1626';
  ctx.lineWidth = 1;
  ctx.strokeRect(cx + 8, feetY - 12, 6.5, 5);
}

function drawMachine(ctx: Ctx, cfg: CreatureCfg, frame: number, playerHex: string, key: string): void {
  const cx = 32;
  const feetY = 50;
  const hover = frame === 1 ? 2 : 0;
  if (cfg.magnets) {
    // three orbiting horseshoe magnets around a core
    const cy = feetY - 18 - hover;
    paintBall(ctx, cx, cy, 8, 8, cfg.base);
    ctx.fillStyle = '#1a1626';
    ellipse(ctx, cx, cy, 3.4, 3.4);
    ctx.fillStyle = '#ff4040';
    ellipse(ctx, cx - 1.2, cy - 1.2, 1.4, 1.4);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + (frame === 1 ? 0.4 : 0);
      const mx = cx + Math.cos(a) * 14;
      const my = cy + Math.sin(a) * 9;
      ctx.strokeStyle = cfg.accent ?? '#3858f0';
      ctx.lineWidth = 3.4;
      ctx.beginPath();
      ctx.arc(mx, my, 4.6, a + 0.6, a + Math.PI - 0.6);
      ctx.stroke();
      ctx.strokeStyle = '#e84040';
      ctx.beginPath();
      ctx.arc(mx, my, 4.6, a - Math.PI + 0.6, a - 0.6);
      ctx.stroke();
    }
  } else if (key === 'tide_starmiez') {
    const cy = feetY - 16 - hover;
    ctx.fillStyle = cfg.base;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2 + (frame === 1 ? 0.15 : 0);
      const r = i % 2 === 0 ? 15 : 6.5;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r * 0.8;
      if (i === 0) ctx.beginPath(), ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = shade(cfg.base, -0.4);
    ctx.lineWidth = 1.4;
    ctx.stroke();
    const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, 6);
    g.addColorStop(0, '#ffd0d8');
    g.addColorStop(1, cfg.accent ?? '#ff4060');
    ctx.fillStyle = g;
    ellipse(ctx, cx, cy, 5, 5);
  } else {
    // krabber: crab hauler with basket
    const cy = feetY - 12;
    ctx.fillStyle = shade(cfg.base, -0.25);
    for (const s of [-1, 1]) {
      ellipse(ctx, cx + s * 12, cy + 4 + (frame === 1 ? s : -s), 4, 5.5); // legs
      // big claw
      ctx.beginPath();
      ctx.ellipse(cx + s * 16, cy - 4, 5.5, 4, s * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
    paintBall(ctx, cx, cy - 2, 13, 9, cfg.base);
    drawFace(ctx, { ...cfg, cheeks: undefined }, cx, cy - 4, 7, false);
    // cargo basket on top
    ctx.fillStyle = cfg.accent ?? '#f8d8a8';
    ctx.fillRect(cx - 8, cy - 16, 16, 6);
    ctx.strokeStyle = '#6a5a3a';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(cx - 8, cy - 16, 16, 6);
    ctx.fillStyle = '#ff9af0';
    ellipse(ctx, cx - 3, cy - 16, 2.6, 2.4);
    ellipse(ctx, cx + 3.4, cy - 16.6, 2.2, 2);
  }
  drawPlayerBand(ctx, cx, feetY - 2, 11, playerHex);
}

function drawHull(ctx: Ctx, cfg: CreatureCfg, frame: number, playerHex: string): void {
  const cx = 32;
  const y = 50 + (frame === 1 ? 0.8 : 0);
  const w = cfg.big ? 24 : 19;
  const g = ctx.createLinearGradient(cx, y - 8, cx, y + 4);
  g.addColorStop(0, '#8a93a6');
  g.addColorStop(1, '#525a6c');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(cx - w, y - 5);
  ctx.quadraticCurveTo(cx, y + 7, cx + w, y - 5);
  ctx.lineTo(cx + w - 4, y + 1 - 5);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(cx - w, y - 7, w * 2, 3.4);
  ctx.fillStyle = playerHex;
  ctx.fillRect(cx - w + 2, y - 7.8, 6, 2);
  // wake
  ctx.strokeStyle = 'rgba(220,245,255,0.55)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(cx - w - 4, y + 1);
  ctx.quadraticCurveTo(cx, y + 5.6, cx + w + 4, y + 1);
  ctx.stroke();
}

function drawSubSprite(ctx: Ctx, cfg: CreatureCfg, frame: number, playerHex: string): void {
  const cx = 32;
  const y = 44 + (frame === 1 ? 1 : 0);
  const g = ctx.createLinearGradient(cx, y - 9, cx, y + 9);
  g.addColorStop(0, shade(cfg.base, 0.25));
  g.addColorStop(0.55, cfg.base);
  g.addColorStop(1, shade(cfg.base, -0.4));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(cx, y, 19, 7.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = shade(cfg.base, -0.55);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // tail fin + conning tower / periscope
  ctx.fillStyle = shade(cfg.base, -0.2);
  tri(ctx, cx - 19, y - 8, 4, 9);
  ctx.fillRect(cx + 2, y - 13, 7, 6);
  ctx.fillRect(cx + 7.4, y - 17, 1.8, 5);
  // eye porthole (creature inside!)
  ctx.fillStyle = '#bfe9ff';
  ellipse(ctx, cx + 8, y - 1, 3.4, 3.4);
  ctx.fillStyle = '#1a1626';
  ellipse(ctx, cx + 9, y - 1, 1.6, 1.8);
  drawPlayerBand(ctx, cx - 8, y - 1, 6, playerHex);
  // bubbles
  ctx.fillStyle = 'rgba(220,245,255,0.5)';
  ellipse(ctx, cx - 23, y - 4 - (frame === 1 ? 2 : 0), 1.6, 1.6);
  ellipse(ctx, cx - 26, y - 8, 1.1, 1.1);
}

function drawPlayerBand(ctx: Ctx, x: number, y: number, halfW: number, hex: string): void {
  ctx.fillStyle = hex;
  ctx.globalAlpha = 0.95;
  ctx.fillRect(x - halfW, y + 2.2, halfW * 2, 2.6);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 0.8;
  ctx.strokeRect(x - halfW, y + 2.2, halfW * 2, 2.6);
}

// =============================================================================
// Building painter
// =============================================================================

interface IsoPts {
  bv: { x: number; y: number };
  A: { x: number; y: number }; // top vertex
  B: { x: number; y: number }; // right vertex
  D: { x: number; y: number }; // left vertex
}

function isoPts(fw: number, fh: number, bvx: number, bvy: number): IsoPts {
  return {
    bv: { x: bvx, y: bvy },
    A: { x: bvx + (fh - fw) * TILE_HALF_W, y: bvy - (fw + fh) * TILE_HALF_H },
    B: { x: bvx + fh * TILE_HALF_W, y: bvy - fh * TILE_HALF_H },
    D: { x: bvx - fw * TILE_HALF_W, y: bvy - fw * TILE_HALF_H },
  };
}

/** Draw an iso box of full footprint size with the given wall height. */
function isoBox(ctx: Ctx, p: IsoPts, h: number, theme: Theme, inset = 0): void {
  const A = { x: p.A.x, y: p.A.y + inset };
  const B = { x: p.B.x - inset, y: p.B.y };
  const D = { x: p.D.x + inset, y: p.D.y };
  const bv = { x: p.bv.x, y: p.bv.y - inset };
  // left wall (D-bv) darker
  ctx.fillStyle = theme.wallB;
  ctx.beginPath();
  ctx.moveTo(D.x, D.y);
  ctx.lineTo(bv.x, bv.y);
  ctx.lineTo(bv.x, bv.y - h);
  ctx.lineTo(D.x, D.y - h);
  ctx.closePath();
  ctx.fill();
  // right wall (bv-B) lighter
  ctx.fillStyle = shade(theme.wallB, 0.18);
  ctx.beginPath();
  ctx.moveTo(bv.x, bv.y);
  ctx.lineTo(B.x, B.y);
  ctx.lineTo(B.x, B.y - h);
  ctx.lineTo(bv.x, bv.y - h);
  ctx.closePath();
  ctx.fill();
  // top
  const g = ctx.createLinearGradient(D.x, D.y - h, B.x, B.y - h);
  g.addColorStop(0, shade(theme.wallA, 0.12));
  g.addColorStop(1, shade(theme.wallA, -0.12));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(A.x, A.y - h);
  ctx.lineTo(B.x, B.y - h);
  ctx.lineTo(bv.x, bv.y - h);
  ctx.lineTo(D.x, D.y - h);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = theme.trim;
  ctx.lineWidth = 1.2;
  ctx.stroke();
}

function basePlate(ctx: Ctx, p: IsoPts, theme: Theme): void {
  ctx.fillStyle = shade(theme.wallB, -0.25);
  ctx.beginPath();
  ctx.moveTo(p.A.x, p.A.y);
  ctx.lineTo(p.B.x, p.B.y);
  ctx.lineTo(p.bv.x, p.bv.y);
  ctx.lineTo(p.D.x, p.D.y);
  ctx.closePath();
  ctx.fill();
}

function glowOrb(ctx: Ctx, x: number, y: number, r: number, color: string): void {
  const g = ctx.createRadialGradient(x, y, 0.5, x, y, r);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.35, color);
  g.addColorStop(1, 'transparent');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function banner(ctx: Ctx, x: number, y: number, hex: string): void {
  ctx.strokeStyle = '#3a3326';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - 18);
  ctx.stroke();
  ctx.fillStyle = hex;
  ctx.beginPath();
  ctx.moveTo(x, y - 18);
  ctx.lineTo(x + 11, y - 15);
  ctx.lineTo(x, y - 12);
  ctx.closePath();
  ctx.fill();
}

function drawBuilding(
  ctx: Ctx,
  kind: string,
  theme: Theme,
  fw: number,
  fh: number,
  bvx: number,
  bvy: number,
  playerHex: string,
  key: string,
): void {
  const rnd = mulberry32(hashSeed(key));
  const p = isoPts(fw, fh, bvx, bvy);
  const cx = (p.A.x + p.bv.x) / 2;
  const topY = (h: number) => (p.A.y + p.bv.y) / 2 - h; // y of roof center for wall height h
  basePlate(ctx, p, theme);

  switch (kind) {
    case 'conyard': {
      isoBox(ctx, p, 34, theme, 4);
      // command tower
      const t = isoPts(1.4, 1.4, bvx - 6, bvy - 26);
      isoBox(ctx, t, 26, theme);
      glowOrb(ctx, t.A.x + 18, t.A.y - 26, 5, theme.glow);
      // crane arm
      ctx.strokeStyle = shade(theme.wallA, 0.3);
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(cx + 14, topY(34) + 4);
      ctx.lineTo(cx + 30, topY(34) - 16);
      ctx.lineTo(cx + 36, topY(34) - 8);
      ctx.stroke();
      banner(ctx, p.B.x - 6, p.B.y - 4, playerHex);
      break;
    }
    case 'power': {
      isoBox(ctx, p, 22, theme, 3);
      // twin reactor coils
      for (const off of [-10, 8]) {
        const x = cx + off;
        const y = topY(22) - 2;
        ctx.fillStyle = shade(theme.wallA, -0.05);
        ctx.beginPath();
        ctx.ellipse(x, y - 7, 7, 12, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = theme.glow;
        ctx.lineWidth = 1.8;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.ellipse(x, y - 3 - i * 5, 7.5, 2.6, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        glowOrb(ctx, x, y - 17, 4.5, theme.glow);
      }
      banner(ctx, p.D.x + 8, p.D.y - 2, playerHex);
      break;
    }
    case 'refinery': {
      isoBox(ctx, p, 26, theme, 3);
      // candy silo
      const sx = cx - 12;
      ctx.fillStyle = shade(theme.wallA, 0.06);
      ctx.beginPath();
      ctx.ellipse(sx, topY(26) - 12, 9, 16, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = theme.trim;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      // candy pile
      for (let i = 0; i < 7; i++) {
        const gx = cx + 8 + rnd() * 14 - 7;
        const gy = topY(26) + 6 + rnd() * 6;
        ctx.fillStyle = i % 2 ? '#ff9af0' : '#7ae8ff';
        ctx.beginPath();
        ctx.moveTo(gx, gy - 5);
        ctx.lineTo(gx + 3.4, gy);
        ctx.lineTo(gx, gy + 2.6);
        ctx.lineTo(gx - 3.4, gy);
        ctx.closePath();
        ctx.fill();
      }
      glowOrb(ctx, sx, topY(26) - 26, 4, '#ff9af0');
      banner(ctx, p.B.x - 8, p.B.y - 3, playerHex);
      break;
    }
    case 'barracks': {
      isoBox(ctx, p, 18, theme, 3);
      // nest dome + eggs
      ctx.fillStyle = shade(theme.roof, 0.08);
      ctx.beginPath();
      ctx.ellipse(cx, topY(18) - 4, 16, 9, 0, Math.PI, 0);
      ctx.fill();
      ctx.strokeStyle = theme.trim;
      ctx.stroke();
      for (const [ex, ey, er] of [[-7, 4, 3.4], [0, 6, 3.8], [7, 4, 3.2]] as const) {
        ctx.fillStyle = '#f4ead2';
        ctx.beginPath();
        ctx.ellipse(cx + ex, topY(18) + ey, er, er * 1.25, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#c9b88a';
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
      banner(ctx, p.D.x + 7, p.D.y - 2, playerHex);
      break;
    }
    case 'factory': {
      isoBox(ctx, p, 30, theme, 3);
      // big garage door on the right wall
      ctx.fillStyle = shade(theme.wallB, 0.35);
      ctx.beginPath();
      ctx.moveTo(p.bv.x + 4, p.bv.y - 4);
      ctx.lineTo(p.B.x - 5, p.B.y - 1);
      ctx.lineTo(p.B.x - 5, p.B.y - 19);
      ctx.lineTo(p.bv.x + 4, p.bv.y - 23);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = theme.trim;
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(p.bv.x + 4, p.bv.y - 4 - i * 4.6);
        ctx.lineTo(p.B.x - 5, p.B.y - 1 - i * 4.4);
        ctx.stroke();
      }
      // rooftop crane + vent
      ctx.strokeStyle = shade(theme.wallA, 0.35);
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(cx - 14, topY(30) + 2);
      ctx.lineTo(cx - 14, topY(30) - 14);
      ctx.lineTo(cx + 10, topY(30) - 20);
      ctx.stroke();
      glowOrb(ctx, cx + 10, topY(30) - 20, 3.4, theme.glow);
      banner(ctx, p.D.x + 8, p.D.y - 3, playerHex);
      break;
    }
    case 'radar': {
      isoBox(ctx, p, 20, theme, 4);
      // mast + dish
      ctx.strokeStyle = shade(theme.wallA, 0.2);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx, topY(20) + 2);
      ctx.lineTo(cx, topY(20) - 14);
      ctx.stroke();
      ctx.fillStyle = shade(theme.wallA, 0.28);
      ctx.beginPath();
      ctx.ellipse(cx + 4, topY(20) - 18, 11, 7, -0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = theme.trim;
      ctx.lineWidth = 1;
      ctx.stroke();
      glowOrb(ctx, cx + 8, topY(20) - 21, 3, theme.glow);
      banner(ctx, p.D.x + 6, p.D.y - 2, playerHex);
      break;
    }
    case 'airpad': {
      isoBox(ctx, p, 8, theme, 2);
      // landing circle
      ctx.strokeStyle = theme.glow;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.ellipse(cx, topY(8), (fw + fh) * TILE_HALF_W * 0.32, (fw + fh) * TILE_HALF_H * 0.32, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(cx, topY(8), 4, 2.2, 0, 0, Math.PI * 2);
      ctx.stroke();
      // windsock
      ctx.strokeStyle = '#8a8da0';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(p.A.x + 6, p.A.y + 4);
      ctx.lineTo(p.A.x + 6, p.A.y - 12);
      ctx.stroke();
      ctx.fillStyle = '#ff8a3c';
      ctx.beginPath();
      ctx.moveTo(p.A.x + 6, p.A.y - 12);
      ctx.lineTo(p.A.x + 16, p.A.y - 10);
      ctx.lineTo(p.A.x + 6, p.A.y - 8);
      ctx.closePath();
      ctx.fill();
      banner(ctx, p.B.x - 6, p.B.y - 2, playerHex);
      break;
    }
    case 'navalyard': {
      // dry dock frame over water
      ctx.fillStyle = 'rgba(40,90,140,0.5)';
      ctx.beginPath();
      ctx.moveTo(p.A.x, p.A.y);
      ctx.lineTo(p.B.x, p.B.y);
      ctx.lineTo(p.bv.x, p.bv.y);
      ctx.lineTo(p.D.x, p.D.y);
      ctx.closePath();
      ctx.fill();
      // two pier arms
      for (const side of [0, 1]) {
        const sub = isoPts(fw, 0.5, bvx - side * 0 + (side ? 0 : 0), bvy - side * (fh - 0.5) * TILE_HALF_H * 2);
        void sub;
      }
      isoBox(ctx, isoPts(fw, 0.6, bvx + (fh - 0.6) * TILE_HALF_W, bvy - (fh - 0.6) * TILE_HALF_H), 12, theme);
      isoBox(ctx, isoPts(0.6, fh, bvx - (fw - 0.6) * TILE_HALF_W, bvy - (fw - 0.6) * TILE_HALF_H), 12, theme);
      // gantry arch
      ctx.strokeStyle = shade(theme.wallA, 0.2);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(p.D.x + 8, p.D.y - 14);
      ctx.quadraticCurveTo(cx, topY(40) - 6, p.B.x - 8, p.B.y - 14);
      ctx.stroke();
      glowOrb(ctx, cx, topY(40) + 2, 4, theme.glow);
      banner(ctx, p.bv.x, p.bv.y - 4, playerHex);
      break;
    }
    case 'techlab': {
      isoBox(ctx, p, 16, theme, 3);
      // glowing dome
      const dg = ctx.createRadialGradient(cx - 3, topY(16) - 8, 2, cx, topY(16) - 4, 14);
      dg.addColorStop(0, shade(theme.glow, 0.55));
      dg.addColorStop(1, shade(theme.glow, -0.35));
      ctx.fillStyle = dg;
      ctx.beginPath();
      ctx.ellipse(cx, topY(16) - 4, 13, 10, 0, Math.PI, 0);
      ctx.fill();
      ctx.globalAlpha = 0.85;
      glowOrb(ctx, cx, topY(16) - 12, 5, theme.glow);
      ctx.globalAlpha = 1;
      // antennae
      ctx.strokeStyle = '#aab0c4';
      ctx.lineWidth = 1.4;
      for (const off of [-10, 10]) {
        ctx.beginPath();
        ctx.moveTo(cx + off, topY(16) - 2);
        ctx.lineTo(cx + off * 1.3, topY(16) - 16);
        ctx.stroke();
        glowOrb(ctx, cx + off * 1.3, topY(16) - 16, 2.2, theme.glow);
      }
      banner(ctx, p.D.x + 7, p.D.y - 2, playerHex);
      break;
    }
    case 'repair': {
      isoBox(ctx, p, 16, theme, 3);
      // pink Care Center roof
      ctx.fillStyle = '#ff7aa8';
      ctx.beginPath();
      ctx.moveTo(p.A.x, p.A.y - 16 - 10);
      ctx.lineTo(p.B.x - 6, p.B.y - 16 - 2);
      ctx.lineTo(p.bv.x, p.bv.y - 16 + 4);
      ctx.lineTo(p.D.x + 6, p.D.y - 16 - 2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#c84a78';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      // white cross sign
      ctx.fillStyle = '#ffffff';
      const sy = topY(16) - 14;
      ctx.fillRect(cx - 2.2, sy - 7, 4.4, 14);
      ctx.fillRect(cx - 7, sy - 2.2, 14, 4.4);
      ctx.strokeStyle = '#c84a78';
      ctx.lineWidth = 1;
      ctx.strokeRect(cx - 2.2, sy - 7, 4.4, 14);
      banner(ctx, p.B.x - 7, p.B.y - 3, playerHex);
      break;
    }
    case 'wall': {
      isoBox(ctx, p, 16, theme, 1);
      ctx.fillStyle = shade(theme.wallA, 0.18);
      ellipse(ctx, cx, topY(16), 5, 2.6);
      break;
    }
    case 'def_basic': {
      isoBox(ctx, p, 8, theme, 1);
      // rotating barrel turret
      paintBall(ctx, cx, topY(8) - 4, 8, 6, shade(theme.wallA, 0.05));
      ctx.fillStyle = shade(theme.wallB, 0.25);
      ctx.save();
      ctx.translate(cx, topY(8) - 6);
      ctx.rotate(-0.35);
      ctx.fillRect(0, -2, 16, 4);
      ctx.restore();
      glowOrb(ctx, cx + 15, topY(8) - 11, 2.4, theme.glow);
      break;
    }
    case 'def_adv': {
      isoBox(ctx, p, 10, theme, 1);
      // elemental emitter pylon
      ctx.fillStyle = shade(theme.wallB, 0.15);
      tri(ctx, cx, topY(10) - 22, 7, 22);
      glowOrb(ctx, cx, topY(10) - 24, 7, theme.glow);
      ctx.strokeStyle = theme.glow;
      ctx.lineWidth = 1.4;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.ellipse(cx, topY(10) - 12, 8, 3.4, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    }
    case 'def_aa': {
      isoBox(ctx, p, 8, theme, 1);
      // skyward launcher rack
      ctx.fillStyle = shade(theme.wallB, 0.3);
      ctx.save();
      ctx.translate(cx, topY(8) - 4);
      ctx.rotate(-0.9);
      for (const off of [-4, 0.5, 5]) ctx.fillRect(off, -16, 3.4, 18);
      ctx.restore();
      for (const off of [-7, -2, 3]) glowOrb(ctx, cx + off, topY(8) - 17 + off * 0.5, 2, theme.glow);
      break;
    }
    case 'sw': {
      isoBox(ctx, p, 18, theme, 3);
      if (key.startsWith('scorch')) {
        // volcano caldera
        ctx.fillStyle = shade(theme.wallB, -0.1);
        ctx.beginPath();
        ctx.moveTo(cx - 22, topY(18) + 4);
        ctx.quadraticCurveTo(cx - 8, topY(18) - 26, cx, topY(18) - 28);
        ctx.quadraticCurveTo(cx + 8, topY(18) - 26, cx + 22, topY(18) + 4);
        ctx.closePath();
        ctx.fill();
        const lg = ctx.createRadialGradient(cx, topY(18) - 26, 1, cx, topY(18) - 24, 12);
        lg.addColorStop(0, '#fff3a0');
        lg.addColorStop(0.5, '#ff7a2a');
        lg.addColorStop(1, '#a02810');
        ctx.fillStyle = lg;
        ctx.beginPath();
        ctx.ellipse(cx, topY(18) - 26, 9, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        // lava seams
        ctx.strokeStyle = '#ff5a2a';
        ctx.lineWidth = 1.6;
        for (const off of [-10, 2, 12]) {
          ctx.beginPath();
          ctx.moveTo(cx + off * 0.6, topY(18) - 22);
          ctx.lineTo(cx + off, topY(18) + 2);
          ctx.stroke();
        }
      } else if (key.startsWith('tide')) {
        // tiered water temple with floating orb
        isoBox(ctx, isoPts(fw * 0.62, fh * 0.62, bvx, bvy - 20), 14, theme);
        isoBox(ctx, isoPts(fw * 0.34, fh * 0.34, bvx, bvy - 38), 10, theme);
        glowOrb(ctx, cx, topY(18) - 46, 8, theme.glow);
        ctx.strokeStyle = theme.glow;
        ctx.globalAlpha = 0.6;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.ellipse(cx, topY(18) - 46, 12, 4.6, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else {
        // the Great Tree
        ctx.strokeStyle = '#6b4a2e';
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.moveTo(cx, topY(18) + 6);
        ctx.quadraticCurveTo(cx - 3, topY(18) - 14, cx + 2, topY(18) - 26);
        ctx.stroke();
        for (const [ox, oy, r] of [[-12, -24, 11], [10, -28, 12], [0, -38, 13], [-2, -20, 9]] as const) {
          const lg2 = ctx.createRadialGradient(cx + ox - 3, topY(18) + oy - 3, 1, cx + ox, topY(18) + oy, r);
          lg2.addColorStop(0, '#7aea8a');
          lg2.addColorStop(1, '#2e7a3a');
          ctx.fillStyle = lg2;
          ellipse(ctx, cx + ox, topY(18) + oy, r, r * 0.8);
        }
        glowOrb(ctx, cx, topY(18) - 30, 6, theme.glow);
      }
      banner(ctx, p.bv.x, p.bv.y - 3, playerHex);
      break;
    }
    default: {
      isoBox(ctx, p, 20, theme, 3);
      banner(ctx, p.bv.x, p.bv.y - 3, playerHex);
    }
  }
}

function drawConstructionSite(ctx: Ctx, theme: Theme, fw: number, fh: number, bvx: number, bvy: number, key: string): void {
  const rnd = mulberry32(hashSeed(key + 'c'));
  const p = isoPts(fw, fh, bvx, bvy);
  basePlate(ctx, p, theme);
  // corner scaffold posts
  ctx.strokeStyle = '#8a7a4a';
  ctx.lineWidth = 2.2;
  for (const pt of [p.A, p.B, p.D, p.bv]) {
    ctx.beginPath();
    ctx.moveTo(pt.x, pt.y);
    ctx.lineTo(pt.x, pt.y - 22);
    ctx.stroke();
  }
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(p.A.x, p.A.y - 22);
  ctx.lineTo(p.B.x, p.B.y - 22);
  ctx.lineTo(p.bv.x, p.bv.y - 22);
  ctx.lineTo(p.D.x, p.D.y - 22);
  ctx.closePath();
  ctx.stroke();
  // the giant egg
  const cx = (p.A.x + p.bv.x) / 2;
  const cy = (p.A.y + p.bv.y) / 2;
  const eg = ctx.createRadialGradient(cx - 4, cy - 14, 2, cx, cy - 8, 16);
  eg.addColorStop(0, '#fdf6e3');
  eg.addColorStop(1, '#cdbf96');
  ctx.fillStyle = eg;
  ctx.beginPath();
  ctx.ellipse(cx, cy - 8, 12, 15, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#a89868';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  // crack
  ctx.strokeStyle = '#8a7a4a';
  ctx.beginPath();
  ctx.moveTo(cx - 5, cy - 14);
  ctx.lineTo(cx - 1, cy - 10);
  ctx.lineTo(cx - 4, cy - 6);
  ctx.stroke();
  // spots
  ctx.fillStyle = 'rgba(160,140,90,0.5)';
  for (let i = 0; i < 4; i++) ellipse(ctx, cx - 8 + rnd() * 16, cy - 16 + rnd() * 16, 1.8, 1.4);
}

// =============================================================================
// Terrain painter
// =============================================================================

function drawTerrain(t: Terrain, variant: number): HTMLCanvasElement {
  const tall = t === Terrain.TREE || t === Terrain.ROCK;
  const H = tall ? 64 : TILE_H;
  const [c, ctx] = canvas(TILE_W, H);
  const rnd = mulberry32(hashSeed(`t${t}v${variant}`));
  const baseY = H - TILE_H; // diamond occupies the bottom TILE_H of the canvas

  const diamond = () => {
    ctx.beginPath();
    ctx.moveTo(TILE_W / 2, baseY);
    ctx.lineTo(TILE_W, baseY + TILE_HALF_H);
    ctx.lineTo(TILE_W / 2, baseY + TILE_H);
    ctx.lineTo(0, baseY + TILE_HALF_H);
    ctx.closePath();
  };

  const fillBase = (a: string, b: string) => {
    // Seal antialiased diamond edges before the visible paint pass. Without
    // this tiny overscan, neighbouring transparent tile edges can expose the
    // black terrain cache and read as cracks in the battlefield.
    ctx.fillStyle = b;
    ctx.beginPath();
    ctx.moveTo(TILE_W / 2, baseY - 1.25);
    ctx.lineTo(TILE_W + 2, baseY + TILE_HALF_H);
    ctx.lineTo(TILE_W / 2, baseY + TILE_H + 1.25);
    ctx.lineTo(-2, baseY + TILE_HALF_H);
    ctx.closePath();
    ctx.fill();

    const g = ctx.createLinearGradient(0, baseY, TILE_W, baseY + TILE_H);
    g.addColorStop(0, a);
    g.addColorStop(1, b);
    ctx.fillStyle = g;
    diamond();
    ctx.fill();
  };

  const speckle = (colors: string[], n: number) => {
    ctx.save();
    diamond();
    ctx.clip();
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = colors[(rnd() * colors.length) | 0];
      const x = rnd() * TILE_W;
      const y = baseY + rnd() * TILE_H;
      ctx.globalAlpha = 0.25 + rnd() * 0.4;
      ctx.fillRect(x, y, 1.6 + rnd() * 2, 1 + rnd() * 1.4);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  };

  const bevel = (left: string, right: string, lip = 'rgba(255,255,255,0.1)') => {
    ctx.save();
    diamond();
    ctx.clip();
    const midY = baseY + TILE_HALF_H;
    const bottomY = baseY + TILE_H;
    const lg = ctx.createLinearGradient(0, midY, TILE_W / 2, bottomY);
    lg.addColorStop(0, left);
    lg.addColorStop(1, 'rgba(0,0,0,0.16)');
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(TILE_W / 2, bottomY);
    ctx.lineTo(TILE_W / 2, bottomY - 2.5);
    ctx.lineTo(4, midY);
    ctx.closePath();
    ctx.fill();

    const rg = ctx.createLinearGradient(TILE_W, midY, TILE_W / 2, bottomY);
    rg.addColorStop(0, right);
    rg.addColorStop(1, 'rgba(0,0,0,0.20)');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.moveTo(TILE_W, midY);
    ctx.lineTo(TILE_W / 2, bottomY);
    ctx.lineTo(TILE_W / 2, bottomY - 2.5);
    ctx.lineTo(TILE_W - 4, midY);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = lip;
    ctx.lineWidth = 0.55;
    ctx.beginPath();
    ctx.moveTo(7, midY);
    ctx.lineTo(TILE_W / 2, baseY + 4);
    ctx.lineTo(TILE_W - 7, midY);
    ctx.stroke();
    ctx.restore();
  };

  switch (t) {
    case Terrain.GRASS: {
      fillBase(shade('#5aa44a', 0.08 + variant * 0.03), shade('#34712b', variant * 0.02));
      speckle(['#7ccf62', '#2f6728', '#9ad879', '#496f35'], 34);
      bevel('rgba(31,75,34,0.18)', 'rgba(20,50,31,0.22)', 'rgba(255,255,255,0.055)');
      break;
    }
    case Terrain.DIRT: {
      fillBase(shade('#92714a', 0.07 + variant * 0.03), '#62482e');
      speckle(['#b08a5c', '#4e3926', '#80623f', '#c59b66'], 30);
      bevel('rgba(72,48,30,0.18)', 'rgba(43,31,24,0.24)', 'rgba(255,228,176,0.055)');
      break;
    }
    case Terrain.SAND: {
      fillBase(shade('#dbc48c', 0.08 + variant * 0.03), '#b9975e');
      speckle(['#f1dcaa', '#a7834f', '#c9ad76'], 24);
      bevel('rgba(128,98,55,0.16)', 'rgba(93,70,45,0.20)', 'rgba(255,238,184,0.075)');
      break;
    }
    case Terrain.WATER: {
      fillBase(shade('#2387b6', 0.11 + variant * 0.04), '#103b64');
      bevel('rgba(24,98,126,0.14)', 'rgba(8,42,73,0.22)', 'rgba(152,229,255,0.09)');
      // wave hints
      ctx.save();
      diamond();
      ctx.clip();
      ctx.strokeStyle = 'rgba(160,235,255,0.44)';
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 5; i++) {
        const y = baseY + 6 + rnd() * (TILE_H - 12);
        const x = 6 + rnd() * (TILE_W - 24);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + 5, y - 2.4, x + 10, y);
        ctx.stroke();
      }
      ctx.restore();
      break;
    }
    case Terrain.CRYSTAL: {
      fillBase('#554437', '#2f2726');
      speckle(['#7b604d', '#2f2424', '#9b755d', '#594236'], 16);
      bevel('rgba(44,31,29,0.3)', 'rgba(21,18,20,0.36)', 'rgba(180,232,255,0.08)');
      ctx.save();
      diamond();
      ctx.clip();
      const stain = ctx.createRadialGradient(TILE_W / 2, baseY + TILE_HALF_H, 4, TILE_W / 2, baseY + TILE_HALF_H, 42);
      stain.addColorStop(0, 'rgba(98, 41, 120, 0.36)');
      stain.addColorStop(0.62, 'rgba(43, 24, 56, 0.2)');
      stain.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = stain;
      ctx.fillRect(0, baseY, TILE_W, TILE_H);
      ctx.restore();
      const n = 4 + variant;
      for (let i = 0; i < n; i++) {
        const gx = 12 + rnd() * (TILE_W - 24);
        const gy = baseY + 8 + rnd() * (TILE_H - 15);
        const r = 5.5 + rnd() * 5;
        const h = r * (1.9 + rnd() * 1.0);
        const pink = rnd() < 0.6;
        const col = pink ? '#d85fff' : '#4fdcff';
        ctx.globalAlpha = 0.38;
        ctx.fillStyle = 'rgba(5, 10, 18, 0.62)';
        ctx.beginPath();
        ctx.ellipse(gx + 2.5, gy + 2, r * 1.25, r * 0.42, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        const g = ctx.createLinearGradient(gx - r, gy - h, gx + r, gy + r);
        g.addColorStop(0, '#f4ffff');
        g.addColorStop(0.35, shade(col, 0.2));
        g.addColorStop(0.78, shade(col, -0.18));
        g.addColorStop(1, '#2e2351');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(gx, gy - h);
        ctx.lineTo(gx + r * 0.78, gy - r * 0.22);
        ctx.lineTo(gx + r * 0.42, gy + r * 0.58);
        ctx.lineTo(gx - r * 0.52, gy + r * 0.5);
        ctx.lineTo(gx - r * 0.88, gy - r * 0.14);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(210, 249, 255, 0.7)';
        ctx.lineWidth = 0.75;
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.28)';
        ctx.beginPath();
        ctx.moveTo(gx, gy - h + 1.8);
        ctx.lineTo(gx + r * 0.28, gy - r * 0.1);
        ctx.lineTo(gx - r * 0.06, gy + r * 0.42);
        ctx.lineTo(gx - r * 0.48, gy - r * 0.1);
        ctx.closePath();
        ctx.fill();
        ctx.shadowColor = col;
        ctx.shadowBlur = 8;
        ctx.globalAlpha = 0.36;
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.beginPath();
        ctx.ellipse(gx - r * 0.22, gy - h * 0.72, r * 0.12, r * 0.34, -0.45, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case Terrain.ROCK: {
      fillBase('#345f34', '#1f4229');
      speckle(['#5c8d4a', '#243f27', '#3e6535'], 12);
      bevel('rgba(18,40,26,0.44)', 'rgba(12,28,23,0.5)', 'rgba(214,236,196,0.05)');
      const n = 4 + variant;
      for (let i = 0; i < n; i++) {
        const bx = 12 + rnd() * (TILE_W - 24);
        const by = baseY + 11 + rnd() * (TILE_H - 17);
        const r = 5.5 + rnd() * 8.5;
        ctx.globalAlpha = 0.32;
        ctx.fillStyle = 'rgba(4, 8, 10, 0.68)';
        ctx.beginPath();
        ctx.ellipse(bx + r * 0.22, by + r * 0.18, r * 1.15, r * 0.42, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        const g = ctx.createRadialGradient(bx - r * 0.45, by - r * 0.9, 1, bx + r * 0.2, by, r * 1.55);
        g.addColorStop(0, '#d3d5ce');
        g.addColorStop(0.35, '#8d948d');
        g.addColorStop(1, '#3a403f');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(bx - r * 1.05, by - r * 0.1);
        ctx.lineTo(bx - r * 0.48, by - r * 1.05);
        ctx.lineTo(bx + r * 0.25, by - r * 1.22);
        ctx.lineTo(bx + r * 1.04, by - r * 0.38);
        ctx.lineTo(bx + r * 0.78, by + r * 0.42);
        ctx.lineTo(bx - r * 0.25, by + r * 0.5);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(20, 24, 26, 0.8)';
        ctx.lineWidth = 0.9;
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.beginPath();
        ctx.moveTo(bx - r * 0.5, by - r * 0.72);
        ctx.lineTo(bx + r * 0.14, by - r * 1.0);
        ctx.lineTo(bx + r * 0.68, by - r * 0.34);
        ctx.stroke();
      }
      break;
    }
    case Terrain.TREE: {
      fillBase('#2f6733', '#1e4728');
      speckle(['#4f8c42', '#1f4a28', '#365f31'], 10);
      bevel('rgba(17,47,25,0.44)', 'rgba(9,28,21,0.52)', 'rgba(198,239,183,0.05)');
      const n = 2 + (variant % 2);
      for (let i = 0; i < n; i++) {
        const tx = 15 + rnd() * (TILE_W - 30);
        const ty = baseY + 16 + rnd() * (TILE_H - 20);
        const height = 32 + rnd() * 12;
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = 'rgba(2, 10, 8, 0.74)';
        ctx.beginPath();
        ctx.ellipse(tx + 5, ty + 1, 13, 4.4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        const trunk = ctx.createLinearGradient(tx - 3, ty - 18, tx + 3, ty);
        trunk.addColorStop(0, '#9b6a42');
        trunk.addColorStop(1, '#3e2a1e');
        ctx.fillStyle = trunk;
        ctx.fillRect(tx - 2.2, ty - 18, 4.4, 19);
        for (let l = 0; l < 3; l++) {
          const r = 13.5 - l * 3.1;
          const ly = ty - 10 - l * (height / 4.2);
          const g = ctx.createLinearGradient(tx - r, ly - r, tx + r, ly + r);
          g.addColorStop(0, '#7fd46a');
          g.addColorStop(0.38, '#2f7a37');
          g.addColorStop(1, '#123f25');
          ctx.fillStyle = g;
          tri(ctx, tx, ly - r * 1.1, r, r * 1.7);
          ctx.strokeStyle = 'rgba(9, 29, 17, 0.52)';
          ctx.lineWidth = 0.6;
          ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(213,255,191,0.18)';
        ctx.beginPath();
        ctx.moveTo(tx - 3, ty - height + 5);
        ctx.lineTo(tx - 9, ty - 12);
        ctx.stroke();
      }
      break;
    }
  }

  // soft edge highlight (NW light)
  ctx.strokeStyle = 'rgba(255,255,255,0.065)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(0, baseY + TILE_HALF_H);
  ctx.lineTo(TILE_W / 2, baseY);
  ctx.lineTo(TILE_W, baseY + TILE_HALF_H);
  ctx.stroke();
  return c;
}

// =============================================================================
// Projectiles + superweapon icons
// =============================================================================

const ELEMENT_COLOR: Record<number, string> = {
  [Element.NEUTRAL]: '#f0f0f4',
  [Element.FIRE]: '#ff8a2a',
  [Element.WATER]: '#3cc8ff',
  [Element.GRASS]: '#7ae84a',
  [Element.ELECTRIC]: '#ffe43c',
};

function drawProjectile(wc: WeaponClass, elem: Element): HTMLCanvasElement {
  const [c, ctx] = canvas(18, 18);
  const col = ELEMENT_COLOR[elem] ?? '#ffffff';
  const cx = 9;
  const cy = 9;
  switch (wc) {
    case WeaponClass.CLAW: {
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      for (const off of [-3.4, 0, 3.4]) {
        ctx.beginPath();
        ctx.arc(cx + off, cy, 6, -0.9, 0.9);
        ctx.stroke();
      }
      break;
    }
    case WeaponClass.CANNON: {
      const g = ctx.createRadialGradient(cx - 1, cy - 1, 0.5, cx, cy, 5);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.5, col);
      g.addColorStop(1, shade(col, -0.4));
      ctx.fillStyle = g;
      ellipse(ctx, cx, cy, 4.4, 4.4);
      break;
    }
    case WeaponClass.BLAST: {
      const g = ctx.createRadialGradient(cx, cy, 0.5, cx, cy, 8);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.35, col);
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ellipse(ctx, cx, cy, 8, 8);
      break;
    }
    default: {
      // PIERCE bolt
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.6;
      ctx.lineCap = 'round';
      ctx.shadowColor = col;
      ctx.shadowBlur = 5;
      ctx.beginPath();
      ctx.moveTo(2, cy + 3);
      ctx.lineTo(16, cy - 3);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }
  return c;
}

function drawSuperweaponIcon(ctx: Ctx, key: string): void {
  if (key === 'magma_strike') {
    const g = ctx.createRadialGradient(28, 24, 2, 28, 24, 18);
    g.addColorStop(0, '#fff3a0');
    g.addColorStop(0.45, '#ff7a2a');
    g.addColorStop(1, '#701808');
    ctx.fillStyle = g;
    ellipse(ctx, 28, 26, 15, 11);
    ctx.fillStyle = '#ffb02a';
    tri(ctx, 28, 4, 4, 16);
  } else if (key === 'tsunami_surge') {
    ctx.strokeStyle = '#3cc8ff';
    ctx.lineWidth = 3.4;
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(20 + i * 8, 30 - i * 4, 11, Math.PI, Math.PI * 1.75);
      ctx.stroke();
    }
    ctx.fillStyle = '#aef';
    ellipse(ctx, 42, 12, 2.4, 2.4);
  } else {
    const g = ctx.createRadialGradient(28, 20, 2, 28, 22, 16);
    g.addColorStop(0, '#c8ffb0');
    g.addColorStop(0.5, '#58c850');
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ellipse(ctx, 28, 21, 15, 12);
    ctx.fillStyle = '#2e7a3a';
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      ellipse(ctx, 28 + Math.cos(a) * 9, 21 + Math.sin(a) * 7, 2.6, 2.6);
    }
  }
}
