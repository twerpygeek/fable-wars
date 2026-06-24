// =============================================================================
// FABLE WARS — procedural chiptune-military soundtrack (Owner F).
// ~115 BPM, A minor, 16-bar form, scheduled with the classic WebAudio
// lookahead pattern (25 ms timer, 100 ms scheduling horizon) so the loop is
// seamless. Intensity 0..1 layers in combat percussion and busier hats.
// The whole arrangement is generated from a fixed seed so every loop pass is
// identical (musically coherent) without shipping any audio assets.
// =============================================================================

import { mulberry32 } from '../core/rng';
import { getContext, getMusicBus } from './sfx';

const BPM = 115;
const SPB = 60 / BPM; // seconds per beat
const STEP = SPB / 4; // 16th-note step
const STEPS_PER_BAR = 16;
const BARS = 16;
const TOTAL_STEPS = BARS * STEPS_PER_BAR;
const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.1; // seconds

function midiHz(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

interface BarChord {
  root: number; // bass root, midi
  triad: number[]; // pad voicing, midi
}

const Am: BarChord = { root: 45, triad: [57, 60, 64] };
const Fc: BarChord = { root: 41, triad: [53, 57, 60] };
const Gc: BarChord = { root: 43, triad: [55, 59, 62] };
const Ec: BarChord = { root: 40, triad: [52, 56, 59] }; // E major (harmonic minor V)

// 16-bar form: dark, marching, resolving onto the dominant before the loop.
const PROG: BarChord[] = [Am, Am, Fc, Gc, Am, Am, Fc, Ec, Am, Gc, Fc, Gc, Am, Fc, Ec, Ec];

// Arp motif index sequences (into triad + octave extensions), one per bar parity.
const ARP_SEQ: number[][] = [
  [0, 1, 2, 3, 2, 1, 0, 2],
  [0, 2, 1, 3, 4, 3, 2, 1],
];

// Deterministic per-bar variation, fixed at module load for a seamless loop.
const BAR_VARIANT: number[] = [];
const EXTRA_KICK: boolean[] = [];
{
  const rng = mulberry32(0xa11ce5);
  for (let i = 0; i < BARS; i++) {
    BAR_VARIANT.push(Math.floor(rng() * 4));
    EXTRA_KICK.push(rng() < 0.45);
  }
}

// --- Graph & scheduler state ----------------------------------------------------

interface MusicGraph {
  c: AudioContext;
  sub: GainNode; // music sub-mix -> musicBus
  bassFilter: BiquadFilterNode;
  delaySend: GainNode; // lead echo send
  noise: AudioBuffer;
  teardown: AudioNode[];
}

let graph: MusicGraph | null = null;
let timer: number | null = null;
let running = false;
let enabled = true;
let stepIndex = 0;
let nextTime = 0;
let targetIntensity = 0;
let currentIntensity = 0;

function buildGraph(c: AudioContext, bus: GainNode): MusicGraph {
  const sub = c.createGain();
  sub.gain.value = enabled ? 1 : 0;
  sub.connect(bus);

  const bassFilter = c.createBiquadFilter();
  bassFilter.type = 'lowpass';
  bassFilter.frequency.value = 480;
  bassFilter.Q.value = 0.7;
  bassFilter.connect(sub);

  // Dotted-eighth echo for the arp lead.
  const delaySend = c.createGain();
  delaySend.gain.value = 1;
  const delay = c.createDelay(1.0);
  delay.delayTime.value = STEP * 3;
  const feedback = c.createGain();
  feedback.gain.value = 0.34;
  const wet = c.createGain();
  wet.gain.value = 0.4;
  const damp = c.createBiquadFilter();
  damp.type = 'lowpass';
  damp.frequency.value = 2400;
  delaySend.connect(delay);
  delay.connect(damp);
  damp.connect(feedback);
  feedback.connect(delay);
  damp.connect(wet);
  wet.connect(sub);

  const noise = c.createBuffer(1, Math.floor(c.sampleRate * 1), c.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

  return { c, sub, bassFilter, delaySend, noise, teardown: [sub, bassFilter, delaySend, delay, feedback, wet, damp] };
}

// --- Instruments ------------------------------------------------------------------

function bassNote(g: MusicGraph, t: number, freq: number, vel: number): void {
  const o = g.c.createOscillator();
  o.type = 'square';
  o.frequency.value = freq;
  const gn = g.c.createGain();
  const peak = 0.3 * vel;
  gn.gain.setValueAtTime(0, t);
  gn.gain.linearRampToValueAtTime(peak, t + 0.008);
  gn.gain.setValueAtTime(peak, t + STEP * 1.35);
  gn.gain.linearRampToValueAtTime(0, t + STEP * 1.85);
  o.connect(gn);
  gn.connect(g.bassFilter);
  o.start(t);
  o.stop(t + STEP * 2);
}

function kick(g: MusicGraph, t: number, vel: number): void {
  const o = g.c.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(115, t);
  o.frequency.exponentialRampToValueAtTime(40, t + 0.09);
  const gn = g.c.createGain();
  gn.gain.setValueAtTime(0, t);
  gn.gain.linearRampToValueAtTime(0.85 * vel, t + 0.003);
  gn.gain.setTargetAtTime(0, t + 0.01, 0.045);
  o.connect(gn);
  gn.connect(g.sub);
  o.start(t);
  o.stop(t + 0.2);
}

function snare(g: MusicGraph, t: number, vel: number): void {
  const n = g.c.createBufferSource();
  n.buffer = g.noise;
  const f = g.c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 1900;
  f.Q.value = 0.8;
  const gn = g.c.createGain();
  gn.gain.setValueAtTime(0, t);
  gn.gain.linearRampToValueAtTime(0.34 * vel, t + 0.002);
  gn.gain.setTargetAtTime(0, t + 0.005, 0.05);
  n.connect(f);
  f.connect(gn);
  gn.connect(g.sub);
  n.start(t, Math.random() * 0.5);
  n.stop(t + 0.25);
  const o = g.c.createOscillator(); // body tone
  o.type = 'triangle';
  o.frequency.value = 196;
  const og = g.c.createGain();
  og.gain.setValueAtTime(0, t);
  og.gain.linearRampToValueAtTime(0.16 * vel, t + 0.002);
  og.gain.setTargetAtTime(0, t + 0.005, 0.03);
  o.connect(og);
  og.connect(g.sub);
  o.start(t);
  o.stop(t + 0.15);
}

function hat(g: MusicGraph, t: number, vel: number, open: boolean): void {
  const n = g.c.createBufferSource();
  n.buffer = g.noise;
  const f = g.c.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = 7000;
  const gn = g.c.createGain();
  gn.gain.setValueAtTime(0, t);
  gn.gain.linearRampToValueAtTime(0.15 * vel, t + 0.001);
  gn.gain.setTargetAtTime(0, t + 0.002, open ? 0.08 : 0.014);
  n.connect(f);
  f.connect(gn);
  gn.connect(g.sub);
  n.start(t, Math.random() * 0.5);
  n.stop(t + (open ? 0.5 : 0.12));
}

function padChord(g: MusicGraph, t: number, triad: number[], durSec: number, inten: number): void {
  const filt = g.c.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.value = 700 + 700 * inten;
  filt.Q.value = 0.6;
  filt.connect(g.sub);
  for (const m of triad) {
    for (const det of [-7, 7]) {
      const o = g.c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = midiHz(m);
      o.detune.value = det;
      const gn = g.c.createGain();
      gn.gain.setValueAtTime(0, t);
      gn.gain.linearRampToValueAtTime(0.045, t + 0.35);
      gn.gain.setValueAtTime(0.045, t + durSec - 0.25);
      gn.gain.linearRampToValueAtTime(0, t + durSec + 0.35);
      o.connect(gn);
      gn.connect(filt);
      o.start(t);
      o.stop(t + durSec + 0.45);
    }
  }
}

function leadNote(g: MusicGraph, t: number, freq: number, vel: number): void {
  const o = g.c.createOscillator();
  o.type = 'square';
  o.frequency.value = freq;
  const gn = g.c.createGain();
  gn.gain.setValueAtTime(0, t);
  gn.gain.linearRampToValueAtTime(0.11 * vel, t + 0.004);
  gn.gain.setTargetAtTime(0, t + STEP * 0.9, 0.05);
  o.connect(gn);
  gn.connect(g.sub);
  gn.connect(g.delaySend);
  o.start(t);
  o.stop(t + STEP * 3);
}

function combatPulse(g: MusicGraph, t: number, freq: number, vel: number): void {
  const o = g.c.createOscillator();
  o.type = 'triangle';
  o.frequency.value = freq;
  const gn = g.c.createGain();
  gn.gain.setValueAtTime(0, t);
  gn.gain.linearRampToValueAtTime(0.07 * vel, t + 0.003);
  gn.gain.setTargetAtTime(0, t + 0.01, 0.025);
  o.connect(gn);
  gn.connect(g.sub);
  o.start(t);
  o.stop(t + 0.12);
}

function crash(g: MusicGraph, t: number, vel: number): void {
  const n = g.c.createBufferSource();
  n.buffer = g.noise;
  const f = g.c.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = 4000;
  const gn = g.c.createGain();
  gn.gain.setValueAtTime(0, t);
  gn.gain.linearRampToValueAtTime(0.22 * vel, t + 0.005);
  gn.gain.setTargetAtTime(0, t + 0.02, 0.4);
  n.connect(f);
  f.connect(gn);
  gn.connect(g.sub);
  n.start(t, Math.random() * 0.3);
  n.stop(t + 1.6);
}

// --- Pattern -------------------------------------------------------------------------

function scheduleStep(g: MusicGraph, globalStep: number, time: number): void {
  const bar = Math.floor(globalStep / STEPS_PER_BAR) % BARS;
  const step = globalStep % STEPS_PER_BAR;
  const chord = PROG[bar];
  const inten = currentIntensity;
  const isFillBar = bar === 7 || bar === 15;

  // Driving 8th-note bass.
  if (step % 2 === 0) {
    let note = chord.root;
    const v = BAR_VARIANT[bar];
    if (step === 14) note = (v & 1) !== 0 ? chord.root + 12 : chord.root + 7;
    else if (step === 6 && (v & 2) !== 0) note = chord.root + 7;
    const vel = step % 8 === 0 ? 1 : 0.78;
    bassNote(g, time, midiHz(note), vel);
  }

  // Kick on 1 and 3, with deterministic syncopation + combat extras.
  if (
    step === 0 ||
    step === 8 ||
    (EXTRA_KICK[bar] && step === 10) ||
    (inten > 0.55 && step === 6 && (bar & 1) === 1)
  ) {
    kick(g, time, step === 0 ? 1 : 0.85);
  }

  // Snare on 2 and 4; rolling fill at the end of bars 8 and 16.
  if (isFillBar && step >= 12) {
    snare(g, time, 0.5 + 0.15 * (step - 12));
  } else if (step === 4 || step === 12) {
    snare(g, time, 0.9);
  }

  // Hats: 8ths normally, 16ths under combat intensity, open hat accent.
  const hatEvery = inten > 0.45 ? 1 : 2;
  if (step % hatEvery === 0) {
    const open = step === 14 && inten > 0.45;
    const vel = step % 4 === 0 ? 0.55 : step % 2 === 0 ? 0.4 : 0.26;
    hat(g, time, vel * (0.8 + 0.4 * inten), open);
  }

  // Dark detuned pad, one chord per bar.
  if (step === 0) padChord(g, time, chord.triad, STEPS_PER_BAR * STEP, inten);

  // Delayed arp lead: second 8 bars of the form (and everywhere in combat).
  const leadOn = bar >= 8 || inten > 0.5;
  if (leadOn && step % 2 === 0) {
    const seq = ARP_SEQ[bar % 2];
    const idx = seq[(step / 2) | 0];
    const note = chord.triad[idx % 3] + 12 * (1 + Math.floor(idx / 3));
    leadNote(g, time, midiHz(note), 0.55 + 0.35 * inten);
  }

  // Combat-only staccato pulse layer on the offbeats.
  if (inten > 0.5 && step % 4 === 2) {
    combatPulse(g, time, midiHz(chord.root + 24), inten);
  }

  // Cymbal wash at each half of the form.
  if (step === 0 && (bar === 0 || bar === 8)) crash(g, time, bar === 0 ? 0.5 : 0.35);
}

// --- Scheduler ----------------------------------------------------------------------

function schedulerTick(): void {
  if (!running || !graph) return;
  const c = graph.c;
  // If timers were throttled (hidden tab) or the context was suspended for a
  // while, realign instead of burst-scheduling a backlog of past steps.
  if (nextTime < c.currentTime - 0.25) {
    nextTime = c.currentTime + 0.05;
  }
  while (nextTime < c.currentTime + SCHEDULE_AHEAD) {
    currentIntensity += (targetIntensity - currentIntensity) * 0.03;
    if (Math.abs(targetIntensity - currentIntensity) < 0.01) currentIntensity = targetIntensity;
    if (enabled) scheduleStep(graph, stepIndex, nextTime);
    stepIndex = (stepIndex + 1) % TOTAL_STEPS;
    nextTime += STEP;
  }
}

export function startMusic(): void {
  if (running) return;
  const c = getContext();
  const bus = getMusicBus();
  if (!c || !bus) return;
  graph = buildGraph(c, bus);
  stepIndex = 0;
  nextTime = c.currentTime + 0.08;
  running = true;
  timer = window.setInterval(schedulerTick, LOOKAHEAD_MS);
}

export function stopMusic(): void {
  if (!running) return;
  running = false;
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  const g = graph;
  graph = null;
  if (g) {
    const t = g.c.currentTime;
    g.sub.gain.cancelScheduledValues(t);
    g.sub.gain.setTargetAtTime(0, t, 0.12);
    setTimeout(() => {
      for (const n of g.teardown) {
        try {
          n.disconnect();
        } catch {
          /* already disconnected */
        }
      }
    }, 700);
  }
}

export function isMusicRunning(): boolean {
  return running;
}

export function setMusicEnabled(on: boolean): void {
  enabled = on;
  if (graph) {
    const t = graph.c.currentTime;
    graph.sub.gain.cancelScheduledValues(t);
    graph.sub.gain.setTargetAtTime(on ? 1 : 0, t, 0.08);
  }
}

/** 0 = calm patrol loop, 1 = full combat arrangement. Smoothed internally. */
export function setMusicIntensity(v: number): void {
  targetIntensity = Math.max(0, Math.min(1, v));
}
