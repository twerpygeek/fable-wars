// =============================================================================
// POCKET ALERT — local match history ("Service Record"). Finished matches are
// stored in localStorage so the main menu can list past operations and replay
// any setup (seed included — the exact same map regenerates). Storage is
// best-effort: quota errors and corrupted payloads degrade to "no history",
// never to a crash.
// =============================================================================

import type { AIDifficulty, FactionId, PlayerStats } from '../core/types';

const HISTORY_KEY = 'pa-history';
const HISTORY_CAP = 30; // newest-first; older entries fall off

export interface MatchResult {
  dateISO: string; // when the match ended
  seed: number;
  mapSize: 'S' | 'M' | 'L';
  water: 'low' | 'medium' | 'high';
  crates: boolean;
  durationSec: number;
  victory: boolean; // from the human player's perspective
  players: {
    name: string;
    faction: FactionId;
    colorIdx: number;
    isHuman: boolean;
    difficulty: AIDifficulty | null;
    eliminated: boolean;
    stats: PlayerStats;
  }[];
  humanIdx: number; // index into players
}

/** Prepend a finished match to the record, keeping at most HISTORY_CAP entries. */
export function recordMatch(r: MatchResult): void {
  try {
    const list = getHistory();
    list.unshift(r);
    if (list.length > HISTORY_CAP) list.length = HISTORY_CAP;
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  } catch {
    // Storage full or unavailable — the service record is a luxury, not a need.
  }
}

/** All recorded matches, newest first. Empty array on absence or corruption. */
export function getHistory(): MatchResult[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is MatchResult =>
        typeof r === 'object' &&
        r !== null &&
        Array.isArray((r as MatchResult).players) &&
        (r as MatchResult).players.length > 0,
    );
  } catch {
    return [];
  }
}

/** Wipe the service record. */
export function clearHistory(): void {
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    // Nothing to do — if storage is unreadable the record is effectively clear.
  }
}
