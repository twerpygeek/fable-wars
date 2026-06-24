// =============================================================================
// FABLE WARS — Sprite Lab (open the game with ?spritelab).
// Browses every unit/building sprite (with any custom overrides applied) and
// downloads correctly-named, correctly-sized PNG templates for repainting.
// File names match exactly what loadSpriteOverrides() expects under
// public/sprites/. See SPRITES.md for the full authoring guide.
// =============================================================================

import type { GameData } from '../core/types';
import { TILE_HALF_H, TILE_HALF_W } from '../core/constants';
import { buildSpriteAtlas, buildingSpriteBox, type SpriteAtlas, type SpriteOverrides } from './sprites';

const CANONICAL_DIRS: { name: string; facing8: number }[] = [
  { name: 's', facing8: 2 },
  { name: 'sw', facing8: 3 },
  { name: 'w', facing8: 4 },
  { name: 'nw', facing8: 5 },
  { name: 'n', facing8: 6 },
];

function dl(name: string, canvasEl: HTMLCanvasElement): void {
  const a = document.createElement('a');
  a.download = name;
  a.href = canvasEl.toDataURL('image/png');
  a.click();
}

/** Template canvas for a unit: the current sprite + guide box + feet line. */
function unitTemplate(atlas: SpriteAtlas, key: string, facing8: number, frame: number, guides: boolean): HTMLCanvasElement {
  const spr = atlas.getUnitSprite(key, facing8, frame, 0);
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  if (guides) {
    ctx.strokeStyle = 'rgba(80,200,255,0.6)';
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(0.5, 0.5, 63, 63);
    ctx.beginPath();
    ctx.moveTo(0, 52.5); // feet line
    ctx.lineTo(64, 52.5);
    ctx.moveTo(32.5, 0); // center line
    ctx.lineTo(32.5, 64);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.drawImage(spr, 0, 0);
  return c;
}

/** Template for a building: current sprite + footprint diamond + anchor guides. */
function buildingTemplate(atlas: SpriteAtlas, data: GameData, key: string, guides: boolean): HTMLCanvasElement {
  const def = data.buildings[key];
  const fw = def.footprint.w;
  const fh = def.footprint.h;
  const kind = key.slice(key.indexOf('_') + 1);
  const { w: W, h: H } = buildingSpriteBox(fw, fh, kind);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  if (guides) {
    // footprint diamond: bottom vertex at (bvx, H-2)
    const bvx = W / 2 + ((fw - fh) / 2) * TILE_HALF_W;
    const bvy = H - 2;
    const A = { x: bvx + (fh - fw) * TILE_HALF_W, y: bvy - (fw + fh) * TILE_HALF_H };
    const B = { x: bvx + fh * TILE_HALF_W, y: bvy - fh * TILE_HALF_H };
    const D = { x: bvx - fw * TILE_HALF_W, y: bvy - fw * TILE_HALF_H };
    ctx.strokeStyle = 'rgba(80,200,255,0.7)';
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(A.x, A.y);
    ctx.lineTo(B.x, B.y);
    ctx.lineTo(bvx, bvy);
    ctx.lineTo(D.x, D.y);
    ctx.closePath();
    ctx.stroke();
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
    ctx.setLineDash([]);
  }
  ctx.drawImage(atlas.getBuildingSprite(key, 0, true), 0, 0);
  return c;
}

export function showSpriteLab(root: HTMLElement, data: GameData, overrides: SpriteOverrides | null): void {
  const atlas = buildSpriteAtlas(data, overrides);
  const el = document.createElement('div');
  el.style.cssText =
    'position:absolute;inset:0;overflow-y:auto;background:#0d0f1c;color:#cfd6ff;' +
    'font-family:Verdana,Geneva,sans-serif;font-size:11px;padding:18px 24px;z-index:200;';
  el.innerHTML = `
    <h1 style="letter-spacing:4px;color:#fff;">SPRITE LAB</h1>
    <p style="max-width:760px;line-height:1.6;color:#9aa3cf;">
      Download a template, paint over it (keep the PNG size and transparent background, respect the
      <b style="color:#7ad4ff">feet line / footprint diamond</b> guides), save it under
      <code>public/sprites/units/</code> or <code>public/sprites/buildings/</code> with the same file name,
      list it in <code>public/sprites/manifest.json</code>, and reload. Full guide: <b>SPRITES.md</b>.
      Overrides currently loaded: <b style="color:#7ad4ff">${
        overrides ? [...overrides.units.values()].reduce((s, u) => s + u.imgs.size, 0) + overrides.buildings.size : 0
      } images</b>.
    </p>
    <div style="margin:10px 0 22px;display:flex;gap:10px;">
      <button id="lab-all-units" style="padding:8px 14px;cursor:pointer;">⬇ Download ALL unit templates (410 files)</button>
      <button id="lab-all-bld" style="padding:8px 14px;cursor:pointer;">⬇ Download ALL building templates (45 files)</button>
      <button id="lab-back" style="padding:8px 14px;cursor:pointer;">← Back to game</button>
    </div>`;
  root.appendChild(el);

  const grid = (title: string) => {
    const h = document.createElement('h2');
    h.textContent = title;
    h.style.cssText = 'letter-spacing:3px;color:#fff;margin:24px 0 10px;font-size:14px;';
    el.appendChild(h);
    const g = document.createElement('div');
    g.style.cssText = 'display:flex;flex-wrap:wrap;gap:12px;';
    el.appendChild(g);
    return g;
  };

  // --- units ---
  const unitIds = Object.keys(data.units).sort();
  const ug = grid(`UNITS (${unitIds.length}) — 64×64 px, 5 facings × 2 frames each`);
  for (const id of unitIds) {
    const card = document.createElement('div');
    card.style.cssText = 'background:#161830;border:1px solid #2e3252;border-radius:5px;padding:8px;width:188px;';
    const name = data.units[id].name;
    card.innerHTML = `<div style="color:#fff;font-weight:bold;">${name}</div><div style="color:#6f78a8;font-size:9px;margin-bottom:5px;">${id}</div>`;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:2px;background:#0a0c18;padding:3px;border-radius:3px;';
    for (const d of CANONICAL_DIRS.slice(0, 5)) {
      const cv = unitTemplate(atlas, id, d.facing8, 0, false);
      cv.style.width = '34px';
      cv.style.height = '34px';
      cv.title = d.name;
      row.appendChild(cv);
    }
    card.appendChild(row);
    const btn = document.createElement('button');
    btn.textContent = '⬇ 10 templates';
    btn.style.cssText = 'margin-top:6px;cursor:pointer;font-size:10px;padding:4px 8px;';
    btn.addEventListener('click', () => {
      for (const d of CANONICAL_DIRS) {
        for (let f = 0; f < 2; f++) dl(`${id}_${d.name}_${f}.png`, unitTemplate(atlas, id, d.facing8, f, true));
      }
    });
    card.appendChild(btn);
    ug.appendChild(card);
  }

  // --- buildings ---
  const bldIds = Object.keys(data.buildings).sort();
  const bg = grid(`BUILDINGS (${bldIds.length}) — size varies by footprint (guide shows the ground diamond)`);
  for (const id of bldIds) {
    const def = data.buildings[id];
    const kind = id.slice(id.indexOf('_') + 1);
    const box = buildingSpriteBox(def.footprint.w, def.footprint.h, kind);
    const card = document.createElement('div');
    card.style.cssText = 'background:#161830;border:1px solid #2e3252;border-radius:5px;padding:8px;width:188px;';
    card.innerHTML = `<div style="color:#fff;font-weight:bold;">${def.name}</div>
      <div style="color:#6f78a8;font-size:9px;margin-bottom:5px;">${id} — ${box.w}×${box.h}px</div>`;
    const cv = buildingTemplate(atlas, data, id, false);
    cv.style.maxWidth = '170px';
    cv.style.background = '#0a0c18';
    cv.style.borderRadius = '3px';
    card.appendChild(cv);
    const btn = document.createElement('button');
    btn.textContent = '⬇ template';
    btn.style.cssText = 'display:block;margin-top:6px;cursor:pointer;font-size:10px;padding:4px 8px;';
    btn.addEventListener('click', () => dl(`${id}.png`, buildingTemplate(atlas, data, id, true)));
    card.appendChild(btn);
    bg.appendChild(card);
  }

  // --- bulk + nav ---
  (el.querySelector('#lab-back') as HTMLElement).addEventListener('click', () => {
    location.href = location.pathname;
  });
  (el.querySelector('#lab-all-units') as HTMLElement).addEventListener('click', () => {
    let i = 0;
    const next = () => {
      if (i >= unitIds.length) return;
      const id = unitIds[i++];
      for (const d of CANONICAL_DIRS) {
        for (let f = 0; f < 2; f++) dl(`${id}_${d.name}_${f}.png`, unitTemplate(atlas, id, d.facing8, f, true));
      }
      setTimeout(next, 350); // pace downloads so the browser doesn't drop them
    };
    next();
  });
  (el.querySelector('#lab-all-bld') as HTMLElement).addEventListener('click', () => {
    let i = 0;
    const next = () => {
      if (i >= bldIds.length) return;
      dl(`${bldIds[i]}.png`, buildingTemplate(atlas, data, bldIds[i], true));
      i++;
      setTimeout(next, 350);
    };
    next();
  });
}
