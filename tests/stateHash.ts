import assert from 'node:assert/strict';
import { DATA } from '../src/data';
import type { GameConfig } from '../src/core/types';
import { createGame } from '../src/sim/game';
import { hashGameState } from '../src/net/stateHash';

const config: GameConfig = {
  mode: 'crystalRush',
  seed: 91827,
  mapSize: 'M',
  waterAmount: 'low',
  crates: false,
  players: [
    { faction: 'scorch', isHuman: true, difficulty: null, colorIdx: 0, name: 'A' },
    { faction: 'tide', isHuman: false, difficulty: null, colorIdx: 1, name: 'B' },
    { faction: 'verdant', isHuman: false, difficulty: 'medium', colorIdx: 2, name: 'C' },
    { faction: 'scorch', isHuman: false, difficulty: 'medium', colorIdx: 3, name: 'D' },
  ],
};

const a = createGame(config, DATA);
const b = createGame(config, DATA);

assert.equal(hashGameState(a), hashGameState(b), 'identical seeded matches should hash identically');

a.players[0].credits += 1;
assert.notEqual(hashGameState(a), hashGameState(b), 'credit drift should change the match hash');

a.players[0].credits -= 1;
const ent = [...a.entities.values()][0];
assert.ok(ent, 'match should have starting entities');
ent.hp -= 1;
assert.notEqual(hashGameState(a), hashGameState(b), 'entity HP drift should change the match hash');

console.log('PASS state hash');
