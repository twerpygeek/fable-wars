// Deterministic RNG (mulberry32). The sim's RNG state lives in GameState.rngState
// so replays/headless runs are reproducible. Never use Math.random() in sim code.

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Step the sim RNG stored in state: returns [0,1) and the new state.
export function simRandom(state: { rngState: number }): number {
  let a = state.rngState >>> 0;
  a = (a + 0x6d2b79f5) | 0;
  state.rngState = a;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function simRandInt(state: { rngState: number }, min: number, max: number): number {
  return min + Math.floor(simRandom(state) * (max - min + 1));
}

export function hashSeed(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
