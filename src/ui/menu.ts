// =============================================================================
// POCKET ALERT — menus (Owner E): main menu, skirmish lobby, loading overlay,
// ESC menu, game-over screen, How-to-Play. Dark command-console aesthetic with
// drifting elemental particles. Produces GameConfig (human is player 0).
// =============================================================================

import type { AIDifficulty, FactionId, GameConfig, GameMode } from '../core/types';
import { PLAYER_COLORS } from '../core/types';
import {
  SCROLL_RATE_DEFAULT,
  SCROLL_RATE_MAX,
  SCROLL_RATE_MIN,
  SCROLL_RATE_TICKS,
} from '../core/constants';
import { DATA } from '../data/index';
import { clearHistory, getHistory } from './history';
import type { MatchResult } from './history';

const STYLE_ID = 'pa-style-menu';
const CSS = `
.pa-menu-root { position: absolute; inset: 0; z-index: 100; display: flex; align-items: stretch; justify-content: center;
  background: #06070a url('/media/fable-wars-hero-poster.jpg') center / cover no-repeat;
  font-family: Verdana, Geneva, sans-serif; color: #cfd6ff; overflow: hidden; user-select: none; }
.pa-bg-video { position: absolute; inset: 0; z-index: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0.9; pointer-events: none; }
.pa-menu-root::before { content: ''; position: absolute; inset: 0; pointer-events: none;
  background:
    radial-gradient(ellipse at 50% 40%, rgba(223, 70, 190, 0.24) 0%, rgba(4,5,8,0.1) 28%, rgba(4,5,8,0.8) 86%),
    linear-gradient(90deg, rgba(4,5,8,0.82) 0%, rgba(4,5,8,0.18) 48%, rgba(4,5,8,0.82) 100%),
    linear-gradient(180deg, rgba(4,5,8,0.12), rgba(4,5,8,0.86)); z-index: 1; }
.pa-menu-root::after { content: ''; position: absolute; inset: 0; pointer-events: none;
  background:
    linear-gradient(180deg, rgba(255,255,255,0.07), transparent 16%, transparent 74%, rgba(0,0,0,0.72)),
    repeating-linear-gradient(0deg, rgba(255,255,255,0.022) 0 1px, transparent 1px 3px); z-index: 1; }
.pa-particle { position: absolute; z-index: 1; border-radius: 50%; pointer-events: none; opacity: 0.55; animation: pa-drift linear infinite; }
@keyframes pa-drift { from { transform: translateY(105vh); } to { transform: translateY(-8vh); } }
.pa-title-stage { position: relative; z-index: 2; width: min(1180px, calc(100vw - 32px)); min-height: 100%;
  display: flex; flex-direction: column; justify-content: flex-end; align-items: center; padding: clamp(18px, 3vh, 34px) 0; }
.pa-panel { position: relative; z-index: 2; background: rgba(13, 16, 30, 0.94); border: 1px solid #343a63; border-radius: 8px;
  padding: 28px 34px; box-shadow: 0 24px 70px rgba(0,0,0,0.68), inset 0 1px 0 rgba(255,255,255,0.06); max-height: 92vh; overflow-y: auto; scrollbar-width: thin; }
.pa-panel--main { width: min(980px, 100%); overflow: visible;
  background:
    linear-gradient(180deg, rgba(12, 14, 24, 0.54), rgba(8, 10, 18, 0.88)),
    linear-gradient(90deg, rgba(255, 126, 45, 0.14), transparent 24%, transparent 76%, rgba(70, 182, 255, 0.14));
  border-color: rgba(255, 221, 150, 0.32);
  backdrop-filter: blur(10px);
  padding: clamp(18px, 2.4vw, 28px);
  box-shadow: 0 30px 90px rgba(0,0,0,0.74), inset 0 1px 0 rgba(255,255,255,0.08); }
.pa-panel--main::before, .pa-panel--main::after { content: ''; position: absolute; left: 18px; right: 18px; height: 1px; pointer-events: none;
  background: linear-gradient(90deg, transparent, rgba(255, 225, 166, 0.76), transparent); }
.pa-panel--main::before { top: -1px; }
.pa-panel--main::after { bottom: -1px; }
.pa-logo-wrap { width: min(560px, 70vw); margin: 0 auto auto; padding-top: clamp(10px, 3vh, 26px);
  filter: drop-shadow(0 16px 34px rgba(0,0,0,0.78)) drop-shadow(0 0 18px rgba(228, 54, 189, 0.25)); }
.pa-logo-img { display: block; width: 100%; height: auto; }
.pa-title { font-size: 44px; font-weight: bold; letter-spacing: 6px; text-align: center; color: #fff;
  text-shadow: 0 0 28px rgba(255, 214, 115, 0.45), 0 2px 0 #000; margin: 0 0 2px; }
.pa-subtitle { text-align: center; font-size: 11px; letter-spacing: 6px; color: #8d96c8; margin-bottom: 28px; text-transform: uppercase; }
.pa-hero-kicker { text-align: center; font-size: 10px; letter-spacing: 3px; color: #ffd777; text-transform: uppercase; margin-bottom: 8px; }
.pa-launch-top { display: flex; justify-content: space-between; align-items: center; gap: 18px; margin-bottom: 14px; }
.pa-launch-label { font-size: 10px; letter-spacing: 3px; color: #ffd777; text-transform: uppercase; }
.pa-launch-status { font-size: 9px; letter-spacing: 2px; color: #8790bf; text-transform: uppercase; }
.pa-faction-strip { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 0 0 16px; }
.pa-faction-tile { min-height: 118px; border: 1px solid rgba(255,255,255,0.16); border-radius: 6px; overflow: hidden; position: relative;
  background-size: cover; background-position: center; box-shadow: inset 0 -48px 42px rgba(0,0,0,0.68); }
.pa-faction-tile::before { content: ''; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(255,255,255,0.06), rgba(0,0,0,0.52)); }
.pa-faction-tile span { position: absolute; left: 10px; bottom: 9px; z-index: 1; color: #fff; font-size: 10px; letter-spacing: 2px; text-transform: uppercase;
  text-shadow: 0 2px 8px #000; }
.pa-command-row { display: grid; grid-template-columns: 1.4fr 1fr 1fr; gap: 10px; align-items: stretch; }
.pa-mode-pick { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 0 0 12px; }
.pa-mode-choice { min-height: 48px; padding: 8px 10px; border: 1px solid #343a63; border-radius: 6px;
  background: linear-gradient(180deg, rgba(24,27,49,0.88), rgba(10,12,23,0.92)); cursor: pointer; }
.pa-mode-choice:hover { border-color: #6ea7ff; }
.pa-mode-choice.sel { border-color: #ffb15d; box-shadow: inset 0 1px 0 rgba(255,255,255,0.1), 0 0 18px rgba(255,112,70,0.2); }
.pa-mode-choice strong { display: block; color: #fff; font-size: 11px; letter-spacing: 2px; text-transform: uppercase; }
.pa-mode-choice span { display: block; margin-top: 5px; color: #8d96c8; font-size: 9px; line-height: 1.35; letter-spacing: 1px; }
.pa-btn { display: flex; align-items: center; justify-content: center; min-height: 54px; padding: 0 18px; text-align: center; font-size: 13px; letter-spacing: 3px;
  background: linear-gradient(180deg, #252945 0%, #121523 100%); color: #dfe5ff; border: 1px solid #3a3f66; border-radius: 6px;
  cursor: pointer; text-transform: uppercase; box-shadow: inset 0 1px 0 rgba(255,255,255,0.07); }
.pa-btn:hover { border-color: #6ea7ff; box-shadow: 0 0 18px rgba(74,125,255,0.36), inset 0 1px 0 rgba(255,255,255,0.12); color: #fff; }
.pa-btn.primary { min-height: 64px; background: linear-gradient(180deg, #8c3b29 0%, #442018 100%); border-color: #ffb15d; color: #fff7e2; font-weight: bold;
  box-shadow: 0 0 24px rgba(255, 101, 56, 0.22), inset 0 1px 0 rgba(255,255,255,0.18); }
.pa-btn.primary:hover { box-shadow: 0 0 26px rgba(255, 101, 56, 0.48), inset 0 1px 0 rgba(255,255,255,0.2); }
.pa-launch-footer { display: flex; justify-content: space-between; gap: 18px; margin-top: 14px; color: #727ca9; font-size: 9px; letter-spacing: 1px; text-transform: uppercase; }
.pa-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
.pa-row { display: flex; gap: 10px; align-items: center; margin: 12px 0; flex-wrap: wrap; }
.pa-label { font-size: 10px; letter-spacing: 2px; color: #8d96c8; text-transform: uppercase; min-width: 90px; }
.pa-fcards { display: flex; gap: 10px; margin: 6px 0 14px; }
.pa-fcard { flex: 1; min-width: 150px; border: 2px solid #2e3252; border-radius: 6px; padding: 10px; cursor: pointer; background: #14162a; }
.pa-fcard:hover { border-color: #6f78a8; }
.pa-fcard.sel { border-color: var(--fc, #4a7dff); box-shadow: 0 0 16px color-mix(in srgb, var(--fc) 45%, transparent); }
.pa-fcard .pa-fc-emblem { font-size: 28px; text-align: center; }
.pa-fcard .pa-fc-name { font-size: 12px; font-weight: bold; text-align: center; letter-spacing: 1px; margin: 4px 0; color: #fff; }
.pa-fcard .pa-fc-blurb { font-size: 9px; color: #9aa3cf; line-height: 1.5; min-height: 40px; }
.pa-fcard .pa-fc-roster { font-size: 8px; color: #6f78a8; margin-top: 6px; line-height: 1.4; }
.pa-seg { display: flex; gap: 3px; }
.pa-seg .pa-seg-opt { padding: 6px 13px; font-size: 10px; letter-spacing: 1px; background: #181a30; border: 1px solid #2e3252;
  cursor: pointer; color: #8d96c8; }
.pa-seg .pa-seg-opt:first-child { border-radius: 4px 0 0 4px; } .pa-seg .pa-seg-opt:last-child { border-radius: 0 4px 4px 0; }
.pa-seg .pa-seg-opt.sel { background: #262a4c; color: #fff; border-color: #4a7dff; }
.pa-swatch { width: 22px; height: 22px; border-radius: 4px; border: 2px solid transparent; cursor: pointer; }
.pa-swatch.sel { border-color: #fff; box-shadow: 0 0 8px rgba(255,255,255,0.5); }
.pa-swatch.taken { opacity: 0.25; cursor: not-allowed; }
.pa-ai-row { display: flex; gap: 8px; align-items: center; background: #1113233; background: #131528; border: 1px solid #262a4c;
  border-radius: 4px; padding: 7px 10px; margin: 6px 0; }
.pa-ai-row select, .pa-panel input[type=number] { background: #0a0c18; color: #dfe5ff; border: 1px solid #3a3f66; border-radius: 3px;
  padding: 5px 7px; font-family: inherit; font-size: 11px; }
.pa-ai-row .pa-ai-name { font-size: 10px; letter-spacing: 1px; color: #aeb6e2; flex: 1; }
.pa-x { color: #e8453c; cursor: pointer; font-weight: bold; padding: 0 4px; }
.pa-small-btn { font-size: 10px; letter-spacing: 1px; padding: 6px 12px; background: #181a30; border: 1px solid #3a3f66;
  border-radius: 4px; cursor: pointer; color: #aeb6e2; }
.pa-small-btn:hover { color: #fff; border-color: #4a7dff; }
.pa-overlay { position: absolute; inset: 0; z-index: 140; display: flex; align-items: center; justify-content: center;
  background: rgba(5, 6, 12, 0.82); font-family: Verdana, Geneva, sans-serif; }
.pa-go-banner { font-size: 52px; font-weight: bold; letter-spacing: 12px; text-align: center; margin-bottom: 8px; }
.pa-go-banner.win { color: #ffd95e; text-shadow: 0 0 32px #ffd95e; }
.pa-go-banner.lose { color: #e8453c; text-shadow: 0 0 32px #e8453c; }
.pa-go-stats { text-align: center; font-size: 11px; color: #9aa3cf; letter-spacing: 1px; margin-bottom: 22px; }
.pa-load-tip { margin-top: 14px; font-size: 10px; color: #6f78a8; letter-spacing: 1px; text-align: center; max-width: 420px; }
.pa-load-card { min-width: min(520px, calc(100vw - 32px)); padding: 28px 34px; border: 1px solid rgba(255,215,119,0.32);
  border-radius: 8px; background: linear-gradient(180deg, rgba(6,8,13,0.78), rgba(6,8,13,0.95));
  box-shadow: 0 24px 70px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.08); }
.pa-spin { width: 38px; height: 38px; margin: 0 auto 14px; border-radius: 50%; border: 3px solid #2e3252; border-top-color: #4a7dff;
  animation: pa-spin 800ms linear infinite; }
@keyframes pa-spin { to { transform: rotate(360deg); } }
.pa-howto table { border-collapse: collapse; font-size: 10px; color: #aeb6e2; }
.pa-howto td { border: 1px solid #262a4c; padding: 4px 10px; }
.pa-howto td:first-child { color: #ffd95e; font-weight: bold; white-space: nowrap; }
.pa-menu-h2 { font-size: 13px; letter-spacing: 3px; color: #fff; text-transform: uppercase; margin: 18px 0 6px; }
.pa-score-banner { animation: pa-banner-in 1000ms ease-out both; }
@keyframes pa-banner-in { from { opacity: 0; transform: translateY(-16px); } to { opacity: 1; transform: none; } }
.pa-score-table { border-collapse: collapse; margin: 14px auto 4px; font-size: 12px; }
.pa-score-table th { font-size: 9px; letter-spacing: 1px; color: #8d96c8; text-transform: uppercase; font-weight: normal;
  padding: 6px 12px; border-bottom: 1px solid #2e3252; text-align: right; }
.pa-score-table th:first-child { text-align: left; }
.pa-score-table td { padding: 8px 12px; text-align: right; color: #cfd6ff; font-variant-numeric: tabular-nums; }
.pa-score-table tr.pa-score-row { border-bottom: 1px solid rgba(46,50,82,0.5); }
.pa-score-name { text-align: left !important; min-width: 160px; white-space: nowrap; }
.pa-score-swatch { display: inline-block; width: 22px; height: 22px; border-radius: 4px; vertical-align: middle;
  margin-right: 9px; border: 1px solid rgba(255,255,255,0.3); }
.pa-score-score { font-weight: bold; color: #ffd95e; }
.pa-score-dead { text-decoration: line-through; opacity: 0.65; }
.pa-score-time { text-align: center; font-size: 11px; letter-spacing: 2px; color: #9aa3cf; margin: 14px 0 8px; }
.pa-svc { margin-top: 22px; border-top: 1px solid #2e3252; padding-top: 2px; width: 470px; }
.pa-svc-list { max-height: 200px; overflow-y: auto; scrollbar-width: thin; }
.pa-svc-row { display: flex; gap: 9px; align-items: center; font-size: 10px; padding: 6px 8px;
  border-bottom: 1px solid rgba(38,42,76,0.6); color: #aeb6e2; }
.pa-svc-row:hover { background: #181a30; }
.pa-svc-date { color: #6f78a8; white-space: nowrap; width: 92px; flex-shrink: 0; }
.pa-svc-sum { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pa-svc-badge { font-weight: bold; width: 18px; height: 18px; line-height: 18px; text-align: center; border-radius: 3px; flex-shrink: 0; }
.pa-svc-badge.win { color: #ffd95e; border: 1px solid #ffd95e; }
.pa-svc-badge.lose { color: #e8453c; border: 1px solid #e8453c; }
.pa-svc-num { white-space: nowrap; font-variant-numeric: tabular-nums; }
.pa-svc-replay { cursor: pointer; font-size: 13px; color: #8d96c8; padding: 1px 7px; border: 1px solid #3a3f66; border-radius: 3px; flex-shrink: 0; }
.pa-svc-replay:hover { color: #fff; border-color: #4a7dff; }
.pa-svc-clear { text-align: center; font-size: 9px; color: #5a6390; letter-spacing: 1px; cursor: pointer;
  margin-top: 8px; text-decoration: underline; }
.pa-svc-clear:hover { color: #aeb6e2; }
.pa-opt-readout { font-size: 10px; color: #8d96c8; letter-spacing: 1px; min-width: 70px; font-variant-numeric: tabular-nums; }
.pa-codex { width: min(1120px, calc(100vw - 32px)); }
.pa-codex-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.pa-codex-card { border: 1px solid #2e3252; border-radius: 6px; background: rgba(9,11,20,0.74); overflow: hidden; }
.pa-codex-card img { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; background: #05060a; }
.pa-codex-card div { padding: 9px 10px; font-size: 10px; letter-spacing: 2px; color: #cfd6ff; text-transform: uppercase; }
@media (max-width: 760px) {
  .pa-menu-root { padding: 10px; min-height: 100svh; }
  .pa-menu-root::before {
    background:
      radial-gradient(ellipse at 50% 32%, rgba(223, 70, 190, 0.18) 0%, rgba(4,5,8,0.08) 30%, rgba(4,5,8,0.66) 88%),
      linear-gradient(180deg, rgba(4,5,8,0.08), rgba(4,5,8,0.72));
  }
  .pa-menu-root::after {
    background:
      linear-gradient(180deg, rgba(255,255,255,0.05), transparent 20%, transparent 80%, rgba(0,0,0,0.54)),
      repeating-linear-gradient(0deg, rgba(255,255,255,0.018) 0 1px, transparent 1px 3px);
  }
  .pa-title-stage { width: 100%; min-height: 100svh; padding: max(10px, env(safe-area-inset-top)) 0 max(10px, env(safe-area-inset-bottom)); }
  .pa-panel--main { width: 100%; padding: 12px; background: linear-gradient(180deg, rgba(12,14,24,0.34), rgba(8,10,18,0.76)); backdrop-filter: blur(5px); }
  .pa-logo-wrap { width: min(300px, 66vw); margin-bottom: auto; padding-top: clamp(6px, 2vh, 14px); }
  .pa-title { font-size: 34px; letter-spacing: 4px; }
  .pa-codex-grid { grid-template-columns: 1fr; }
  .pa-launch-top { margin-bottom: 9px; }
  .pa-launch-status { display: none; }
  .pa-faction-strip { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; margin-bottom: 10px; }
  .pa-faction-tile { min-height: 52px; }
  .pa-faction-tile span { left: 6px; bottom: 5px; font-size: 7px; letter-spacing: 1px; }
  .pa-command-row { grid-template-columns: 1fr; gap: 7px; }
  .pa-mode-pick { grid-template-columns: 1fr; gap: 6px; }
  .pa-mode-choice { min-height: 42px; }
  .pa-btn { min-height: 40px; font-size: 11px; letter-spacing: 2px; }
  .pa-btn.primary { min-height: 46px; }
  .pa-launch-footer { justify-content: center; text-align: center; margin-top: 9px; }
  .pa-launch-footer span:first-child { display: none; }
}
`;

const FACTION_EMBLEMS: Record<FactionId, string> = { scorch: '🔥', tide: '🌊', verdant: '🌿' };
const LOBBY_KEY = 'pa-lobby'; // persisted lobby settings (everything except seed)
const SCROLL_RATE_KEY = 'pa-scrollRate'; // px/s at zoom 1 — input.ts re-reads this live

/** Saved lobby settings shape (localStorage 'pa-lobby'). */
interface LobbySettings {
  faction: FactionId;
  colorIdx: number;
  ais: { faction: FactionId | 'random'; difficulty: AIDifficulty }[];
  mapSize: 'S' | 'M' | 'L';
  water: 'low' | 'medium' | 'high';
  crates: boolean;
}
const TIPS = [
  'First minute: power, refinery, barracks. Then scout before the first raid.',
  'Right-click crystals with harvesters to claim a Candy field deliberately.',
  'Peekachoo hits air AND ground. The cheeks are not just for show.',
  'Low power slows construction and shuts down radar and advanced defenses.',
  'Harvesters auto-return to the nearest Candy Refinery. Protect them!',
  'Engineers (the Professors) capture enemy buildings. Escort them well.',
  'Fire beats Grass, Grass beats Water, Water beats Fire. +25% damage.',
  'Veteran creatures deal +25% damage. Elites self-heal. Keep them alive.',
  'Sell unwanted structures for half their cost — fast cash in a pinch.',
  'Press H to jump to your Citadel. Space jumps to the last attack.',
  'Hard AI snipes harvesters. Wall in your Candy fields or guard them.',
];
const ART_CODEX = [
  {
    title: 'World Style',
    src: '/art/world-style-board.webp',
  },
  {
    title: 'Faction Strongholds',
    src: '/art/faction-buildings-sheet.webp',
  },
  {
    title: 'Creature Roster',
    src: '/art/creature-units-sheet.webp',
  },
  {
    title: 'Battlefield Terrain',
    src: '/art/world-map-sheet.webp',
  },
];

export class MenuManager {
  private root: HTMLElement;
  private onStart: (cfg: GameConfig) => void;
  private menuEl: HTMLElement | null = null;
  private overlayEl: HTMLElement | null = null;
  private escEl: HTMLElement | null = null;
  private tipTimer: number | null = null;

  // lobby state
  private faction: FactionId = 'scorch';
  private colorIdx = 0;
  private mapSize: 'S' | 'M' | 'L' = 'M';
  private water: 'low' | 'medium' | 'high' = 'medium';
  private crates = true; // RA2 'Crates Appear' default ON
  private mode: GameMode = 'classic';
  private seed = Math.floor(Math.random() * 1e6);
  private ais: { faction: FactionId | 'random'; difficulty: AIDifficulty }[] = [
    { faction: 'random', difficulty: 'medium' },
  ];

  /** Config of the last launched match — main.ts reads this for "Play Again". */
  lastConfig: GameConfig | null = null;

  constructor(root: HTMLElement, onStartGame: (cfg: GameConfig) => void) {
    this.root = root;
    this.onStart = onStartGame;
    if (!document.getElementById(STYLE_ID)) {
      const s = document.createElement('style');
      s.id = STYLE_ID;
      s.textContent = CSS;
      document.head.appendChild(s);
    }
  }

  // --- helpers --------------------------------------------------------------------

  /** Remove every menu screen/overlay — called when a match takes the stage. */
  hideMenus(): void {
    this.clearMenu();
  }

  private clearMenu(): void {
    this.menuEl?.remove();
    this.menuEl = null;
    this.clearOverlay();
    if (this.tipTimer !== null) {
      clearInterval(this.tipTimer);
      this.tipTimer = null;
    }
  }

  private clearOverlay(): void {
    this.overlayEl?.remove();
    this.overlayEl = null;
  }

  /** Save every lobby setting except the seed (fresh seed per session by default). */
  private persistLobby(): void {
    try {
      const s: LobbySettings = {
        faction: this.faction,
        colorIdx: this.colorIdx,
        ais: this.ais,
        mapSize: this.mapSize,
        water: this.water,
        crates: this.crates,
      };
      localStorage.setItem(LOBBY_KEY, JSON.stringify(s));
    } catch {
      // Storage unavailable — settings simply won't survive a reload.
    }
  }

  /** Restore persisted lobby settings, validating every field (corruption-proof). */
  private restoreLobby(): void {
    try {
      const raw = localStorage.getItem(LOBBY_KEY);
      if (!raw) return;
      const s = JSON.parse(raw) as Partial<LobbySettings>;
      const factionIds: FactionId[] = ['scorch', 'tide', 'verdant'];
      if (typeof s.faction === 'string' && factionIds.includes(s.faction)) this.faction = s.faction;
      if (typeof s.colorIdx === 'number' && s.colorIdx >= 0 && s.colorIdx < PLAYER_COLORS.length) {
        this.colorIdx = s.colorIdx | 0;
      }
      if (s.mapSize === 'S' || s.mapSize === 'M' || s.mapSize === 'L') this.mapSize = s.mapSize;
      if (s.water === 'low' || s.water === 'medium' || s.water === 'high') this.water = s.water;
      if (typeof s.crates === 'boolean') this.crates = s.crates;
      if (Array.isArray(s.ais)) {
        const ais = s.ais
          .filter((a): a is LobbySettings['ais'][number] => !!a && typeof a === 'object')
          .map((a) => ({
            faction: (factionIds as string[]).includes(a.faction as string)
              ? (a.faction as FactionId)
              : ('random' as const),
            difficulty:
              a.difficulty === 'easy' || a.difficulty === 'medium' || a.difficulty === 'hard'
                ? a.difficulty
                : ('medium' as const),
          }))
          .slice(0, 3);
        if (ais.length > 0) this.ais = ais;
      }
    } catch {
      // Corrupted settings — keep defaults.
    }
  }

  private screen(): HTMLElement {
    this.clearMenu();
    const el = document.createElement('div');
    el.className = 'pa-menu-root';
    for (let i = 0; i < 26; i++) {
      const p = document.createElement('div');
      p.className = 'pa-particle';
      const kind = i % 3;
      const size = 3 + Math.random() * 5;
      p.style.cssText = `left:${Math.random() * 100}%; width:${size}px; height:${size}px;
        background:${kind === 0 ? '#ff7a3c' : kind === 1 ? '#3cc8ff' : '#5ee887'};
        animation-duration:${9 + Math.random() * 16}s; animation-delay:-${Math.random() * 20}s;
        filter: blur(${Math.random() < 0.4 ? 1 : 0}px);`;
      el.appendChild(p);
    }
    const video = document.createElement('video');
    video.className = 'pa-bg-video';
    video.src = '/media/fable-wars-hero.mp4';
    video.poster = '/media/fable-wars-hero-poster.jpg';
    video.autoplay = true;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.setAttribute('aria-hidden', 'true');
    el.prepend(video);
    void video.play().catch(() => {
      // Autoplay is best-effort; poster art remains as the fallback background.
    });
    this.root.appendChild(el);
    this.menuEl = el;
    return el;
  }

  // --- main menu -------------------------------------------------------------------

  showMainMenu(): void {
    const el = this.screen();
    const stage = document.createElement('main');
    stage.className = 'pa-title-stage';

    const logoWrap = document.createElement('div');
    logoWrap.className = 'pa-logo-wrap';
    logoWrap.innerHTML = `<img class="pa-logo-img" src="/brand/fable-wars-logo-alpha.png" alt="Fable Wars">`;
    stage.appendChild(logoWrap);

    const panel = document.createElement('div');
    panel.className = 'pa-panel pa-panel--main';
    panel.innerHTML = `<h1 class="pa-sr-only">Fable Wars</h1>
      <div class="pa-launch-top">
        <div class="pa-launch-label">Crystal Rift Campaign</div>
        <div class="pa-launch-status">Hero video online · Skirmish build ready</div>
      </div>`;

    const factionStrip = document.createElement('div');
    factionStrip.className = 'pa-faction-strip';
    const factionTiles = [
      { label: 'Scorch Legion', src: '/art/factions/scorch-banner.jpg' },
      { label: 'Tide Dominion', src: '/art/factions/tide-banner.jpg' },
      { label: 'Verdant Swarm', src: '/art/factions/verdant-banner.jpg' },
    ];
    for (const tile of factionTiles) {
      const item = document.createElement('div');
      item.className = 'pa-faction-tile';
      item.style.backgroundImage = `url('${tile.src}')`;
      item.innerHTML = `<span>${tile.label}</span>`;
      factionStrip.appendChild(item);
    }
    panel.appendChild(factionStrip);

    const modePick = document.createElement('div');
    modePick.className = 'pa-mode-pick';
    const classic = document.createElement('div');
    const rush = document.createElement('div');
    const paintModes = () => {
      classic.className = 'pa-mode-choice' + (this.mode === 'classic' ? ' sel' : '');
      rush.className = 'pa-mode-choice' + (this.mode === 'crystalRush' ? ' sel' : '');
    };
    classic.innerHTML = `<strong>Classic RTS</strong><span>Build bases, harvest crystals, command units directly.</span>`;
    rush.innerHTML = `<strong>Crystal Rush Beta</strong><span>Command wave pushes, hold the crystal, break enemy bases.</span>`;
    classic.addEventListener('click', () => {
      this.mode = 'classic';
      paintModes();
    });
    rush.addEventListener('click', () => {
      this.mode = 'crystalRush';
      paintModes();
    });
    paintModes();
    modePick.append(classic, rush);
    panel.appendChild(modePick);

    const commandRow = document.createElement('div');
    commandRow.className = 'pa-command-row';
    const skirmish = btn('Start Match', () => this.showLobby(), true);
    const howto = btn('How to Play', () => this.showHowTo());
    const codex = btn('Art Codex', () => this.showArtCodex());
    commandRow.append(skirmish, howto, codex);
    panel.appendChild(commandRow);

    const record = this.serviceRecordPanel();
    if (record) panel.appendChild(record);
    const footer = document.createElement('div');
    footer.className = 'pa-launch-footer';
    footer.innerHTML = `<span>Scorch · Tide · Verdant</span><span>Browser RTS prototype · AI skirmish mode</span>`;
    panel.appendChild(footer);

    stage.appendChild(panel);
    el.appendChild(stage);
  }

  private showArtCodex(): void {
    const el = this.screen();
    const panel = document.createElement('div');
    panel.className = 'pa-panel pa-codex';
    panel.innerHTML = `<h1 class="pa-title" style="font-size:24px;letter-spacing:4px;">ART CODEX</h1>
      <div class="pa-subtitle" style="margin-bottom:16px">World · Factions · Creatures · Terrain</div>`;
    const grid = document.createElement('div');
    grid.className = 'pa-codex-grid';
    for (const art of ART_CODEX) {
      const card = document.createElement('div');
      card.className = 'pa-codex-card';
      const img = document.createElement('img');
      img.src = art.src;
      img.alt = art.title;
      const label = document.createElement('div');
      label.textContent = art.title;
      card.append(img, label);
      grid.appendChild(card);
    }
    panel.appendChild(grid);
    panel.appendChild(btn('Back', () => this.showMainMenu()));
    el.appendChild(panel);
  }

  /** Service Record: past matches with a ↻ replay button each. Null when empty. */
  private serviceRecordPanel(): HTMLElement | null {
    const history = getHistory();
    if (history.length === 0) return null;
    const wrap = document.createElement('div');
    wrap.className = 'pa-svc';
    wrap.innerHTML = `<div class="pa-menu-h2" style="text-align:center">Service Record</div>`;
    const list = document.createElement('div');
    list.className = 'pa-svc-list';
    for (const r of history) {
      const human = r.players[r.humanIdx] ?? r.players.find((p) => p.isHuman);
      if (!human) continue;
      const aiPlayers = r.players.filter((p) => !p.isHuman);
      const diffs = [...new Set(aiPlayers.map((p) => p.difficulty ?? 'medium'))].join('/');
      const facName = DATA.factions[human.faction]?.name.split(' ')[0] ?? human.faction;
      const when = new Date(r.dateISO);
      const dateLabel = isNaN(when.getTime())
        ? '—'
        : when.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

      const row = document.createElement('div');
      row.className = 'pa-svc-row';
      const badge = `<span class="pa-svc-badge ${r.victory ? 'win' : 'lose'}">${r.victory ? 'W' : 'L'}</span>`;
      row.innerHTML = `<span class="pa-svc-date">${dateLabel}</span>
        <span class="pa-svc-sum">${FACTION_EMBLEMS[human.faction] ?? ''} ${facName} vs ${aiPlayers.length} AI (${diffs})</span>
        ${badge}
        <span class="pa-svc-num" title="Score">★ ${human.stats.score.toLocaleString()}</span>
        <span class="pa-svc-num" title="Duration">${formatDuration(r.durationSec)}</span>`;
      const replay = document.createElement('span');
      replay.className = 'pa-svc-replay';
      replay.textContent = '↻';
      replay.title = 'Replay this setup (same map seed)';
      replay.addEventListener('click', () => this.replaySetup(r));
      row.appendChild(replay);
      list.appendChild(row);
    }
    wrap.appendChild(list);
    const clear = document.createElement('div');
    clear.className = 'pa-svc-clear';
    clear.textContent = 'Clear history';
    clear.addEventListener('click', () => {
      if (confirm('Clear the service record?')) {
        clearHistory();
        this.showMainMenu();
      }
    });
    wrap.appendChild(clear);
    return wrap;
  }

  /** Pre-fill the lobby with a past match's exact setup — seed included. */
  private replaySetup(r: MatchResult): void {
    const human = r.players[r.humanIdx] ?? r.players.find((p) => p.isHuman);
    if (!human) return;
    this.faction = human.faction;
    this.colorIdx = Math.max(0, Math.min(PLAYER_COLORS.length - 1, human.colorIdx | 0));
    const ais = r.players
      .filter((p) => !p.isHuman)
      .map((p) => ({ faction: p.faction, difficulty: p.difficulty ?? ('medium' as const) }))
      .slice(0, 3);
    this.ais = ais.length > 0 ? ais : [{ faction: 'random', difficulty: 'medium' }];
    this.mapSize = r.mapSize;
    this.water = r.water;
    this.crates = r.crates;
    this.persistLobby(); // showLobby() restores from storage; keep them in sync
    this.seed = Math.abs(r.seed | 0) || 1; // seed is NOT persisted — set after persist
    this.showLobby();
  }

  private showHowTo(): void {
    const el = this.screen();
    const panel = document.createElement('div');
    panel.className = 'pa-panel pa-howto';
    panel.style.maxWidth = '640px';
    panel.innerHTML = `<h1 class="pa-title" style="font-size:24px;letter-spacing:4px;">HOW TO PLAY</h1>
      <div class="pa-menu-h2">Objective</div>
      <div style="font-size:11px;color:#9aa3cf;line-height:1.6">Destroy every enemy structure. Build Power, a Candy
      Refinery, then war production. Harvesters mine <b style="color:#ff9af0">Rare Candy crystals</b> to fund your army.
      Radar unlocks tier 2; the Master Lab unlocks tier 3 and your faction superweapon.</div>
      <div class="pa-menu-h2">Controls</div>
      <table>
      <tr><td>Left click / drag</td><td>Select units (double-click: all of same type on screen)</td></tr>
      <tr><td>Right click</td><td>Context order: move / attack / harvest / capture · sets rally for selected factory</td></tr>
      <tr><td>Shift</td><td>Queue orders · add to selection · chain wall placement</td></tr>
      <tr><td>A + Left click</td><td>Attack-move</td></tr>
      <tr><td>S / G</td><td>Stop / Guard</td></tr>
      <tr><td>Ctrl+1..9 / 1..9</td><td>Assign / recall control group (double-tap to center)</td></tr>
      <tr><td>Q W E R T Y</td><td>Sidebar tabs (Buildings, Defense, Infantry, Vehicles, Air, Naval)</td></tr>
      <tr><td>H / Space</td><td>Center on Citadel / jump to last attack</td></tr>
      <tr><td>Arrows · mouse edge</td><td>Scroll the battlefield · mouse wheel zooms</td></tr>
      <tr><td>Esc</td><td>Cancel mode · game menu</td></tr>
      </table>
      <div class="pa-menu-h2">Elements</div>
      <div style="font-size:11px;color:#9aa3cf">🔥 Fire → 🌿 Grass → 🌊 Water → 🔥 Fire&nbsp;&nbsp;(+25% damage along the arrow, −20% against it)</div>`;
    panel.appendChild(btn('Back', () => this.showMainMenu()));
    el.appendChild(panel);
  }

  // --- lobby -----------------------------------------------------------------------

  showLobby(): void {
    this.restoreLobby(); // last-used settings (everything except seed)
    const el = this.screen();
    const panel = document.createElement('div');
    panel.className = 'pa-panel';
    panel.style.width = '660px';
    panel.innerHTML = `<h1 class="pa-title" style="font-size:26px;letter-spacing:5px;">SKIRMISH</h1>
      <div class="pa-subtitle" style="margin-bottom:14px">Operation Setup</div>`;

    // faction cards
    panel.insertAdjacentHTML('beforeend', `<div class="pa-menu-h2">Your Faction</div>`);
    const cards = document.createElement('div');
    cards.className = 'pa-fcards';
    for (const f of Object.values(DATA.factions)) {
      const roster = Object.values(DATA.units)
        .filter((u) => u.faction === f.id)
        .slice(0, 5)
        .map((u) => u.name)
        .join(' · ');
      const card = document.createElement('div');
      card.className = 'pa-fcard' + (f.id === this.faction ? ' sel' : '');
      card.style.setProperty('--fc', f.themeColor);
      card.innerHTML = `<div class="pa-fc-emblem">${FACTION_EMBLEMS[f.id]}</div>
        <div class="pa-fc-name" style="color:${f.themeColor}">${f.name}</div>
        <div class="pa-fc-blurb">${f.blurb}</div><div class="pa-fc-roster">${roster}…</div>`;
      card.addEventListener('click', () => {
        this.faction = f.id;
        this.persistLobby();
        cards.querySelectorAll('.pa-fcard').forEach((c) => c.classList.remove('sel'));
        card.classList.add('sel');
      });
      cards.appendChild(card);
    }
    panel.appendChild(cards);

    // color row
    const colorRow = document.createElement('div');
    colorRow.className = 'pa-row';
    colorRow.innerHTML = `<span class="pa-label">Your Color</span>`;
    const swatches: HTMLElement[] = [];
    PLAYER_COLORS.forEach((c, i) => {
      const sw = document.createElement('div');
      sw.className = 'pa-swatch' + (i === this.colorIdx ? ' sel' : '');
      sw.style.background = c.hex;
      sw.title = c.name;
      sw.addEventListener('click', () => {
        this.colorIdx = i;
        this.persistLobby();
        swatches.forEach((s) => s.classList.remove('sel'));
        sw.classList.add('sel');
      });
      swatches.push(sw);
      colorRow.appendChild(sw);
    });
    panel.appendChild(colorRow);

    // AI slots
    panel.insertAdjacentHTML('beforeend', `<div class="pa-menu-h2">Opponents</div>`);
    const aiHost = document.createElement('div');
    panel.appendChild(aiHost);
    const addBtn = document.createElement('div');
    addBtn.className = 'pa-small-btn';
    addBtn.style.margin = '6px 0';
    addBtn.textContent = '+ Add AI opponent';
    addBtn.addEventListener('click', () => {
      if (this.ais.length < 3) {
        this.ais.push({ faction: 'random', difficulty: 'medium' });
        this.persistLobby();
        renderAIs();
      }
    });
    panel.appendChild(addBtn);

    const renderAIs = () => {
      aiHost.innerHTML = '';
      addBtn.style.display = this.ais.length < 3 ? 'inline-block' : 'none';
      this.ais.forEach((ai, i) => {
        const row = document.createElement('div');
        row.className = 'pa-ai-row';
        row.innerHTML = `<span class="pa-ai-name">🤖 AI ${i + 1}</span>`;
        const fSel = document.createElement('select');
        fSel.innerHTML =
          `<option value="random">🎲 Random</option>` +
          Object.values(DATA.factions)
            .map((f) => `<option value="${f.id}" ${ai.faction === f.id ? 'selected' : ''}>${FACTION_EMBLEMS[f.id]} ${f.name}</option>`)
            .join('');
        fSel.value = ai.faction;
        fSel.addEventListener('change', () => {
          ai.faction = fSel.value as FactionId | 'random';
          this.persistLobby();
        });
        const dSel = document.createElement('select');
        dSel.innerHTML = `<option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>`;
        dSel.value = ai.difficulty;
        dSel.addEventListener('change', () => {
          ai.difficulty = dSel.value as AIDifficulty;
          this.persistLobby();
        });
        row.append(fSel, dSel);
        if (this.ais.length > 1) {
          const x = document.createElement('span');
          x.className = 'pa-x';
          x.textContent = '✕';
          x.title = 'Remove';
          x.addEventListener('click', () => {
            this.ais.splice(i, 1);
            this.persistLobby();
            renderAIs();
          });
          row.appendChild(x);
        }
        aiHost.appendChild(row);
      });
    };
    renderAIs();

    // map settings
    panel.insertAdjacentHTML('beforeend', `<div class="pa-menu-h2">Battlefield</div>`);
    const sizeRow = segRow('Map Size', ['S', 'M', 'L'], this.mapSize, (v) => {
      this.mapSize = v as 'S' | 'M' | 'L';
      this.persistLobby();
    });
    const waterRow = segRow('Water', ['low', 'medium', 'high'], this.water, (v) => {
      this.water = v as 'low' | 'medium' | 'high';
      this.persistLobby();
    });
    const cratesRow = segRow('Crates', ['on', 'off'], this.crates ? 'on' : 'off', (v) => {
      this.crates = v === 'on';
      this.persistLobby();
    });
    const seedRow = document.createElement('div');
    seedRow.className = 'pa-row';
    seedRow.innerHTML = `<span class="pa-label">Map Seed</span>`;
    const seedInput = document.createElement('input');
    seedInput.type = 'number';
    seedInput.value = String(this.seed);
    seedInput.style.width = '110px';
    seedInput.addEventListener('change', () => (this.seed = Math.abs(Number(seedInput.value) | 0) || 1));
    const dice = document.createElement('div');
    dice.className = 'pa-small-btn';
    dice.textContent = '🎲 Randomize';
    dice.addEventListener('click', () => {
      this.seed = Math.floor(Math.random() * 1e6);
      seedInput.value = String(this.seed);
    });
    seedRow.append(seedInput, dice);
    panel.append(sizeRow, waterRow, cratesRow, seedRow);

    // start
    const start = btn('⚔ Start Operation', () => this.launch(), true);
    start.style.width = '340px';
    start.style.marginTop = '20px';
    panel.appendChild(start);
    panel.appendChild(btn('Back', () => this.showMainMenu()));
    el.appendChild(panel);
  }

  private launch(): void {
    const factions: FactionId[] = ['scorch', 'tide', 'verdant'];
    const usedColors = new Set<number>([this.colorIdx]);
    const nextColor = () => {
      for (let i = 0; i < PLAYER_COLORS.length; i++) if (!usedColors.has(i)) return (usedColors.add(i), i);
      return 0;
    };
    const cfg: GameConfig =
      this.mode === 'crystalRush'
        ? {
            mode: 'crystalRush',
            seed: this.seed,
            mapSize: this.mapSize === 'S' ? 'M' : this.mapSize,
            waterAmount: 'low',
            crates: false,
            players: [
              { faction: this.faction, isHuman: true, difficulty: null, colorIdx: this.colorIdx, name: 'Commander' },
              ...[0, 1, 2].map((_, i) => {
                const f = factions[(factions.indexOf(this.faction) + i + 1) % factions.length];
                return {
                  faction: f,
                  isHuman: false,
                  difficulty: 'medium' as AIDifficulty,
                  colorIdx: nextColor(),
                  name: `${DATA.factions[f].name.split(' ')[0]} Rush AI ${i + 1}`,
                };
              }),
            ],
          }
        : {
            mode: 'classic',
            seed: this.seed,
            mapSize: this.mapSize,
            waterAmount: this.water,
            crates: this.crates,
            players: [
              { faction: this.faction, isHuman: true, difficulty: null, colorIdx: this.colorIdx, name: 'Commander' },
              ...this.ais.map((ai, i) => {
                const f = ai.faction === 'random' ? factions[Math.floor(Math.random() * 3)] : ai.faction;
                return {
                  faction: f,
                  isHuman: false,
                  difficulty: ai.difficulty,
                  colorIdx: nextColor(),
                  name: `${DATA.factions[f].name.split(' ')[0]} AI ${i + 1} (${ai.difficulty})`,
                };
              }),
            ],
          };
    this.persistLobby();
    this.lastConfig = cfg;
    this.onStart(cfg);
  }

  // --- loading / game over / esc -----------------------------------------------------

  showLoading(msg: string): void {
    if (!this.menuEl) this.screen();
    this.clearOverlay();
    const ov = document.createElement('div');
    ov.className = 'pa-overlay';
    const inner = document.createElement('div');
    inner.className = 'pa-load-card';
    inner.innerHTML = `<div class="pa-spin"></div>
      <div style="text-align:center;font-size:13px;letter-spacing:3px;color:#dfe5ff">${msg}</div>
      <div class="pa-load-tip"></div>`;
    ov.appendChild(inner);
    (this.menuEl ?? this.root).appendChild(ov);
    this.overlayEl = ov;
    const tipEl = inner.querySelector('.pa-load-tip') as HTMLElement;
    let t = Math.floor(Math.random() * TIPS.length);
    tipEl.textContent = '💡 ' + TIPS[t];
    this.tipTimer = window.setInterval(() => {
      t = (t + 1) % TIPS.length;
      tipEl.textContent = '💡 ' + TIPS[t];
    }, 3200);
  }

  showGameOver(victory: boolean, stats: string, onBackToMenu: () => void): void {
    this.clearMenu();
    const ov = document.createElement('div');
    ov.className = 'pa-overlay';
    ov.style.background = 'rgba(5,6,12,0.9)';
    const inner = document.createElement('div');
    inner.innerHTML = `<div class="pa-go-banner ${victory ? 'win' : 'lose'}">${victory ? 'VICTORY' : 'DEFEAT'}</div>
      <div class="pa-go-stats">${stats}</div>`;
    const back = btn('Back to HQ', () => {
      ov.remove();
      onBackToMenu();
    }, true);
    inner.appendChild(back);
    ov.appendChild(inner);
    this.root.appendChild(ov);
  }

  /** RA2-style end-of-match score screen: banner, per-player score table, time. */
  showScoreScreen(result: MatchResult, onPlayAgain: () => void, onBackToMenu: () => void): void {
    this.clearMenu();
    const ov = document.createElement('div');
    ov.className = 'pa-overlay';
    ov.style.background = 'rgba(5,6,12,0.9)';
    const inner = document.createElement('div');
    inner.innerHTML = `<div class="pa-go-banner pa-score-banner ${result.victory ? 'win' : 'lose'}">${
      result.victory ? 'VICTORY' : 'DEFEAT'
    }</div>`;

    // Score table — header + one color-barred row per player.
    const table = document.createElement('table');
    table.className = 'pa-score-table';
    const cols = [
      'Creatures Killed',
      'Creatures Lost',
      'Buildings Destroyed',
      'Buildings Lost',
      'Crystals Harvested',
      'Score',
    ];
    let html = `<tr><th></th>${cols.map((c) => `<th>${c}</th>`).join('')}</tr>`;
    for (const p of result.players) {
      const hex = PLAYER_COLORS[p.colorIdx]?.hex ?? '#888';
      const nameStyle = p.isHuman ? 'font-weight:bold;color:#fff;' : '';
      const nameClass = p.eliminated ? ' class="pa-score-dead"' : '';
      const nums = [
        p.stats.unitsKilled,
        p.stats.unitsLost,
        p.stats.buildingsKilled,
        p.stats.buildingsLost,
        p.stats.creditsHarvested,
      ];
      html += `<tr class="pa-score-row" style="background:linear-gradient(90deg, ${hex}1f, transparent 70%)">
        <td class="pa-score-name"><span class="pa-score-swatch" style="background:${hex}"></span><span${nameClass} style="${nameStyle}">${escapeHtml(p.name)}</span></td>
        ${nums.map((n) => `<td data-count="${n}">0</td>`).join('')}
        <td class="pa-score-score" data-count="${p.stats.score}">0</td>
      </tr>`;
    }
    table.innerHTML = html;
    inner.appendChild(table);

    inner.insertAdjacentHTML(
      'beforeend',
      `<div class="pa-score-time">Operation time ${formatDuration(result.durationSec)}</div>`,
    );

    const again = btn('⚔ Play Again', () => {
      ov.remove();
      onPlayAgain();
    }, true);
    const back = btn('Back to HQ', () => {
      ov.remove();
      onBackToMenu();
    });
    inner.append(again, back);
    ov.appendChild(inner);
    this.root.appendChild(ov);

    // Count the numbers up over ~800ms (eased; cosmetic, renderer-side timing OK).
    const counters = Array.from(table.querySelectorAll<HTMLElement>('[data-count]'));
    const t0 = performance.now();
    const DURATION = 800;
    const step = (now: number) => {
      if (!table.isConnected) return; // screen dismissed mid-animation
      const k = Math.min(1, (now - t0) / DURATION);
      const ease = 1 - Math.pow(1 - k, 3);
      for (const c of counters) {
        const target = Number(c.dataset.count) || 0;
        c.textContent = Math.round(target * ease).toLocaleString();
      }
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  showEscMenu(opts: {
    onResume: () => void;
    onSurrender: () => void;
    onQuit: () => void;
    /** Optional audio on/off rows (label + getter/setter), e.g. Music / SFX / Voice. */
    audioToggles?: { label: string; get: () => boolean; set: (on: boolean) => void }[];
  }): void {
    this.hideEscMenu();
    const ov = document.createElement('div');
    ov.className = 'pa-overlay';
    const panel = document.createElement('div');
    panel.className = 'pa-panel';
    panel.innerHTML = `<div style="text-align:center;font-size:16px;letter-spacing:5px;color:#fff;margin-bottom:14px">OPERATION PAUSED</div>`;
    panel.append(
      btn('Resume', opts.onResume, true),
      btn('Surrender', () => {
        if (confirm('Surrender the operation?')) opts.onSurrender();
      }),
      btn('Quit to Menu', () => {
        if (confirm('Quit to the main menu? The match will be lost.')) opts.onQuit();
      }),
    );

    // Options: Scroll Rate (CnCNet-style ticks, linear px/s) + audio toggles.
    panel.insertAdjacentHTML('beforeend', `<div class="pa-menu-h2">Options</div>`);
    panel.appendChild(this.scrollRateRow());
    for (const t of opts.audioToggles ?? []) {
      panel.appendChild(segRow(t.label, ['on', 'off'], t.get() ? 'on' : 'off', (v) => t.set(v === 'on')));
    }

    ov.appendChild(panel);
    this.root.appendChild(ov);
    this.escEl = ov;
  }

  /**
   * Scroll Rate segmented control: SCROLL_RATE_TICKS steps mapped linearly onto
   * SCROLL_RATE_MIN..SCROLL_RATE_MAX px/s. Written to localStorage immediately —
   * input.ts re-reads the key live, so the change applies without a restart.
   */
  private scrollRateRow(): HTMLElement {
    const rateForTick = (i: number): number =>
      Math.round(SCROLL_RATE_MIN + (i * (SCROLL_RATE_MAX - SCROLL_RATE_MIN)) / (SCROLL_RATE_TICKS - 1));
    let rate = SCROLL_RATE_DEFAULT;
    try {
      const v = Number(localStorage.getItem(SCROLL_RATE_KEY));
      if (Number.isFinite(v) && v > 0) rate = Math.max(SCROLL_RATE_MIN, Math.min(SCROLL_RATE_MAX, v));
    } catch {
      // Storage unreadable — show the default.
    }
    let tick = 0;
    for (let i = 1; i < SCROLL_RATE_TICKS; i++) {
      if (Math.abs(rateForTick(i) - rate) < Math.abs(rateForTick(tick) - rate)) tick = i;
    }

    const row = document.createElement('div');
    row.className = 'pa-row';
    row.innerHTML = `<span class="pa-label">Scroll Rate</span>`;
    const seg = document.createElement('div');
    seg.className = 'pa-seg';
    const readout = document.createElement('span');
    readout.className = 'pa-opt-readout';
    readout.textContent = `${rateForTick(tick)} px/s`;
    for (let i = 0; i < SCROLL_RATE_TICKS; i++) {
      const o = document.createElement('div');
      o.className = 'pa-seg-opt' + (i === tick ? ' sel' : '');
      o.textContent = String(i + 1);
      o.title = `${rateForTick(i)} px/s`;
      o.addEventListener('click', () => {
        tick = i;
        try {
          localStorage.setItem(SCROLL_RATE_KEY, String(rateForTick(i)));
        } catch {
          // Storage unavailable — the rate just won't persist.
        }
        seg.querySelectorAll('.pa-seg-opt').forEach((x) => x.classList.remove('sel'));
        o.classList.add('sel');
        readout.textContent = `${rateForTick(i)} px/s`;
      });
      seg.appendChild(o);
    }
    row.append(seg, readout);
    return row;
  }

  hideEscMenu(): void {
    this.escEl?.remove();
    this.escEl = null;
  }
}

// --- tiny DOM helpers -----------------------------------------------------------------

/** Seconds -> 'M:SS' (e.g. 754 -> '12:34'). */
function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Player names come back out of localStorage — never trust them as HTML. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function btn(label: string, onClick: () => void, primary = false): HTMLElement {
  const b = document.createElement('div');
  b.className = 'pa-btn' + (primary ? ' primary' : '');
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function segRow(label: string, options: string[], current: string, onPick: (v: string) => void): HTMLElement {
  const row = document.createElement('div');
  row.className = 'pa-row';
  row.innerHTML = `<span class="pa-label">${label}</span>`;
  const seg = document.createElement('div');
  seg.className = 'pa-seg';
  for (const opt of options) {
    const o = document.createElement('div');
    o.className = 'pa-seg-opt' + (opt === current ? ' sel' : '');
    o.textContent = opt.toUpperCase();
    o.addEventListener('click', () => {
      onPick(opt);
      seg.querySelectorAll('.pa-seg-opt').forEach((x) => x.classList.remove('sel'));
      o.classList.add('sel');
    });
    seg.appendChild(o);
  }
  row.appendChild(seg);
  return row;
}
