import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const typesSource = readFileSync(new URL('../src/core/types.ts', import.meta.url), 'utf8');
const simSource = readFileSync(new URL('../src/sim/modes/crystalRush.ts', import.meta.url), 'utf8');
const effectsSource = readFileSync(new URL('../src/render/effects.ts', import.meta.url), 'utf8');
const audioSource = readFileSync(new URL('../src/audio/audio.ts', import.meta.url), 'utf8');

assert.match(typesSource, /crystalRushSurge/);
assert.match(simSource, /type: 'crystalRushSurge'/);
assert.match(effectsSource, /case 'crystalRushSurge'/);
assert.match(effectsSource, /War Surge command feedback/);
assert.match(audioSource, /case 'crystalRushSurge'/);

console.log('PASS Crystal Rush feedback');
