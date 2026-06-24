import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const spritesSource = readFileSync(new URL('../src/render/sprites.ts', import.meta.url), 'utf8');

assert.match(spritesSource, /function sanitizeTerrainPropOverride/);
assert.match(spritesSource, /isMagentaChroma/);
assert.match(spritesSource, /sanitizeTerrainPropOverride\(img\)/);
assert.match(spritesSource, /function drawTerrainPropContactShadow/);
assert.match(
  spritesSource,
  /t === Terrain\.CRYSTAL \|\| t === Terrain\.ROCK \|\| t === Terrain\.TREE/,
  'terrain resources should be treated as prop cutouts over seamless base terrain',
);
assert.match(
  spritesSource,
  /ctx\.drawImage\(base[\s\S]*drawTerrainPropContactShadow\([\s\S]*ctx\.drawImage\(prop/,
  'terrain prop cutouts should be grounded by a contact shadow before the prop is drawn',
);

console.log('PASS terrain art');
