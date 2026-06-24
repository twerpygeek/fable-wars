// =============================================================================
// FABLE WARS — EVA-style announcer (Owner F).
// speechSynthesis with a deep/slow delivery, priority queue (0 = critical,
// 1 = combat, 2 = production), no overlap, per-line dedupe cooldowns, and a
// radio-static SFX fallback for important lines when speech is unavailable.
// All lines come from the DESIGN.md announcer script.
// =============================================================================

import { TICK_MS, UNDER_ATTACK_COOLDOWN } from '../core/constants';
import { playSfx } from './sfx';

export type AnnounceKey =
  | 'constructionComplete'
  | 'unitReady'
  | 'baseUnderAttack'
  | 'harvesterUnderAttack'
  | 'insufficientFunds'
  | 'lowPower'
  | 'powerRestored'
  | 'buildingCaptured'
  | 'enemyBuildingCaptured'
  | 'superweaponReady'
  | 'enemySuperweaponDetected'
  | 'enemySuperweaponLaunch'
  | 'reinforcements'
  | 'enemyEliminated'
  | 'victory'
  | 'defeat';

interface LineDef {
  text: string;
  priority: 0 | 1 | 2;
  cooldownMs: number;
}

const UA_MS = UNDER_ATTACK_COOLDOWN * TICK_MS; // announcer dedupe window (15 s)

const LINES: Record<AnnounceKey, LineDef> = {
  constructionComplete: { text: 'Construction complete.', priority: 2, cooldownMs: 3000 },
  unitReady: { text: 'New creature ready.', priority: 2, cooldownMs: 3000 },
  baseUnderAttack: { text: 'Our base is under attack.', priority: 1, cooldownMs: UA_MS },
  harvesterUnderAttack: { text: 'Our harvester is under attack.', priority: 1, cooldownMs: UA_MS },
  insufficientFunds: { text: 'Insufficient funds.', priority: 2, cooldownMs: 6000 },
  lowPower: { text: 'Low power.', priority: 2, cooldownMs: 12000 },
  powerRestored: { text: 'Power restored.', priority: 2, cooldownMs: 12000 },
  buildingCaptured: { text: 'Building captured.', priority: 1, cooldownMs: 4000 },
  enemyBuildingCaptured: { text: 'Enemy building captured.', priority: 1, cooldownMs: 4000 },
  superweaponReady: { text: 'Superweapon ready.', priority: 0, cooldownMs: 8000 },
  enemySuperweaponDetected: { text: 'Warning: enemy superweapon detected.', priority: 0, cooldownMs: 8000 },
  enemySuperweaponLaunch: { text: 'Enemy superweapon launch detected.', priority: 0, cooldownMs: 4000 },
  reinforcements: { text: 'Reinforcements have arrived.', priority: 2, cooldownMs: 60000 },
  enemyEliminated: { text: 'Enemy commander eliminated.', priority: 0, cooldownMs: 2000 },
  victory: { text: 'Commander, victory is ours!', priority: 0, cooldownMs: 60000 },
  defeat: { text: 'Mission failed. Our base has fallen.', priority: 0, cooldownMs: 60000 },
};

// --- Plumbing ----------------------------------------------------------------------

let voiceEnabled = true;
let chosenVoice: SpeechSynthesisVoice | null = null;
let voicesLoaded = false;
let primed = false;

interface QItem {
  key: AnnounceKey;
  priority: number;
  seq: number;
}

const queue: QItem[] = [];
let current: QItem | null = null;
let seqCounter = 0;
const lastSpokenAt = new Map<AnnounceKey, number>();
let watchdog: number | null = null;

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function synthAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof SpeechSynthesisUtterance !== 'undefined'
  );
}

function pickVoice(): void {
  if (!synthAvailable()) return;
  const vs = window.speechSynthesis.getVoices();
  if (vs.length === 0) return;
  voicesLoaded = true;
  let best: SpeechSynthesisVoice | null = null;
  let bestScore = -1;
  for (const v of vs) {
    const name = v.name.toLowerCase();
    const lang = v.lang.toLowerCase();
    if (!lang.startsWith('en')) continue;
    let s = 1;
    if (name.includes('daniel')) s += 100;
    if (name.includes('google uk english male')) s += 90;
    if (lang === 'en-gb' || name.includes('uk english')) s += 10;
    if (name.includes('male') && !name.includes('female')) s += 5;
    if (v.localService) s += 2;
    if (s > bestScore) {
      bestScore = s;
      best = v;
    }
  }
  if (best) chosenVoice = best;
}

/** Kick voice loading early (voices arrive async in Chrome). Idempotent. */
export function primeAnnouncer(): void {
  if (primed || !synthAvailable()) return;
  primed = true;
  pickVoice();
  window.speechSynthesis.onvoiceschanged = pickVoice;
}

function ensureWatchdog(): void {
  if (watchdog !== null || !synthAvailable()) return;
  // Chrome occasionally drops onend; keep the queue moving regardless.
  watchdog = window.setInterval(() => {
    const synth = window.speechSynthesis;
    if (current && !synth.speaking && !synth.pending) {
      current = null;
      pump();
    } else if (!current && queue.length > 0) {
      pump();
    }
  }, 1000);
}

function pump(): void {
  if (!synthAvailable() || !voiceEnabled) return;
  if (current || queue.length === 0) return;
  queue.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
  const item = queue.shift();
  if (!item) return;
  current = item;
  const u = new SpeechSynthesisUtterance(LINES[item.key].text);
  if (!voicesLoaded) pickVoice();
  if (chosenVoice) u.voice = chosenVoice;
  u.rate = 0.92;
  u.pitch = 0.7;
  u.volume = 1;
  const done = (): void => {
    if (current === item) current = null;
    setTimeout(pump, 60);
  };
  u.onend = done;
  u.onerror = done;
  try {
    window.speechSynthesis.speak(u);
  } catch {
    done();
  }
  ensureWatchdog();
}

// --- Public API -----------------------------------------------------------------------

/**
 * Queue an announcer line. Lower priority number = more important.
 * Never interrupts a same-or-higher priority line; dedupes repeats within
 * each line's cooldown window.
 */
export function announce(key: AnnounceKey): void {
  if (!voiceEnabled) return;
  const line = LINES[key];
  const t = nowMs();

  const last = lastSpokenAt.get(key);
  if (last !== undefined && t - last < line.cooldownMs) return;
  if (current && current.key === key) return;
  for (const q of queue) if (q.key === key) return;
  lastSpokenAt.set(key, t);

  if (!synthAvailable()) {
    // Radio-static attention blip fallback for critical/combat lines.
    if (line.priority <= 1) playSfx('radio_blip', { gain: 0.8 });
    return;
  }

  primeAnnouncer();
  const item: QItem = { key, priority: line.priority, seq: seqCounter++ };

  if (current && line.priority < current.priority) {
    // Strictly more important than what is being said: cut in.
    queue.unshift(item);
    current = null;
    window.speechSynthesis.cancel();
    pump();
  } else {
    queue.push(item);
    pump();
  }
}

/** Drop everything queued and stop the current line (used before game-over). */
export function flushAnnouncer(): void {
  queue.length = 0;
  current = null;
  if (synthAvailable()) window.speechSynthesis.cancel();
}

export function setVoiceEnabled(on: boolean): void {
  if (voiceEnabled === on) return;
  voiceEnabled = on;
  if (!on) flushAnnouncer();
}

export function isVoiceEnabled(): boolean {
  return voiceEnabled;
}
