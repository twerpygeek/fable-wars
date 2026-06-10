// =============================================================================
// POCKET ALERT — visual effects system (renderer-owned).
// Self-expiring effects spawned from GameEvents. Every particle's position is
// a pure function of (effect seed, age), so the per-frame draw pass allocates
// nothing; gradient sprites (fireballs, glows, smoke) are pre-rendered once.
// Cosmetic randomness / performance.now() are allowed here (render side only).
// =============================================================================

import { TICK_MS, TILE_HALF_H, TILE_HALF_W } from '../core/constants';
import { Element } from '../core/types';
import type {
  GameData,
  GameEvent,
  GameState,
  PlayerId,
  SuperweaponDef,
  VisualEffect,
} from '../core/types';

interface ActiveEffect extends VisualEffect {
  seed: number;
}

interface Flash {
  startedAt: number; // may be in the future (scheduled, e.g. nuke arrival)
  duration: number;
  color: string;
  peak: number; // max alpha
}

interface Shake {
  startedAt: number; // may be in the future
  duration: number;
  mag: number; // screen px
}

const MAX_EFFECTS = 240;
const TAU = Math.PI * 2;
const SQRT2 = Math.SQRT2;
const NUKE_TRAVEL_MS = 3000; // matches sim's 3s incoming warning

// Palette per Element (index = Element const enum value: NEUTRAL,FIRE,WATER,GRASS,ELECTRIC)
const CORE: string[] = ['#fff6e8', '#fff3c4', '#e8fbff', '#eaffe6', '#fffbd6'];
const MAIN: string[] = ['#ffd9a0', '#ff7a30', '#38b6ff', '#58e06a', '#ffe24a'];
const DEEP: string[] = ['#c08a50', '#d63a10', '#1670c0', '#23a040', '#d8a818'];
const CRYSTAL_PINK = '#ff8ade';
const GOLD = '#ffd24a';

/** Cheap deterministic hash -> [0,1). Stable per (seed, lane) so particles don't jitter. */
function h(seed: number, lane: number): number {
  let x = (seed + Math.imul(lane | 0, 0x9e3779b9)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

function makeCanvas(size: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  if (!g) throw new Error('2d context unavailable');
  return { c, g };
}

function renderBall(core: string, main: string, deep: string): HTMLCanvasElement {
  const { c, g } = makeCanvas(96);
  const grad = g.createRadialGradient(48, 48, 2, 48, 48, 47);
  grad.addColorStop(0, core);
  grad.addColorStop(0.35, main);
  grad.addColorStop(0.75, deep);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 96, 96);
  return c;
}

function renderGlow(main: string): HTMLCanvasElement {
  const { c, g } = makeCanvas(96);
  const grad = g.createRadialGradient(48, 48, 0, 48, 48, 47);
  grad.addColorStop(0, main);
  grad.addColorStop(0.4, main);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalAlpha = 0.85;
  g.fillStyle = grad;
  g.fillRect(0, 0, 96, 96);
  return c;
}

function renderSmoke(rgb: string): HTMLCanvasElement {
  const { c, g } = makeCanvas(80);
  const grad = g.createRadialGradient(40, 40, 2, 40, 40, 39);
  grad.addColorStop(0, `rgba(${rgb},0.85)`);
  grad.addColorStop(0.6, `rgba(${rgb},0.45)`);
  grad.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 80, 80);
  return c;
}

export class EffectsSystem {
  private effects: ActiveEffect[] = [];
  private flashes: Flash[] = [];
  private shakes: Shake[] = [];
  private balls: HTMLCanvasElement[] = [];
  private glows: HTMLCanvasElement[] = [];
  private smoke: HTMLCanvasElement;
  private darkSmoke: HTMLCanvasElement;
  private shakeOut = { x: 0, y: 0 };

  constructor() {
    for (let e = 0; e < 5; e++) {
      this.balls.push(renderBall(CORE[e], MAIN[e], DEEP[e]));
      this.glows.push(renderGlow(MAIN[e]));
    }
    this.smoke = renderSmoke('120,118,116');
    this.darkSmoke = renderSmoke('34,38,52');
  }

  /** Soft glow sprite per element — also used by the renderer for projectile trails. */
  glowSprite(elem: Element): HTMLCanvasElement {
    return this.glows[elem] ?? this.glows[0];
  }

  add(fx: VisualEffect): void {
    if (this.effects.length >= MAX_EFFECTS) {
      // Drop the oldest effect to make room (keeps recent, salient ones).
      let oldest = 0;
      for (let i = 1; i < this.effects.length; i++) {
        if (this.effects[i].startedAt < this.effects[oldest].startedAt) oldest = i;
      }
      this.effects[oldest] = this.effects[this.effects.length - 1];
      this.effects.pop();
    }
    const seed =
      (Math.floor(fx.pos.x * 127.3 + fx.pos.y * 311.7 + fx.startedAt * 7.7) ^ 0x5bd1e995) >>> 0;
    this.effects.push({
      kind: fx.kind,
      pos: { x: fx.pos.x, y: fx.pos.y },
      startedAt: fx.startedAt,
      duration: fx.duration,
      scale: fx.scale,
      element: fx.element,
      seed,
    });
  }

  flash(color: string, peak: number, durationMs: number, startMs: number): void {
    if (this.flashes.length > 8) this.flashes.shift();
    this.flashes.push({ startedAt: startMs, duration: durationMs, color, peak });
  }

  shake(mag: number, durationMs: number, startMs: number): void {
    if (this.shakes.length > 8) this.shakes.shift();
    this.shakes.push({ startedAt: startMs, duration: durationMs, mag });
  }

  /** Map sim events to spawned effects. Called from Renderer.handleEvents. */
  spawnFromEvents(
    events: GameEvent[],
    state: GameState,
    data: GameData,
    humanPlayer: PlayerId,
    now: number
  ): void {
    for (const ev of events) {
      switch (ev.type) {
        case 'shotFired': {
          if (this.effects.length > MAX_EFFECTS - 40) break; // muzzle flashes are lowest priority
          this.add({
            kind: 'spark',
            pos: ev.pos,
            startedAt: now,
            duration: 140,
            scale: 0.6,
            element: ev.element,
          });
          break;
        }
        case 'impact': {
          const kind = ev.element === Element.WATER ? 'splash' : 'explosion';
          this.add({
            kind,
            pos: ev.pos,
            startedAt: now,
            duration: 380 + ev.splash * 160,
            scale: 0.8 + ev.splash * 0.55,
            element: ev.element,
          });
          if (ev.splash >= 2) this.shake(Math.min(10, ev.splash * 1.6), 260 + ev.splash * 90, now);
          break;
        }
        case 'entityDied': {
          if (ev.kind === 'building') {
            const bd = data.buildings[ev.defId];
            const fw = bd ? bd.footprint.w : 2;
            const fh = bd ? bd.footprint.h : 2;
            this.add({
              kind: 'explosion',
              pos: { x: ev.pos.x + fw / 2, y: ev.pos.y + fh / 2 },
              startedAt: now,
              duration: 950,
              scale: 2.2 + (fw + fh) * 0.3,
              element: Element.FIRE,
            });
            this.shake(5, 480, now);
          } else {
            const ud = data.units[ev.defId];
            this.add({
              kind: 'explosion',
              pos: ev.pos,
              startedAt: now,
              duration: 420,
              scale: 0.95,
              element: ud ? ud.element : Element.NEUTRAL,
            });
          }
          break;
        }
        case 'superweaponLaunched': {
          let sw: SuperweaponDef | undefined = data.superweapons[ev.defId];
          if (!sw) {
            const bd = data.buildings[ev.defId];
            if (bd && bd.superweaponId) sw = data.superweapons[bd.superweaponId];
          }
          const enemy = ev.byPlayer !== humanPlayer;
          this.flash(enemy ? '#ff3020' : '#ffffff', enemy ? 0.34 : 0.18, 600, now);
          if (!sw) break;
          if (sw.kind === 'nuke') {
            this.add({
              kind: 'nuke',
              pos: ev.target,
              startedAt: now,
              duration: NUKE_TRAVEL_MS,
              scale: sw.radius,
              element: Element.FIRE,
            });
            // Arrival drama: white-hot flash + heavy screen shake when it lands.
            this.flash('#fff6e0', 0.55, 700, now + NUKE_TRAVEL_MS - 80);
            this.shake(11, 900, now + NUKE_TRAVEL_MS);
          } else if (sw.kind === 'storm') {
            this.add({
              kind: 'storm',
              pos: ev.target,
              startedAt: now,
              duration: sw.durationTicks * TICK_MS + 700,
              scale: sw.radius,
              element: Element.WATER,
            });
          } else {
            this.add({
              kind: 'spore',
              pos: ev.target,
              startedAt: now,
              duration: sw.durationTicks * TICK_MS,
              scale: sw.radius,
              element: Element.GRASS,
            });
          }
          break;
        }
        case 'promotion': {
          const e = state.entities.get(ev.id);
          if (!e) break;
          this.add({
            kind: 'promote',
            pos: { x: e.pos.x, y: e.pos.y },
            startedAt: now,
            duration: 1300,
            scale: ev.rank, // chevron count
            element: Element.NEUTRAL,
          });
          break;
        }
        case 'buildingPlaced': {
          const e = state.entities.get(ev.id);
          if (!e) break;
          const bd = data.buildings[e.defId];
          const fw = bd ? bd.footprint.w : 2;
          const fh = bd ? bd.footprint.h : 2;
          this.add({
            kind: 'place',
            pos: { x: e.pos.x + fw / 2, y: e.pos.y + fh / 2 },
            startedAt: now,
            duration: 650,
            scale: Math.max(fw, fh),
            element: Element.GRASS,
          });
          break;
        }
        case 'buildingCaptured': {
          const e = state.entities.get(ev.id);
          if (!e) break;
          const bd = data.buildings[e.defId];
          const fw = bd ? bd.footprint.w : 2;
          const fh = bd ? bd.footprint.h : 2;
          this.add({
            kind: 'capture',
            pos: { x: e.pos.x + fw / 2, y: e.pos.y + fh / 2 },
            startedAt: now,
            duration: 1100,
            scale: 1,
            element: Element.NEUTRAL,
          });
          break;
        }
        case 'crystalDepleted': {
          this.add({
            kind: 'spark',
            pos: { x: ev.pos.x + 0.5, y: ev.pos.y + 0.5 },
            startedAt: now,
            duration: 900,
            scale: 1.6, // >=1.5 + NEUTRAL = candy-pink sparkle (crystal)
            element: Element.NEUTRAL,
          });
          break;
        }
        default:
          break;
      }
    }
  }

  /** Drop expired effects/flashes/shakes. Call once per frame before drawing. */
  update(now: number): void {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const fx = this.effects[i];
      if (now - fx.startedAt >= fx.duration) {
        this.effects[i] = this.effects[this.effects.length - 1];
        this.effects.pop();
      }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      if (now - f.startedAt >= f.duration) this.flashes.splice(i, 1);
    }
    for (let i = this.shakes.length - 1; i >= 0; i--) {
      const s = this.shakes[i];
      if (now - s.startedAt >= s.duration) this.shakes.splice(i, 1);
    }
  }

  /** Current accumulated screen-shake offset in screen pixels (reused object). */
  shakeOffset(now: number): { x: number; y: number } {
    let x = 0;
    let y = 0;
    for (let i = 0; i < this.shakes.length; i++) {
      const s = this.shakes[i];
      const p = (now - s.startedAt) / s.duration;
      if (p < 0 || p >= 1) continue; // scheduled or finished
      const decay = (1 - p) * (1 - p);
      x += Math.sin(now * 0.085 + i * 1.7) * s.mag * decay;
      y += Math.cos(now * 0.103 + i * 2.9) * s.mag * decay * 0.7;
    }
    this.shakeOut.x = x;
    this.shakeOut.y = y;
    return this.shakeOut;
  }

  /** Draw all world-space effects. Projection params passed inline (no closures). */
  drawWorld(
    ctx: CanvasRenderingContext2D,
    now: number,
    camX: number,
    camY: number,
    z: number,
    viewW: number,
    viewH: number
  ): void {
    const pad = 280 * z;
    for (let i = 0; i < this.effects.length; i++) {
      const fx = this.effects[i];
      const age = now - fx.startedAt;
      if (age < 0 || age >= fx.duration) continue;
      const t = age / fx.duration;
      const sx = ((fx.pos.x - fx.pos.y) * TILE_HALF_W - camX) * z;
      const sy = ((fx.pos.x + fx.pos.y) * TILE_HALF_H - camY) * z;
      if (sx < -pad || sx > viewW + pad || sy < -pad || sy > viewH + pad) continue;
      switch (fx.kind) {
        case 'explosion':
          this.drawExplosion(ctx, fx, t, sx, sy, z);
          break;
        case 'splash':
          this.drawSplash(ctx, fx, t, sx, sy, z, now);
          break;
        case 'spark':
          this.drawSpark(ctx, fx, t, sx, sy, z);
          break;
        case 'nuke':
          this.drawNuke(ctx, fx, t, sx, sy, z, now);
          break;
        case 'storm':
          this.drawStorm(ctx, fx, t, sx, sy, z, now);
          break;
        case 'spore':
          this.drawSpore(ctx, fx, t, sx, sy, z, now);
          break;
        case 'heal':
          this.drawHeal(ctx, fx, t, sx, sy, z);
          break;
        case 'capture':
          this.drawCapture(ctx, fx, t, sx, sy, z);
          break;
        case 'sell':
          this.drawSell(ctx, fx, t, sx, sy, z);
          break;
        case 'place':
          this.drawPlace(ctx, fx, t, sx, sy, z);
          break;
        case 'promote':
          this.drawPromote(ctx, fx, t, sx, sy, z);
          break;
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Full-screen flashes (superweapon warnings / nuke arrival). Draw last. */
  drawScreenFlashes(ctx: CanvasRenderingContext2D, now: number, viewW: number, viewH: number): void {
    for (let i = 0; i < this.flashes.length; i++) {
      const f = this.flashes[i];
      const p = (now - f.startedAt) / f.duration;
      if (p < 0 || p >= 1) continue;
      const a = f.peak * (p < 0.18 ? p / 0.18 : 1 - (p - 0.18) / 0.82);
      if (a <= 0.004) continue;
      ctx.globalAlpha = a;
      ctx.fillStyle = f.color;
      ctx.fillRect(0, 0, viewW, viewH);
    }
    ctx.globalAlpha = 1;
  }

  // --- per-kind draw routines --------------------------------------------------

  private drawExplosion(
    ctx: CanvasRenderingContext2D,
    fx: ActiveEffect,
    t: number,
    sx: number,
    sy: number,
    z: number
  ): void {
    const ease = 1 - (1 - t) * (1 - t);
    const s = fx.scale;
    // fireball
    if (t < 0.75) {
      const r = (10 + 22 * ease) * s * z;
      ctx.globalAlpha = 1 - t / 0.75;
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(this.balls[fx.element] ?? this.balls[0], sx - r, sy - r * 1.05 - 6 * z * ease, r * 2, r * 2);
      ctx.globalCompositeOperation = 'source-over';
    }
    // ground shock ring (iso ellipse)
    const ringR = 30 * s * z * ease;
    ctx.globalAlpha = (1 - t) * 0.45;
    ctx.strokeStyle = CORE[fx.element] ?? CORE[0];
    ctx.lineWidth = Math.max(1, 2 * z * (1 - t));
    ctx.beginPath();
    ctx.ellipse(sx, sy, ringR, ringR * 0.5, 0, 0, TAU);
    ctx.stroke();
    // sparks (ballistic, deterministic)
    const n = 6 + Math.min(10, (s * 3) | 0);
    ctx.fillStyle = CORE[fx.element] ?? CORE[0];
    ctx.globalAlpha = 1 - t;
    for (let i = 0; i < n; i++) {
      const a = h(fx.seed, i) * TAU;
      const sp = 0.5 + h(fx.seed, i + 50);
      const d = (6 + 40 * ease * sp) * z * s * 0.6;
      const px = sx + Math.cos(a) * d;
      const py = sy + Math.sin(a) * d * 0.5 - (46 * sp * t - 52 * t * t) * z;
      const sz = Math.max(1, (3 - 2 * t) * z);
      ctx.fillRect(px - sz / 2, py - sz / 2, sz, sz);
    }
    // smoke puffs in the late phase
    if (t > 0.32) {
      const u = (t - 0.32) / 0.68;
      for (let i = 0; i < 4; i++) {
        const ang = h(fx.seed, 100 + i) * TAU;
        const px = sx + Math.cos(ang) * 9 * z * s * 0.6;
        const py = sy - u * (26 + 14 * h(fx.seed, 140 + i)) * z - i * 3 * z;
        const sr = (8 + 22 * u) * z * s * 0.45;
        ctx.globalAlpha = (1 - u) * 0.34;
        ctx.drawImage(this.smoke, px - sr, py - sr, sr * 2, sr * 2);
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawSplash(
    ctx: CanvasRenderingContext2D,
    fx: ActiveEffect,
    t: number,
    sx: number,
    sy: number,
    z: number,
    now: number
  ): void {
    const s = fx.scale;
    // bolt streak from the sky (tsunami strike / heavy water hit)
    if (t < 0.38) {
      const ba = 1 - t / 0.38;
      const top = sy - 190 * z;
      const flick = Math.floor(now / 50);
      ctx.globalCompositeOperation = 'lighter';
      for (let pass = 0; pass < 2; pass++) {
        ctx.globalAlpha = ba * (pass === 0 ? 0.35 : 0.9);
        ctx.strokeStyle = pass === 0 ? MAIN[Element.WATER] : '#f2fcff';
        ctx.lineWidth = (pass === 0 ? 5 : 2) * z;
        ctx.beginPath();
        ctx.moveTo(sx + (h(fx.seed, flick) - 0.5) * 10 * z, top);
        for (let k = 1; k <= 4; k++) {
          const yy = top + ((sy - top) * k) / 4;
          const xx = sx + (k === 4 ? 0 : (h(fx.seed, flick + k * 7) - 0.5) * 26 * z);
          ctx.lineTo(xx, yy);
        }
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    // expanding water ring
    const ease = 1 - (1 - t) * (1 - t);
    const ringR = 26 * s * z * ease;
    ctx.globalAlpha = (1 - t) * 0.6;
    ctx.strokeStyle = MAIN[Element.WATER];
    ctx.lineWidth = Math.max(1, 2.4 * z * (1 - t));
    ctx.beginPath();
    ctx.ellipse(sx, sy, ringR, ringR * 0.5, 0, 0, TAU);
    ctx.stroke();
    // droplets up & falling
    ctx.fillStyle = CORE[Element.WATER];
    ctx.globalAlpha = 1 - t;
    const n = 8;
    for (let i = 0; i < n; i++) {
      const a = h(fx.seed, i + 20) * TAU;
      const sp = 0.5 + h(fx.seed, i + 70);
      const d = (4 + 26 * ease * sp) * z * s * 0.55;
      const px = sx + Math.cos(a) * d;
      const py = sy + Math.sin(a) * d * 0.45 - (52 * sp * t - 70 * t * t) * z;
      const sz = Math.max(1, 2.4 * z * (1 - t));
      ctx.fillRect(px - sz / 2, py - sz / 2, sz, sz);
    }
    ctx.globalAlpha = 1;
  }

  private drawSpark(
    ctx: CanvasRenderingContext2D,
    fx: ActiveEffect,
    t: number,
    sx: number,
    sy: number,
    z: number
  ): void {
    const crystal = fx.element === Element.NEUTRAL && fx.scale >= 1.5;
    const col = crystal ? CRYSTAL_PINK : MAIN[fx.element] ?? MAIN[0];
    const core = crystal ? '#fff0fa' : CORE[fx.element] ?? CORE[0];
    const s = fx.scale;
    const grow = Math.sqrt(t);
    ctx.globalCompositeOperation = 'lighter';
    // center dot
    ctx.globalAlpha = (1 - t) * 0.95;
    ctx.fillStyle = core;
    const cr = 2.4 * s * z * (1 - t * 0.5);
    ctx.fillRect(sx - cr / 2, sy - cr / 2 - 6 * z, cr, cr);
    // rays
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(0.8, 1.3 * z);
    ctx.globalAlpha = (1 - t) * 0.8;
    const n = crystal ? 7 : 5;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = h(fx.seed, i) * TAU;
      const r0 = 2 * z;
      const r1 = (4 + 12 * grow * s) * z;
      const lift = crystal ? -t * 14 * z : -6 * z;
      ctx.moveTo(sx + Math.cos(a) * r0, sy + lift + Math.sin(a) * r0 * 0.6);
      ctx.lineTo(sx + Math.cos(a) * r1, sy + lift + Math.sin(a) * r1 * 0.6);
    }
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  private drawNuke(
    ctx: CanvasRenderingContext2D,
    fx: ActiveEffect,
    t: number,
    sx: number,
    sy: number,
    z: number,
    now: number
  ): void {
    // Incoming-warning reticle: rings contracting onto the target.
    const maxR = fx.scale * SQRT2 * TILE_HALF_W * z;
    ctx.strokeStyle = '#ff4636';
    for (let i = 0; i < 3; i++) {
      const pr = (now * 0.0009 + i / 3) % 1;
      const r = (1 - pr) * maxR;
      ctx.globalAlpha = pr * 0.75;
      ctx.lineWidth = Math.max(1, 2 * z);
      ctx.beginPath();
      ctx.ellipse(sx, sy, r, r * 0.5, 0, 0, TAU);
      ctx.stroke();
    }
    // crosshair
    ctx.globalAlpha = 0.5 + 0.5 * Math.sin(now * 0.02);
    ctx.lineWidth = Math.max(1, 1.5 * z);
    ctx.beginPath();
    ctx.moveTo(sx - 12 * z, sy);
    ctx.lineTo(sx + 12 * z, sy);
    ctx.moveTo(sx, sy - 7 * z);
    ctx.lineTo(sx, sy + 7 * z);
    ctx.stroke();
    // final descent: white-hot comet streaking down
    if (t > 0.82) {
      const u = (t - 0.82) / 0.18;
      const yy = sy - (1 - u) * 560 * z;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.9;
      const gr = 16 * z;
      ctx.drawImage(this.glows[Element.FIRE], sx - gr, yy - gr, gr * 2, gr * 2);
      ctx.strokeStyle = '#fff2cc';
      ctx.lineWidth = 3 * z;
      ctx.beginPath();
      ctx.moveTo(sx, yy - 90 * z);
      ctx.lineTo(sx, yy);
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
  }

  private drawStorm(
    ctx: CanvasRenderingContext2D,
    fx: ActiveEffect,
    t: number,
    sx: number,
    sy: number,
    z: number,
    now: number
  ): void {
    const fade = t < 0.08 ? t / 0.08 : t > 0.85 ? (1 - t) / 0.15 : 1;
    const rad = fx.scale * TILE_HALF_W * z;
    // brooding cloud cover
    for (let i = 0; i < 6; i++) {
      const a = h(fx.seed, i) * TAU + now * 0.00012 * (i % 2 === 0 ? 1 : -1);
      const d = rad * (0.25 + 0.65 * h(fx.seed, i + 30));
      const px = sx + Math.cos(a) * d;
      const py = sy - 60 * z + Math.sin(a) * d * 0.5;
      const sr = rad * (0.45 + 0.25 * h(fx.seed, i + 60));
      ctx.globalAlpha = 0.3 * fade;
      ctx.drawImage(this.darkSmoke, px - sr, py - sr * 0.6, sr * 2, sr * 1.2);
    }
    // electric flicker inside the clouds
    const f = h(fx.seed, Math.floor(now / 110));
    if (f > 0.62) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (f - 0.62) * 1.4 * fade;
      const gx = sx + (h(fx.seed, Math.floor(now / 110) + 7) - 0.5) * rad * 1.4;
      const gr = rad * 0.5;
      ctx.drawImage(this.glows[Element.WATER], gx - gr, sy - 70 * z - gr * 0.6, gr * 2, gr * 1.2);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
  }

  private drawSpore(
    ctx: CanvasRenderingContext2D,
    fx: ActiveEffect,
    t: number,
    sx: number,
    sy: number,
    z: number,
    now: number
  ): void {
    const fade = t < 0.08 ? t / 0.08 : t > 0.88 ? (1 - t) / 0.12 : 1;
    const rad = fx.scale * TILE_HALF_W * z;
    // drifting toxic blooms
    for (let i = 0; i < 7; i++) {
      const dir = i % 2 === 0 ? 1 : -1;
      const a = h(fx.seed, i) * TAU + now * 0.00025 * dir;
      const d = rad * (0.2 + 0.7 * h(fx.seed, i + 40));
      const px = sx + Math.cos(a) * d;
      const py = sy + Math.sin(a) * d * 0.5 - 6 * z;
      const sr = rad * (0.3 + 0.2 * h(fx.seed, i + 80)) * (1 + 0.1 * Math.sin(now * 0.003 + i));
      ctx.globalAlpha = 0.17 * fade;
      ctx.drawImage(this.glows[Element.GRASS], px - sr, py - sr * 0.55, sr * 2, sr * 1.1);
    }
    // floating spore motes
    ctx.fillStyle = CORE[Element.GRASS];
    for (let i = 0; i < 10; i++) {
      const a = h(fx.seed, i + 200) * TAU;
      const d = rad * h(fx.seed, i + 240) * 0.9;
      const bob = Math.sin(now * 0.002 + i * 1.3) * 5 * z;
      ctx.globalAlpha = (0.4 + 0.3 * Math.sin(now * 0.004 + i)) * fade;
      const sz = Math.max(1, 1.6 * z);
      ctx.fillRect(sx + Math.cos(a) * d - sz / 2, sy + Math.sin(a) * d * 0.5 - 10 * z + bob, sz, sz);
    }
    ctx.globalAlpha = 1;
  }

  private drawHeal(
    ctx: CanvasRenderingContext2D,
    fx: ActiveEffect,
    t: number,
    sx: number,
    sy: number,
    z: number
  ): void {
    ctx.fillStyle = MAIN[Element.GRASS];
    for (let i = 0; i < 3; i++) {
      const px = sx + (h(fx.seed, i) - 0.5) * 24 * z;
      const py = sy - (8 + t * 26) * z - i * 7 * z;
      ctx.globalAlpha = Math.max(0, 1 - t) * (1 - i * 0.22);
      const w = 7 * z;
      const th = 2 * z;
      ctx.fillRect(px - w / 2, py - th / 2, w, th);
      ctx.fillRect(px - th / 2, py - w / 2, th, w);
    }
    ctx.globalAlpha = 1;
  }

  private drawCapture(
    ctx: CanvasRenderingContext2D,
    fx: ActiveEffect,
    t: number,
    sx: number,
    sy: number,
    z: number
  ): void {
    const rise = t * 22 * z;
    const a = t > 0.75 ? (1 - t) * 4 : 1;
    ctx.globalAlpha = a;
    // pole
    ctx.strokeStyle = '#e8e4d8';
    ctx.lineWidth = Math.max(1, 1.6 * z);
    ctx.beginPath();
    ctx.moveTo(sx, sy - rise);
    ctx.lineTo(sx, sy - rise - 20 * z);
    ctx.stroke();
    // flag (waves slightly with t)
    const wave = Math.sin(t * 14) * 2 * z;
    ctx.fillStyle = GOLD;
    ctx.beginPath();
    ctx.moveTo(sx, sy - rise - 20 * z);
    ctx.lineTo(sx + 13 * z, sy - rise - 16.5 * z + wave);
    ctx.lineTo(sx, sy - rise - 13 * z);
    ctx.closePath();
    ctx.fill();
    // ring pulse at base
    ctx.strokeStyle = GOLD;
    ctx.globalAlpha = a * 0.5;
    const rr = (10 + t * 18) * z;
    ctx.beginPath();
    ctx.ellipse(sx, sy, rr, rr * 0.5, 0, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private drawSell(
    ctx: CanvasRenderingContext2D,
    fx: ActiveEffect,
    t: number,
    sx: number,
    sy: number,
    z: number
  ): void {
    // coins burst up then fall, gold sparkles
    for (let i = 0; i < 6; i++) {
      const a0 = h(fx.seed, i) * TAU;
      const sp = 0.6 + h(fx.seed, i + 33);
      const px = sx + Math.cos(a0) * (4 + 26 * t * sp) * z;
      const py = sy - (54 * sp * t - 72 * t * t) * z;
      ctx.globalAlpha = Math.max(0, 1 - t * 1.1);
      ctx.fillStyle = GOLD;
      const r = 2.6 * z * (0.7 + 0.3 * Math.sin(t * 22 + i)); // spinning glint
      ctx.beginPath();
      ctx.ellipse(px, py, r, r * 0.75, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#fff6cf';
      ctx.fillRect(px - 0.8 * z, py - 0.8 * z, 1.6 * z, 1.6 * z);
    }
    // $-sparkle cross
    ctx.strokeStyle = '#fff6cf';
    ctx.globalAlpha = Math.max(0, 1 - t * 1.4);
    ctx.lineWidth = Math.max(1, 1.4 * z);
    const cr = (5 + 10 * t) * z;
    ctx.beginPath();
    ctx.moveTo(sx - cr, sy - 14 * z);
    ctx.lineTo(sx + cr, sy - 14 * z);
    ctx.moveTo(sx, sy - 14 * z - cr * 0.7);
    ctx.lineTo(sx, sy - 14 * z + cr * 0.7);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private drawPlace(
    ctx: CanvasRenderingContext2D,
    fx: ActiveEffect,
    t: number,
    sx: number,
    sy: number,
    z: number
  ): void {
    // expanding green iso-diamond pulse (two rings)
    ctx.strokeStyle = MAIN[Element.GRASS];
    for (let i = 0; i < 2; i++) {
      const u = Math.min(1, t * 1.3 - i * 0.18);
      if (u <= 0) continue;
      const a = fx.scale * TILE_HALF_W * z * (0.5 + u * 0.9);
      const b = a * (TILE_HALF_H / TILE_HALF_W);
      ctx.globalAlpha = (1 - u) * 0.8;
      ctx.lineWidth = Math.max(1, (2.4 - u * 1.6) * z);
      ctx.beginPath();
      ctx.moveTo(sx, sy - b);
      ctx.lineTo(sx + a, sy);
      ctx.lineTo(sx, sy + b);
      ctx.lineTo(sx - a, sy);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private drawPromote(
    ctx: CanvasRenderingContext2D,
    fx: ActiveEffect,
    t: number,
    sx: number,
    sy: number,
    z: number
  ): void {
    const count = Math.max(1, Math.min(2, Math.round(fx.scale)));
    const rise = (16 + t * 24) * z;
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = Math.max(1.2, 2.2 * z);
    ctx.globalAlpha = t > 0.75 ? (1 - t) * 4 : 1;
    const w = 6 * z;
    const hgt = 4 * z;
    for (let i = 0; i < count; i++) {
      const py = sy - rise - i * 5.5 * z;
      ctx.beginPath();
      ctx.moveTo(sx - w, py + hgt);
      ctx.lineTo(sx, py);
      ctx.lineTo(sx + w, py + hgt);
      ctx.stroke();
    }
    // little glint
    ctx.fillStyle = '#fff6cf';
    ctx.globalAlpha *= 0.9;
    const gs = Math.max(1, 1.8 * z);
    ctx.fillRect(sx + w + 2 * z, sy - rise - 2 * z, gs, gs);
    ctx.globalAlpha = 1;
  }
}
