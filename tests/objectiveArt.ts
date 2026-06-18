import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const spritesSource = readFileSync(new URL('../src/render/sprites.ts', import.meta.url), 'utf8');
const rendererSource = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
const importerSource = readFileSync(new URL('../scripts/import-objective-asset.mjs', import.meta.url), 'utf8');

assert.match(spritesSource, /objectives: Map<string, HTMLImageElement>/);
assert.match(spritesSource, /getObjectiveSprite\(key: string\)/);
assert.ok(spritesSource.includes('objectives/${id}.png'));
assert.match(rendererSource, /getObjectiveSprite\('central_crystal'\)/);
assert.match(rendererSource, /canvas crystal fallback|const h = 132 \* z/);
assert.match(importerSource, /manifest\.objectives/);
assert.match(importerSource, /remove_chroma_key\.py/);

console.log('PASS objective art');
