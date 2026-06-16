import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/ui/menu.ts', import.meta.url), 'utf8');

assert.match(source, /crystal-rush-gameplay-preview\.png/);
assert.match(source, /classic-rts-gameplay-preview\.png/);
assert.match(source, /modePreview/);
assert.match(source, /Watch Trailer/);
assert.match(source, /showTrailer/);

console.log('PASS menu visuals');
