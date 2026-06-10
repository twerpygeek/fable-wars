// =============================================================================
// POCKET ALERT — menus (Owner E): main menu, skirmish lobby, loading overlay,
// ESC menu, game-over screen, How-to-Play. Dark command-console aesthetic with
// drifting elemental particles. Produces GameConfig (human is player 0).
// =============================================================================

import type { AIDifficulty, FactionId, GameConfig } from '../core/types';
import { PLAYER_COLORS } from '../core/types';
import { DATA } from '../data/index';

const STYLE_ID = 'pa-style-menu';
const CSS = `
.pa-menu-root { position: absolute; inset: 0; z-index: 100; display: flex; align-items: center; justify-content: center;
  background: radial-gradient(ellipse at 50% 30%, #161a33 0%, #0a0a12 70%);
  font-family: Verdana, Geneva, sans-serif; color: #cfd6ff; overflow: hidden; user-select: none; }
.pa-menu-root::after { content: ''; position: absolute; inset: 0; pointer-events: none;
  background: repeating-linear-gradient(0deg, rgba(255,255,255,0.022) 0 1px, transparent 1px 3px); }
.pa-particle { position: absolute; border-radius: 50%; pointer-events: none; opacity: 0.55; animation: pa-drift linear infinite; }
@keyframes pa-drift { from { transform: translateY(105vh); } to { transform: translateY(-8vh); } }
.pa-panel { position: relative; z-index: 2; background: rgba(16, 18, 36, 0.92); border: 1px solid #2e3252; border-radius: 8px;
  padding: 28px 34px; box-shadow: 0 18px 60px rgba(0,0,0,0.6); max-height: 92vh; overflow-y: auto; scrollbar-width: thin; }
.pa-title { font-size: 44px; font-weight: bold; letter-spacing: 9px; text-align: center; color: #fff;
  text-shadow: 0 0 22px #4a7dff, 0 2px 0 #000; margin: 0 0 2px; }
.pa-subtitle { text-align: center; font-size: 11px; letter-spacing: 6px; color: #8d96c8; margin-bottom: 28px; text-transform: uppercase; }
.pa-btn { display: block; width: 280px; margin: 10px auto; padding: 13px 0; text-align: center; font-size: 14px; letter-spacing: 3px;
  background: linear-gradient(180deg, #232748 0%, #181a30 100%); color: #dfe5ff; border: 1px solid #3a3f66; border-radius: 4px;
  cursor: pointer; text-transform: uppercase; }
.pa-btn:hover { border-color: #4a7dff; box-shadow: 0 0 14px rgba(74,125,255,0.35); color: #fff; }
.pa-btn.primary { background: linear-gradient(180deg, #2c5d2e 0%, #1d3f1f 100%); border-color: #4ade5a; font-weight: bold; }
.pa-btn.primary:hover { box-shadow: 0 0 18px rgba(74,222,90,0.4); }
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
.pa-spin { width: 38px; height: 38px; margin: 0 auto 14px; border-radius: 50%; border: 3px solid #2e3252; border-top-color: #4a7dff;
  animation: pa-spin 800ms linear infinite; }
@keyframes pa-spin { to { transform: rotate(360deg); } }
.pa-howto table { border-collapse: collapse; font-size: 10px; color: #aeb6e2; }
.pa-howto td { border: 1px solid #262a4c; padding: 4px 10px; }
.pa-howto td:first-child { color: #ffd95e; font-weight: bold; white-space: nowrap; }
.pa-menu-h2 { font-size: 13px; letter-spacing: 3px; color: #fff; text-transform: uppercase; margin: 18px 0 6px; }
`;

const FACTION_EMBLEMS: Record<FactionId, string> = { scorch: '🔥', tide: '🌊', verdant: '🌿' };
const TIPS = [
  'Peekachoo hits air AND ground. The cheeks are not just for show.',
  'Low power slows construction and shuts down radar and advanced defenses.',
  'Harvesters auto-return to the nearest Candy Refinery. Protect them!',
  'Engineers (the Professors) capture enemy buildings. Escort them well.',
  'Fire beats Grass, Grass beats Water, Water beats Fire. +25% damage.',
  'Veteran creatures deal +25% damage. Elites self-heal. Keep them alive.',
  'Sell unwanted structures for half their cost — fast cash in a pinch.',
  'Press H to jump to your Citadel. Space jumps to the last attack.',
  'Snorlux is 1600 HP of nap-powered violence. Bring anti-armor.',
  'Hard AI snipes harvesters. Wall in your Candy fields or guard them.',
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
  private seed = Math.floor(Math.random() * 1e6);
  private ais: { faction: FactionId | 'random'; difficulty: AIDifficulty }[] = [
    { faction: 'random', difficulty: 'medium' },
  ];

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
    this.root.appendChild(el);
    this.menuEl = el;
    return el;
  }

  // --- main menu -------------------------------------------------------------------

  showMainMenu(): void {
    const el = this.screen();
    const panel = document.createElement('div');
    panel.className = 'pa-panel';
    panel.innerHTML = `<h1 class="pa-title">POCKET ALERT</h1><div class="pa-subtitle">Creature Command</div>`;
    const skirmish = btn('Skirmish', () => this.showLobby(), true);
    const howto = btn('How to Play', () => this.showHowTo());
    panel.append(skirmish, howto);
    const credits = document.createElement('div');
    credits.style.cssText = 'margin-top:18px;text-align:center;font-size:9px;color:#5a6390;letter-spacing:1px;';
    credits.textContent = 'A loving parody. All creatures procedurally hatched in your browser.';
    panel.appendChild(credits);
    el.appendChild(panel);
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
        fSel.addEventListener('change', () => (ai.faction = fSel.value as FactionId | 'random'));
        const dSel = document.createElement('select');
        dSel.innerHTML = `<option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>`;
        dSel.value = ai.difficulty;
        dSel.addEventListener('change', () => (ai.difficulty = dSel.value as AIDifficulty));
        row.append(fSel, dSel);
        if (this.ais.length > 1) {
          const x = document.createElement('span');
          x.className = 'pa-x';
          x.textContent = '✕';
          x.title = 'Remove';
          x.addEventListener('click', () => {
            this.ais.splice(i, 1);
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
    const sizeRow = segRow('Map Size', ['S', 'M', 'L'], this.mapSize, (v) => (this.mapSize = v as 'S' | 'M' | 'L'));
    const waterRow = segRow('Water', ['low', 'medium', 'high'], this.water, (v) => (this.water = v as 'low' | 'medium' | 'high'));
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
    panel.append(sizeRow, waterRow, seedRow);

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
    const cfg: GameConfig = {
      seed: this.seed,
      mapSize: this.mapSize,
      waterAmount: this.water,
      crates: true,
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
    this.onStart(cfg);
  }

  // --- loading / game over / esc -----------------------------------------------------

  showLoading(msg: string): void {
    if (!this.menuEl) this.screen();
    this.clearOverlay();
    const ov = document.createElement('div');
    ov.className = 'pa-overlay';
    const inner = document.createElement('div');
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

  showEscMenu(opts: { onResume: () => void; onSurrender: () => void; onQuit: () => void }): void {
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
    ov.appendChild(panel);
    this.root.appendChild(ov);
    this.escEl = ov;
  }

  hideEscMenu(): void {
    this.escEl?.remove();
    this.escEl = null;
  }
}

// --- tiny DOM helpers -----------------------------------------------------------------

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
