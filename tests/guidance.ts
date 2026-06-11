import assert from 'node:assert/strict';
import type { UIState } from '../src/core/types';
import { DATA } from '../src/data/index';
import { createGame } from '../src/sim/game';
import { getGuidance } from '../src/ui/guidance';

function ui(overrides: Partial<UIState> = {}): UIState {
  return {
    selection: [],
    controlGroups: {},
    placingDefId: null,
    placeValid: false,
    sellMode: false,
    repairMode: false,
    targetingSuperweapon: false,
    hoverTile: null,
    dragStart: null,
    dragEnd: null,
    paused: false,
    gameSpeed: 1,
    showMenu: false,
    ...overrides,
  };
}

function game() {
  return createGame(
    {
      seed: 20260611,
      mapSize: 'S',
      waterAmount: 'low',
      crates: false,
      players: [
        { faction: 'scorch', isHuman: true, difficulty: null, colorIdx: 0, name: 'Commander' },
        { faction: 'tide', isHuman: false, difficulty: 'medium', colorIdx: 1, name: 'AI' },
      ],
    },
    DATA,
  );
}

{
  const state = game();
  const msg = getGuidance(state, DATA, 0, ui());
  assert.equal(msg?.id, 'select-start');
  assert.equal(msg?.severity, 'info');
}

{
  const state = game();
  const msg = getGuidance(state, DATA, 0, ui({ selection: [1] }));
  assert.equal(msg?.id, 'build-power');
}

{
  const state = game();
  const p = state.players[0];
  p.queues.structure.items.push('scorch_power');
  const msg = getGuidance(state, DATA, 0, ui({ selection: [1] }));
  assert.equal(msg?.id, 'build-refinery');
}

{
  const state = game();
  const p = state.players[0];
  p.powerProduced = 25;
  p.powerConsumed = 90;
  const msg = getGuidance(state, DATA, 0, ui({ selection: [1] }));
  assert.equal(msg?.id, 'low-power');
  assert.equal(msg?.severity, 'warn');
}

console.log('PASS guidance');
