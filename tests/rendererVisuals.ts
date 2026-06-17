import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');

assert.match(source, /drawUnitModelPresence/);
assert.match(source, /brightness\(0\) saturate\(0\)/);
assert.match(source, /brightness\(1\.85\) saturate\(1\.15\)/);
assert.match(source, /Pre-rendered RTS sprites/);

console.log('PASS renderer visuals');
