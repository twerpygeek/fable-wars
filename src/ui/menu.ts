// =============================================================================
// FABLE WARS — menus (Owner E): main menu, skirmish lobby, loading overlay,
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
import {
  battleInviteUrl,
  multiplayerEndpoint,
  normalizeRoomCode,
  randomRoomCode,
  roomSocketUrl,
} from '../net/multiplayer';
import { createRoomClient, type RoomClient } from '../net/client';
import type { OnlineCommandFrame, OnlineMatchConnection } from '../net/onlineCommands';
import type { RoomPlayer } from '../net/protocol';
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
    linear-gradient(180deg, rgba(22, 22, 25, 0.58), rgba(7, 8, 12, 0.9)),
    linear-gradient(90deg, rgba(170, 105, 45, 0.16), transparent 24%, transparent 76%, rgba(94, 126, 150, 0.12));
  border-color: rgba(255, 221, 150, 0.32);
  backdrop-filter: blur(10px);
  padding: clamp(18px, 2.4vw, 28px);
  box-shadow: 0 30px 90px rgba(0,0,0,0.74), inset 0 1px 0 rgba(255,255,255,0.08), inset 0 0 0 2px rgba(15,10,7,0.72); }
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
.pa-choice-section { position: relative; padding: 14px 12px 12px; margin-bottom: 14px;
  background:
    linear-gradient(180deg, rgba(255, 226, 171, 0.035), rgba(255,255,255,0.008) 42%, rgba(0,0,0,0.22)),
    repeating-linear-gradient(135deg, rgba(255,255,255,0.018) 0 1px, transparent 1px 8px);
  border: 1px solid rgba(185, 144, 82, 0.24);
  box-shadow: inset 0 1px 0 rgba(255, 235, 190, 0.08), inset 0 -2px 0 rgba(0,0,0,0.42); }
.pa-choice-section::before { content: ''; position: absolute; left: 12px; right: 12px; top: -1px; height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255, 215, 119, 0.72), transparent); pointer-events: none; }
.pa-section-head { display: flex; justify-content: space-between; align-items: end; gap: 16px; margin: 0 0 10px; }
.pa-section-title { color: #fff4d6; font-size: 11px; letter-spacing: 3px; text-transform: uppercase; font-weight: bold;
  text-shadow: 0 2px 8px rgba(0,0,0,0.9), 0 0 12px rgba(255, 215, 119, 0.18); }
.pa-section-note { color: #8f98c7; font-size: 8px; letter-spacing: 2px; text-transform: uppercase; text-align: right; }
.pa-faction-strip { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 0; }
.pa-faction-tile { min-height: 156px; border: 1px solid rgba(255,255,255,0.16); border-radius: 6px; overflow: hidden; position: relative;
  background-size: cover; background-position: center; cursor: pointer;
  box-shadow: inset 0 -82px 58px rgba(0,0,0,0.76), inset 0 1px 0 rgba(255,255,255,0.08), 0 2px 0 #050506; }
.pa-faction-tile::before { content: ''; position: absolute; inset: 0;
  background: linear-gradient(180deg, rgba(255,255,255,0.05), rgba(0,0,0,0.22) 34%, rgba(0,0,0,0.84)); }
.pa-faction-tile::after { content: ''; position: absolute; inset: 5px; border: 1px solid rgba(255,220,150,0.18); pointer-events: none; }
.pa-faction-tile:hover { border-color: #b99052; filter: brightness(1.08); }
.pa-faction-tile.sel { border-color: var(--fc, #f0b35c);
  box-shadow: inset 0 -82px 58px rgba(0,0,0,0.74), inset 0 1px 0 rgba(255,255,255,0.12), 0 0 22px color-mix(in srgb, var(--fc, #f0b35c) 44%, transparent); }
.pa-faction-copy { position: absolute; left: 12px; right: 12px; bottom: 10px; z-index: 1; }
.pa-faction-title { color: #fff; font-size: 12px; font-weight: bold; letter-spacing: 2px; text-transform: uppercase; text-shadow: 0 2px 8px #000; }
.pa-faction-role { margin-top: 4px; color: #ffd777; font-size: 8px; letter-spacing: 2px; text-transform: uppercase; text-shadow: 0 2px 6px #000; }
.pa-faction-stats { display: grid; gap: 4px; margin-top: 8px; }
.pa-faction-stat { display: grid; grid-template-columns: 56px 1fr 20px; align-items: center; gap: 6px; color: #cfd6ff;
  font-size: 7px; letter-spacing: 1px; text-transform: uppercase; text-shadow: 0 1px 3px #000; }
.pa-faction-bar { height: 4px; background: rgba(255,255,255,0.14); border: 1px solid rgba(255,255,255,0.08); box-shadow: inset 0 1px 2px rgba(0,0,0,0.8); }
.pa-faction-fill { display: block; height: 100%; background: linear-gradient(90deg, var(--fc, #f0b35c), #fff1a4); box-shadow: 0 0 8px color-mix(in srgb, var(--fc, #f0b35c) 60%, transparent); }
.pa-command-row { display: grid; grid-template-columns: 1.35fr 1fr 1fr 1fr 1fr; gap: 10px; align-items: stretch; }
.pa-online-grid { display: grid; gap: 12px; }
.pa-online-card { border: 1px solid rgba(255, 220, 150, 0.24); border-radius: 4px; padding: 12px;
  background:
    linear-gradient(180deg, rgba(40, 34, 26, 0.56), rgba(8, 9, 14, 0.88)),
    repeating-linear-gradient(135deg, rgba(255,255,255,0.018) 0 1px, transparent 1px 8px);
  box-shadow: inset 0 1px 0 rgba(255,237,190,0.08), inset 0 -2px 0 rgba(0,0,0,0.48); }
.pa-online-card h2 { margin: 0 0 7px; color: #fff4d6; font-size: 13px; letter-spacing: 3px; text-transform: uppercase; }
.pa-online-card p { margin: 0 0 9px; color: #aeb7e8; font-size: 10px; line-height: 1.55; letter-spacing: 1px; }
.pa-online-status { display: inline-flex; align-items: center; gap: 7px; margin-bottom: 8px; color: #ffd777;
  font-size: 9px; letter-spacing: 2px; text-transform: uppercase; }
.pa-online-status::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: #e8453c; box-shadow: 0 0 12px #e8453c; }
.pa-online-status.ready::before { background: #65d86e; box-shadow: 0 0 12px #65d86e; }
.pa-online-roadmap { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin: 8px 0 10px; }
.pa-online-step { padding: 8px; border: 1px solid rgba(255, 220, 150, 0.16); background: rgba(5,7,13,0.42);
  color: #aeb7e8; font-size: 8px; line-height: 1.35; letter-spacing: 1px; text-transform: uppercase; }
.pa-online-step b { display: block; margin-bottom: 4px; color: #fff4d6; font-size: 9px; letter-spacing: 2px; }
.pa-online-form { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.pa-online-form label { display: grid; gap: 4px; color: #8d96c8; font-size: 8px; letter-spacing: 2px; text-transform: uppercase; }
.pa-online-form input { min-width: 0; background: linear-gradient(180deg, #11131b, #05060a); color: #ffd777; border: 2px solid #2a231d; border-radius: 3px;
  padding: 8px 9px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; letter-spacing: 1px;
  box-shadow: inset 0 2px 5px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,237,190,0.08); }
.pa-online-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }
.pa-online-note { color: #8790bf; font-size: 9px; line-height: 1.55; letter-spacing: 1px; }
.pa-online-note code { color: #ffd777; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.pa-online-roster { display: grid; gap: 7px; margin-top: 10px; }
.pa-online-player { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 8px;
  padding: 8px; border: 1px solid rgba(255,220,150,0.16); border-radius: 3px;
  background: linear-gradient(180deg, rgba(18,21,32,0.74), rgba(5,7,13,0.66));
  box-shadow: inset 0 1px 0 rgba(255,237,190,0.06), inset 0 -2px 0 rgba(0,0,0,0.32); }
.pa-online-player.empty { grid-template-columns: 1fr; color: #8790bf; font-size: 8px; letter-spacing: 1px; text-transform: uppercase; }
.pa-online-color { width: 10px; height: 10px; border-radius: 50%; background: var(--pc, #ffd777);
  border: 1px solid rgba(255,255,255,0.32); box-shadow: 0 0 10px var(--pc, #ffd777); }
.pa-online-player-name { min-width: 0; color: #fff4d6; font-size: 10px; letter-spacing: 1px; text-transform: uppercase;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pa-online-player-meta { margin-top: 2px; color: #8f98c7; font-size: 7px; letter-spacing: 1px; text-transform: uppercase; }
.pa-online-pill { padding: 4px 6px; border: 1px solid rgba(101,216,110,0.48); border-radius: 2px; color: #b9ffbe;
  background: rgba(37,93,43,0.24); font-size: 7px; letter-spacing: 1px; text-transform: uppercase; }
.pa-online-pill.waiting { border-color: rgba(255,215,119,0.38); color: #ffd777; background: rgba(110,76,25,0.24); }
.pa-online-chat { margin-top: 10px; border-top: 1px solid rgba(255,220,150,0.14); padding-top: 9px; }
.pa-online-chat-log { min-height: 72px; max-height: 112px; overflow-y: auto; display: grid; align-content: start; gap: 5px;
  padding: 8px; border: 1px solid rgba(255,220,150,0.12); border-radius: 3px;
  background: rgba(4,6,12,0.46); scrollbar-width: thin; }
.pa-online-chat-line { color: #cfd6ff; font-size: 8px; line-height: 1.4; letter-spacing: 1px; }
.pa-online-chat-line b { color: #ffd777; font-weight: bold; text-transform: uppercase; }
.pa-online-chat-line.system { color: #8790bf; text-transform: uppercase; }
.pa-online-chat-form { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 7px; margin-top: 7px; }
.pa-online-chat-form input { min-width: 0; background: linear-gradient(180deg, #11131b, #05060a); color: #fff4d6;
  border: 2px solid #2a231d; border-radius: 3px; padding: 7px 8px; font-size: 10px; letter-spacing: 1px;
  box-shadow: inset 0 2px 5px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,237,190,0.08); }
.pa-online-chat-form .pa-small-btn { min-width: 78px; }
.pa-online-start { width: 100%; margin-top: 10px; min-height: 46px; font-size: 10px; letter-spacing: 2px; }
.pa-online-muted { opacity: 0.46; filter: grayscale(0.45); pointer-events: none; }
.pa-lobby-actions { position: sticky; bottom: -28px; z-index: 3; display: grid; grid-template-columns: 1.2fr 1fr; gap: 10px;
  margin: 18px -10px -18px; padding: 12px 10px 10px;
  background: linear-gradient(180deg, rgba(8, 9, 14, 0.08), rgba(8, 9, 14, 0.94) 28%, rgba(8, 9, 14, 0.98));
  border-top: 1px solid rgba(255, 220, 150, 0.2); box-shadow: 0 -18px 28px rgba(5,6,10,0.62); }
.pa-lobby-actions .pa-btn { min-height: 54px; }
.pa-mode-pick { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 0; }
.pa-mode-choice { min-height: 182px; padding: 0; border: 2px solid #2b241d; border-radius: 4px;
  position: relative; overflow: hidden;
  background:
    linear-gradient(180deg, rgba(95,83,69,0.28), rgba(12,12,16,0.24) 34%, rgba(5,6,10,0.94)),
    repeating-linear-gradient(135deg, rgba(255,255,255,0.035) 0 1px, transparent 1px 7px);
  cursor: pointer;
  box-shadow: inset 0 2px 0 rgba(255,229,170,0.18), inset 0 -3px 0 rgba(0,0,0,0.78), 0 2px 0 #050506; }
.pa-mode-choice::before { content: ''; position: absolute; inset: 4px; border: 1px solid rgba(151, 123, 75, 0.34); pointer-events: none; }
.pa-mode-choice::after { content: ''; position: absolute; left: 10px; right: 10px; top: 3px; height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255,234,176,0.58), transparent); pointer-events: none; }
.pa-mode-choice:hover { border-color: #b99052; filter: brightness(1.1); box-shadow: inset 0 2px 0 rgba(255,229,170,0.24), inset 0 -3px 0 rgba(0,0,0,0.8), 0 0 18px rgba(202,151,77,0.28); }
.pa-mode-choice.sel { border-color: #f0b35c; background:
    linear-gradient(180deg, rgba(117, 77, 38, 0.5), rgba(20,14,11,0.42) 36%, rgba(5,6,10,0.94)),
    repeating-linear-gradient(135deg, rgba(255,229,170,0.045) 0 1px, transparent 1px 7px);
  box-shadow: inset 0 2px 0 rgba(255,230,170,0.32), inset 0 -3px 0 rgba(0,0,0,0.78), 0 0 22px rgba(255,142,62,0.34); }
.pa-mode-preview { position: absolute; inset: 0; background-size: cover; background-position: center; filter: brightness(1.18) saturate(1.24) contrast(1.08); transform: scale(1.01); }
.pa-mode-preview::after { content: ''; position: absolute; inset: 0;
  background:
    radial-gradient(ellipse at 50% 18%, rgba(255, 229, 162, 0.13), transparent 45%),
    linear-gradient(180deg, rgba(0,0,0,0.02), rgba(0,0,0,0.16) 46%, rgba(0,0,0,0.7)); }
.pa-mode-copy { position: absolute; left: 14px; right: 14px; bottom: 12px; z-index: 1; }
.pa-mode-copy::before { content: ''; position: absolute; left: -8px; right: -8px; bottom: -8px; height: 78px; z-index: -1;
  background: linear-gradient(180deg, rgba(4,5,8,0), rgba(4,5,8,0.72) 38%, rgba(4,5,8,0.92)); pointer-events: none; }
.pa-mode-choice strong { display: block; color: #fff; font-size: 12px; letter-spacing: 2px; text-transform: uppercase; text-shadow: 0 2px 8px #000, 0 0 12px rgba(255,225,170,0.28); }
.pa-mode-choice span { display: block; margin-top: 6px; color: #f0e4cf; font-size: 9px; line-height: 1.35; letter-spacing: 1px; text-shadow: 0 2px 6px #000; }
.pa-trailer-overlay { position: absolute; inset: 0; z-index: 10; display: grid; place-items: center; padding: 24px;
  background: rgba(3, 4, 8, 0.78); backdrop-filter: blur(8px); }
.pa-trailer-frame { width: min(1040px, 94vw); background: #05070c; border: 2px solid #b99052; border-radius: 6px;
  box-shadow: 0 26px 80px rgba(0,0,0,0.82), inset 0 1px 0 rgba(255,239,190,0.2); overflow: hidden; }
.pa-trailer-head { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 10px 12px;
  border-bottom: 1px solid rgba(255,220,150,0.24); color: #ffd777; font-size: 10px; letter-spacing: 2px; text-transform: uppercase; }
.pa-trailer-title { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pa-trailer-close { cursor: pointer; color: #fff5d8; border: 1px solid rgba(255,220,150,0.5); padding: 7px 11px;
  background: linear-gradient(180deg, #333849, #11131d); box-shadow: inset 0 1px 0 rgba(255,255,255,0.14); }
.pa-trailer-frame video { display: block; width: 100%; aspect-ratio: 16 / 9; background: #000; }
.pa-trailer-tabs { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; padding: 10px; background: linear-gradient(180deg, #0d1019, #05070c);
  border-top: 1px solid rgba(255,220,150,0.12); }
.pa-trailer-tab { min-height: 44px; cursor: pointer; border: 1px solid rgba(185,144,82,0.36); border-radius: 3px; color: #cfd6ff;
  background:
    radial-gradient(ellipse at 50% 0%, rgba(255,234,178,0.11), transparent 54%),
    linear-gradient(180deg, #242838, #0b0d14);
  font-size: 10px; letter-spacing: 2px; text-transform: uppercase; font-weight: bold;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.11), inset 0 -3px 0 rgba(0,0,0,0.58); }
.pa-trailer-tab.sel { color: #fff4d6; border-color: #f0b35c;
  background: linear-gradient(180deg, #5b3724, #171018);
  box-shadow: inset 0 1px 0 rgba(255,229,170,0.24), inset 0 -3px 0 rgba(0,0,0,0.68), 0 0 20px rgba(240,179,92,0.2); }
.pa-btn { display: flex; align-items: center; justify-content: center; min-height: 58px; padding: 0 18px; text-align: center; font-size: 13px; letter-spacing: 3px;
  position: relative; overflow: hidden;
  background:
    radial-gradient(ellipse at 50% 0%, rgba(255,234,178,0.15), transparent 42%),
    linear-gradient(180deg, #42485a 0%, #1b1f2c 42%, #090a0f 100%);
  color: #e7e1d2; border: 2px solid #2a231d; border-radius: 4px;
  cursor: pointer; text-transform: uppercase; font-weight: bold;
  text-shadow: 0 2px 0 #000, 0 0 10px rgba(255,226,165,0.18);
  box-shadow: inset 0 2px 0 rgba(255,237,190,0.22), inset 0 -4px 0 rgba(0,0,0,0.76), 0 3px 0 #050506, 0 12px 22px rgba(0,0,0,0.34); }
.pa-btn::before { content: ''; position: absolute; inset: 5px; border: 1px solid rgba(202, 171, 109, 0.36); pointer-events: none; }
.pa-btn::after { content: ''; position: absolute; left: 12px; right: 12px; top: 4px; height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255,239,190,0.72), transparent); pointer-events: none; }
.pa-btn:hover { border-color: #d2a25d; color: #fff8e6; filter: brightness(1.08);
  box-shadow: inset 0 2px 0 rgba(255,237,190,0.3), inset 0 -4px 0 rgba(0,0,0,0.78), 0 3px 0 #050506, 0 0 22px rgba(223,169,89,0.34); }
.pa-btn:active { transform: translateY(2px); box-shadow: inset 0 1px 0 rgba(255,237,190,0.16), inset 0 3px 10px rgba(0,0,0,0.7), 0 1px 0 #050506; }
.pa-btn.primary { min-height: 68px; background:
    radial-gradient(ellipse at 50% 0%, rgba(255,223,146,0.22), transparent 45%),
    linear-gradient(180deg, #9a4f2f 0%, #672f1f 43%, #2a120d 100%);
  border-color: #f1b15e; color: #fff5d8; font-weight: bold;
  box-shadow: inset 0 2px 0 rgba(255,239,190,0.36), inset 0 -4px 0 rgba(55,15,10,0.88), 0 3px 0 #120806, 0 0 26px rgba(255, 101, 56, 0.28); }
.pa-btn.primary:hover { box-shadow: inset 0 2px 0 rgba(255,239,190,0.42), inset 0 -4px 0 rgba(55,15,10,0.88), 0 3px 0 #120806, 0 0 32px rgba(255, 136, 58, 0.5); }
.pa-launch-footer { display: flex; justify-content: space-between; align-items: center; gap: 18px; margin-top: 14px; padding-top: 11px;
  border-top: 1px solid rgba(255, 220, 150, 0.14); color: #7d88bc; font-size: 9px; letter-spacing: 1px; text-transform: uppercase; }
.pa-launch-credit { display: inline-flex; gap: 6px; align-items: center; color: #8f98c7; white-space: nowrap; }
.pa-launch-footer a { color: #d2dbff; text-decoration: none; text-shadow: 0 0 10px rgba(160,180,255,0.16); }
.pa-launch-footer a:hover { color: #ffd777; text-decoration: underline; text-underline-offset: 3px; }
.pa-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
.pa-row { display: flex; gap: 10px; align-items: center; margin: 12px 0; flex-wrap: wrap; }
.pa-label { font-size: 10px; letter-spacing: 2px; color: #8d96c8; text-transform: uppercase; min-width: 90px; }
.pa-fcards { display: flex; gap: 10px; margin: 6px 0 14px; }
.pa-fcard { flex: 1; min-width: 150px; border: 2px solid #2a231d; border-radius: 4px; padding: 12px 10px; cursor: pointer; position: relative; overflow: hidden;
  background:
    linear-gradient(180deg, rgba(55,49,42,0.78), rgba(11,12,17,0.95)),
    repeating-linear-gradient(135deg, rgba(255,255,255,0.035) 0 1px, transparent 1px 8px);
  box-shadow: inset 0 2px 0 rgba(255,229,170,0.18), inset 0 -3px 0 rgba(0,0,0,0.72), 0 2px 0 #050506; }
.pa-fcard::before { content: ''; position: absolute; inset: 4px; border: 1px solid rgba(151, 123, 75, 0.3); pointer-events: none; }
.pa-fcard:hover { border-color: #b99052; filter: brightness(1.08); }
.pa-fcard.sel { border-color: var(--fc, #d8a35f); box-shadow: inset 0 2px 0 rgba(255,229,170,0.26), inset 0 -3px 0 rgba(0,0,0,0.74), 0 0 18px color-mix(in srgb, var(--fc) 50%, transparent); }
.pa-fcard .pa-fc-emblem { font-size: 28px; text-align: center; }
.pa-fc-emblem { width: 42px; height: 42px; margin: 0 auto 6px; display: grid; place-items: center; color: #fff5d8;
  border: 2px solid #2a231d; border-radius: 50%;
  background: radial-gradient(circle at 50% 30%, color-mix(in srgb, var(--fc, #d8a35f) 54%, #ffffff 12%), rgba(15,12,9,0.95) 68%);
  box-shadow: inset 0 2px 0 rgba(255,237,190,0.22), inset 0 -4px 0 rgba(0,0,0,0.62), 0 0 18px color-mix(in srgb, var(--fc, #d8a35f) 35%, transparent);
  font-size: 15px; font-weight: bold; letter-spacing: 1px; text-shadow: 0 2px 0 #000; }
.pa-fcard .pa-fc-name { font-size: 12px; font-weight: bold; text-align: center; letter-spacing: 1px; margin: 4px 0; color: #fff; }
.pa-fcard .pa-fc-role { text-align: center; color: #ffd777; font-size: 8px; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 8px; }
.pa-fcard .pa-fc-blurb { font-size: 9px; color: #9aa3cf; line-height: 1.5; min-height: 40px; }
.pa-fcard .pa-fc-roster { font-size: 8px; color: #6f78a8; margin-top: 6px; line-height: 1.4; }
.pa-fcard .pa-faction-stats { margin: 8px 0 6px; }
.pa-seg { display: flex; gap: 3px; }
.pa-seg .pa-seg-opt { padding: 7px 14px; font-size: 10px; letter-spacing: 1px; background: linear-gradient(180deg, #343a4c, #11141e);
  border: 2px solid #2a231d; box-shadow: inset 0 1px 0 rgba(255,237,190,0.14), inset 0 -2px 0 rgba(0,0,0,0.72);
  cursor: pointer; color: #b7af9d; text-transform: uppercase; font-weight: bold; }
.pa-seg .pa-seg-opt:first-child { border-radius: 4px 0 0 4px; } .pa-seg .pa-seg-opt:last-child { border-radius: 0 4px 4px 0; }
.pa-seg .pa-seg-opt:hover { color: #fff8e6; border-color: #a9854d; }
.pa-seg .pa-seg-opt.sel { background: linear-gradient(180deg, #75522d, #20140d); color: #fff5d8; border-color: #e4ad5d; }
.pa-swatch { width: 24px; height: 24px; border-radius: 3px; border: 2px solid #2a231d; cursor: pointer; box-shadow: inset 0 1px 0 rgba(255,255,255,0.28), 0 2px 0 #050506; }
.pa-swatch.sel { border-color: #ffe3a0; box-shadow: inset 0 1px 0 rgba(255,255,255,0.36), 0 0 12px rgba(255,214,115,0.72); }
.pa-swatch.taken { opacity: 0.25; cursor: not-allowed; }
.pa-ai-row { display: flex; gap: 8px; align-items: center; background: #1113233; background: #131528; border: 1px solid #262a4c;
  border-radius: 4px; padding: 7px 10px; margin: 6px 0; }
.pa-ai-row select, .pa-panel input[type=number] { background: linear-gradient(180deg, #141721, #07080d); color: #e7e1d2; border: 2px solid #2a231d; border-radius: 3px;
  padding: 6px 8px; font-family: inherit; font-size: 11px; box-shadow: inset 0 2px 5px rgba(0,0,0,0.58), inset 0 1px 0 rgba(255,237,190,0.08); }
.pa-ai-row .pa-ai-name { font-size: 10px; letter-spacing: 1px; color: #aeb6e2; flex: 1; }
.pa-x { color: #e8453c; cursor: pointer; font-weight: bold; padding: 0 4px; }
.pa-small-btn { font-size: 10px; letter-spacing: 1px; padding: 7px 13px; background: linear-gradient(180deg, #343a4c, #11141e); border: 2px solid #2a231d;
  border-radius: 4px; cursor: pointer; color: #c9c0aa; text-transform: uppercase; font-weight: bold; box-shadow: inset 0 1px 0 rgba(255,237,190,0.14), inset 0 -2px 0 rgba(0,0,0,0.7), 0 2px 0 #050506; }
.pa-small-btn:hover { color: #fff8e6; border-color: #c99b57; }
.pa-battle-code { display: grid; grid-template-columns: 1fr auto auto; gap: 8px; align-items: center; margin: 10px 0 4px;
  padding: 9px; border: 1px solid rgba(255, 220, 150, 0.22); border-radius: 4px;
  background: linear-gradient(180deg, rgba(30, 27, 24, 0.64), rgba(8, 9, 14, 0.86)); box-shadow: inset 0 1px 0 rgba(255,237,190,0.08); }
.pa-battle-code input { min-width: 0; background: linear-gradient(180deg, #11131b, #05060a); color: #ffd777; border: 2px solid #2a231d; border-radius: 3px;
  padding: 8px 9px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 10px; letter-spacing: 1px;
  box-shadow: inset 0 2px 5px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,237,190,0.08); }
.pa-code-status { grid-column: 1 / -1; min-height: 12px; color: #8790bf; font-size: 8px; letter-spacing: 1px; text-transform: uppercase; }
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
.pa-svc-replay { cursor: pointer; font-size: 13px; color: #d8c7a1; padding: 2px 8px; border: 2px solid #2a231d; border-radius: 3px; flex-shrink: 0;
  background: linear-gradient(180deg, #343a4c, #11141e); box-shadow: inset 0 1px 0 rgba(255,237,190,0.14), 0 1px 0 #050506; }
.pa-svc-replay:hover { color: #fff8e6; border-color: #c99b57; }
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
  .pa-menu-root { align-items: flex-start; padding: 10px; min-height: 100svh; overflow-y: auto; }
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
  .pa-title-stage { width: 100%; min-height: 100svh; justify-content: flex-start; padding: max(10px, env(safe-area-inset-top)) 0 max(10px, env(safe-area-inset-bottom)); }
  .pa-panel--main { width: 100%; padding: 12px; background: linear-gradient(180deg, rgba(12,14,24,0.34), rgba(8,10,18,0.76)); backdrop-filter: blur(5px); }
  .pa-logo-wrap { width: min(300px, 66vw); margin: 0 auto 8px; padding-top: clamp(6px, 2vh, 14px); }
  .pa-title { font-size: 34px; letter-spacing: 4px; }
  .pa-codex-grid { grid-template-columns: 1fr; }
  .pa-launch-top { margin-bottom: 9px; }
  .pa-launch-status { display: none; }
  .pa-choice-section { padding: 10px 8px 8px; margin-bottom: 9px; }
  .pa-section-head { display: block; margin-bottom: 7px; }
  .pa-section-title { font-size: 9px; letter-spacing: 2px; }
  .pa-section-note { margin-top: 3px; font-size: 7px; letter-spacing: 1px; text-align: left; }
  .pa-faction-strip { grid-template-columns: 1fr; gap: 7px; }
  .pa-faction-tile { min-height: 96px; }
  .pa-faction-copy { left: 8px; right: 8px; bottom: 7px; }
  .pa-faction-title { font-size: 9px; letter-spacing: 1px; }
  .pa-faction-role { font-size: 7px; letter-spacing: 1px; }
  .pa-faction-stat { grid-template-columns: 42px 1fr 16px; gap: 4px; font-size: 6px; }
  .pa-command-row { grid-template-columns: 1fr; gap: 7px; }
  .pa-online-roadmap { grid-template-columns: 1fr; }
  .pa-online-form, .pa-online-actions { grid-template-columns: 1fr; }
  .pa-lobby-actions { position: sticky; bottom: -12px; grid-template-columns: 1fr; margin: 12px -4px -8px; padding: 10px 4px 6px; }
  .pa-battle-code { grid-template-columns: 1fr; }
  .pa-battle-code .pa-small-btn { text-align: center; }
  .pa-mode-pick { grid-template-columns: 1fr; gap: 6px; }
  .pa-mode-choice { min-height: 112px; }
  .pa-mode-copy { left: 10px; right: 10px; bottom: 9px; }
  .pa-trailer-overlay { padding: 10px; }
  .pa-btn { min-height: 40px; font-size: 11px; letter-spacing: 2px; }
  .pa-btn.primary { min-height: 46px; }
  .pa-launch-footer { display: grid; justify-content: stretch; text-align: center; gap: 5px; margin-top: 9px; }
  .pa-launch-credit { justify-content: center; white-space: normal; }
}
`;

const FACTION_EMBLEMS: Record<FactionId, string> = { scorch: 'SL', tide: 'TD', verdant: 'VS' };
const FACTION_CLASS_STATS: Record<
  FactionId,
  {
    role: string;
    stats: { label: string; value: number }[];
  }
> = {
  scorch: {
    role: 'Assault · Armor · Siege',
    stats: [
      { label: 'Damage', value: 92 },
      { label: 'Armor', value: 86 },
      { label: 'Speed', value: 48 },
    ],
  },
  tide: {
    role: 'Control · Range · Tech',
    stats: [
      { label: 'Range', value: 88 },
      { label: 'Control', value: 84 },
      { label: 'Armor', value: 58 },
    ],
  },
  verdant: {
    role: 'Swarm · Speed · Economy',
    stats: [
      { label: 'Speed', value: 90 },
      { label: 'Growth', value: 86 },
      { label: 'Damage', value: 62 },
    ],
  },
};
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
interface BattleCodePayload {
  v: 1;
  mode: GameMode;
  faction: FactionId;
  color: number;
  seed: number;
  map: 'S' | 'M' | 'L';
  water: 'low' | 'medium' | 'high';
  crates: boolean;
  ais: { faction: FactionId | 'random'; difficulty: AIDifficulty }[];
}
const TIPS = [
  'First minute: power, refinery, barracks. Then scout before the first raid.',
  'Right-click crystals with harvesters to claim a crystal field deliberately.',
  'Volt Cinders can punish aircraft early. Mix them in before enemy air arrives.',
  'Low power slows construction and shuts down radar and advanced defenses.',
  'Harvesters auto-return to the nearest Crystal Refinery. Protect them!',
  'Savant units capture enemy buildings. Escort them well.',
  'Fire beats Verdant, Verdant beats Tide, Tide beats Fire. +25% damage.',
  'Veteran units deal +25% damage. Elites self-heal. Keep them alive.',
  'Sell unwanted structures for half their cost — fast cash in a pinch.',
  'Press H to jump to your Citadel. Space jumps to the last attack.',
  'Hard AI snipes harvesters. Wall in your crystal fields or guard them.',
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

const TRAILERS = [
  {
    label: 'Cinematic',
    title: 'Fable Wars Cinematic Trailer',
    src: '/media/fable-wars-cinematic-trailer.mp4',
    poster: '/media/fable-wars-cinematic-trailer-poster.jpg',
  },
  {
    label: 'Gameplay',
    title: 'Fable Wars Hero Trailer',
    src: '/media/fable-wars-hero.mp4',
    poster: '/media/fable-wars-hero-poster.jpg',
  },
] as const;

function factionStatBars(stats: { label: string; value: number }[]): string {
  return stats
    .map(
      (s) =>
        `<div class="pa-faction-stat"><span>${s.label}</span><div class="pa-faction-bar"><span class="pa-faction-fill" style="width:${s.value}%"></span></div><b>${s.value}</b></div>`
    )
    .join('');
}

function encodeBattleCode(payload: BattleCodePayload): string {
  const raw = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return `FW1-${raw}`;
}

function decodeBattleCode(code: string): BattleCodePayload | null {
  const raw = code.trim().replace(/^FW1-/i, '').replace(/-/g, '+').replace(/_/g, '/');
  if (!raw) return null;
  try {
    const padded = raw.padEnd(Math.ceil(raw.length / 4) * 4, '=');
    const parsed = JSON.parse(atob(padded)) as Partial<BattleCodePayload>;
    const factionIds: FactionId[] = ['scorch', 'tide', 'verdant'];
    const difficulties: AIDifficulty[] = ['easy', 'medium', 'hard'];
    const ais = Array.isArray(parsed.ais)
      ? parsed.ais
          .filter((a): a is BattleCodePayload['ais'][number] => !!a && typeof a === 'object')
          .map((a) => ({
            faction: (factionIds as string[]).includes(a.faction) ? a.faction : ('random' as const),
            difficulty: difficulties.includes(a.difficulty) ? a.difficulty : ('medium' as const),
          }))
          .slice(0, 3)
      : [];
    if (
      parsed.v !== 1 ||
      (parsed.mode !== 'classic' && parsed.mode !== 'crystalRush') ||
      !factionIds.includes(parsed.faction as FactionId) ||
      (parsed.map !== 'S' && parsed.map !== 'M' && parsed.map !== 'L') ||
      (parsed.water !== 'low' && parsed.water !== 'medium' && parsed.water !== 'high')
    ) {
      return null;
    }
    return {
      v: 1,
      mode: parsed.mode,
      faction: parsed.faction as FactionId,
      color:
        typeof parsed.color === 'number' && parsed.color >= 0 && parsed.color < PLAYER_COLORS.length
          ? parsed.color | 0
          : 0,
      seed: typeof parsed.seed === 'number' ? Math.max(1, Math.abs(parsed.seed | 0)) : 1,
      map: parsed.map,
      water: parsed.water,
      crates: parsed.crates === true,
      ais: ais.length > 0 ? ais : [{ faction: 'random', difficulty: 'medium' }],
    };
  } catch {
    return null;
  }
}

export class MenuManager {
  private root: HTMLElement;
  private onStart: (cfg: GameConfig, online?: OnlineMatchConnection) => void;
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

  constructor(root: HTMLElement, onStartGame: (cfg: GameConfig, online?: OnlineMatchConnection) => void) {
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

  private currentBattleCode(): string {
    return encodeBattleCode({
      v: 1,
      mode: this.mode,
      faction: this.faction,
      color: this.colorIdx,
      seed: this.seed,
      map: this.mapSize,
      water: this.water,
      crates: this.crates,
      ais: this.ais.map((ai) => ({ faction: ai.faction, difficulty: ai.difficulty })),
    });
  }

  private applyBattleCode(code: string): boolean {
    const payload = decodeBattleCode(code);
    if (!payload) return false;
    this.mode = payload.mode;
    this.faction = payload.faction;
    this.colorIdx = payload.color;
    this.seed = payload.seed;
    this.mapSize = payload.map;
    this.water = payload.water;
    this.crates = payload.crates;
    this.ais = payload.ais;
    this.persistLobby();
    return true;
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
        <div class="pa-launch-label">Fable Wars</div>
        <div class="pa-launch-status">Harvest crystals · Defend the rift · Crush enemy waves</div>
      </div>`;

    const factionSection = document.createElement('section');
    factionSection.className = 'pa-choice-section';
    factionSection.innerHTML = `<div class="pa-section-head">
      <div class="pa-section-title">Choose Army</div>
      <div class="pa-section-note">Faction identity and combat style</div>
    </div>`;
    const factionStrip = document.createElement('div');
    factionStrip.className = 'pa-faction-strip';
    const factionTiles = [
      { faction: 'scorch' as const, label: 'Scorch Legion', src: '/art/factions/scorch-banner.jpg' },
      { faction: 'tide' as const, label: 'Tide Dominion', src: '/art/factions/tide-banner.jpg' },
      { faction: 'verdant' as const, label: 'Verdant Swarm', src: '/art/factions/verdant-banner.jpg' },
    ];
    for (const tile of factionTiles) {
      const item = document.createElement('div');
      const faction = DATA.factions[tile.faction];
      const stats = FACTION_CLASS_STATS[tile.faction];
      item.className = 'pa-faction-tile';
      item.style.setProperty('--fc', faction.themeColor);
      item.style.backgroundImage = `url('${tile.src}')`;
      item.innerHTML = `<div class="pa-faction-copy">
        <div class="pa-faction-title">${tile.label}</div>
        <div class="pa-faction-role">${stats.role}</div>
        <div class="pa-faction-stats">${factionStatBars(stats.stats)}</div>
      </div>`;
      item.addEventListener('click', () => {
        this.faction = tile.faction;
        this.persistLobby();
        paintFactions();
      });
      factionStrip.appendChild(item);
    }
    const paintFactions = () => {
      factionStrip.querySelectorAll<HTMLElement>('.pa-faction-tile').forEach((item, i) => {
        item.classList.toggle('sel', factionTiles[i]?.faction === this.faction);
      });
    };
    paintFactions();
    factionSection.appendChild(factionStrip);
    panel.appendChild(factionSection);

    const modeSection = document.createElement('section');
    modeSection.className = 'pa-choice-section pa-choice-section--mode';
    modeSection.innerHTML = `<div class="pa-section-head">
      <div class="pa-section-title">Choose Battle</div>
      <div class="pa-section-note">Classic control or faster crystal war</div>
    </div>`;
    const modePick = document.createElement('div');
    modePick.className = 'pa-mode-pick';
    const classic = document.createElement('div');
    const rush = document.createElement('div');
    const paintModes = () => {
      classic.className = 'pa-mode-choice' + (this.mode === 'classic' ? ' sel' : '');
      rush.className = 'pa-mode-choice' + (this.mode === 'crystalRush' ? ' sel' : '');
    };
    const modePreview = (src: string, title: string, body: string) => `
      <div class="pa-mode-preview" style="background-image:url('${src}')"></div>
      <div class="pa-mode-copy"><strong>${title}</strong><span>${body}</span></div>`;
    classic.innerHTML = modePreview(
      '/art/classic-rts-gameplay-preview.png',
      'Classic RTS',
      'Build bases, harvest crystals, command units directly.'
    );
    rush.innerHTML = modePreview(
      '/art/crystal-rush-gameplay-preview.png',
      'Crystal Rush',
      'Command wave pushes, hold the crystal, break enemy bases.'
    );
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
    modeSection.appendChild(modePick);
    panel.appendChild(modeSection);

    const commandRow = document.createElement('div');
    commandRow.className = 'pa-command-row';
    const skirmish = btn('Start Match', () => this.showLobby(), true);
    const online = btn('Online Battle', () => this.showOnlineBattle());
    const trailer = btn('Watch Trailer', () => this.showTrailer());
    const howto = btn('How to Play', () => this.showHowTo());
    const codex = btn('Art Codex', () => this.showArtCodex());
    commandRow.append(skirmish, online, trailer, howto, codex);
    panel.appendChild(commandRow);

    const record = this.serviceRecordPanel();
    if (record) panel.appendChild(record);
    const footer = document.createElement('div');
    footer.className = 'pa-launch-footer';
    footer.innerHTML = `<span>Fantasy browser RTS · Build, harvest, and command armies</span><span class="pa-launch-credit">Made by <a href="https://iangoh.com" target="_blank" rel="noopener noreferrer">iangoh.com</a> · <a href="https://github.com/twerpygeek/fable-wars" target="_blank" rel="noopener noreferrer">github.com/twerpygeek/fable-wars</a></span>`;
    panel.appendChild(footer);

    stage.appendChild(panel);
    el.appendChild(stage);
  }

  private showOnlineBattle(): void {
    const el = this.screen();
    const endpoint = multiplayerEndpoint();
    const params = new URLSearchParams(location.search);
    const battleFromUrl = params.get('battle');
    if (battleFromUrl) this.applyBattleCode(battleFromUrl);
    const roomFromUrl = params.get('room');
    const room = normalizeRoomCode(roomFromUrl ?? randomRoomCode());
    const panel = document.createElement('div');
    panel.className = 'pa-panel';
    panel.style.width = 'min(720px, calc(100vw - 24px))';
    panel.innerHTML = `<h1 class="pa-title" style="font-size:24px;letter-spacing:4px;">ONLINE BATTLE</h1>
      <div class="pa-subtitle" style="margin-bottom:16px">Commanders War Room</div>
      <div class="pa-online-grid">
        <div class="pa-online-card">
          <div class="pa-online-status${endpoint ? ' ready' : ''}">${endpoint ? 'Online rooms ready' : 'Crystal Rush skirmish ready'}</div>
          <h2>Play With Friends</h2>
          <p>Share a room code, ready up, and lead Crystal Rush waves together. If the live room relay is offline, launch a polished commander-vs-AI skirmish from this war room.</p>
          <div class="pa-online-roadmap">
            <div class="pa-online-step"><b>1</b>Create room</div>
            <div class="pa-online-step"><b>2</b>Friend joins</div>
            <div class="pa-online-step"><b>3</b>Command waves</div>
          </div>
          <div class="pa-online-form">
            <label>Commander Name <input class="js-online-name" maxlength="20" value="Commander"></label>
            <label>Room Code <input class="js-online-room" maxlength="16" value="${room}"></label>
          </div>
          <div class="pa-online-actions">
            <button class="pa-btn primary js-online-host" type="button">${endpoint ? 'Host Room' : 'Start Crystal Rush'}</button>
            <button class="pa-btn js-online-copy" type="button">Copy Invite</button>
            <button class="pa-btn js-online-practice" type="button">Skirmish Lobby</button>
            <button class="pa-btn js-online-docs" type="button">Setup Notes</button>
          </div>
        </div>
        <div class="pa-online-card">
          <h2>Room Status</h2>
          <p class="pa-online-note js-online-note"></p>
          <div class="pa-online-roster js-online-roster"></div>
          <div class="pa-online-chat">
            <div class="pa-online-chat-log js-online-chat-log">
              <div class="pa-online-chat-line system">Connect to a room to open commander chat.</div>
            </div>
            <div class="pa-online-chat-form">
              <input class="js-online-chat" maxlength="140" placeholder="Message your room">
              <button class="pa-small-btn js-online-chat-send" type="button">Send</button>
            </div>
          </div>
          <button class="pa-btn primary pa-online-start js-online-start" type="button">Start Room Match</button>
        </div>
      </div>`;
    const nameInput = panel.querySelector<HTMLInputElement>('.js-online-name')!;
    const roomInput = panel.querySelector<HTMLInputElement>('.js-online-room')!;
    const note = panel.querySelector<HTMLElement>('.js-online-note')!;
    const roster = panel.querySelector<HTMLElement>('.js-online-roster')!;
    const chatLog = panel.querySelector<HTMLElement>('.js-online-chat-log')!;
    const chatInput = panel.querySelector<HTMLInputElement>('.js-online-chat')!;
    const chatSend = panel.querySelector<HTMLButtonElement>('.js-online-chat-send')!;
    const roomStart = panel.querySelector<HTMLButtonElement>('.js-online-start')!;
    let roomClient: RoomClient | null = null;
    let roomOpen = false;
    let roomClientId: string | null = null;
    let roomPlayers: RoomPlayer[] = [];
    const commandHandlers: ((frame: OnlineCommandFrame) => void)[] = [];
    const onlineConnection: OnlineMatchConnection = {
      sendCommandFrame(tick, commands) {
        roomClient?.commandFrame(tick, commands);
      },
      onCommandFrame(handler) {
        commandHandlers.push(handler);
      },
    };
    const appendChat = (html: string) => {
      chatLog.insertAdjacentHTML('beforeend', html);
      while (chatLog.children.length > 18) chatLog.firstElementChild?.remove();
      chatLog.scrollTop = chatLog.scrollHeight;
    };
    const playerName = (id: string) => roomPlayers.find((player) => player.id === id)?.name ?? id.slice(0, 8);
    const refreshNote = () => {
      const code = normalizeRoomCode(roomInput.value);
      const ws = roomSocketUrl(code, endpoint);
      const battle = this.currentBattleCode();
      const invite = battleInviteUrl(code, battle);
      note.innerHTML = endpoint
        ? `Room relay found at <code>${escapeHtml(endpoint)}</code>. Invite carries this room and battle setup: <code>${escapeHtml(invite)}</code>.`
        : `Copy Invite shares this exact faction, map, seed, and Crystal Rush room code. Live friend rooms unlock when the realtime relay endpoint is connected.`;
      roomInput.value = code;
      return { code, ws, invite };
    };
    roomInput.addEventListener('change', refreshNote);
    roster.innerHTML = renderOnlineRoster([]);
    const sendChat = () => {
      const text = chatInput.value.trim();
      if (!text) return;
      if (!roomClient || !roomOpen) {
        appendChat(`<div class="pa-online-chat-line system">Join or host a room before sending chat.</div>`);
        return;
      }
      roomClient.chat(text);
      chatInput.value = '';
    };
    chatSend.addEventListener('click', sendChat);
    chatInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') sendChat();
    });
    roomStart.addEventListener('click', () => {
      if (!roomClient || !roomOpen) {
        appendChat(`<div class="pa-online-chat-line system">Host a room before starting a shared match.</div>`);
        return;
      }
      this.mode = 'crystalRush';
      const code = this.currentBattleCode();
      roomClient.start(code);
      appendChat(`<div class="pa-online-chat-line system">Launching shared Crystal Rush match...</div>`);
    });
    const host = panel.querySelector<HTMLButtonElement>('.js-online-host')!;
    host.addEventListener('click', () => {
      const { code, ws } = refreshNote();
      if (!ws) {
        this.mode = 'crystalRush';
        this.launch();
        return;
      }
      roomClient?.close();
      roomOpen = false;
      roomClient = createRoomClient(ws, {
        onStatus: (status) => {
          if (status === 'connecting') note.innerHTML = `Opening room <code>${escapeHtml(code)}</code>...`;
          else if (status === 'open') {
            roomOpen = true;
            note.innerHTML = `Connected to room <code>${escapeHtml(code)}</code>. Waiting for the room roster...`;
            appendChat(`<div class="pa-online-chat-line system">Room connected. Commander chat online.</div>`);
            roomClient?.hello({ name: nameInput.value || 'Commander', faction: this.faction, colorIdx: this.colorIdx });
            roomClient?.ready(true);
          } else if (status === 'closed') {
            roomOpen = false;
            note.innerHTML = `Room connection closed. Copy the invite and reconnect when your friend is ready.`;
            roomPlayers = [];
            roster.innerHTML = renderOnlineRoster([]);
            appendChat(`<div class="pa-online-chat-line system">Room connection closed.</div>`);
          } else if (status === 'error') {
            roomOpen = false;
            note.innerHTML = `Room connection failed. Check <code>VITE_MULTIPLAYER_WS</code> and the relay deployment.`;
            roomPlayers = [];
            roster.innerHTML = renderOnlineRoster([]);
            appendChat(`<div class="pa-online-chat-line system">Room connection failed.</div>`);
          }
        },
        onMessage: (msg) => {
          switch (msg.type) {
            case 'welcome':
              roomClientId = msg.clientId;
              note.innerHTML = `Connected to room <code>${escapeHtml(msg.room)}</code> as commander <code>${escapeHtml(msg.clientId)}</code>.`;
              break;
            case 'room':
              note.innerHTML = `Room <code>${escapeHtml(msg.room)}</code> online. ${msg.players.length} commander${msg.players.length === 1 ? '' : 's'} present.`;
              roomPlayers = msg.players;
              roster.innerHTML = renderOnlineRoster(msg.players);
              break;
            case 'chat':
              appendChat(renderOnlineChatLine(playerName(msg.from), msg.text));
              break;
            case 'command':
              if (msg.from !== roomClientId) {
                commandHandlers.forEach((handler) => handler({ tick: msg.tick, commands: msg.commands }));
              }
              break;
            case 'start':
              if (this.applyBattleCode(msg.battleCode)) {
                this.mode = 'crystalRush';
                appendChat(`<div class="pa-online-chat-line system">${escapeHtml(playerName(msg.from))} started the room match.</div>`);
                this.launch(onlineConnection, roomPlayers, roomClientId);
              } else {
                note.innerHTML = `Room start failed: invalid battle setup from <code>${escapeHtml(playerName(msg.from))}</code>.`;
              }
              break;
            case 'error':
              note.innerHTML = `Room relay error: ${escapeHtml(msg.message)}`;
              break;
          }
        },
        onError: (message) => {
          note.innerHTML = `${escapeHtml(message)} Try copying the invite instead.`;
        },
      });
      roomClient.connect();
    });
    panel.querySelector<HTMLButtonElement>('.js-online-copy')!.addEventListener('click', () => {
      const { invite } = refreshNote();
      void navigator.clipboard
        ?.writeText(invite)
        .then(() => (note.innerHTML = `Invite copied: <code>${escapeHtml(invite)}</code>`))
        .catch(() => (note.innerHTML = `Invite link: <code>${escapeHtml(invite)}</code>`));
    });
    panel.querySelector<HTMLButtonElement>('.js-online-practice')!.addEventListener('click', () => {
      this.mode = 'crystalRush';
      this.showLobby();
    });
    panel.querySelector<HTMLButtonElement>('.js-online-docs')!.addEventListener('click', () => {
      note.innerHTML = `Deploy <code>realtime/partykit</code>, then set <code>VITE_MULTIPLAYER_WS</code> in Vercel. The repo includes the room relay and protocol notes.`;
    });
    panel.appendChild(
      btn('Back', () => {
        roomClient?.close();
        this.showMainMenu();
      }),
    );
    refreshNote();
    el.appendChild(panel);
  }

  private showTrailer(): void {
    const host = this.menuEl ?? this.screen();
    host.querySelector('.pa-trailer-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'pa-trailer-overlay';
    const first = TRAILERS[0];
    overlay.innerHTML = `<div class="pa-trailer-frame" role="dialog" aria-modal="true" aria-label="Fable Wars trailer">
      <div class="pa-trailer-head"><span class="pa-trailer-title">${first.title}</span><button class="pa-trailer-close" type="button">Close</button></div>
      <video src="${first.src}" poster="${first.poster}" controls autoplay playsinline></video>
      <div class="pa-trailer-tabs">
        ${TRAILERS.map((trailer, i) => `<button class="pa-trailer-tab${i === 0 ? ' sel' : ''}" type="button" data-trailer="${i}">${trailer.label}</button>`).join('')}
      </div>
    </div>`;
    const close = () => overlay.remove();
    overlay.addEventListener('click', (ev) => {
      if (ev.target === overlay) close();
    });
    overlay.querySelector('.pa-trailer-close')?.addEventListener('click', close);
    host.appendChild(overlay);
    const video = overlay.querySelector('video');
    const title = overlay.querySelector<HTMLElement>('.pa-trailer-title');
    overlay.querySelectorAll<HTMLButtonElement>('.pa-trailer-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const index = Number(tab.dataset.trailer ?? 0);
        const trailer = TRAILERS[index] ?? first;
        overlay.querySelectorAll('.pa-trailer-tab').forEach((button, i) => button.classList.toggle('sel', i === index));
        if (title) title.textContent = trailer.title;
        if (video) {
          video.pause();
          video.src = trailer.src;
          video.poster = trailer.poster;
          video.load();
          void video.play().catch(() => {
            video.controls = true;
          });
        }
      });
    });
    void video?.play().catch(() => {
      video.controls = true;
    });
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
        <span class="pa-svc-sum">${facName} vs ${aiPlayers.length} AI (${diffs})</span>
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
      <div style="font-size:11px;color:#9aa3cf;line-height:1.6">Destroy every enemy structure. Build Power, a Crystal
      Refinery, then war production. Harvesters mine <b style="color:#ff9af0">rift crystals</b> to fund your army.
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
    let refreshBattleCode = () => {};

    // faction cards
    panel.insertAdjacentHTML('beforeend', `<div class="pa-menu-h2">Your Faction</div>`);
    const cards = document.createElement('div');
    cards.className = 'pa-fcards';
    const lobbyFactions = Object.values(DATA.factions);
    for (const f of lobbyFactions) {
      const stats = FACTION_CLASS_STATS[f.id];
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
        <div class="pa-fc-role">${stats.role}</div>
        <div class="pa-faction-stats">${factionStatBars(stats.stats)}</div>
        <div class="pa-fc-blurb">${f.blurb}</div><div class="pa-fc-roster">${roster}…</div>`;
      card.addEventListener('click', () => {
        this.faction = f.id;
        this.persistLobby();
        paintLobbyFactions();
        refreshBattleCode();
      });
      cards.appendChild(card);
    }
    const paintLobbyFactions = () => {
      cards.querySelectorAll<HTMLElement>('.pa-fcard').forEach((card, i) => {
        card.classList.toggle('sel', lobbyFactions[i]?.id === this.faction);
      });
    };
    paintLobbyFactions();
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
        refreshBattleCode();
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
        refreshBattleCode();
      }
    });
    panel.appendChild(addBtn);

    const renderAIs = () => {
      aiHost.innerHTML = '';
      addBtn.style.display = this.ais.length < 3 ? 'inline-block' : 'none';
      this.ais.forEach((ai, i) => {
        const row = document.createElement('div');
        row.className = 'pa-ai-row';
        row.innerHTML = `<span class="pa-ai-name">Rival Army ${i + 1}</span>`;
        const fSel = document.createElement('select');
        fSel.innerHTML =
          `<option value="random">Random Faction</option>` +
          Object.values(DATA.factions)
            .map((f) => `<option value="${f.id}" ${ai.faction === f.id ? 'selected' : ''}>${f.name}</option>`)
            .join('');
        fSel.value = ai.faction;
        fSel.addEventListener('change', () => {
          ai.faction = fSel.value as FactionId | 'random';
          this.persistLobby();
          refreshBattleCode();
        });
        const dSel = document.createElement('select');
        dSel.innerHTML = `<option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>`;
        dSel.value = ai.difficulty;
        dSel.addEventListener('change', () => {
          ai.difficulty = dSel.value as AIDifficulty;
          this.persistLobby();
          refreshBattleCode();
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
            refreshBattleCode();
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
      refreshBattleCode();
    });
    const waterRow = segRow('Water', ['low', 'medium', 'high'], this.water, (v) => {
      this.water = v as 'low' | 'medium' | 'high';
      this.persistLobby();
      refreshBattleCode();
    });
    const cratesRow = segRow('Crates', ['on', 'off'], this.crates ? 'on' : 'off', (v) => {
      this.crates = v === 'on';
      this.persistLobby();
      refreshBattleCode();
    });
    const seedRow = document.createElement('div');
    seedRow.className = 'pa-row';
    seedRow.innerHTML = `<span class="pa-label">Map Seed</span>`;
    const seedInput = document.createElement('input');
    seedInput.type = 'number';
    seedInput.value = String(this.seed);
    seedInput.style.width = '110px';
    seedInput.addEventListener('change', () => {
      this.seed = Math.abs(Number(seedInput.value) | 0) || 1;
      seedInput.value = String(this.seed);
      refreshBattleCode();
    });
    const dice = document.createElement('div');
    dice.className = 'pa-small-btn';
    dice.textContent = 'Randomize';
    dice.addEventListener('click', () => {
      this.seed = Math.floor(Math.random() * 1e6);
      seedInput.value = String(this.seed);
      refreshBattleCode();
    });
    seedRow.append(seedInput, dice);
    panel.append(sizeRow, waterRow, cratesRow, seedRow);

    const codeBox = document.createElement('div');
    codeBox.className = 'pa-battle-code';
    const codeInput = document.createElement('input');
    codeInput.type = 'text';
    codeInput.spellcheck = false;
    codeInput.value = this.currentBattleCode();
    codeInput.title = 'Battle code for sharing this exact setup';
    const copyCode = document.createElement('div');
    copyCode.className = 'pa-small-btn';
    copyCode.textContent = 'Copy Code';
    const importCode = document.createElement('div');
    importCode.className = 'pa-small-btn';
    importCode.textContent = 'Import';
    const codeStatus = document.createElement('div');
    codeStatus.className = 'pa-code-status';
    codeStatus.textContent = 'Share this setup with a friend for the same seed and battle rules.';
    refreshBattleCode = () => {
      codeInput.value = this.currentBattleCode();
    };
    copyCode.addEventListener('click', () => {
      const code = this.currentBattleCode();
      codeInput.value = code;
      codeInput.select();
      void navigator.clipboard
        ?.writeText(code)
        .then(() => (codeStatus.textContent = 'Battle code copied.'))
        .catch(() => {
          document.execCommand('copy');
          codeStatus.textContent = 'Battle code selected for copying.';
        });
    });
    importCode.addEventListener('click', () => {
      if (!this.applyBattleCode(codeInput.value)) {
        codeStatus.textContent = 'Invalid battle code.';
        return;
      }
      codeStatus.textContent = 'Battle code imported.';
      this.showLobby();
    });
    codeBox.append(codeInput, copyCode, importCode, codeStatus);
    panel.appendChild(codeBox);

    // start
    const actions = document.createElement('div');
    actions.className = 'pa-lobby-actions';
    const start = btn('Start Operation', () => this.launch(), true);
    actions.append(start, btn('Back', () => this.showMainMenu()));
    panel.appendChild(actions);
    el.appendChild(panel);
  }

  private buildCrystalRushPlayers(onlinePlayers?: RoomPlayer[], localClientId?: string | null): GameConfig['players'] {
    const factions: FactionId[] = ['scorch', 'tide', 'verdant'];
    const onlineRoster = (onlinePlayers ?? []).slice(0, 4);
    if (onlineRoster.length > 0 && localClientId) {
      const usedColors = new Set<number>();
      const uniqueColor = (preferred: number) => {
        if (Number.isInteger(preferred) && preferred >= 0 && preferred < PLAYER_COLORS.length && !usedColors.has(preferred)) {
          usedColors.add(preferred);
          return preferred;
        }
        for (let i = 0; i < PLAYER_COLORS.length; i++) {
          if (!usedColors.has(i)) {
            usedColors.add(i);
            return i;
          }
        }
        return 0;
      };
      const players: GameConfig['players'] = onlineRoster.map((player) => ({
        faction: player.faction,
        isHuman: player.id === localClientId,
        difficulty: null,
        colorIdx: uniqueColor(player.colorIdx),
        name: player.name || 'Commander',
      }));
      for (let i = players.length; i < 4; i++) {
        const f = factions[(factions.indexOf(this.faction) + i) % factions.length];
        players.push({
          faction: f,
          isHuman: false,
          difficulty: 'medium',
          colorIdx: uniqueColor(i),
          name: `${DATA.factions[f].name.split(' ')[0]} Online AI ${i - onlineRoster.length + 1}`,
        });
      }
      return players;
    }

    const usedColors = new Set<number>([this.colorIdx]);
    const nextColor = () => {
      for (let i = 0; i < PLAYER_COLORS.length; i++) if (!usedColors.has(i)) return (usedColors.add(i), i);
      return 0;
    };
    return [
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
    ];
  }

  private launch(online?: OnlineMatchConnection, onlinePlayers?: RoomPlayer[], localClientId?: string | null): void {
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
            players: this.buildCrystalRushPlayers(onlinePlayers, localClientId),
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
    this.onStart(cfg, online);
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
    tipEl.textContent = 'Intel: ' + TIPS[t];
    this.tipTimer = window.setInterval(() => {
      t = (t + 1) % TIPS.length;
      tipEl.textContent = 'Intel: ' + TIPS[t];
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

    const again = btn('Play Again', () => {
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

function renderOnlineRoster(players: RoomPlayer[]): string {
  if (players.length === 0) {
    return `<div class="pa-online-player empty">Waiting for commanders to join this room...</div>`;
  }
  return players
    .map((player) => {
      const faction = DATA.factions[player.faction]?.name ?? player.faction;
      const color = PLAYER_COLORS[player.colorIdx]?.hex ?? '#ffd777';
      const status = player.ready ? 'READY' : 'WAITING';
      return `<div class="pa-online-player">
        <span class="pa-online-color" style="--pc:${color}"></span>
        <span>
          <span class="pa-online-player-name">${escapeHtml(player.name || 'Commander')}</span>
          <span class="pa-online-player-meta">${escapeHtml(faction)}</span>
        </span>
        <span class="pa-online-pill${player.ready ? '' : ' waiting'}">${status}</span>
      </div>`;
    })
    .join('');
}

function renderOnlineChatLine(name: string, text: string): string {
  return `<div class="pa-online-chat-line"><b>${escapeHtml(name)}</b>: ${escapeHtml(text)}</div>`;
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
