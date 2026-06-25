import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const menuSource = readFileSync(new URL('../src/ui/menu.ts', import.meta.url), 'utf8');
const queueSource = readFileSync(new URL('../src/net/onlineCommands.ts', import.meta.url), 'utf8');
const crystalRushSource = readFileSync(new URL('../src/sim/modes/crystalRush.ts', import.meta.url), 'utf8');

assert.match(queueSource, /export interface OnlineMatchConnection/);
assert.match(queueSource, /onCommandFrame\(handler/);
assert.match(queueSource, /sendStateCheck\(tick: number, hash: string\)/);
assert.match(queueSource, /onStateCheck\(handler: \(check: OnlineStateCheck\) => void\)/);
assert.match(menuSource, /OnlineMatchConnection/);
assert.match(menuSource, /commandHandlers/);
assert.match(menuSource, /onCommandFrame\(handler\)/);
assert.match(menuSource, /this\.launch\(onlineConnection, roomPlayers, roomClientId\)/);
assert.match(menuSource, /case 'command'/);
assert.match(menuSource, /let roomClientId: string \| null = null/);
assert.match(menuSource, /roomClientId = msg\.clientId/);
assert.match(menuSource, /msg\.from !== roomClientId/);
assert.match(mainSource, /createOnlineCommandQueue/);
assert.match(mainSource, /online\?: OnlineMatchConnection/);
assert.match(mainSource, /onlineQueue\.dispatchLocal\(state\.tick, c\)/);
assert.match(mainSource, /onlineQueue\.receiveFrame\(frame\)/);
assert.match(mainSource, /pending\.push\(\.\.\.onlineQueue\.drain\(state\.tick\)\)/);
assert.match(mainSource, /hashGameState\(state\)/);
assert.match(mainSource, /online\.sendStateCheck\(state\.tick, hashGameState\(state\)\)/);
assert.match(mainSource, /Online desync warning/);
assert.match(crystalRushSource, /!p\.isHuman && p\.difficulty/);

console.log('PASS online match bridge');
