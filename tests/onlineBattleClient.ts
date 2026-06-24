import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/ui/menu.ts', import.meta.url), 'utf8');

assert.match(source, /createRoomClient/);
assert.match(source, /type RoomClient/);
assert.match(source, /let roomClient: RoomClient \| null = null/);
assert.match(source, /roomClient = createRoomClient\(ws,/);
assert.match(source, /roomClient\.connect\(\)/);
assert.match(source, /roomClient\?\.hello\(/);
assert.match(source, /roomClient\?\.ready\(true\)/);
assert.match(source, /case 'welcome'/);
assert.match(source, /case 'room'/);
assert.match(source, /Connected to room/);
assert.match(source, /players\.length/);

console.log('PASS online battle client');
