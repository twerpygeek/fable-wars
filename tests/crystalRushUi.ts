import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const panelSource = readFileSync(new URL('../src/ui/crystalRushPanel.ts', import.meta.url), 'utf8');

assert.match(panelSource, /War Surge/);
assert.match(panelSource, /getCrystalRushManualWaveCount/);
assert.match(panelSource, /units ·/);
assert.match(panelSource, /spend crystals to surge/);

console.log('PASS Crystal Rush UI');
