import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/render/sprites.ts', import.meta.url), 'utf8');

assert.match(source, /Seal antialiased diamond edges/);
assert.match(source, /black terrain cache/);
assert.match(source, /baseY - 1\.25/);
assert.match(source, /TILE_W \+ 2/);
assert.match(source, /rgba\(255,255,255,0\.065\)/);

console.log('PASS terrain visuals');
