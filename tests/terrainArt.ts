import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const spritesSource = readFileSync(new URL('../src/render/sprites.ts', import.meta.url), 'utf8');

assert.match(spritesSource, /function sanitizeTerrainPropOverride/);
assert.match(spritesSource, /isMagentaChroma/);
assert.match(spritesSource, /sanitizeTerrainPropOverride\(img\)/);
assert.match(
  spritesSource,
  /t === Terrain\.CRYSTAL \|\| t === Terrain\.ROCK \|\| t === Terrain\.TREE/,
  'terrain resources should be treated as prop cutouts over seamless base terrain',
);

console.log('PASS terrain art');
