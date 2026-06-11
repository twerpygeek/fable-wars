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
import { MAX_QUEUE_LENGTH, SELL_REFUND, TICK_RATE } from '../core/constants';
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

const UNIT_TABS: ProductionTab[] = ['infantry', 'vehicle', 'air', 'naval'];

const TIP_DELAY_MS = 250; // hover dwell before the sidebar tooltip panel shows
const BATCH_QUEUE_COUNT = 5; // Shift+click queues this many at once (units)

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
.pa-item {
  position: relative; border: 1px solid #343a63; border-radius: 4px;
  background: linear-gradient(180deg, #1a1d36 0%, #111426 100%);
  cursor: pointer; overflow: hidden; min-height: 74px;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.05);
}
.pa-item:hover { border-color: #6f9dff; box-shadow: 0 0 10px rgba(74,125,255,0.24), inset 0 1px 0 rgba(255,255,255,0.08); }
.pa-item img, .pa-item canvas { display: block; width: 100%; height: 56px; object-fit: cover; }
.pa-item .pa-item-name { font-size: 7.5px; text-align: center; padding: 3px 1px 4px; color: #c4ccf4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pa-item .pa-item-cost { position: absolute; top: 2px; right: 3px; font-size: 8px; font-weight: bold; color: #ffd95e; text-shadow: 0 1px 2px #000; }
.pa-item.locked { opacity: 0.46; filter: grayscale(0.75) contrast(0.82); cursor: not-allowed; }
.pa-item.locked::after {
  content: ''; position: absolute; inset: 0;
  background: repeating-linear-gradient(135deg, rgba(0,0,0,0.18) 0 6px, transparent 6px 12px);
  pointer-events: none;
}
.pa-item.ready { border-color: #ffd95e; animation: pa-ready-pulse 650ms infinite alternate; }
.pa-item .pa-prog { position: absolute; left: 0; bottom: 16px; height: 4px; width: 0%; background: linear-gradient(90deg,#4a7dff,#9bc0ff); }
.pa-item .pa-inf { position: absolute; top: 2px; left: 4px; font-size: 14px; font-weight: bold; color: #ffd95e;
  text-shadow: 0 1px 3px #000, 0 0 8px rgba(255,217,94,0.65); display: none; pointer-events: none; }
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
.pa-tip { position: absolute; z-index: 60; width: 212px; display: none; pointer-events: none; user-select: none;
  background: linear-gradient(180deg, #181b33 0%, #0e1020 100%);
  border: 1px solid #4a7dff; border-radius: 4px; box-shadow: 0 6px 18px rgba(0,0,0,0.65);
  padding: 8px 10px; font-family: Verdana, Geneva, sans-serif; color: #cfd6ff; }
.pa-tip .pa-tip-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.pa-tip .pa-tip-name { font-size: 12px; font-weight: bold; color: #fff; letter-spacing: 0.5px; }
.pa-tip .pa-tip-cost { font-size: 11px; font-weight: bold; color: #ffd95e; white-space: nowrap; }
.pa-tip .pa-tip-stats { margin-top: 4px; display: flex; gap: 10px; font-size: 9px; color: #8d96c8; }
.pa-tip .pa-tip-pw.pos { color: #5ee887; }
.pa-tip .pa-tip-pw.neg { color: #ff6b5e; }
.pa-tip .pa-tip-blurb { margin-top: 5px; font-size: 9px; line-height: 1.45; color: #aeb6e2; }
.pa-tip .pa-tip-req { margin-top: 5px; font-size: 9px; font-weight: bold; color: #ff6b5e; }
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
  private itemEls = new Map<string, { el: HTMLElement; prog: HTMLElement; inf: HTMLElement }>();
  private repairBtn!: HTMLElement;
  private sellBtn!: HTMLElement;
  private swPanel!: HTMLElement;
  private swTime!: HTMLElement;
  private swName!: HTMLElement;
  private swIconHost!: HTMLElement;
  private swIconKey = '';

  private shownCredits = 0;
  private gridHash = '';

  // tooltip panel (shared by build items, mode buttons, superweapon panel)
  private tipEl!: HTMLElement;
  private tipTimer: number | null = null;

  // infinite repeat-build (OpenRA-style): unit defIds toggled via Ctrl+click.
  // lastRepeatTick dedupes the auto-requeue dispatch while a command is in
  // flight (the sim only consumes pending commands on the next tick).
  private repeatDefs = new Set<string>();
  private lastRepeatTick = new Map<ProductionTab, number>();

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
    this.tipEl = document.createElement('div');
    this.tipEl.className = 'pa-tip';
    this.buildStatic();
    root.appendChild(this.el);
    root.appendChild(this.tipEl);
    window.addEventListener('keydown', this.onKey);
    this.shownCredits = getState().players[humanPlayer].credits;
    this.crVal.textContent = String(this.shownCredits);
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKey);
    this.hideTip();
    this.tipEl.remove();
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
    this.bindTip(
      this.repairBtn,
      () =>
        `<div class="pa-tip-head"><span class="pa-tip-name">Repair</span></div>` +
        `<div class="pa-tip-blurb">Toggle, then click a damaged structure to repair it over time for credits.</div>`,
    );
    this.bindTip(
      this.sellBtn,
      () =>
        `<div class="pa-tip-head"><span class="pa-tip-name">Sell</span></div>` +
        `<div class="pa-tip-blurb">Toggle, then click one of your structures to sell it for a ${Math.round(SELL_REFUND * 100)}% refund.</div>`,
    );

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
    this.bindTip(this.swPanel, () => {
      const p = this.getState().players[this.me];
      if (!p.superweapon) return null;
      const swDef = this.data.superweapons[p.superweapon.defId];
      if (!swDef) return null;
      return (
        `<div class="pa-tip-head"><span class="pa-tip-name">${esc(swDef.name)}</span></div>` +
        `<div class="pa-tip-stats"><span>⏱ ${fmt(swDef.chargeTicks / TICK_RATE)} charge</span></div>` +
        `<div class="pa-tip-blurb">When READY, click this panel and choose a target anywhere on the battlefield.</div>`
      );
    });
    this.el.appendChild(this.swPanel);
  }

  // --- tooltip panel ---------------------------------------------------------

  /** Show `content()` in the tooltip panel after a short hover dwell on `el`;
   *  hide on mouseleave or any click. A null content suppresses the tip. */
  private bindTip(el: HTMLElement, content: () => string | null): void {
    el.addEventListener('mouseenter', () => {
      this.cancelTipTimer();
      this.tipTimer = window.setTimeout(() => {
        this.tipTimer = null;
        const html = content();
        if (html !== null && el.isConnected) this.showTip(el, html);
      }, TIP_DELAY_MS);
    });
    el.addEventListener('mouseleave', () => this.hideTip());
    el.addEventListener('mousedown', () => this.hideTip());
  }

  /** Position the panel just left of the sidebar, top-aligned with the anchor
   *  (clamped to the viewport). Content is set before measuring. */
  private showTip(anchor: HTMLElement, html: string): void {
    const tip = this.tipEl;
    tip.innerHTML = html;
    tip.style.display = 'block';
    tip.style.visibility = 'hidden';
    const rootRect = this.root.getBoundingClientRect();
    const sideRect = this.el.getBoundingClientRect();
    const aRect = anchor.getBoundingClientRect();
    const left = sideRect.left - rootRect.left - tip.offsetWidth - 8;
    const maxTop = window.innerHeight - rootRect.top - tip.offsetHeight - 8;
    tip.style.left = `${Math.max(4, left)}px`;
    tip.style.top = `${Math.max(8, Math.min(aRect.top - rootRect.top, maxTop))}px`;
    tip.style.visibility = 'visible';
  }

  private hideTip(): void {
    this.cancelTipTimer();
    this.tipEl.style.display = 'none';
  }

  private cancelTipTimer(): void {
    if (this.tipTimer !== null) {
      window.clearTimeout(this.tipTimer);
      this.tipTimer = null;
    }
  }

  /** Build-item tooltip: name / cost / build seconds / power delta / role line,
   *  plus a red requirement line when locked (canQueue reason). */
  private defTipHtml(def: DefAny): string {
    const chk = canQueue(this.getState(), this.data, this.me, def.id);
    const bld = this.data.buildings[def.id] as BuildingDef | undefined;
    const secs = Math.max(1, Math.round(def.buildTicks / TICK_RATE));
    let stats = `<span>⏱ ${secs}s</span>`;
    if (bld && bld.power !== 0) {
      const cls = bld.power > 0 ? 'pos' : 'neg';
      stats += `<span class="pa-tip-pw ${cls}">⚡ ${bld.power > 0 ? '+' : ''}${bld.power}</span>`;
    }
    let html =
      `<div class="pa-tip-head"><span class="pa-tip-name">${esc(def.name)}</span>` +
      `<span class="pa-tip-cost">$${def.cost}</span></div>` +
      `<div class="pa-tip-stats">${stats}</div>` +
      `<div class="pa-tip-blurb">${esc(def.blurb)}</div>`;
    if (!chk.ok) {
      const reason = (chk.reason ?? 'Unavailable').replace(/^Requires\s+/i, '');
      html += `<div class="pa-tip-req">Requires: ${esc(reason)}</div>`;
    }
    return html;
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

    // infinite repeat-build: when a unit tab's queue runs dry, re-queue every
    // toggled def of that tab (UNITS ONLY — structures are never auto-requeued).
    if (this.repeatDefs.size > 0) {
      for (const tab of UNIT_TABS) {
        const queue = p.queues[tab];
        if (queue.items.length > 0) continue;
        if (this.lastRepeatTick.get(tab) === state.tick) continue; // dispatch still pending
        let sent = false;
        for (const defId of this.repeatDefs) {
          const ud = this.data.units[defId];
          if (!ud || ud.tab !== tab) continue;
          if (!canQueue(state, this.data, this.me, defId).ok) continue;
          this.dispatch({ type: 'queueProduction', player: this.me, tab, defId });
          sent = true;
        }
        if (sent) this.lastRepeatTick.set(tab, state.tick);
      }
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

  /** Ctrl+click repeat toggle: flip the defId and refresh its ∞ badge. */
  private toggleRepeat(defId: string): void {
    if (this.repeatDefs.has(defId)) this.repeatDefs.delete(defId);
    else this.repeatDefs.add(defId);
    const it = this.itemEls.get(defId);
    if (it) it.inf.style.display = this.repeatDefs.has(defId) ? 'block' : 'none';
  }

  private rebuildGrid(defs: DefAny[], state: GameState): void {
    this.hideTip(); // anchors are about to be replaced
    this.grid.innerHTML = '';
    this.itemEls.clear();
    const p = state.players[this.me];
    const q = p.queues[this.currentTab];

    for (const def of defs) {
      const chk = canQueue(state, this.data, this.me, def.id);
      const isReady = q.readyBuilding === def.id;
      const el = document.createElement('div');
      el.className = 'pa-item' + (chk.ok || isReady ? '' : ' locked') + (isReady ? ' ready' : '');
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
      const inf = document.createElement('div');
      inf.className = 'pa-inf';
      inf.textContent = '∞';
      inf.style.display = this.repeatDefs.has(def.id) ? 'block' : 'none';
      el.append(cost, name, prog, readyTag, inf);
      this.bindTip(el, () => this.defTipHtml(def));

      const isUnit = def.id in this.data.units;
      el.addEventListener('click', (ev) => {
        const st = this.getState();
        const pl = st.players[this.me];
        const queue = pl.queues[this.currentTab];
        if (queue.readyBuilding === def.id) {
          this.ui.placingDefId = def.id;
          return;
        }
        // Ctrl+click (Cmd on macOS): toggle infinite repeat — units only.
        // Toggling OFF is always allowed, even if the item locked meanwhile.
        if ((ev.ctrlKey || ev.metaKey) && isUnit) {
          if (this.repeatDefs.has(def.id) || canQueue(st, this.data, this.me, def.id).ok) {
            this.toggleRepeat(def.id);
          }
          return;
        }
        if (!canQueue(st, this.data, this.me, def.id).ok) return;
        // Shift+click queues a batch (units only); the sim re-validates each
        // command, so MAX_QUEUE_LENGTH is respected even with stale state.
        const room = MAX_QUEUE_LENGTH - queue.items.length;
        const count = ev.shiftKey && isUnit ? Math.max(1, Math.min(BATCH_QUEUE_COUNT, room)) : 1;
        for (let i = 0; i < count; i++) {
          this.dispatch({ type: 'queueProduction', player: this.me, tab: this.currentTab, defId: def.id });
        }
      });
      el.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        // macOS reports Ctrl+LMB as a context click — treat it as the toggle.
        if (ev.ctrlKey && isUnit) {
          const st = this.getState();
          if (this.repeatDefs.has(def.id) || canQueue(st, this.data, this.me, def.id).ok) {
            this.toggleRepeat(def.id);
          }
          return;
        }
        // Plain right-click on a repeating item switches repeat off first;
        // the queue itself is left intact (OpenRA behavior).
        if (this.repeatDefs.has(def.id)) {
          this.toggleRepeat(def.id);
          return;
        }
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
      this.itemEls.set(def.id, { el, prog, inf });
    }
  }
}

function fmt(totalSec: number): string {
  const s = Math.ceil(totalSec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
