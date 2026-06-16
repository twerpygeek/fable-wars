import type {
  Command,
  CrystalRushStance,
  CrystalRushUpgradeId,
  GameState,
  PlayerId,
} from '../core/types';
import { PLAYER_COLORS } from '../core/types';
import {
  getCrystalRushDeployCost,
  getCrystalRushUpgradeCost,
} from '../sim/modes/crystalRush';

const STYLE_ID = 'pa-style-crystal-rush';
const CSS = `
.pa-rush {
  position: absolute; right: 14px; top: 14px; z-index: 55; width: min(310px, calc(100vw - 28px));
  color: #dfe5ff; font-family: Verdana, Geneva, sans-serif; user-select: none;
  background: linear-gradient(180deg, rgba(13,16,30,0.92), rgba(8,10,18,0.96));
  border: 1px solid rgba(255, 215, 119, 0.34); border-radius: 8px;
  box-shadow: 0 18px 52px rgba(0,0,0,0.62), inset 0 1px 0 rgba(255,255,255,0.08);
  padding: 12px;
}
.pa-rush-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.pa-rush-title { font-size: 13px; letter-spacing: 3px; color: #fff; text-transform: uppercase; font-weight: bold; }
.pa-rush-clock { font-size: 10px; color: #ffd95e; letter-spacing: 2px; font-variant-numeric: tabular-nums; }
.pa-rush-stat { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; margin-bottom: 10px; }
.pa-rush-stat div { background: rgba(5,7,13,0.74); border: 1px solid #2e3252; border-radius: 5px; padding: 7px 6px; }
.pa-rush-stat span { display: block; color: #7680ad; font-size: 8px; letter-spacing: 1px; text-transform: uppercase; }
.pa-rush-stat strong { display: block; margin-top: 3px; color: #fff; font-size: 14px; font-variant-numeric: tabular-nums; }
.pa-rush-label { margin: 10px 0 5px; color: #8d96c8; font-size: 9px; letter-spacing: 2px; text-transform: uppercase; }
.pa-rush-stances, .pa-rush-ups { display: grid; gap: 6px; }
.pa-rush-stances { grid-template-columns: repeat(3, 1fr); }
.pa-rush-deploy {
  width: 100%; min-height: 48px; margin: 0 0 9px; border-color: #ffb15d;
  color: #fff7d1; background: linear-gradient(180deg, #8c3b29 0%, #442018 100%);
  box-shadow: 0 0 18px rgba(255, 101, 56, 0.24), inset 0 1px 0 rgba(255,255,255,0.14);
}
.pa-rush-deploy:disabled { border-color: #343a63; background: linear-gradient(180deg, #1b1f38, #101321); box-shadow: none; color: #8d96c8; }
.pa-rush-btn {
  min-height: 36px; border: 1px solid #343a63; border-radius: 5px; color: #cfd6ff;
  background: linear-gradient(180deg, #1b1f38, #101321); cursor: pointer;
  font-size: 10px; letter-spacing: 1px; text-transform: uppercase; font-weight: bold;
}
.pa-rush-btn:hover { border-color: #6ea7ff; color: #fff; }
.pa-rush-btn.sel { border-color: #ffd95e; color: #fff7d1; background: linear-gradient(180deg, #67431d, #27170d); }
.pa-rush-btn:disabled { opacity: 0.42; cursor: not-allowed; filter: grayscale(0.55); }
.pa-rush-up { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: center; padding: 8px;
  border: 1px solid #2e3252; border-radius: 5px; background: rgba(10,12,23,0.82); }
.pa-rush-up b { display: block; font-size: 10px; letter-spacing: 1px; color: #fff; text-transform: uppercase; }
.pa-rush-up span { display: block; margin-top: 3px; font-size: 9px; color: #8d96c8; }
.pa-rush-up button { min-width: 72px; }
.pa-rush-factions { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin-top: 9px; }
.pa-rush-dot { height: 8px; border-radius: 4px; opacity: 0.95; }
.pa-rush-dot.dead { opacity: 0.18; filter: grayscale(1); }
@media (max-width: 680px) {
  .pa-rush { left: 10px; right: 10px; top: auto; bottom: 10px; width: auto; padding: 10px; }
  .pa-rush-stat strong { font-size: 12px; }
  .pa-rush-stances { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .pa-rush-up { padding: 6px; }
}
`;

const STANCES: { id: CrystalRushStance; label: string }[] = [
  { id: 'greedy', label: 'Greedy' },
  { id: 'aggressive', label: 'Aggro' },
  { id: 'split', label: 'Split' },
];

const UPGRADES: { id: CrystalRushUpgradeId; label: string; desc: string }[] = [
  { id: 'economy', label: 'Crystal Yield', desc: 'More income while contesting center.' },
  { id: 'waves', label: 'War Brood', desc: 'Bigger and stronger auto waves.' },
  { id: 'defense', label: 'Base Guard', desc: 'Adds a turret near your Citadel.' },
];

export class CrystalRushPanel {
  private el: HTMLElement;
  private dispatch: (c: Command) => void;
  private getState: () => GameState;
  private me: PlayerId;

  constructor(root: HTMLElement, dispatch: (c: Command) => void, getState: () => GameState, me: PlayerId) {
    this.dispatch = dispatch;
    this.getState = getState;
    this.me = me;
    if (!document.getElementById(STYLE_ID)) {
      const s = document.createElement('style');
      s.id = STYLE_ID;
      s.textContent = CSS;
      document.head.appendChild(s);
    }
    this.el = document.createElement('div');
    this.el.className = 'pa-rush';
    root.appendChild(this.el);
    this.update();
  }

  destroy(): void {
    this.el.remove();
  }

  update(): void {
    const state = this.getState();
    const p = state.players[this.me];
    const crp = state.crystalRush?.player[this.me];
    if (p === undefined || crp === undefined) return;
    const mins = Math.floor(state.tick / 15 / 60);
    const secs = Math.floor(state.tick / 15) % 60;
    this.el.innerHTML = `
      <div class="pa-rush-head">
        <div class="pa-rush-title">Crystal Rush</div>
        <div class="pa-rush-clock">${mins}:${String(secs).padStart(2, '0')}</div>
      </div>
      <div class="pa-rush-stat">
        <div><span>Crystals</span><strong>${p.credits}</strong></div>
        <div><span>Income</span><strong>+${crp.incomeRate}/s</strong></div>
        <div><span>Wave</span><strong>Lv ${crp.waveLevel}</strong></div>
      </div>
      <button class="pa-rush-btn pa-rush-deploy"></button>
      <div class="pa-rush-label">Wave Stance</div>
      <div class="pa-rush-stances"></div>
      <div class="pa-rush-label">Upgrades</div>
      <div class="pa-rush-ups"></div>
      <div class="pa-rush-factions"></div>`;

    const deployBtn = this.el.querySelector('.pa-rush-deploy') as HTMLButtonElement;
    const deployCost = getCrystalRushDeployCost(state, this.me);
    const ticksLeft = Math.max(0, crp.nextDeployTick - state.tick);
    const cd = Math.ceil(ticksLeft / 15);
    deployBtn.disabled = ticksLeft > 0 || p.credits < deployCost;
    deployBtn.textContent = ticksLeft > 0 ? `Deploy Wave ${cd}s` : `Deploy Wave ${deployCost}`;
    deployBtn.title = 'Send an extra wave immediately using the selected stance.';
    deployBtn.addEventListener('click', () => this.dispatch({ type: 'crystalRushDeployWave', player: this.me }));

    const stanceHost = this.el.querySelector('.pa-rush-stances') as HTMLElement;
    for (const stance of STANCES) {
      const btn = document.createElement('button');
      btn.className = 'pa-rush-btn' + (crp.stance === stance.id ? ' sel' : '');
      btn.textContent = stance.label;
      btn.addEventListener('click', () => this.dispatch({ type: 'crystalRushSetStance', player: this.me, stance: stance.id }));
      stanceHost.appendChild(btn);
    }

    const upgradeHost = this.el.querySelector('.pa-rush-ups') as HTMLElement;
    for (const upgrade of UPGRADES) {
      const cost = getCrystalRushUpgradeCost(state, this.me, upgrade.id);
      const row = document.createElement('div');
      row.className = 'pa-rush-up';
      row.innerHTML = `<div><b>${upgrade.label}</b><span>${upgrade.desc}</span></div>`;
      const btn = document.createElement('button');
      btn.className = 'pa-rush-btn';
      btn.textContent = String(cost);
      btn.disabled = p.credits < cost;
      btn.addEventListener('click', () => this.dispatch({ type: 'crystalRushBuyUpgrade', player: this.me, upgrade: upgrade.id }));
      row.appendChild(btn);
      upgradeHost.appendChild(row);
    }

    const factionHost = this.el.querySelector('.pa-rush-factions') as HTMLElement;
    for (const player of state.players) {
      const dot = document.createElement('div');
      dot.className = 'pa-rush-dot' + (player.eliminated ? ' dead' : '');
      dot.style.background = PLAYER_COLORS[player.colorIdx]?.hex ?? '#fff';
      dot.title = player.name;
      factionHost.appendChild(dot);
    }
  }
}
