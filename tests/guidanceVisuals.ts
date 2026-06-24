import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const guidanceSource = readFileSync(new URL('../src/ui/guidance.ts', import.meta.url), 'utf8');
const hudSource = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');

assert.match(guidanceSource, /action: string/);
assert.match(hudSource, /pa-guide-action/);
assert.match(hudSource, /guideActionEl/);
assert.match(hudSource, /guide\.action/);

console.log('PASS guidance visuals');
