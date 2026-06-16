import assert from 'node:assert/strict';
import { DATA } from '../src/data/index';
import { TICK_RATE } from '../src/core/constants';
import { Terrain, type GameConfig } from '../src/core/types';
import { createGame, tickGame } from '../src/sim/game';
import { rebuildOccupancy } from '../src/sim/entity';

const cfg: GameConfig = {
  seed: 20260616,
  mapSize: 'S',
  waterAmount: 'low',
  crates: false,
  players: [
    { faction: 'scorch', isHuman: true, difficulty: null, colorIdx: 0, name: 'Commander' },
    { faction: 'tide', isHuman: false, difficulty: 'medium', colorIdx: 1, name: 'AI' },
  ],
};

const state = createGame(cfg, DATA);
for (let i = 0; i < state.map.terrain.length; i++) {
  state.map.terrain[i] = Terrain.GRASS;
  state.map.crystal[i] = 0;
}

const harvesters = [...state.entities.values()].filter(
  (e) => e.owner === 0 && e.kind === 'unit' && DATA.units[e.defId]?.harvester !== undefined,
);
assert.ok(harvesters.length > 0, 'scenario needs a player harvester');
const h = harvesters[0];
h.pos = { x: 10.5, y: 10.5 };
h.cargo = 0;
h.orders = [{ kind: 'harvest' }];
h.path = null;
h.pathTarget = null;
for (const extra of harvesters.slice(1)) extra.hp = 0;

const idx = (x: number, y: number) => y * state.map.w + x;
const blockedCrystal = { x: 14, y: 10 };
const reachableCrystal = { x: 18, y: 10 };
state.map.terrain[idx(blockedCrystal.x, blockedCrystal.y)] = Terrain.CRYSTAL;
state.map.crystal[idx(blockedCrystal.x, blockedCrystal.y)] = 5000;
for (let y = blockedCrystal.y - 1; y <= blockedCrystal.y + 1; y++) {
  for (let x = blockedCrystal.x - 1; x <= blockedCrystal.x + 1; x++) {
    if (x === blockedCrystal.x && y === blockedCrystal.y) continue;
    state.map.terrain[idx(x, y)] = Terrain.ROCK;
  }
}
state.map.terrain[idx(reachableCrystal.x, reachableCrystal.y)] = Terrain.CRYSTAL;
state.map.crystal[idx(reachableCrystal.x, reachableCrystal.y)] = 5000;
rebuildOccupancy(state, DATA);

for (let i = 0; i < TICK_RATE * 45 && h.cargo === 0; i++) {
  tickGame(state, DATA, []);
}

assert.ok(h.cargo > 0, 'harvester should skip unreachable crystals and mine a reachable one');
assert.equal(state.map.crystal[idx(blockedCrystal.x, blockedCrystal.y)], 5000, 'blocked crystal should remain untouched');
assert.ok(state.map.crystal[idx(reachableCrystal.x, reachableCrystal.y)] < 5000, 'reachable crystal should be mined');

console.log('PASS harvesters');
