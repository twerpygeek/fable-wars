import assert from 'node:assert/strict';
import { DATA } from '../src/data/index';
import type { GameConfig } from '../src/core/types';
import { TICK_RATE } from '../src/core/constants';
import { createGame, tickGame } from '../src/sim/game';

const cfg: GameConfig = {
  mode: 'crystalRush',
  seed: 424242,
  mapSize: 'M',
  waterAmount: 'low',
  crates: false,
  players: [
    { faction: 'scorch', isHuman: false, difficulty: 'medium', colorIdx: 0, name: 'Scorch Rush AI' },
    { faction: 'tide', isHuman: false, difficulty: 'medium', colorIdx: 1, name: 'Tide Rush AI' },
    { faction: 'verdant', isHuman: false, difficulty: 'medium', colorIdx: 2, name: 'Verdant Rush AI' },
    { faction: 'scorch', isHuman: false, difficulty: 'medium', colorIdx: 3, name: 'Gold Rush AI' },
  ],
};

const state = createGame(cfg, DATA);
const maxTicks = TICK_RATE * 60 * 12;

for (let i = 0; i < maxTicks && state.winner === null; i++) {
  tickGame(state, DATA, []);
}

assert.notEqual(state.crystalRush, undefined, 'Crystal Rush state should be initialized');
assert.notEqual(state.winner, null, 'Crystal Rush AI-vs-AI match should resolve within 12 sim minutes');
assert.ok(state.tick >= TICK_RATE * 60 * 5, `Crystal Rush should last at least 5 sim minutes, lasted ${state.tick / TICK_RATE}s`);

console.log(
  `Crystal Rush winner=${state.winner} duration=${Math.round(state.tick / TICK_RATE)}s income=${state.players
    .map((p) => p.stats.creditsHarvested)
    .join(',')}`,
);
