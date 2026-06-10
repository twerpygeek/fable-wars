// Headless AI-vs-AI harness: proves the sim plays complete matches with no DOM.
// Usage: npm run test:headless [-- --matches 3 --maxMin 30 --seed 42]
import type { AIDifficulty, Command, FactionId, GameConfig } from '../src/core/types';
import { AI_THINK_INTERVAL, TICK_RATE } from '../src/core/constants';
import { DATA } from '../src/data/index';
import { createGame, tickGame } from '../src/sim/game';
import { aiThink } from '../src/ai/ai';

const args = process.argv.slice(2);
const argNum = (name: string, dflt: number) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? Number(args[i + 1]) : dflt;
};
const MATCHES = argNum('matches', 3);
const MAX_MIN = argNum('maxMin', 30);
const BASE_SEED = argNum('seed', 1337);

const FACTIONS: FactionId[] = ['scorch', 'tide', 'verdant'];

function runMatch(seed: number, diffA: AIDifficulty, diffB: AIDifficulty, fa: FactionId, fb: FactionId) {
  const config: GameConfig = {
    seed,
    mapSize: 'M',
    waterAmount: 'medium',
    players: [
      { faction: fa, isHuman: false, difficulty: diffA, colorIdx: 0, name: `AI-A(${diffA})` },
      { faction: fb, isHuman: false, difficulty: diffB, colorIdx: 1, name: `AI-B(${diffB})` },
    ],
  };
  const state = createGame(config, DATA);
  const maxTicks = MAX_MIN * 60 * TICK_RATE;
  const t0 = Date.now();
  let eventCount = 0;

  while (state.winner === null && state.tick < maxTicks) {
    const commands: Command[] = [];
    for (const p of state.players) {
      if (p.eliminated || !p.difficulty) continue;
      if (state.tick % AI_THINK_INTERVAL[p.difficulty] === (p.id * 3) % AI_THINK_INTERVAL[p.difficulty]) {
        commands.push(...aiThink(state, DATA, p.id));
      }
    }
    eventCount += tickGame(state, DATA, commands).length;
  }

  const wall = Date.now() - t0;
  const simMin = (state.tick / TICK_RATE / 60).toFixed(1);
  const winner = state.winner === null ? 'DRAW/TIMEOUT' : state.players[state.winner].name;
  const built = state.players.map((p) => p.stats.built).join('/');
  const kills = state.players.map((p) => p.stats.kills).join('/');
  console.log(
    `seed=${seed} ${fa}(${diffA}) vs ${fb}(${diffB}) → winner=${winner} simTime=${simMin}min ` +
      `ticks=${state.tick} events=${eventCount} built=${built} kills=${kills} wall=${wall}ms`
  );
  return { winner: state.winner, ticks: state.tick, wall };
}

let decided = 0;
const t0 = Date.now();
for (let m = 0; m < MATCHES; m++) {
  const seed = BASE_SEED + m * 101;
  const fa = FACTIONS[m % 3];
  const fb = FACTIONS[(m + 1) % 3];
  const res = runMatch(seed, 'hard', 'medium', fa, fb);
  if (res.winner !== null) decided++;
}
console.log(`\n${decided}/${MATCHES} matches produced a winner in <${MAX_MIN} sim-minutes (${Date.now() - t0}ms total)`);
if (decided === 0) {
  console.error('FAIL: no match reached a decision — AI or combat loop is broken.');
  process.exit(1);
}
console.log('PASS');
