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
assert.match(source, /js-online-roster/);
assert.match(source, /renderOnlineRoster/);
assert.match(source, /pa-online-player/);
assert.match(source, /READY/);
assert.match(source, /WAITING/);
assert.match(source, /js-online-chat-log/);
assert.match(source, /js-online-chat-send/);
assert.match(source, /roomClient\.chat\(text\)/);
assert.match(source, /case 'chat'/);
assert.match(source, /renderOnlineChatLine/);
assert.match(source, /Commander chat online/);
assert.match(source, /js-online-start/);
assert.match(source, /Start Room Match/);
assert.match(source, /roomClient\.start\(code\)/);
assert.match(source, /case 'start'/);
assert.match(source, /this\.applyBattleCode\(msg\.battleCode\)/);
assert.match(source, /this\.launch\(onlineConnection, roomPlayers, roomClientId\)/);
assert.match(source, /buildCrystalRushPlayers\(onlinePlayers\?: RoomPlayer\[], localClientId\?: string \| null\)/);
assert.match(source, /isHuman: player\.id === localClientId/);
assert.match(source, /difficulty: null/);
assert.match(source, /Online AI/);

console.log('PASS online battle client');
