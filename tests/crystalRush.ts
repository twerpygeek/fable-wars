import assert from 'node:assert/strict';
import { DATA } from '../src/data/index';
import type { GameConfig } from '../src/core/types';
import { TICK_RATE } from '../src/core/constants';
import { createGame, tickGame } from '../src/sim/game';
import { entitiesOf } from '../src/sim/entity';

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

const humanCfg: GameConfig = {
  ...cfg,
  seed: 989898,
  players: cfg.players.map((p, i) => ({ ...p, isHuman: i === 0, name: i === 0 ? 'Human Commander' : p.name })),
};
const humanState = createGame(humanCfg, DATA);
humanState.tick = TICK_RATE * 12;
humanState.players[0].credits = 1000;
const beforeUnits = entitiesOf(humanState, 0).filter((e) => e.kind === 'unit').length;
tickGame(humanState, DATA, [{ type: 'crystalRushDeployWave', player: 0, stance: 'aggressive' }]);
const afterUnits = entitiesOf(humanState, 0).filter((e) => e.kind === 'unit');

assert.equal(humanState.crystalRush?.player[0]?.stance, 'aggressive', 'manual deploy should set the chosen plan');
assert.ok(afterUnits.length > beforeUnits, 'manual deploy should spawn an immediate player wave');
assert.ok(
  afterUnits.some((e) => e.orders[0]?.kind === 'attack'),
  'aggressive deploy should send at least one unit toward an enemy base',
);

const surgeCfg: GameConfig = {
  ...cfg,
  seed: 777331,
  players: cfg.players.map((p, i) => ({ ...p, isHuman: i === 0, name: i === 0 ? 'Surge Commander' : p.name })),
};
const surgeState = createGame(surgeCfg, DATA);
const surgePlayer = surgeState.crystalRush?.player[0];
assert.ok(surgePlayer, 'Crystal Rush player state should exist');
surgePlayer.waveLevel = 4;
surgePlayer.nextWaveTick = TICK_RATE * 60 * 30;
surgeState.tick = TICK_RATE * 20;
surgeState.players[0].credits = 2000;
const surgeBefore = entitiesOf(surgeState, 0).filter((e) => e.kind === 'unit').length;
tickGame(surgeState, DATA, [{ type: 'crystalRushDeployWave', player: 0, stance: 'split' }]);
const surgeSpawned = entitiesOf(surgeState, 0).filter((e) => e.kind === 'unit').length - surgeBefore;

assert.ok(surgeSpawned >= 15, `War Surge should feel stronger than an auto wave, spawned ${surgeSpawned}`);
