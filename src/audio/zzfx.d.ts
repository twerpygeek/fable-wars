// Ambient types for the 'zzfx' npm package (MIT, Frank Force) — it ships plain
// JS with no declarations. Only the surface we use is typed.
declare module 'zzfx' {
  export interface ZzfxApi {
    /** Master volume scale baked into buildSamples output (default 0.3). */
    volume: number;
    /** Sample rate used when generating sample arrays (default 44100). */
    sampleRate: number;
    /** Shared context — created at import time; reassignable to ours. */
    audioContext: AudioContext;
    play(...parameters: (number | undefined)[]): AudioBufferSourceNode;
    playSamples(
      sampleChannels: ArrayLike<number>[],
      volumeScale?: number,
      rate?: number,
      pan?: number,
      loop?: boolean,
    ): AudioBufferSourceNode;
    buildSamples(...parameters: (number | undefined)[]): number[];
    getNote(semitoneOffset?: number, rootNoteFrequency?: number): number;
  }
  export const ZZFX: ZzfxApi;
  export function zzfx(...parameters: (number | undefined)[]): AudioBufferSourceNode;
}
