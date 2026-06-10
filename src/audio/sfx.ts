// =============================================================================
// POCKET ALERT — procedural sound effects (Owner F).
// One lazy AudioContext shared by the whole audio stack. Everything here is
// synthesized at play time from oscillators + a shared noise buffer; there are
// zero audio assets. Cosmetic randomness (Math.random) is allowed in audio code.
//
// Signal chain:  voiceGain -> stereoPanner -> sfxBus ─┐
//                                  musicBus (≈ -14dB) ┤-> masterGain -> compressor -> destination
// =============================================================================

export type SfxName =
  | 'fire_claw'
  | 'fire_cannon'
  | 'fire_blast'
  | 'fire_pierce'
  | 'fire_electric'
  | 'impact_thud'
  | 'impact_clank'
  | 'explosion'
  | 'explosion_big'
  | 'place'
  | 'sell'
  | 'click'
  | 'error'
  | 'select'
  | 'alarm'
  | 'nuke'
  | 'storm_strike'
  | 'spore_pad'
  | 'promote'
  | 'capture'
  | 'power_down'
  | 'power_up'
  | 'victory'
  | 'defeat'
  | 'radio_blip';

export interface PlaySfxOpts {
  /** Stereo position, clamped to [-0.8, 0.8]. Default 0 (center). */
  pan?: number;
  /** Linear gain multiplier on top of the per-sound base gain. Default 1. */
  gain?: number;
  /** Playback pitch multiplier (frequency scale). Default 1. */
  pitch?: number;
}

// --- Context & buses ----------------------------------------------------------

interface WebkitWindow {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
}

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let sfxBus: GainNode | null = null;
let musicBus: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let sfxEnabled = true;

/** Lazily create the shared AudioContext (suspended until a user gesture). */
export function getContext(): AudioContext | null {
  if (ctx) return ctx;
  if (typeof window === 'undefined') return null;
  const w = window as unknown as WebkitWindow;
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();

  masterGain = ctx.createGain();
  masterGain.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 12;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.25;
  masterGain.connect(comp);
  comp.connect(ctx.destination);

  sfxBus = ctx.createGain();
  sfxBus.gain.value = sfxEnabled ? 1 : 0;
  sfxBus.connect(masterGain);

  musicBus = ctx.createGain();
  musicBus.gain.value = 0.2; // ≈ -14 dB under SFX
  musicBus.connect(masterGain);

  // Shared 2-second white-noise loop, sliced with random offsets by every recipe.
  noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  return ctx;
}

/** Unlock the AudioContext after a user gesture. Safe to call repeatedly. */
export function resumeContext(): void {
  const c = getContext();
  if (c && c.state !== 'running') void c.resume();
}

/** Music module taps in here so both stacks share the master compressor. */
export function getMusicBus(): GainNode | null {
  getContext();
  return musicBus;
}

export function setSfxEnabled(on: boolean): void {
  sfxEnabled = on;
  const c = getContext();
  if (c && sfxBus) sfxBus.gain.setTargetAtTime(on ? 1 : 0, c.currentTime, 0.02);
}

export function isSfxEnabled(): boolean {
  return sfxEnabled;
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

// --- Polyphony management -------------------------------------------------------

const MAX_VOICES = 24;

interface Voice {
  gain: GainNode;
  pan: StereoPannerNode | null;
  sources: AudioScheduledSourceNode[];
  startTime: number;
  endTime: number;
}

const voices: Voice[] = [];

function disconnectVoice(v: Voice): void {
  try {
    v.gain.disconnect();
    if (v.pan) v.pan.disconnect();
  } catch {
    /* node already collected */
  }
}

function pruneVoices(now: number): void {
  for (let i = voices.length - 1; i >= 0; i--) {
    if (voices[i].endTime <= now) {
      disconnectVoice(voices[i]);
      voices.splice(i, 1);
    }
  }
}

/** Voice stealing: fade out and stop the oldest active sound. */
function stealVoice(now: number): void {
  if (voices.length === 0) return;
  let idx = 0;
  for (let i = 1; i < voices.length; i++) {
    if (voices[i].startTime < voices[idx].startTime) idx = i;
  }
  const v = voices[idx];
  voices.splice(idx, 1);
  v.gain.gain.cancelScheduledValues(now);
  v.gain.gain.setTargetAtTime(0, now, 0.008);
  for (const s of v.sources) {
    try {
      s.stop(now + 0.05);
    } catch {
      /* already stopped */
    }
  }
  setTimeout(() => disconnectVoice(v), 150);
}

// --- Per-type rate throttles ------------------------------------------------------

const THROTTLES: Record<string, { max: number; windowMs: number }> = {
  gunshot: { max: 6, windowMs: 100 },
  impact: { max: 8, windowMs: 100 },
  explosion: { max: 5, windowMs: 180 },
  big: { max: 2, windowMs: 400 },
  ui: { max: 8, windowMs: 120 },
  voicefx: { max: 4, windowMs: 250 },
};

const GROUP_OF: Record<SfxName, string> = {
  fire_claw: 'gunshot',
  fire_cannon: 'gunshot',
  fire_blast: 'gunshot',
  fire_pierce: 'gunshot',
  fire_electric: 'gunshot',
  impact_thud: 'impact',
  impact_clank: 'impact',
  explosion: 'explosion',
  explosion_big: 'explosion',
  storm_strike: 'explosion',
  nuke: 'big',
  alarm: 'big',
  spore_pad: 'big',
  victory: 'big',
  defeat: 'big',
  place: 'ui',
  sell: 'ui',
  click: 'ui',
  error: 'ui',
  select: 'ui',
  radio_blip: 'ui',
  promote: 'voicefx',
  capture: 'voicefx',
  power_down: 'voicefx',
  power_up: 'voicefx',
};

const throttleLog = new Map<string, number[]>();

function throttled(group: string): boolean {
  const cfg = THROTTLES[group];
  if (!cfg) return false;
  const t = nowMs();
  let log = throttleLog.get(group);
  if (!log) {
    log = [];
    throttleLog.set(group, log);
  }
  while (log.length > 0 && log[0] <= t - cfg.windowMs) log.shift();
  if (log.length >= cfg.max) return true;
  log.push(t);
  return false;
}

// --- Synthesis helpers --------------------------------------------------------------

interface Build {
  c: AudioContext;
  t0: number;
  out: GainNode;
  pitch: number;
  srcs: AudioScheduledSourceNode[];
}

function mkOsc(b: Build, type: OscillatorType, freq: number, t: number, dur: number): OscillatorNode {
  const o = b.c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(Math.max(20, freq), t);
  o.start(t);
  o.stop(t + dur + 0.05);
  b.srcs.push(o);
  return o;
}

function mkNoise(b: Build, t: number, dur: number): AudioBufferSourceNode {
  const s = b.c.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  s.start(t, Math.random() * 1.5);
  s.stop(t + dur + 0.05);
  b.srcs.push(s);
  return s;
}

function mkFilter(b: Build, type: BiquadFilterType, freq: number, q = 1): BiquadFilterNode {
  const f = b.c.createBiquadFilter();
  f.type = type;
  f.frequency.value = Math.max(10, freq);
  f.Q.value = q;
  return f;
}

function mkGain(b: Build): GainNode {
  return b.c.createGain();
}

/** Percussive envelope: linear attack to peak, exponential-ish decay (setTargetAtTime). */
function env(p: AudioParam, t: number, attack: number, peak: number, decayTau: number): void {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + attack);
  p.setTargetAtTime(0, t + attack, decayTau);
}

/** Exponential frequency sweep (both endpoints clamped positive). */
function sweep(p: AudioParam, t: number, from: number, to: number, dur: number): void {
  p.setValueAtTime(Math.max(0.01, from), t);
  p.exponentialRampToValueAtTime(Math.max(0.01, to), t + dur);
}

function chain(...nodes: AudioNode[]): void {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
}

/** Short filtered-noise tick (debris, crackle, static). */
function tick(b: Build, t: number, freq: number, peak: number, tau: number, type: BiquadFilterType = 'bandpass'): void {
  const n = mkNoise(b, t, tau * 6 + 0.03);
  const f = mkFilter(b, type, freq, 2);
  const g = mkGain(b);
  env(g.gain, t, 0.002, peak, tau);
  chain(n, f, g, b.out);
}

// --- Sound recipes --------------------------------------------------------------------
// Each returns its duration in seconds (for voice lifetime tracking).

const RECIPES: Record<SfxName, (b: Build) => number> = {
  // Quick noise swipe — claws and bites.
  fire_claw(b) {
    const t = b.t0;
    const p = b.pitch;
    const n = mkNoise(b, t, 0.16);
    const f = mkFilter(b, 'bandpass', 1800 * p, 1.1);
    sweep(f.frequency, t, 1900 * p, 480 * p, 0.12);
    const g = mkGain(b);
    env(g.gain, t, 0.004, 0.55, 0.035);
    chain(n, f, g, b.out);
    return 0.18;
  },

  // Punchy thump: pitch-dropping sine body + bright noise crack.
  fire_cannon(b) {
    const t = b.t0;
    const p = b.pitch;
    const o = mkOsc(b, 'sine', 170 * p, t, 0.3);
    sweep(o.frequency, t, 170 * p, 46, 0.16);
    const og = mkGain(b);
    env(og.gain, t, 0.003, 0.95, 0.07);
    chain(o, og, b.out);
    const n = mkNoise(b, t, 0.08);
    const hf = mkFilter(b, 'highpass', 1300, 0.7);
    const ng = mkGain(b);
    env(ng.gain, t, 0.002, 0.45, 0.018);
    chain(n, hf, ng, b.out);
    return 0.32;
  },

  // Whoosh then boom — mortars/bombs.
  fire_blast(b) {
    const t = b.t0;
    const p = b.pitch;
    const wn = mkNoise(b, t, 0.22);
    const wf = mkFilter(b, 'bandpass', 400 * p, 1.4);
    sweep(wf.frequency, t, 350 * p, 2400 * p, 0.16);
    const wg = mkGain(b);
    env(wg.gain, t, 0.02, 0.4, 0.06);
    chain(wn, wf, wg, b.out);
    const bt = t + 0.13;
    const o = mkOsc(b, 'sine', 120 * p, bt, 0.4);
    sweep(o.frequency, bt, 120 * p, 38, 0.3);
    const og = mkGain(b);
    env(og.gain, bt, 0.004, 0.8, 0.11);
    chain(o, og, b.out);
    const bn = mkNoise(b, bt, 0.3);
    const bf = mkFilter(b, 'lowpass', 750, 0.6);
    const bg = mkGain(b);
    env(bg.gain, bt, 0.004, 0.5, 0.09);
    chain(bn, bf, bg, b.out);
    return 0.6;
  },

  // Zappy down-chirp — energy/projectile lances.
  fire_pierce(b) {
    const t = b.t0;
    const p = b.pitch;
    const o = mkOsc(b, 'sawtooth', 2400 * p, t, 0.13);
    sweep(o.frequency, t, 2400 * p, 320 * p, 0.085);
    const hf = mkFilter(b, 'highpass', 550, 0.8);
    const g = mkGain(b);
    env(g.gain, t, 0.003, 0.4, 0.026);
    chain(o, hf, g, b.out);
    const o2 = mkOsc(b, 'square', 330 * p, t + 0.01, 0.07);
    const g2 = mkGain(b);
    env(g2.gain, t + 0.01, 0.003, 0.12, 0.02);
    chain(o2, g2, b.out);
    return 0.15;
  },

  // Electric variant: higher chirp + crackle ticks.
  fire_electric(b) {
    const t = b.t0;
    const p = b.pitch;
    const o = mkOsc(b, 'square', 3200 * p, t, 0.1);
    sweep(o.frequency, t, 3200 * p, 480 * p, 0.07);
    const hf = mkFilter(b, 'highpass', 900, 1);
    const g = mkGain(b);
    env(g.gain, t, 0.002, 0.32, 0.025);
    chain(o, hf, g, b.out);
    for (let i = 0; i < 5; i++) {
      tick(b, t + Math.random() * 0.11, 2800 + Math.random() * 2500, 0.22, 0.006, 'highpass');
    }
    return 0.2;
  },

  // Soft body hit.
  impact_thud(b) {
    const t = b.t0;
    const p = b.pitch;
    const n = mkNoise(b, t, 0.1);
    const f = mkFilter(b, 'lowpass', 460 * p, 0.7);
    const g = mkGain(b);
    env(g.gain, t, 0.003, 0.4, 0.035);
    chain(n, f, g, b.out);
    const o = mkOsc(b, 'sine', 95 * p, t, 0.12);
    sweep(o.frequency, t, 95 * p, 52, 0.09);
    const og = mkGain(b);
    env(og.gain, t, 0.003, 0.42, 0.045);
    chain(o, og, b.out);
    return 0.16;
  },

  // Metallic armor hit: inharmonic partials + bright burst.
  impact_clank(b) {
    const t = b.t0;
    const p = b.pitch;
    const partials = [1247, 1870, 2520];
    for (const f of partials) {
      const o = mkOsc(b, 'sine', f * p * (0.98 + Math.random() * 0.04), t, 0.14);
      const g = mkGain(b);
      env(g.gain, t, 0.001, 0.13, 0.022);
      chain(o, g, b.out);
    }
    tick(b, t, 3000, 0.3, 0.008, 'highpass');
    const o = mkOsc(b, 'sine', 150 * p, t, 0.1);
    sweep(o.frequency, t, 150 * p, 70, 0.08);
    const og = mkGain(b);
    env(og.gain, t, 0.002, 0.35, 0.03);
    chain(o, og, b.out);
    return 0.2;
  },

  // Filtered noise burst + sub-sine drop + debris crackle.
  explosion(b) {
    const t = b.t0;
    const p = b.pitch;
    const n = mkNoise(b, t, 0.6);
    const f = mkFilter(b, 'lowpass', 900, 0.6);
    sweep(f.frequency, t, 950 * p, 190, 0.45);
    const g = mkGain(b);
    env(g.gain, t, 0.005, 0.9, 0.16);
    chain(n, f, g, b.out);
    const o = mkOsc(b, 'sine', 105 * p, t, 0.5);
    sweep(o.frequency, t, 105 * p, 34, 0.4);
    const og = mkGain(b);
    env(og.gain, t, 0.004, 0.85, 0.16);
    chain(o, og, b.out);
    for (let i = 0; i < 4; i++) {
      tick(b, t + 0.12 + Math.random() * 0.35, 800 + Math.random() * 1800, 0.16, 0.014);
    }
    return 0.8;
  },

  // Long-tail building-killer version.
  explosion_big(b) {
    const t = b.t0;
    const p = b.pitch;
    tick(b, t, 1400, 0.55, 0.02, 'highpass'); // initial crack
    const n = mkNoise(b, t, 1.7);
    const f = mkFilter(b, 'lowpass', 1500, 0.5);
    sweep(f.frequency, t, 1500 * p, 120, 1.3);
    const g = mkGain(b);
    env(g.gain, t, 0.006, 1.0, 0.45);
    chain(n, f, g, b.out);
    const o = mkOsc(b, 'sine', 120 * p, t, 1.6);
    sweep(o.frequency, t, 120 * p, 28, 1.2);
    const og = mkGain(b);
    env(og.gain, t, 0.005, 1.0, 0.4);
    chain(o, og, b.out);
    for (let i = 0; i < 8; i++) {
      const tt = t + 0.15 + Math.random() * 1.1;
      tick(b, tt, 600 + Math.random() * 2200, 0.18 * (1 - (tt - t) / 1.6), 0.016);
    }
    return 1.8;
  },

  // Mechanical kachunk + confirmation chime.
  place(b) {
    const t = b.t0;
    const o = mkOsc(b, 'sine', 120, t, 0.1);
    sweep(o.frequency, t, 120, 58, 0.07);
    const og = mkGain(b);
    env(og.gain, t, 0.003, 0.6, 0.035);
    chain(o, og, b.out);
    tick(b, t, 420, 0.35, 0.02, 'lowpass');
    // the "chunk"
    const o2 = mkOsc(b, 'square', 180, t + 0.07, 0.06);
    const g2 = mkGain(b);
    env(g2.gain, t + 0.07, 0.002, 0.22, 0.015);
    const lp2 = mkFilter(b, 'lowpass', 900, 0.8);
    chain(o2, lp2, g2, b.out);
    tick(b, t + 0.07, 1700, 0.18, 0.008);
    // chime
    for (const [f, dt] of [
      [1174.7, 0.16],
      [1568, 0.22],
    ] as const) {
      const o3 = mkOsc(b, 'sine', f, t + dt, 0.35);
      const g3 = mkGain(b);
      env(g3.gain, t + dt, 0.004, 0.16, 0.09);
      chain(o3, g3, b.out);
    }
    return 0.6;
  },

  // Cash-register arpeggio + drawer thunk.
  sell(b) {
    const t = b.t0;
    const notes = [784, 988, 1175, 1568];
    for (let i = 0; i < notes.length; i++) {
      const tt = t + i * 0.055;
      const o = mkOsc(b, 'square', notes[i], tt, 0.1);
      const lp = mkFilter(b, 'lowpass', 4200, 0.5);
      const g = mkGain(b);
      env(g.gain, tt, 0.004, 0.17, 0.03);
      chain(o, lp, g, b.out);
    }
    const tn = t + 0.25;
    const n = mkNoise(b, tn, 0.1);
    const f = mkFilter(b, 'lowpass', 700, 0.6);
    const ng = mkGain(b);
    env(ng.gain, tn, 0.004, 0.3, 0.035);
    chain(n, f, ng, b.out);
    return 0.45;
  },

  // Tight UI tick.
  click(b) {
    const t = b.t0;
    const o = mkOsc(b, 'sine', 900, t, 0.05);
    const g = mkGain(b);
    env(g.gain, t, 0.001, 0.3, 0.012);
    chain(o, g, b.out);
    tick(b, t, 2400, 0.08, 0.004, 'highpass');
    return 0.06;
  },

  // Double buzz — invalid action.
  error(b) {
    const t = b.t0;
    for (let i = 0; i < 2; i++) {
      const tt = t + i * 0.14;
      const o = mkOsc(b, 'square', 132, tt, 0.11);
      const lp = mkFilter(b, 'lowpass', 720, 0.8);
      const g = mkGain(b);
      g.gain.setValueAtTime(0, tt);
      g.gain.linearRampToValueAtTime(0.38, tt + 0.006);
      g.gain.setValueAtTime(0.38, tt + 0.07);
      g.gain.linearRampToValueAtTime(0, tt + 0.095);
      chain(o, lp, g, b.out);
    }
    return 0.3;
  },

  // Cute two-note acknowledge chirp; pitch varies per call.
  select(b) {
    const t = b.t0;
    const p = b.pitch;
    const n1 = mkOsc(b, 'triangle', 660 * p, t, 0.07);
    sweep(n1.frequency, t, 620 * p, 690 * p, 0.05);
    const g1 = mkGain(b);
    env(g1.gain, t, 0.004, 0.35, 0.022);
    chain(n1, g1, b.out);
    const n2 = mkOsc(b, 'triangle', 990 * p, t + 0.065, 0.09);
    const g2 = mkGain(b);
    env(g2.gain, t + 0.065, 0.004, 0.32, 0.03);
    chain(n2, g2, b.out);
    return 0.18;
  },

  // Superweapon alarm siren: three rise-fall sweeps.
  alarm(b) {
    const t = b.t0;
    const dur = 2.55;
    const o = b.c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(520, t);
    for (let i = 0; i < 3; i++) {
      const cs = t + i * 0.85;
      o.frequency.setValueAtTime(520, cs);
      o.frequency.linearRampToValueAtTime(880, cs + 0.42);
      o.frequency.linearRampToValueAtTime(520, cs + 0.85);
    }
    const band = mkFilter(b, 'bandpass', 900, 1.4);
    const g = mkGain(b);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.34, t + 0.06);
    g.gain.setValueAtTime(0.34, t + dur - 0.35);
    g.gain.linearRampToValueAtTime(0, t + dur);
    chain(o, band, g, b.out);
    o.start(t);
    o.stop(t + dur + 0.05);
    b.srcs.push(o);
    // low pulse underneath
    const o2 = mkOsc(b, 'sine', 110, t, dur);
    const g2 = mkGain(b);
    g2.gain.setValueAtTime(0, t);
    g2.gain.linearRampToValueAtTime(0.14, t + 0.1);
    g2.gain.setValueAtTime(0.14, t + dur - 0.3);
    g2.gain.linearRampToValueAtTime(0, t + dur);
    chain(o2, g2, b.out);
    return dur;
  },

  // Massive sub drop + noise wall, long decay.
  nuke(b) {
    const t = b.t0;
    const dur = 4.5;
    tick(b, t, 1100, 0.8, 0.03, 'highpass'); // detonation crack
    const o = mkOsc(b, 'sine', 90, t, dur);
    sweep(o.frequency, t, 90, 24, 2.8);
    const og = mkGain(b);
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(1.1, t + 0.04);
    og.gain.setTargetAtTime(0, t + 1.2, 1.0);
    chain(o, og, b.out);
    const n = mkNoise(b, t, dur);
    const lp = mkFilter(b, 'lowpass', 2600, 0.5);
    sweep(lp.frequency, t + 0.15, 2600, 110, 3.4);
    const ng = mkGain(b);
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(1.0, t + 0.08);
    ng.gain.setTargetAtTime(0, t + 0.8, 1.1);
    chain(n, lp, ng, b.out);
    for (let i = 0; i < 10; i++) {
      const tt = t + 0.4 + Math.random() * 2.4;
      tick(b, tt, 600 + Math.random() * 2200, Math.max(0.04, 0.22 * (1 - (tt - t) / 3.2)), 0.018);
    }
    return dur;
  },

  // Lightning crack + thunder tail.
  storm_strike(b) {
    const t = b.t0;
    const p = b.pitch;
    tick(b, t, 2300 * p, 0.7, 0.008, 'highpass');
    const o = mkOsc(b, 'sawtooth', 1600 * p, t, 0.14);
    sweep(o.frequency, t, 1600 * p, 110, 0.1);
    const g = mkGain(b);
    env(g.gain, t, 0.002, 0.42, 0.03);
    chain(o, g, b.out);
    const n = mkNoise(b, t + 0.04, 0.8);
    const f = mkFilter(b, 'lowpass', 380, 0.6);
    const ng = mkGain(b);
    env(ng.gain, t + 0.04, 0.05, 0.42, 0.24);
    chain(n, f, ng, b.out);
    return 0.95;
  },

  // Eerie shimmer pad for the spore field.
  spore_pad(b) {
    const t = b.t0;
    const dur = 3.2;
    const lfo = mkOsc(b, 'sine', 6.3, t, dur);
    const lfoGain = mkGain(b);
    lfoGain.gain.value = 0.05;
    lfo.connect(lfoGain);
    const freqs = [519, 524, 781, 786, 1173];
    for (let i = 0; i < freqs.length; i++) {
      const o = mkOsc(b, i < 4 ? 'sine' : 'triangle', freqs[i], t, dur);
      const g = mkGain(b);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(i < 4 ? 0.11 : 0.05, t + 0.5);
      g.gain.setValueAtTime(i < 4 ? 0.11 : 0.05, t + dur - 1.1);
      g.gain.linearRampToValueAtTime(0, t + dur);
      lfoGain.connect(g.gain); // slow tremolo shimmer
      chain(o, g, b.out);
    }
    return dur;
  },

  // Ascending promotion fanfare.
  promote(b) {
    const t = b.t0;
    const notes: ReadonlyArray<readonly [number, number, number]> = [
      [523.25, 0, 0.09],
      [659.25, 0.09, 0.09],
      [784, 0.18, 0.09],
      [1046.5, 0.27, 0.26],
    ];
    for (const [f, dt, d] of notes) {
      const o = mkOsc(b, 'square', f, t + dt, d + 0.05);
      const lp = mkFilter(b, 'lowpass', 5200, 0.5);
      const g = mkGain(b);
      env(g.gain, t + dt, 0.005, 0.16, d * 0.55);
      chain(o, lp, g, b.out);
      const o2 = mkOsc(b, 'triangle', f * 2, t + dt, d + 0.05);
      const g2 = mkGain(b);
      env(g2.gain, t + dt, 0.005, 0.07, d * 0.5);
      chain(o2, g2, b.out);
    }
    tick(b, t + 0.27, 7000, 0.08, 0.05, 'highpass'); // sparkle
    return 0.7;
  },

  // Wet squelch for building capture.
  capture(b) {
    const t = b.t0;
    const p = b.pitch;
    const o = b.c.createOscillator();
    o.type = 'sine';
    const curve = new Float32Array([300, 150, 390, 170, 430, 210, 320].map((f) => f * p));
    o.frequency.setValueCurveAtTime(curve, t, 0.3);
    const g = mkGain(b);
    env(g.gain, t, 0.012, 0.5, 0.11);
    chain(o, g, b.out);
    o.start(t);
    o.stop(t + 0.42);
    b.srcs.push(o);
    const n = mkNoise(b, t, 0.34);
    const f = mkFilter(b, 'bandpass', 620, 0.7);
    sweep(f.frequency, t, 800, 260, 0.3);
    const ng = mkGain(b);
    env(ng.gain, t, 0.02, 0.24, 0.1);
    chain(n, f, ng, b.out);
    return 0.45;
  },

  // Power-down descending sweep.
  power_down(b) {
    const t = b.t0;
    const o = mkOsc(b, 'sawtooth', 380, t, 0.85);
    sweep(o.frequency, t, 380, 52, 0.75);
    const lp = mkFilter(b, 'lowpass', 1400, 0.8);
    sweep(lp.frequency, t, 1400, 180, 0.75);
    const g = mkGain(b);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.32, t + 0.04);
    g.gain.setValueAtTime(0.32, t + 0.45);
    g.gain.linearRampToValueAtTime(0, t + 0.85);
    chain(o, lp, g, b.out);
    return 0.9;
  },

  // Rising sweep + confirmation blip when power is restored.
  power_up(b) {
    const t = b.t0;
    const o = mkOsc(b, 'triangle', 85, t, 0.5);
    sweep(o.frequency, t, 85, 520, 0.42);
    const g = mkGain(b);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.3, t + 0.08);
    g.gain.linearRampToValueAtTime(0, t + 0.5);
    chain(o, g, b.out);
    const o2 = mkOsc(b, 'sine', 660, t + 0.44, 0.1);
    const g2 = mkGain(b);
    env(g2.gain, t + 0.44, 0.005, 0.25, 0.03);
    chain(o2, g2, b.out);
    return 0.6;
  },

  // Triumphant sting (A major lift).
  victory(b) {
    const t = b.t0;
    const seq: ReadonlyArray<readonly [number, number, number]> = [
      [220, 0, 0.14],
      [293.66, 0.16, 0.14],
      [369.99, 0.32, 0.14],
      [440, 0.5, 0.9],
    ];
    for (const [f, dt, d] of seq) {
      const o = mkOsc(b, 'square', f, t + dt, d + 0.1);
      const lp = mkFilter(b, 'lowpass', 3800, 0.6);
      const g = mkGain(b);
      env(g.gain, t + dt, 0.008, 0.2, d * 0.6);
      chain(o, lp, g, b.out);
    }
    // final major chord swell
    for (const f of [220, 277.18, 329.63, 554.37]) {
      const o = mkOsc(b, 'triangle', f, t + 0.5, 1.3);
      const g = mkGain(b);
      g.gain.setValueAtTime(0, t + 0.5);
      g.gain.linearRampToValueAtTime(0.12, t + 0.7);
      g.gain.setTargetAtTime(0, t + 1.2, 0.3);
      chain(o, g, b.out);
    }
    // snare-style hit on the landing
    tick(b, t + 0.5, 1900, 0.3, 0.045);
    return 2.2;
  },

  // Grim descending sting.
  defeat(b) {
    const t = b.t0;
    const seq: ReadonlyArray<readonly [number, number, number]> = [
      [110, 0, 0.5],
      [98, 0.5, 0.5],
      [87.31, 1.0, 0.6],
      [82.41, 1.6, 1.2],
    ];
    for (const [f, dt, d] of seq) {
      const o = mkOsc(b, 'sawtooth', f, t + dt, d + 0.1);
      const lp = mkFilter(b, 'lowpass', 520, 0.7);
      const g = mkGain(b);
      g.gain.setValueAtTime(0, t + dt);
      g.gain.linearRampToValueAtTime(0.26, t + dt + 0.06);
      g.gain.setTargetAtTime(0, t + dt + d * 0.6, d * 0.3);
      chain(o, lp, g, b.out);
      const o2 = mkOsc(b, 'sawtooth', f * 1.06, t + dt, d + 0.1); // dissonant rub
      const g2 = mkGain(b);
      g2.gain.setValueAtTime(0, t + dt);
      g2.gain.linearRampToValueAtTime(0.08, t + dt + 0.08);
      g2.gain.setTargetAtTime(0, t + dt + d * 0.6, d * 0.3);
      chain(o2, lp, g2, b.out);
    }
    // low timpani thumps
    for (const dt of [0, 1.6]) {
      const o = mkOsc(b, 'sine', 70, t + dt, 0.5);
      sweep(o.frequency, t + dt, 70, 40, 0.4);
      const g = mkGain(b);
      env(g.gain, t + dt, 0.004, 0.5, 0.16);
      chain(o, g, b.out);
    }
    return 3.0;
  },

  // Radio-static attention blip (announcer fallback).
  radio_blip(b) {
    const t = b.t0;
    tick(b, t, 1400, 0.25, 0.018);
    tick(b, t + 0.09, 1600, 0.22, 0.016);
    const o = mkOsc(b, 'sine', 950, t + 0.17, 0.1);
    const g = mkGain(b);
    env(g.gain, t + 0.17, 0.004, 0.28, 0.03);
    chain(o, g, b.out);
    return 0.32;
  },
};

const BASE_GAIN: Record<SfxName, number> = {
  fire_claw: 0.5,
  fire_cannon: 0.8,
  fire_blast: 0.7,
  fire_pierce: 0.5,
  fire_electric: 0.55,
  impact_thud: 0.5,
  impact_clank: 0.5,
  explosion: 0.85,
  explosion_big: 1.0,
  place: 0.7,
  sell: 0.6,
  click: 0.5,
  error: 0.6,
  select: 0.5,
  alarm: 0.75,
  nuke: 1.1,
  storm_strike: 0.8,
  spore_pad: 0.5,
  promote: 0.6,
  capture: 0.6,
  power_down: 0.6,
  power_up: 0.55,
  victory: 0.9,
  defeat: 0.9,
  radio_blip: 0.7,
};

// --- Public play API ------------------------------------------------------------------

export function playSfx(name: SfxName, opts: PlaySfxOpts = {}): void {
  if (!sfxEnabled) return;
  const c = getContext();
  if (!c || !sfxBus || !noiseBuf) return;
  if (c.state !== 'running') return; // wait for user-gesture unlock
  if (throttled(GROUP_OF[name])) return;

  const now = c.currentTime;
  pruneVoices(now);
  while (voices.length >= MAX_VOICES) stealVoice(now);

  const vGain = c.createGain();
  const g = (opts.gain ?? 1) * BASE_GAIN[name];
  vGain.gain.value = Math.max(0, Math.min(1.5, g));

  let pan: StereoPannerNode | null = null;
  const panVal = Math.max(-0.8, Math.min(0.8, opts.pan ?? 0));
  if (typeof c.createStereoPanner === 'function') {
    pan = c.createStereoPanner();
    pan.pan.value = panVal;
    vGain.connect(pan);
    pan.connect(sfxBus);
  } else {
    vGain.connect(sfxBus);
  }

  const b: Build = {
    c,
    t0: now + 0.004,
    out: vGain,
    pitch: Math.max(0.25, opts.pitch ?? 1),
    srcs: [],
  };
  const dur = RECIPES[name](b);
  voices.push({ gain: vGain, pan, sources: b.srcs, startTime: now, endTime: now + dur + 0.15 });
}

// Convenience wrappers for UI wiring (selection acknowledge varies pitch per call).
export function playSelectAcknowledge(): void {
  playSfx('select', { pitch: 0.9 + Math.random() * 0.25 });
}

export function playUiClick(): void {
  playSfx('click');
}

export function playErrorBuzz(): void {
  playSfx('error');
}

export function playSellSound(): void {
  playSfx('sell');
}
