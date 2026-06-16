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
  position: absolute; right: 14px; top: 14px; z-index: 55; width: min(360px, calc(100vw - 28px));
  color: #dfe5ff; font-family: Verdana, Geneva, sans-serif; user-select: none;
  background:
    linear-gradient(180deg, rgba(45, 37, 30, 0.24), transparent 24%),
    repeating-linear-gradient(135deg, rgba(255,255,255,0.024) 0 1px, transparent 1px 8px),
    linear-gradient(180deg, rgba(13,14,19,0.94), rgba(6,7,11,0.97));
  border: 2px solid rgba(217, 168, 92, 0.42); border-radius: 6px;
  box-shadow: 0 18px 52px rgba(0,0,0,0.66), inset 0 1px 0 rgba(255,237,190,0.14), inset 0 -2px 0 rgba(0,0,0,0.62);
  padding: 12px;
}
.pa-rush-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.pa-rush-title { font-size: 13px; letter-spacing: 3px; color: #fff; text-transform: uppercase; font-weight: bold; }
.pa-rush-clock { font-size: 10px; color: #ffd95e; letter-spacing: 2px; font-variant-numeric: tabular-nums; }
.pa-rush-goal { margin: -2px 0 8px; color: #d2cab7; font-size: 10px; line-height: 1.35; }
.pa-rush-intent { margin: 0 0 9px; padding: 7px 8px; border: 1px solid rgba(255,217,94,0.38); border-radius: 4px;
  background: linear-gradient(180deg, rgba(104, 70, 28, 0.44), rgba(17, 12, 8, 0.84));
  color: #fff2c9; font-size: 9px; line-height: 1.35; text-shadow: 0 1px 0 #000; }
.pa-rush-intent b { display: block; margin-bottom: 2px; color: #fff; letter-spacing: 1px; text-transform: uppercase; }
.pa-rush-you { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 9px; color: #8d96c8; font-size: 9px; line-height: 1.25; }
.pa-rush-you b { color: #fff; letter-spacing: 1px; text-transform: uppercase; }
.pa-rush-swatch { display: inline-block; width: 9px; height: 9px; margin-right: 5px; border-radius: 50%; box-shadow: 0 0 8px currentColor; }
.pa-rush-stat { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; margin-bottom: 9px; }
.pa-rush-stat div { background: rgba(5,7,13,0.74); border: 2px solid #282018; border-radius: 4px; padding: 7px 6px;
  box-shadow: inset 0 1px 0 rgba(255,237,190,0.1), inset 0 -2px 0 rgba(0,0,0,0.58); }
.pa-rush-stat span { display: block; color: #7680ad; font-size: 8px; letter-spacing: 1px; text-transform: uppercase; }
.pa-rush-stat strong { display: block; margin-top: 3px; color: #fff; font-size: 14px; font-variant-numeric: tabular-nums; }
.pa-rush-label { margin: 10px 0 5px; color: #8d96c8; font-size: 9px; letter-spacing: 2px; text-transform: uppercase; }
.pa-rush-plans, .pa-rush-ups { display: grid; gap: 6px; }
.pa-rush-plans { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.pa-rush-btn {
  min-height: 36px; border: 2px solid #282018; border-radius: 4px; color: #d8cfba;
  background:
    radial-gradient(ellipse at 50% 0%, rgba(255,229,170,0.1), transparent 42%),
    linear-gradient(180deg, #2a2f42, #10121b); cursor: pointer;
  font-size: 10px; letter-spacing: 1px; text-transform: uppercase; font-weight: bold;
  box-shadow: inset 0 1px 0 rgba(255,237,190,0.14), inset 0 -3px 0 rgba(0,0,0,0.68), 0 2px 0 #050506;
}
.pa-rush-btn:hover { border-color: #c99b57; color: #fff8e6; filter: brightness(1.08); }
.pa-rush-btn.sel { border-color: #ffd95e; color: #fff7d1; background: linear-gradient(180deg, #75522d, #20140d); }
.pa-rush-btn:disabled { opacity: 0.42; cursor: not-allowed; filter: grayscale(0.55); }
.pa-rush-plan {
  min-height: 88px; padding: 8px 6px; text-align: left; border-color: #465074;
  display: flex; flex-direction: column; justify-content: space-between; gap: 5px;
}
.pa-rush-plan b { display: block; color: #fff; font-size: 10px; letter-spacing: 1px; }
.pa-rush-plan span { display: block; color: #aeb7e8; font-size: 8px; line-height: 1.25; letter-spacing: 0; text-transform: none; font-weight: normal; }
.pa-rush-plan em { display: block; color: #ffd95e; font-size: 9px; font-style: normal; letter-spacing: 1px; }
.pa-rush-pressure { display: grid; grid-template-columns: 1fr; gap: 5px; }
.pa-rush-meter { background: rgba(5,7,13,0.72); border: 2px solid #282018; border-radius: 4px; padding: 6px;
  box-shadow: inset 0 1px 0 rgba(255,237,190,0.08), inset 0 -2px 0 rgba(0,0,0,0.58); }
.pa-rush-meter-top { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 5px; font-size: 9px; color: #aeb7e8; text-transform: uppercase; letter-spacing: 1px; }
.pa-rush-meter-bar { display: flex; height: 8px; overflow: hidden; border-radius: 4px; background: #111522; }
.pa-rush-meter-seg { min-width: 2px; }
.pa-rush-up { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: center; padding: 8px;
  border: 2px solid #282018; border-radius: 4px; background: linear-gradient(180deg, rgba(20,22,32,0.9), rgba(8,9,14,0.9));
  box-shadow: inset 0 1px 0 rgba(255,237,190,0.08), inset 0 -2px 0 rgba(0,0,0,0.54); }
.pa-rush-up b { display: block; font-size: 10px; letter-spacing: 1px; color: #fff; text-transform: uppercase; }
.pa-rush-up span { display: block; margin-top: 3px; font-size: 9px; color: #8d96c8; }
.pa-rush-up button { min-width: 72px; }
.pa-rush-factions { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin-top: 9px; }
.pa-rush-dot { height: 8px; border-radius: 4px; opacity: 0.95; }
.pa-rush-dot.dead { opacity: 0.18; filter: grayscale(1); }
@media (max-width: 680px) {
  .pa-rush { left: 10px; right: 10px; top: auto; bottom: 10px; width: auto; padding: 10px; }
  .pa-rush-stat strong { font-size: 12px; }
  .pa-rush-plan { min-height: 78px; }
  .pa-rush-up { padding: 6px; }
}
`;

const PLANS: { id: CrystalRushStance; label: string; desc: string }[] = [
  { id: 'greedy', label: 'Claim Crystal', desc: 'Send troops center. More control means more income.' },
  { id: 'aggressive', label: 'Break Base', desc: 'Send troops at enemy bases. Destroy bases to win.' },
  { id: 'split', label: 'Balanced Push', desc: 'Half contest crystal, half pressure bases.' },
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
    this.buildShell();
    this.update();
  }

  destroy(): void {
    this.el.remove();
  }

  private buildShell(): void {
    this.el.innerHTML = `
      <div class="pa-rush-head">
        <div class="pa-rush-title">Crystal Rush</div>
        <div class="pa-rush-clock"></div>
      </div>
      <div class="pa-rush-goal">Hold the crystal to fund your army. Break enemy bases to eliminate them.</div>
      <div class="pa-rush-intent js-intent"></div>
      <div class="pa-rush-you"><span class="js-you"></span><span>Move map: WASD / arrows / right-drag / wheel</span></div>
      <div class="pa-rush-stat">
        <div><span>Crystals</span><strong class="js-credits"></strong></div>
        <div><span>Income</span><strong class="js-income"></strong></div>
        <div><span>Auto Wave</span><strong class="js-auto-wave"></strong></div>
      </div>
      <div class="pa-rush-pressure">
        <div class="pa-rush-meter">
          <div class="pa-rush-meter-top"><span>Crystal Fight</span><span class="js-crystal-yours"></span></div>
          <div class="pa-rush-meter-bar js-crystal-bar"></div>
        </div>
        <div class="pa-rush-meter">
          <div class="pa-rush-meter-top"><span>Base Race</span><span class="js-base-race"></span></div>
          <div class="pa-rush-meter-bar js-base-bar"></div>
        </div>
      </div>
      <div class="pa-rush-label">Battle Plan</div>
      <div class="pa-rush-plans"></div>
      <div class="pa-rush-label">Upgrades</div>
      <div class="pa-rush-ups"></div>
      <div class="pa-rush-factions"></div>`;

    const planHost = this.el.querySelector('.pa-rush-plans') as HTMLElement;
    for (const plan of PLANS) {
      const btn = document.createElement('button');
      btn.className = 'pa-rush-btn pa-rush-plan';
      btn.dataset.plan = plan.id;
      btn.addEventListener('click', () =>
        this.dispatch({ type: 'crystalRushDeployWave', player: this.me, stance: plan.id }),
      );
      planHost.appendChild(btn);
    }

    const upgradeHost = this.el.querySelector('.pa-rush-ups') as HTMLElement;
    for (const upgrade of UPGRADES) {
      const row = document.createElement('div');
      row.className = 'pa-rush-up';
      row.innerHTML = `<div><b>${upgrade.label}</b><span>${upgrade.desc}</span></div>`;
      const btn = document.createElement('button');
      btn.className = 'pa-rush-btn';
      btn.dataset.upgrade = upgrade.id;
      btn.addEventListener('click', () =>
        this.dispatch({ type: 'crystalRushBuyUpgrade', player: this.me, upgrade: upgrade.id }),
      );
      row.appendChild(btn);
      upgradeHost.appendChild(row);
    }
  }

  update(): void {
    const state = this.getState();
    const p = state.players[this.me];
    const crp = state.crystalRush?.player[this.me];
    if (p === undefined || crp === undefined) return;
    const mins = Math.floor(state.tick / 15 / 60);
    const secs = Math.floor(state.tick / 15) % 60;
    const deployCost = getCrystalRushDeployCost(state, this.me);
    const deployTicksLeft = Math.max(0, crp.nextDeployTick - state.tick);
    const deployCd = Math.ceil(deployTicksLeft / 15);
    const waveCd = Math.max(0, Math.ceil((crp.nextWaveTick - state.tick) / 15));
    const crystalCounts = this.crystalPresence(state);
    const totalPresence = Math.max(1, crystalCounts.reduce((sum, count) => sum + count, 0));
    const myBaseHp = this.baseHealthPercent(state, this.me);
    const enemyBaseHp = this.enemyBaseHealthPercent(state);

    this.setText('.pa-rush-clock', `${mins}:${String(secs).padStart(2, '0')}`);
    const color = PLAYER_COLORS[p.colorIdx]?.hex ?? '#ffffff';
    const you = this.el.querySelector('.js-you') as HTMLElement | null;
    if (you !== null) {
      you.innerHTML = `<i class="pa-rush-swatch" style="background:${color};color:${color}"></i><b>You</b> ${p.name}`;
    }
    this.setText('.js-credits', String(p.credits));
    this.setText('.js-income', `+${crp.incomeRate}/s`);
    this.setText('.js-auto-wave', `${waveCd}s`);
    this.setText('.js-intent', this.intentText(crp.stance, deployTicksLeft, p.credits, deployCost));
    this.setText('.js-crystal-yours', `${crystalCounts[this.me] ?? 0} yours`);
    this.setText('.js-base-race', `You ${myBaseHp}% · Enemy ${enemyBaseHp}%`);
    const crystalBar = this.el.querySelector('.js-crystal-bar') as HTMLElement;
    crystalBar.innerHTML = crystalCounts
      .map((count, i) => {
        const width = Math.max(0, (count / totalPresence) * 100);
        const color = PLAYER_COLORS[state.players[i]?.colorIdx ?? 0]?.hex ?? '#777';
        return `<i class="pa-rush-meter-seg" style="width:${width}%;background:${color}"></i>`;
      })
      .join('');
    const baseBar = this.el.querySelector('.js-base-bar') as HTMLElement;
    baseBar.innerHTML = `<i class="pa-rush-meter-seg" style="width:${myBaseHp}%;background:${
      PLAYER_COLORS[p.colorIdx]?.hex ?? '#65d86e'
    }"></i><i class="pa-rush-meter-seg" style="width:${enemyBaseHp}%;background:#d95b52"></i>`;

    for (const plan of PLANS) {
      const btn = this.el.querySelector(`.pa-rush-plan[data-plan="${plan.id}"]`) as HTMLButtonElement | null;
      if (btn === null) continue;
      btn.className = 'pa-rush-btn pa-rush-plan' + (crp.stance === plan.id ? ' sel' : '');
      btn.disabled = deployTicksLeft > 0 || p.credits < deployCost;
      btn.innerHTML = `<b>${plan.label}</b><span>${plan.desc}</span><em>${
        deployTicksLeft > 0 ? `${deployCd}s` : `${deployCost}c`
      }</em>`;
    }

    for (const upgrade of UPGRADES) {
      const cost = getCrystalRushUpgradeCost(state, this.me, upgrade.id);
      const btn = this.el.querySelector(`.pa-rush-btn[data-upgrade="${upgrade.id}"]`) as HTMLButtonElement | null;
      if (btn === null) continue;
      btn.textContent = String(cost);
      btn.disabled = p.credits < cost;
    }

    const factionHost = this.el.querySelector('.pa-rush-factions') as HTMLElement;
    factionHost.innerHTML = '';
    for (const player of state.players) {
      const dot = document.createElement('div');
      dot.className = 'pa-rush-dot' + (player.eliminated ? ' dead' : '');
      dot.style.background = PLAYER_COLORS[player.colorIdx]?.hex ?? '#fff';
      dot.title = player.name;
      factionHost.appendChild(dot);
    }
  }

  private setText(selector: string, value: string): void {
    const el = this.el.querySelector(selector);
    if (el !== null) el.textContent = value;
  }

  private intentText(
    stance: CrystalRushStance,
    deployTicksLeft: number,
    credits: number,
    deployCost: number,
  ): string {
    if (deployTicksLeft > 0) return 'Orders committed. Your next manual wave is forming.';
    if (credits < deployCost) return `Earn ${deployCost - credits} more crystals, then choose a battle plan.`;
    if (stance === 'greedy') return 'Ready: Claim Crystal sends your next wave to secure income.';
    if (stance === 'aggressive') return 'Ready: Break Base sends your next wave to eliminate a rival.';
    return 'Ready: Balanced Push splits your next wave between income and pressure.';
  }

  private crystalPresence(state: GameState): number[] {
    const mode = state.crystalRush;
    const counts = new Array(state.players.length).fill(0) as number[];
    if (mode === undefined) return counts;
    for (const e of state.entities.values()) {
      if (e.kind !== 'unit' || e.hp <= 0) continue;
      const player = state.players[e.owner];
      if (player === undefined || player.eliminated) continue;
      if (Math.hypot(e.pos.x - mode.objective.x, e.pos.y - mode.objective.y) <= mode.radius) counts[e.owner]++;
    }
    return counts;
  }

  private baseHealthPercent(state: GameState, player: PlayerId): number {
    for (const e of state.entities.values()) {
      if (e.owner === player && e.kind === 'building' && e.defId.endsWith('_conyard') && e.maxHp > 0) {
        return Math.max(0, Math.round((e.hp / e.maxHp) * 100));
      }
    }
    return state.players[player]?.eliminated ? 0 : 100;
  }

  private enemyBaseHealthPercent(state: GameState): number {
    const liveEnemies = state.players.filter((p) => p.id !== this.me && !p.eliminated);
    if (liveEnemies.length === 0) return 0;
    const total = liveEnemies.reduce((sum, p) => sum + this.baseHealthPercent(state, p.id), 0);
    return Math.round(total / liveEnemies.length);
  }
}
