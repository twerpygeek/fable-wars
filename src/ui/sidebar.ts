// =============================================================================
// POCKET ALERT — RA2-style build sidebar (Owner E).
// Right 200px column: minimap, credits ticker + power bar, six production tabs
// (Q W E R T Y), icon grid with queue/lock/READY states, repair/sell toggles,
// superweapon countdown. DOM built once; update() touches only changed nodes.
// =============================================================================

import type {
  BuildingDef,
  Command,
  GameData,
  GameState,
  PlayerId,
  ProductionTab,
  UIState,
  UnitDef,
} from '../core/types';
import { TICK_RATE } from '../core/constants';
import { canQueue } from '../sim/production';
import type { SpriteAtlas } from '../render/sprites';

const TABS: { tab: ProductionTab; label: string; key: string }[] = [
  { tab: 'structure', label: 'BLD', key: 'Q' },
  { tab: 'defense', label: 'DEF', key: 'W' },
  { tab: 'infantry', label: 'INF', key: 'E' },
  { tab: 'vehicle', label: 'VEH', key: 'R' },
  { tab: 'air', label: 'AIR', key: 'T' },
  { tab: 'naval', label: 'NAV', key: 'Y' },
];

const STYLE_ID = 'pa-style-sidebar';
const CSS = `
.pa-side {
  position: absolute; top: 0; right: 0; bottom: 0; width: 200px; z-index: 50;
  background: linear-gradient(180deg, #14162a 0%, #0e1020 100%);
  border-left: 2px solid #2a2d44; box-shadow: -4px 0 18px rgba(0,0,0,0.55);
  display: flex; flex-direction: column; gap: 6px; padding: 8px;
  font-family: Verdana, Geneva, sans-serif; color: #cfd6ff; user-select: none;
  overflow-y: auto; scrollbar-width: thin;
}
.pa-side canvas.pa-minimap { width: 184px; height: 184px; background: #05060a; border: 1px solid #2a2d44; border-radius: 3px; flex-shrink: 0; }
/* short windows: shrink the minimap before squeezing the build grid */
@media (max-height: 700px) { .pa-side canvas.pa-minimap { width: 140px; height: 140px; align-self: center; } }
@media (max-height: 540px) { .pa-side canvas.pa-minimap { width: 110px; height: 110px; } }
.pa-credits { display: flex; justify-content: space-between; align-items: center; background: #0a0c18; border: 1px solid #2a2d44; border-radius: 3px; padding: 4px 8px; }
.pa-credits .pa-cr-val { font-size: 15px; font-weight: bold; color: #ffd95e; letter-spacing: 1px; text-shadow: 0 1px 2px #000; }
.pa-credits .pa-cr-label { font-size: 8px; color: #6f78a8; text-transform: uppercase; letter-spacing: 1px; }
.pa-power { height: 10px; background: #0a0c18; border: 1px solid #2a2d44; border-radius: 3px; position: relative; overflow: hidden; }
.pa-power .pa-pw-fill { position: absolute; inset: 0; width: 50%; background: linear-gradient(90deg,#2fae5a,#5ee887); transition: width 200ms; }
.pa-power.low .pa-pw-fill { background: linear-gradient(90deg,#a8242f,#e8453c); animation: pa-pw-flash 700ms infinite alternate; }
.pa-power .pa-pw-text { position: absolute; inset: 0; font-size: 8px; text-align: center; line-height: 10px; color: #fff; text-shadow: 0 1px 1px #000; letter-spacing: 1px; }
@keyframes pa-pw-flash { from { opacity: 1; } to { opacity: 0.45; } }
.pa-tabs { display: flex; gap: 2px; }
.pa-tab { flex: 1; position: relative; text-align: center; padding: 5px 0 3px; font-size: 9px; letter-spacing: 0.5px;
  background: #181a30; border: 1px solid #2a2d44; border-radius: 3px 3px 0 0; cursor: pointer; color: #8d96c8; }
.pa-tab:hover { background: #20233e; color: #fff; }
.pa-tab.active { background: #262a4c; color: #fff; border-bottom-color: #262a4c; box-shadow: inset 0 2px 0 #4a7dff; }
.pa-tab .pa-tab-key { display: block; font-size: 7px; color: #5a6390; }
.pa-tab .pa-badge { position: absolute; top: -5px; right: -3px; min-width: 13px; height: 13px; border-radius: 7px;
  background: #e8453c; color: #fff; font-size: 8px; line-height: 13px; font-weight: bold; display: none; }
.pa-grid { flex: 1; min-height: 150px; overflow-y: auto; display: grid; grid-template-columns: 1fr 1fr; gap: 4px; align-content: start;
  background: #0a0c18; border: 1px solid #2a2d44; border-radius: 0 0 3px 3px; padding: 5px; scrollbar-width: thin; }
.pa-item { position: relative; border: 1px solid #2e3252; border-radius: 3px; background: #161830; cursor: pointer; overflow: hidden; }
.pa-item:hover { border-color: #4a7dff; }
.pa-item img, .pa-item canvas { display: block; width: 100%; height: 56px; object-fit: cover; }
.pa-item .pa-item-name { font-size: 7.5px; text-align: center; padding: 2px 1px 3px; color: #aeb6e2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pa-item .pa-item-cost { position: absolute; top: 2px; right: 3px; font-size: 8px; font-weight: bold; color: #ffd95e; text-shadow: 0 1px 2px #000; }
.pa-item.locked { opacity: 0.38; filter: grayscale(0.8); cursor: not-allowed; }
.pa-item .pa-prog { position: absolute; left: 0; bottom: 14px; height: 3px; width: 0%; background: #4a7dff; }
.pa-item.ready { border-color: #ffd95e; animation: pa-ready-pulse 800ms infinite alternate; }
.pa-item .pa-ready-tag { position: absolute; top: 18px; left: 0; right: 0; text-align: center; font-size: 9px; font-weight: bold;
  color: #ffd95e; text-shadow: 0 1px 3px #000; letter-spacing: 2px; display: none; }
.pa-item.ready .pa-ready-tag { display: block; }
@keyframes pa-ready-pulse { from { box-shadow: 0 0 2px #ffd95e; } to { box-shadow: 0 0 10px #ffd95e; } }
.pa-modes { display: flex; gap: 4px; }
.pa-mode-btn { flex: 1; padding: 5px 0; text-align: center; font-size: 9px; letter-spacing: 1px; cursor: pointer;
  background: #181a30; border: 1px solid #2a2d44; border-radius: 3px; color: #8d96c8; }
.pa-mode-btn:hover { color: #fff; background: #20233e; }
.pa-mode-btn.active { background: #4d3211; border-color: #ffd95e; color: #ffd95e; }
.pa-sw { display: none; align-items: center; gap: 6px; background: #1c0f24; border: 1px solid #6b2a8c; border-radius: 3px; padding: 4px; cursor: pointer; }
.pa-sw.visible { display: flex; }
.pa-sw canvas { width: 42px; height: 32px; border-radius: 2px; }
.pa-sw .pa-sw-name { font-size: 8px; color: #d9b3ff; letter-spacing: 0.5px; }
.pa-sw .pa-sw-time { font-size: 13px; font-weight: bold; color: #fff; }
.pa-sw.ready { border-color: #ff5ad9; animation: pa-ready-pulse 700ms infinite alternate; }
.pa-sw.ready .pa-sw-time { color: #ff9af0; }
`;

type DefAny = UnitDef | BuildingDef;

export class Sidebar {
  public minimapCanvas: HTMLCanvasElement;

  private data: GameData;
  private icons: SpriteAtlas;
  private dispatch: (c: Command) => void;
  private getState: () => GameState;
  private me: PlayerId;
  private ui: UIState;

  private currentTab: ProductionTab = 'structure';
  private root: HTMLElement;
  private el: HTMLElement;
  private crVal!: HTMLElement;
  private pwWrap!: HTMLElement;
  private pwFill!: HTMLElement;
  private pwText!: HTMLElement;
  private tabEls = new Map<ProductionTab, { btn: HTMLElement; badge: HTMLElement }>();
  private grid!: HTMLElement;
  private itemEls = new Map<string, { el: HTMLElement; prog: HTMLElement }>();
  private repairBtn!: HTMLElement;
  private sellBtn!: HTMLElement;
  private swPanel!: HTMLElement;
  private swTime!: HTMLElement;
  private swName!: HTMLElement;
  private swIconHost!: HTMLElement;
  private swIconKey = '';

  private shownCredits = 0;
  private gridHash = '';
  private onKey = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const i = ['q', 'w', 'e', 'r', 't', 'y'].indexOf(e.key.toLowerCase());
    if (i >= 0) this.setTab(TABS[i].tab);
  };

  constructor(
    root: HTMLElement,
    data: GameData,
    icons: SpriteAtlas,
    dispatch: (c: Command) => void,
    getState: () => GameState,
    humanPlayer: PlayerId,
    ui: UIState,
  ) {
    this.root = root;
    this.data = data;
    this.icons = icons;
    this.dispatch = dispatch;
    this.getState = getState;
    this.me = humanPlayer;
    this.ui = ui;

    if (!document.getElementById(STYLE_ID)) {
      const s = document.createElement('style');
      s.id = STYLE_ID;
      s.textContent = CSS;
      document.head.appendChild(s);
    }

    this.el = document.createElement('div');
    this.el.className = 'pa-side';
    this.minimapCanvas = document.createElement('canvas');
    this.minimapCanvas.className = 'pa-minimap';
    this.minimapCanvas.width = 184;
    this.minimapCanvas.height = 184;
    this.el.appendChild(this.minimapCanvas);
    this.buildStatic();
    root.appendChild(this.el);
    window.addEventListener('keydown', this.onKey);
    this.shownCredits = getState().players[humanPlayer].credits;
    this.crVal.textContent = String(this.shownCredits);
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKey);
    this.el.remove();
  }

  private buildStatic(): void {
    const credits = document.createElement('div');
    credits.className = 'pa-credits';
    credits.innerHTML = `<span class="pa-cr-label">Credits</span><span class="pa-cr-val">0</span>`;
    this.crVal = credits.querySelector('.pa-cr-val') as HTMLElement;
    this.el.appendChild(credits);

    this.pwWrap = document.createElement('div');
    this.pwWrap.className = 'pa-power';
    this.pwWrap.innerHTML = `<div class="pa-pw-fill"></div><div class="pa-pw-text"></div>`;
    this.pwFill = this.pwWrap.querySelector('.pa-pw-fill') as HTMLElement;
    this.pwText = this.pwWrap.querySelector('.pa-pw-text') as HTMLElement;
    this.el.appendChild(this.pwWrap);

    const tabs = document.createElement('div');
    tabs.className = 'pa-tabs';
    for (const t of TABS) {
      const btn = document.createElement('div');
      btn.className = 'pa-tab' + (t.tab === this.currentTab ? ' active' : '');
      btn.innerHTML = `${t.label}<span class="pa-tab-key">${t.key}</span><span class="pa-badge"></span>`;
      btn.addEventListener('click', () => this.setTab(t.tab));
      tabs.appendChild(btn);
      this.tabEls.set(t.tab, { btn, badge: btn.querySelector('.pa-badge') as HTMLElement });
    }
    this.el.appendChild(tabs);

    this.grid = document.createElement('div');
    this.grid.className = 'pa-grid';
    this.el.appendChild(this.grid);

    const modes = document.createElement('div');
    modes.className = 'pa-modes';
    this.repairBtn = document.createElement('div');
    this.repairBtn.className = 'pa-mode-btn';
    this.repairBtn.textContent = '🔧 REPAIR';
    this.repairBtn.addEventListener('click', () => {
      this.ui.repairMode = !this.ui.repairMode;
      if (this.ui.repairMode) this.ui.sellMode = false;
    });
    this.sellBtn = document.createElement('div');
    this.sellBtn.className = 'pa-mode-btn';
    this.sellBtn.textContent = '💰 SELL';
    this.sellBtn.addEventListener('click', () => {
      this.ui.sellMode = !this.ui.sellMode;
      if (this.ui.sellMode) this.ui.repairMode = false;
    });
    modes.append(this.repairBtn, this.sellBtn);
    this.el.appendChild(modes);

    this.swPanel = document.createElement('div');
    this.swPanel.className = 'pa-sw';
    this.swIconHost = document.createElement('div');
    const swInfo = document.createElement('div');
    this.swName = document.createElement('div');
    this.swName.className = 'pa-sw-name';
    this.swTime = document.createElement('div');
    this.swTime.className = 'pa-sw-time';
    swInfo.append(this.swName, this.swTime);
    this.swPanel.append(this.swIconHost, swInfo);
    this.swPanel.addEventListener('click', () => {
      const p = this.getState().players[this.me];
      if (p.superweapon && !p.superweapon.charging) this.ui.targetingSuperweapon = true;
    });
    this.el.appendChild(this.swPanel);
  }

  private setTab(tab: ProductionTab): void {
    if (tab === this.currentTab) return;
    this.currentTab = tab;
    for (const [t, els] of this.tabEls) els.btn.classList.toggle('active', t === tab);
    this.gridHash = ''; // force grid rebuild
  }

  private defsForTab(tab: ProductionTab): DefAny[] {
    const p = this.getState().players[this.me];
    const pool: DefAny[] =
      tab === 'structure' || tab === 'defense'
        ? Object.values(this.data.buildings)
        : Object.values(this.data.units);
    return pool
      .filter((d) => d.tab === tab && d.faction === p.faction)
      .sort((a, b) => a.uiOrder - b.uiOrder || a.cost - b.cost);
  }

  /** Per-frame refresh; only touches DOM on change. */
  update(): void {
    const state = this.getState();
    const p = state.players[this.me];
    if (!p) return;

    // credits ticker
    const target = Math.floor(p.credits);
    if (this.shownCredits !== target) {
      const diff = target - this.shownCredits;
      this.shownCredits += Math.abs(diff) <= 2 ? diff : Math.round(diff * 0.18);
      this.crVal.textContent = String(this.shownCredits);
    }

    // power bar
    const low = p.powerConsumed > p.powerProduced;
    const ratio = p.powerProduced <= 0 ? 0 : Math.min(1, p.powerProduced / Math.max(1, p.powerConsumed + 50));
    const pwLabel = `⚡ ${p.powerProduced} / ${p.powerConsumed}`;
    if (this.pwText.textContent !== pwLabel) this.pwText.textContent = pwLabel;
    this.pwFill.style.width = `${Math.round((low ? p.powerConsumed && ratio : 1) ? ratio * 100 : 100)}%`;
    this.pwWrap.classList.toggle('low', low);

    // tab badges
    for (const t of TABS) {
      const q = p.queues[t.tab];
      const count = q.items.length + (q.readyBuilding ? 1 : 0);
      const badge = this.tabEls.get(t.tab)!.badge;
      const txt = count > 0 ? String(count) : '';
      if (badge.textContent !== txt) {
        badge.textContent = txt;
        badge.style.display = count > 0 ? 'block' : 'none';
      }
    }

    // grid rebuild when composition changes
    const defs = this.defsForTab(this.currentTab);
    const q = p.queues[this.currentTab];
    const hash =
      this.currentTab +
      '|' +
      q.items.join(',') +
      '|' +
      (q.readyBuilding ?? '') +
      '|' +
      defs.map((d) => (canQueue(state, this.data, this.me, d.id).ok ? '1' : '0')).join('');
    if (hash !== this.gridHash) {
      this.gridHash = hash;
      this.rebuildGrid(defs, state);
    }

    // progress overlay on the in-flight item
    if (q.items.length > 0) {
      const defId = q.items[0];
      const def = this.data.units[defId] ?? this.data.buildings[defId];
      const it = this.itemEls.get(defId);
      if (it && def) it.prog.style.width = `${Math.min(100, (q.progress / Math.max(1, def.buildTicks)) * 100)}%`;
    }

    // superweapon panel
    if (p.superweapon) {
      const swDef = this.data.superweapons[p.superweapon.defId];
      this.swPanel.classList.add('visible');
      if (this.swIconKey !== p.superweapon.defId) {
        this.swIconKey = p.superweapon.defId;
        this.swIconHost.innerHTML = '';
        this.swIconHost.appendChild(this.icons.getIcon(p.superweapon.defId));
        this.swName.textContent = swDef ? swDef.name.toUpperCase() : 'SUPERWEAPON';
      }
      const remaining = Math.max(0, p.superweapon.readyAtTick - state.tick);
      const ready = !p.superweapon.charging && remaining <= 0;
      this.swPanel.classList.toggle('ready', ready);
      const txt = ready ? 'READY' : fmt(remaining / TICK_RATE);
      if (this.swTime.textContent !== txt) this.swTime.textContent = txt;
    } else {
      this.swPanel.classList.remove('visible');
      this.swIconKey = '';
    }

    this.repairBtn.classList.toggle('active', this.ui.repairMode);
    this.sellBtn.classList.toggle('active', this.ui.sellMode);
  }

  private rebuildGrid(defs: DefAny[], state: GameState): void {
    this.grid.innerHTML = '';
    this.itemEls.clear();
    const p = state.players[this.me];
    const q = p.queues[this.currentTab];

    for (const def of defs) {
      const chk = canQueue(state, this.data, this.me, def.id);
      const isReady = q.readyBuilding === def.id;
      const el = document.createElement('div');
      el.className = 'pa-item' + (chk.ok || isReady ? '' : ' locked') + (isReady ? ' ready' : '');
      el.title = `${def.name} — $${def.cost}\n${def.blurb}` + (chk.ok ? '' : `\n🔒 ${chk.reason ?? 'unavailable'}`);
      el.appendChild(this.icons.getIcon(def.id));
      const cost = document.createElement('span');
      cost.className = 'pa-item-cost';
      cost.textContent = `$${def.cost}`;
      const name = document.createElement('div');
      name.className = 'pa-item-name';
      name.textContent = def.name;
      const prog = document.createElement('div');
      prog.className = 'pa-prog';
      const readyTag = document.createElement('div');
      readyTag.className = 'pa-ready-tag';
      readyTag.textContent = 'READY';
      el.append(cost, name, prog, readyTag);

      el.addEventListener('click', () => {
        const st = this.getState();
        const pl = st.players[this.me];
        const queue = pl.queues[this.currentTab];
        if (queue.readyBuilding === def.id) {
          this.ui.placingDefId = def.id;
          return;
        }
        if (canQueue(st, this.data, this.me, def.id).ok) {
          this.dispatch({ type: 'queueProduction', player: this.me, tab: this.currentTab, defId: def.id });
        }
      });
      el.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        const st = this.getState();
        const queue = st.players[this.me].queues[this.currentTab];
        if (queue.readyBuilding === def.id) {
          this.dispatch({ type: 'cancelProduction', player: this.me, tab: this.currentTab, index: 0 });
          if (this.ui.placingDefId === def.id) this.ui.placingDefId = null;
          return;
        }
        const idx = queue.items.lastIndexOf(def.id);
        if (idx >= 0) this.dispatch({ type: 'cancelProduction', player: this.me, tab: this.currentTab, index: idx });
      });

      this.grid.appendChild(el);
      this.itemEls.set(def.id, { el, prog });
    }
  }
}

function fmt(totalSec: number): string {
  const s = Math.ceil(totalSec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
