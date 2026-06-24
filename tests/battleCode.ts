import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/ui/menu.ts', import.meta.url), 'utf8');

assert.match(source, /interface BattleCodePayload/);
assert.match(source, /function encodeBattleCode/);
assert.match(source, /function decodeBattleCode/);
assert.match(source, /FW1-/);
assert.match(source, /pa-battle-code/);
assert.match(source, /Copy Code/);
assert.match(source, /Share this setup with a friend/);
assert.match(source, /battleInviteUrl/);
assert.match(source, /params\.get\('battle'\)/);
assert.match(source, /Copy Invite shares this exact faction, map, seed/);

console.log('PASS battle code');
