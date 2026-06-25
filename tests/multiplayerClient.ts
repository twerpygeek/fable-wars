import assert from 'node:assert/strict';
import { createRoomClient, type WebSocketLike } from '../src/net/client';
import type { ServerRoomMessageEnvelope } from '../src/net/protocol';

class FakeSocket implements WebSocketLike {
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.onclose?.();
  }
}

const activeSocket = new FakeSocket();
const received: ServerRoomMessageEnvelope[] = [];
const statuses: string[] = [];
const errors: string[] = [];
const client = createRoomClient('wss://rooms.example.test/rooms/FW-TEST', {
  socketFactory: () => activeSocket,
  onMessage: (msg) => received.push(msg),
  onStatus: (status) => statuses.push(status),
  onError: (message) => errors.push(message),
});

client.connect();
assert.deepEqual(statuses, ['connecting']);
activeSocket.onopen?.();
assert.deepEqual(statuses, ['connecting', 'open']);

client.hello({ name: 'Ian', faction: 'verdant', colorIdx: 3 });
client.ready(true);
client.start('FW1-seed');
client.commandFrame(180, [{ type: 'crystalRushDeployWave', player: 0 }]);
client.stateCheck(240, 'deadbeef');
client.chat(' push center ');

assert.deepEqual(
  activeSocket.sent.map((msg: string) => JSON.parse(msg)),
  [
    { v: 1, type: 'hello', name: 'Ian', faction: 'verdant', colorIdx: 3 },
    { v: 1, type: 'ready', ready: true },
    { v: 1, type: 'start', battleCode: 'FW1-seed' },
    { v: 1, type: 'command', tick: 180, commands: [{ type: 'crystalRushDeployWave', player: 0 }] },
    { v: 1, type: 'stateCheck', tick: 240, hash: 'deadbeef' },
    { v: 1, type: 'chat', text: 'push center' },
  ],
);

activeSocket.onmessage?.({ data: JSON.stringify({ v: 1, type: 'welcome', clientId: 'abc', room: 'FW-TEST' }) });
activeSocket.onmessage?.({ data: JSON.stringify({ v: 1, type: 'room', room: 'FW-TEST', players: [] }) });
activeSocket.onmessage?.({ data: JSON.stringify({ v: 1, type: 'stateCheck', from: 'peer', at: 1234, tick: 240, hash: 'deadbeef' }) });
activeSocket.onmessage?.({ data: JSON.stringify({ v: 2, type: 'room', room: 'FW-TEST', players: [] }) });
activeSocket.onmessage?.({ data: 'not-json' });

assert.equal(received.length, 3);
assert.deepEqual(received[0], { v: 1, type: 'welcome', clientId: 'abc', room: 'FW-TEST' });
assert.deepEqual(received[2], { v: 1, type: 'stateCheck', from: 'peer', at: 1234, tick: 240, hash: 'deadbeef' });
assert.deepEqual(errors, ['Ignored unsupported room message.', 'Invalid room message JSON.']);

client.close();
assert.equal(activeSocket.closed, true);
assert.deepEqual(statuses, ['connecting', 'open', 'closed']);

console.log('PASS multiplayer client');
