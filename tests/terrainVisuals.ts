import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/render/sprites.ts', import.meta.url), 'utf8');

assert.match(source, /Seal antialiased diamond edges/);
assert.match(source, /black terrain cache/);
assert.match(source, /baseY - 1\.25/);
assert.match(source, /TILE_W \+ 2/);
assert.match(source, /rgba\(255,255,255,0\.065\)/);
assert.match(source, /const stain = ctx\.createRadialGradient/);
assert.match(source, /rgba\(2, 6, 10, 0\.74\)/);
assert.match(source, /#22203a/);
assert.match(source, /const n = 3 \+ variant/);
assert.match(source, /const n = 3 \+ \(variant % 2\)/);
assert.match(source, /ctx\.bezierCurveTo/);
assert.match(source, /#0e3726/);
assert.match(source, /#23292b/);

console.log('PASS terrain visuals');
