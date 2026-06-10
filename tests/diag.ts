import type { Command, GameConfig } from '../src/core/types';
import { AI_THINK_INTERVAL, TICK_RATE } from '../src/core/constants';
import { DATA } from '../src/data/index';
import { createGame, tickGame } from '../src/sim/game';
import { aiThink } from '../src/ai/ai';

const config: GameConfig = {
  seed: 9137, mapSize: 'M', waterAmount: 'medium', crates: false,
  players: [
    { faction: 'scorch', isHuman: false, difficulty: 'hard', colorIdx: 0, name: 'HARD' },
    { faction: 'scorch', isHuman: false, difficulty: 'medium', colorIdx: 1, name: 'MED' },
  ],
};
const state = createGame(config, DATA);
const max = 30 * 60 * TICK_RATE;
while (state.winner === null && state.tick < max) {
  const commands: Command[] = [];
  for (const p of state.players) {
    if (p.eliminated || !p.difficulty) continue;
    if (state.tick % AI_THINK_INTERVAL[p.difficulty] === (p.id * 3) % AI_THINK_INTERVAL[p.difficulty]) {
      commands.push(...aiThink(state, DATA, p.id));
    }
  }
  tickGame(state, DATA, commands);
  if (state.tick % (60 * TICK_RATE) === 0) {
    const min = state.tick / TICK_RATE / 60;
    const rows = state.players.map((p) => {
      const ents = [...state.entities.values()].filter(e => e.owner === p.id);
      const mil = ents.filter(e => e.kind === 'unit' && DATA.units[e.defId]?.weapon);
      const milVal = mil.reduce((s, e) => s + DATA.units[e.defId].cost, 0);
      const harv = ents.filter(e => e.kind === 'unit' && DATA.units[e.defId]?.harvester).length;
      const defs = ents.filter(e => e.kind === 'building' && DATA.buildings[e.defId]?.tab === 'defense').length;
      const bld = ents.filter(e => e.kind === 'building').length;
      const tech = ['radar','techlab','sw','factory','airpad','navalyard'].filter(k => ents.some(e => e.defId === `${p.faction}_${k}`)).join(',');
      return `${p.name}: $${Math.round(p.credits)} mil${mil.length}($${milVal}) harv${harv} def${defs} bld${bld} [${tech}] k${p.stats.unitsKilled}/l${p.stats.unitsLost}`;
    });
    console.log(`[${String(min).padStart(2)}m]`, rows.join(' || '));
  }
}
console.log('winner:', state.winner === null ? 'DRAW' : state.players[state.winner].name);
