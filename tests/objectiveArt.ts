import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';

const spritesSource = readFileSync(new URL('../src/render/sprites.ts', import.meta.url), 'utf8');
const rendererSource = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
const importerSource = readFileSync(new URL('../scripts/import-objective-asset.mjs', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../public/sprites/manifest.json', import.meta.url), 'utf8')) as {
  objectives?: string[];
};
const crystalPath = new URL('../public/sprites/objectives/central_crystal.png', import.meta.url);
const crystal = readFileSync(crystalPath);
const crystalStats = statSync(crystalPath);

assert.match(spritesSource, /objectives: Map<string, HTMLImageElement>/);
assert.match(spritesSource, /getObjectiveSprite\(key: string\)/);
assert.ok(spritesSource.includes('objectives/${id}.png'));
assert.match(rendererSource, /getObjectiveSprite\('central_crystal'\)/);
assert.match(rendererSource, /canvas crystal fallback|const h = 132 \* z/);
assert.match(importerSource, /manifest\.objectives/);
assert.match(importerSource, /remove_chroma_key\.py/);
assert.ok(manifest.objectives?.includes('central_crystal'));
assert.deepEqual([...crystal.subarray(1, 4)].map((v) => String.fromCharCode(v)).join(''), 'PNG');
assert.equal(crystal.readUInt32BE(16), 768);
assert.ok(crystal.readUInt32BE(20) <= 768);
assert.ok(crystalStats.size < 800_000);

console.log('PASS objective art');
