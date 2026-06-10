// Balance matrix: difficulty ordering (hard > medium > easy) and faction
// fairness (mirror + cross matchups at equal difficulty).
// Usage: npx tsx tests/balance.ts [--reps 2] [--maxMin 35]
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
const REPS = argNum('reps', 2);
const MAX_MIN = argNum('maxMin', 35);

const F: FactionId[] = ['scorch', 'tide', 'verdant'];

function run(seed: number, a: { f: FactionId; d: AIDifficulty }, b: { f: FactionId; d: AIDifficulty }) {
  const config: GameConfig = {
    seed,
    mapSize: 'M',
    waterAmount: 'medium',
    players: [
      { faction: a.f, isHuman: false, difficulty: a.d, colorIdx: 0, name: 'A' },
      { faction: b.f, isHuman: false, difficulty: b.d, colorIdx: 1, name: 'B' },
    ],
  };
  const state = createGame(config, DATA);
  const maxTicks = MAX_MIN * 60 * TICK_RATE;
  while (state.winner === null && state.tick < maxTicks) {
    const commands: Command[] = [];
    for (const p of state.players) {
      if (p.eliminated || !p.difficulty) continue;
      if (state.tick % AI_THINK_INTERVAL[p.difficulty] === (p.id * 3) % AI_THINK_INTERVAL[p.difficulty]) {
        commands.push(...aiThink(state, DATA, p.id));
      }
    }
    tickGame(state, DATA, commands);
  }
  return { winner: state.winner, min: state.tick / TICK_RATE / 60 };
}

function series(label: string, mk: (rep: number) => [{ f: FactionId; d: AIDifficulty }, { f: FactionId; d: AIDifficulty }]) {
  let aWins = 0;
  let bWins = 0;
  let draws = 0;
  let totMin = 0;
  for (let r = 0; r < REPS; r++) {
    const [a, b] = mk(r);
    // alternate sides to cancel positional bias
    const swap = r % 2 === 1;
    const res = run(4321 + r * 271, swap ? b : a, swap ? a : b);
    totMin += res.min;
    if (res.winner === null) draws++;
    else if ((res.winner === 0) !== swap) aWins++;
    else bWins++;
  }
  console.log(`${label.padEnd(34)} A:${aWins} B:${bWins} draws:${draws} avg ${(totMin / REPS).toFixed(1)}min`);
  return { aWins, bWins, draws };
}

console.log(`reps per series: ${REPS}\n`);
console.log('--- difficulty ordering (mirror factions) ---');
let hardOk = 0;
let medOk = 0;
for (const f of F) {
  const r1 = series(`${f} hard vs ${f} medium`, () => [{ f, d: 'hard' }, { f, d: 'medium' }]);
  hardOk += r1.aWins;
  const r2 = series(`${f} medium vs ${f} easy`, () => [{ f, d: 'medium' }, { f, d: 'easy' }]);
  medOk += r2.aWins;
}
console.log('\n--- faction fairness (hard vs hard) ---');
const fw: Record<FactionId, number> = { scorch: 0, tide: 0, verdant: 0 };
for (let i = 0; i < F.length; i++) {
  for (let j = i + 1; j < F.length; j++) {
    const r = series(`${F[i]} vs ${F[j]} (both hard)`, () => [{ f: F[i], d: 'hard' }, { f: F[j], d: 'hard' }]);
    fw[F[i]] += r.aWins;
    fw[F[j]] += r.bWins;
  }
}
console.log(`\nfaction wins (hard mirror-cross): ${JSON.stringify(fw)}`);
console.log(`hard beat medium in ${hardOk}/${REPS * 3}; medium beat easy in ${medOk}/${REPS * 3}`);
