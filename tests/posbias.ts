import type { AIDifficulty, Command, FactionId, GameConfig } from '../src/core/types';
import { AI_THINK_INTERVAL, TICK_RATE } from '../src/core/constants';
import { DATA } from '../src/data/index';
import { createGame, tickGame } from '../src/sim/game';
import { aiThink } from '../src/ai/ai';

function run(seed: number, d0: AIDifficulty, d1: AIDifficulty) {
  const config: GameConfig = { seed, mapSize: 'M', waterAmount: 'medium', players: [
    { faction: 'scorch', isHuman: false, difficulty: d0, colorIdx: 0, name: 'P0-' + d0 },
    { faction: 'scorch', isHuman: false, difficulty: d1, colorIdx: 1, name: 'P1-' + d1 },
  ]};
  const state = createGame(config, DATA);
  const max = 35 * 60 * TICK_RATE;
  while (state.winner === null && state.tick < max) {
    const commands: Command[] = [];
    for (const p of state.players) {
      if (p.eliminated || !p.difficulty) continue;
      if (state.tick % AI_THINK_INTERVAL[p.difficulty] === (p.id * 3) % AI_THINK_INTERVAL[p.difficulty]) commands.push(...aiThink(state, DATA, p.id));
    }
    tickGame(state, DATA, commands);
  }
  return state.winner === null ? 'DRAW' : state.players[state.winner].name;
}
for (const seed of [9000, 9137, 9274]) {
  console.log(`seed ${seed}: hard-as-P0 → ${run(seed, 'hard', 'medium')} ; hard-as-P1 → ${run(seed, 'medium', 'hard')}`);
}
// mirror sanity: medium vs medium — does P0 or P1 win structurally?
for (const seed of [9000, 9137, 9274]) {
  console.log(`seed ${seed}: med-vs-med → winner ${run(seed, 'medium', 'medium')}`);
}
