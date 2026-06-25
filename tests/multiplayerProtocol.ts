import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createChatMessage,
  createClientHello,
  createCommandFrame,
  createReadyMessage,
  createStartMessage,
  createStateCheckMessage,
  isClientRoomMessage,
  PROTOCOL_VERSION,
} from '../src/net/protocol';

assert.equal(PROTOCOL_VERSION, 1);
assert.deepEqual(createClientHello({ name: 'Ian', faction: 'tide', colorIdx: 2 }), {
  v: 1,
  type: 'hello',
  name: 'Ian',
  faction: 'tide',
  colorIdx: 2,
});
assert.deepEqual(createReadyMessage(true), { v: 1, type: 'ready', ready: true });
assert.deepEqual(createStartMessage('FW1-test'), { v: 1, type: 'start', battleCode: 'FW1-test' });
assert.deepEqual(createCommandFrame(240, [{ type: 'crystalRushDeployWave', player: 0 }]), {
  v: 1,
  type: 'command',
  tick: 240,
  commands: [{ type: 'crystalRushDeployWave', player: 0 }],
});
assert.deepEqual(createStateCheckMessage(360, 'a1b2c3d4'), {
  v: 1,
  type: 'stateCheck',
  tick: 360,
  hash: 'a1b2c3d4',
});
assert.equal(createChatMessage('  rally at crystal\nnow  ').text, 'rally at crystal now');

assert.equal(isClientRoomMessage({ v: 1, type: 'ready', ready: false }), true);
assert.equal(isClientRoomMessage({ type: 'ready', ready: false }), false);
assert.equal(isClientRoomMessage({ v: 2, type: 'ready', ready: false }), false);
assert.equal(isClientRoomMessage({ v: 1, type: 'command', tick: -1, commands: [] }), false);
assert.equal(isClientRoomMessage({ v: 1, type: 'stateCheck', tick: 120, hash: 'abc123' }), true);
assert.equal(isClientRoomMessage({ v: 1, type: 'stateCheck', tick: 120.5, hash: 'abc123' }), false);
assert.equal(isClientRoomMessage({ v: 1, type: 'stateCheck', tick: 120, hash: '' }), false);
assert.equal(isClientRoomMessage({ v: 1, type: 'chat', text: '' }), false);

const relaySource = readFileSync(new URL('../realtime/partykit/server.js', import.meta.url), 'utf8');
assert.match(relaySource, /const PROTOCOL_VERSION = 1/);
assert.match(relaySource, /msg\.v !== PROTOCOL_VERSION/);
assert.match(relaySource, /type: 'welcome', v: PROTOCOL_VERSION/);
assert.match(relaySource, /type: 'room'[\s\S]*v: PROTOCOL_VERSION/);

const multiplayerDocs = readFileSync(new URL('../docs/multiplayer.md', import.meta.url), 'utf8');
assert.match(multiplayerDocs, /"v": 1, "type": "hello"/);
assert.match(multiplayerDocs, /"v": 1, "type": "command"[\s\S]*"commands"/);
assert.match(multiplayerDocs, /"v": 1, "type": "stateCheck"[\s\S]*"hash"/);

console.log('PASS multiplayer protocol');
