// =============================================================================
// FABLE WARS — AudioSystem (Owner F).
// Routes GameEvents from the sim into the SFX synth, procedural music layer
// and the EVA announcer. Positional audio: pan/volume by distance from the
// camera center, culled beyond ~1.5 screens. Reads GameState strictly
// read-only. All randomness here is cosmetic (allowed outside the sim).
// =============================================================================

import type { Camera, GameEvent, GameState, PlayerId, Vec2 } from '../core/types';
import { Element, WeaponClass } from '../core/types';
import { TILE_HALF_H, TILE_HALF_W } from '../core/constants';
import { DATA } from '../data';
import type { SfxName } from './sfx';
import {
  playBark,
  playCheer,
  playCrateChime,
  playSfx,
  playTauntBlip,
  resumeContext,
  setSfxEnabled,
} from './sfx';
import {
  setMusicEnabled,
  setMusicIntensity,
  startMusic as musicStart,
  stopMusic as musicStop,
} from './music';
import { announce, flushAnnouncer, primeAnnouncer, setVoiceEnabled } from './announcer';

const COMBAT_BUMP_MS = 20000; // music stays "hot" this long after combat near the player

interface Spatial {
  pan: number;
  gain: number;
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Which superweapon flavor a defId refers to (works for sw ids and faction building ids). */
function swKind(defId: string): 'nuke' | 'storm' | 'spore' {
  const id = defId.toLowerCase();
  if (id.includes('spore') || id.startsWith('verdant')) return 'spore'; // before 'storm': "sporestorm"
  if (id.includes('tsunami') || id.includes('surge') || id.includes('storm') || id.startsWith('tide')) {
    return 'storm';
  }
  return 'nuke'; // magma strike / scorch / unknown
}

export class AudioSystem {
  private combatUntil = 0;
  private musicRunning = false;
  private startAnnounced = false;
  private gameOverHandled = false;

  constructor() {
    primeAnnouncer();
  }

  /** Call on the first user gesture to unlock the AudioContext. */
  resume(): void {
    // Also kicks off the recorded-sample fetch + ZzFX adoption (both lazy,
    // idempotent, and silently degrade to the synth recipes on failure).
    resumeContext();
    primeAnnouncer();
  }

  /**
   * Creature acknowledgement bark for the lead unit of a selection/order
   * (RA2's "lead unit responds" rule). Species voice is derived from the def
   * id; timbre from its element. Internally throttled to 1 per 250 ms, so
   * call freely on every select/command.
   */
  bark(defId: string): void {
    const def = DATA.units[defId];
    playBark(defId, def !== undefined ? def.element : Element.NEUTRAL);
  }

  /** Celebration note for the cheer command (C key) and victory auto-cheer. */
  cheer(): void {
    playCheer();
  }

  setEnabled(sfx: boolean, music: boolean, voice: boolean): void {
    setSfxEnabled(sfx);
    setMusicEnabled(music);
    setVoiceEnabled(voice);
  }

  startMusic(): void {
    this.musicRunning = true;
    musicStart();
  }

  stopMusic(): void {
    this.musicRunning = false;
    musicStop();
  }

  handleEvents(
    events: GameEvent[],
    state: GameState,
    humanPlayer: PlayerId,
    cam: Camera,
    viewW: number,
    viewH: number,
  ): void {
    const t = nowMs();

    // One-time game-start line ("Reinforcements have arrived").
    if (!this.startAnnounced) {
      this.startAnnounced = true;
      if (state.tick < 150 && !this.gameOverHandled) announce('reinforcements');
    }

    for (const ev of events) {
      switch (ev.type) {
        case 'shotFired': {
          const s = this.spatial(ev.pos, cam, viewW, viewH);
          if (!s) break;
          let name: SfxName;
          switch (ev.weaponClass) {
            case WeaponClass.CLAW:
              name = 'fire_claw';
              break;
            case WeaponClass.CANNON:
              name = 'fire_cannon';
              break;
            case WeaponClass.BLAST:
              name = 'fire_blast';
              break;
            default:
              name = ev.element === Element.ELECTRIC ? 'fire_electric' : 'fire_pierce';
          }
          playSfx(name, { pan: s.pan, gain: s.gain, pitch: 0.92 + Math.random() * 0.16 });
          break;
        }

        case 'impact': {
          const s = this.spatial(ev.pos, cam, viewW, viewH);
          if (!s) break;
          let name: SfxName;
          let gain = s.gain;
          if (ev.splash >= 4.5) {
            // Superweapon-scale blast (magma strike epicenter).
            name = 'nuke';
            gain = Math.max(0.6, s.gain);
          } else if (ev.splash >= 2 || ev.weaponClass === WeaponClass.BLAST) {
            name = 'explosion';
            gain = s.gain * 0.8;
          } else if (ev.weaponClass === WeaponClass.CANNON) {
            name = 'impact_clank';
          } else {
            name = 'impact_thud';
          }
          playSfx(name, { pan: s.pan, gain, pitch: 0.94 + Math.random() * 0.12 });
          break;
        }

        case 'entityDied': {
          if (ev.owner === humanPlayer) this.combatUntil = t + COMBAT_BUMP_MS;
          const s = this.spatial(ev.pos, cam, viewW, viewH);
          if (!s) break;
          if (ev.kind === 'building') {
            playSfx('explosion_big', { pan: s.pan, gain: s.gain, pitch: 0.92 + Math.random() * 0.12 });
          } else {
            playSfx('explosion', { pan: s.pan, gain: s.gain * 0.7, pitch: 1.0 + Math.random() * 0.25 });
          }
          break;
        }

        case 'promotion': {
          const ent = state.entities.get(ev.id);
          if (!ent || ent.owner !== humanPlayer) break;
          const s = this.spatial(ent.pos, cam, viewW, viewH);
          playSfx('promote', s ? { pan: s.pan, gain: s.gain } : { gain: 0.5 });
          break;
        }

        case 'buildingPlaced': {
          if (ev.player !== humanPlayer) break;
          const ent = state.entities.get(ev.id);
          const s = ent ? this.spatial(ent.pos, cam, viewW, viewH) : null;
          playSfx('place', s ? { pan: s.pan, gain: Math.max(0.6, s.gain) } : { gain: 0.8 });
          break;
        }

        case 'buildingReady': {
          if (ev.player === humanPlayer) announce('constructionComplete');
          break;
        }

        case 'unitReady': {
          if (ev.player === humanPlayer) announce('unitReady');
          break;
        }

        case 'underAttack': {
          if (ev.player !== humanPlayer) break;
          this.combatUntil = t + COMBAT_BUMP_MS;
          announce(ev.baseAttack ? 'baseUnderAttack' : 'harvesterUnderAttack');
          break;
        }

        case 'lowPower': {
          if (ev.player !== humanPlayer) break;
          playSfx('power_down', { gain: 0.8 });
          announce('lowPower');
          break;
        }

        case 'powerRestored': {
          if (ev.player !== humanPlayer) break;
          playSfx('power_up', { gain: 0.7 });
          announce('powerRestored');
          break;
        }

        case 'insufficientFunds': {
          if (ev.player !== humanPlayer) break;
          playSfx('error', { gain: 0.8 });
          announce('insufficientFunds');
          break;
        }

        case 'superweaponReady': {
          if (ev.player === humanPlayer) announce('superweaponReady');
          else announce('enemySuperweaponDetected');
          break;
        }

        case 'superweaponLaunched': {
          this.combatUntil = t + COMBAT_BUMP_MS;
          // Alarm sounds for everyone — incoming doom is always audible.
          playSfx('alarm', { gain: 0.9 });
          if (ev.byPlayer !== humanPlayer) announce('enemySuperweaponLaunch');
          this.scheduleSuperweaponSounds(ev.defId, ev.target, cam, viewW, viewH);
          break;
        }

        case 'buildingCaptured': {
          const involvesHuman = ev.byPlayer === humanPlayer || ev.fromPlayer === humanPlayer;
          if (!involvesHuman) break;
          if (ev.fromPlayer === humanPlayer) this.combatUntil = t + COMBAT_BUMP_MS;
          const ent = state.entities.get(ev.id);
          const s = ent ? this.spatial(ent.pos, cam, viewW, viewH) : null;
          playSfx('capture', s ? { pan: s.pan, gain: Math.max(0.5, s.gain) } : { gain: 0.7 });
          announce(ev.byPlayer === humanPlayer ? 'enemyBuildingCaptured' : 'buildingCaptured');
          break;
        }

        case 'playerEliminated': {
          if (ev.player !== humanPlayer) announce('enemyEliminated');
          break;
        }

        case 'gameOver': {
          if (this.gameOverHandled) break;
          this.gameOverHandled = true;
          const victory = ev.winner === humanPlayer;
          flushAnnouncer(); // final line must not wait behind chatter
          announce(victory ? 'victory' : 'defeat');
          playSfx(victory ? 'victory' : 'defeat');
          if (this.musicRunning) {
            this.musicRunning = false;
            musicStop();
          }
          break;
        }

        case 'cratePickup': {
          if (ev.player !== humanPlayer) break; // enemy crates pop silently
          const s = this.spatial(ev.pos, cam, viewW, viewH);
          playCrateChime(
            ev.kind === 'money',
            s ? { pan: s.pan, gain: Math.max(0.6, s.gain) } : { gain: 0.8 },
          );
          break;
        }

        case 'aiTaunt': {
          if (ev.player === humanPlayer) break; // only enemy commanders taunt
          playTauntBlip();
          break;
        }

        case 'crystalDepleted':
          break; // intentionally silent

        default:
          break;
      }
    }

    setMusicIntensity(t < this.combatUntil ? 1 : 0);
  }

  // --- internals -------------------------------------------------------------------

  /**
   * Pan/volume from the tile position's offset to the camera center.
   * Returns null when the source is further than ~1.5 screens away (culled).
   */
  private spatial(pos: Vec2, cam: Camera, viewW: number, viewH: number): Spatial | null {
    const wx = (pos.x - pos.y) * TILE_HALF_W;
    const wy = (pos.x + pos.y) * TILE_HALF_H;
    const zoom = cam.zoom > 0 ? cam.zoom : 1;
    const sx = (wx - cam.x) * zoom;
    const sy = (wy - cam.y) * zoom;
    const nx = (sx - viewW / 2) / Math.max(1, viewW);
    const ny = (sy - viewH / 2) / Math.max(1, viewH);
    const d = Math.hypot(nx, ny); // 0 at center, ~0.5 at screen edge
    if (d > 1.5) return null;
    const pan = Math.max(-0.8, Math.min(0.8, nx * 1.7));
    const gain = d <= 0.5 ? 1 : Math.max(0.12, 1 - (d - 0.5) * 0.88);
    return { pan, gain };
  }

  /**
   * Signature superweapon audio. The magma-strike detonation itself arrives via
   * the sim's big-splash impact event; storm bolts and the spore field get
   * cosmetically-timed layers here (setTimeout is fine — audio is not sim code).
   */
  private scheduleSuperweaponSounds(
    defId: string,
    target: Vec2,
    cam: Camera,
    viewW: number,
    viewH: number,
  ): void {
    const kind = swKind(defId);
    const s = this.spatial(target, cam, viewW, viewH);
    const pan = s ? s.pan : 0;
    if (kind === 'storm') {
      for (let i = 0; i < 9; i++) {
        const delay = 400 + Math.random() * 7400;
        setTimeout(() => {
          playSfx('storm_strike', {
            pan,
            gain: s ? Math.max(0.4, s.gain) : 0.4,
            pitch: 0.9 + Math.random() * 0.25,
          });
        }, delay);
      }
    } else if (kind === 'spore') {
      for (let i = 0; i < 3; i++) {
        setTimeout(() => {
          playSfx('spore_pad', { pan, gain: s ? Math.max(0.4, s.gain) : 0.45 });
        }, 600 + i * 4800);
      }
    }
    // kind === 'nuke': the 3 s travel ends in a splash>=4.5 impact event,
    // which handleEvents turns into the full detonation sound.
  }
}
