// =============================================================================
// FABLE WARS — recorded SFX sample loader (Owner F).
// Small decoded-buffer cache over public/audio/sfx/ (cherry-picked CC0 Kenney
// recordings, see CREDITS.md). Every manifest entry ships as <name>.ogg with a
// <name>.m4a sibling because Safari's decodeAudioData rejects Ogg Vorbis.
// Loading is fire-and-forget: a file that fails to fetch or decode is silently
// skipped — sfx.ts falls back to its synth recipe whenever getSample() returns
// null, so missing assets can never break the game.
// =============================================================================

/** Short names of every shipped sample (public/audio/sfx/<name>.ogg|.m4a). */
export const SAMPLE_MANIFEST = [
  // weapon fire
  'shot_small', // laser pip — PIERCE
  'shot_zap', // retro zap — ELECTRIC
  'shot_heavy', // big laser — CANNON
  'claw', // meaty punch — CLAW swipes
  // explosions
  'boom_small', // unit pop
  'boom_med', // unit pop, crunchier variant
  'boom_big', // low-frequency rumble layer
  'collapse', // long crunch — building collapse
  // impacts
  'hit_metal', // armor clank
  'hit_thud', // soft body hit
  'hit_crunch', // rocky crunch variant
  // superweapon
  'forcefield', // charge shimmer layered under the alarm siren
  // interface
  'ui_click',
  'ui_confirm',
  'ui_error',
  'ui_notify',
] as const;

export type SampleName = (typeof SAMPLE_MANIFEST)[number];

const SAMPLE_BASE = '/audio/sfx'; // public/ root, same convention as /sprites

const buffers = new Map<string, AudioBuffer>();
let loadStarted = false;

/** decodeAudioData with callback-form fallback for older Safari. */
function decode(ctx: AudioContext, bytes: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    try {
      const maybe = ctx.decodeAudioData(bytes, resolve, reject);
      // Modern browsers also return a promise; absorb its rejection so the
      // callback path stays the single source of truth without unhandled noise.
      if (maybe && typeof (maybe as Promise<AudioBuffer>).catch === 'function') {
        (maybe as Promise<AudioBuffer>).catch(() => undefined);
      }
    } catch (err) {
      reject(err instanceof Error ? err : new Error('decodeAudioData threw'));
    }
  });
}

async function loadOne(ctx: AudioContext, name: string): Promise<void> {
  // .ogg first (smaller), then the .m4a sibling for browsers that reject Vorbis.
  for (const ext of ['ogg', 'm4a'] as const) {
    try {
      const res = await fetch(`${SAMPLE_BASE}/${name}.${ext}`);
      if (!res.ok) continue;
      const bytes = await res.arrayBuffer();
      const buf = await decode(ctx, bytes);
      buffers.set(name, buf);
      return;
    } catch {
      // fetch or decode failed — try the next container, else give up silently
    }
  }
}

/**
 * Fetch + decode every manifest entry into the cache. Idempotent; safe to call
 * on every unlock gesture. Never rejects — per-file failures are swallowed and
 * the synth fallback covers the gaps.
 */
export async function loadSamples(ctx: AudioContext): Promise<void> {
  if (loadStarted) return;
  loadStarted = true;
  await Promise.all(SAMPLE_MANIFEST.map((name) => loadOne(ctx, name)));
}

/** Decoded buffer for a shipped sample, or null while loading / on failure. */
export function getSample(name: string): AudioBuffer | null {
  return buffers.get(name) ?? null;
}
