import assert from 'node:assert/strict';
import type { Command } from '../src/core/types';
import { createOnlineCommandQueue } from '../src/net/onlineCommands';

const sent: { tick: number; commands: Command[] }[] = [];
const queue = createOnlineCommandQueue({
  inputDelayTicks: 6,
  sendFrame: (tick, commands) => sent.push({ tick, commands }),
});

const local: Command = { type: 'crystalRushDeployWave', player: 0, stance: 'split' };
assert.deepEqual(queue.dispatchLocal(100, local), []);
assert.deepEqual(sent, [{ tick: 106, commands: [local] }]);
assert.deepEqual(queue.drain(105), []);
assert.deepEqual(queue.drain(106), [local]);
assert.deepEqual(queue.drain(106), []);

const remote: Command = { type: 'crystalRushBuyUpgrade', player: 1, upgrade: 'waves' };
queue.receiveFrame({ tick: 112, commands: [remote] });
assert.deepEqual(queue.drain(111), []);
assert.deepEqual(queue.drain(112), [remote]);

console.log('PASS online command queue');
