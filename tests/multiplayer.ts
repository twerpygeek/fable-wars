import assert from 'node:assert/strict';
import { battleInviteUrl, normalizeRoomCode, roomSocketUrl, roomUrl } from '../src/net/multiplayer';

assert.equal(normalizeRoomCode(' fw alpha!! '), 'FWALPHA');
assert.match(normalizeRoomCode(''), /^FW-[A-Z2-9]{5}$/);
assert.equal(roomUrl('fw-test', 'https://fablewars.vercel.app/?x=1'), 'https://fablewars.vercel.app/?x=1&room=FW-TEST');
assert.equal(
  battleInviteUrl('fw-test', 'FW1-abc_DEF', 'https://fablewars.vercel.app/?x=1'),
  'https://fablewars.vercel.app/?x=1&room=FW-TEST&battle=FW1-abc_DEF',
);
assert.equal(roomSocketUrl('fw-test', 'wss://rooms.example.com/'), 'wss://rooms.example.com/rooms/FW-TEST');
assert.equal(roomSocketUrl('fw-test', null), null);

console.log('PASS multiplayer');
