import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/render/sprites.ts', import.meta.url), 'utf8');

assert.match(source, /Seal antialiased diamond edges/);
assert.match(source, /black terrain cache/);
assert.match(source, /baseY - 1\.25/);
assert.match(source, /TILE_W \+ 2/);
assert.match(source, /rgba\(255,255,255,0\.065\)/);
assert.match(source, /const stain = ctx\.createRadialGradient/);
assert.match(source, /rgba\(5, 10, 18, 0\.62\)/);
assert.match(source, /#2e2351/);
assert.match(source, /const n = 4 \+ variant/);
assert.match(source, /const n = 2 \+ \(variant % 2\)/);
assert.match(source, /#123f25/);
assert.match(source, /#3a403f/);

console.log('PASS terrain visuals');
