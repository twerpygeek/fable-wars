import assert from 'node:assert/strict';
import type { UIState } from '../src/core/types';
import { DATA } from '../src/data/index';
import { createGame } from '../src/sim/game';
import { spawnBuilding } from '../src/sim/entity';
import { TICK_RATE } from '../src/core/constants';
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
  for (const e of state.entities.values()) {
    const def = DATA.units[e.defId];
    if (e.kind === 'unit' && e.owner === 0 && def?.harvester !== undefined) {
      e.hp = 0;
    }
  }
  const p = state.players[0];
  p.queues.vehicle.items.push('scorch_basalt_ram');
  const msg = getGuidance(state, DATA, 0, ui({ selection: [1] }));
  assert.equal(msg?.id, 'rebuild-harvester');
}

{
  const state = game();
  const p = state.players[0];
  p.queues.structure.items.push('scorch_power', 'scorch_refinery');
  const msg = getGuidance(state, DATA, 0, ui({ selection: [1] }));
  assert.equal(msg?.id, 'build-barracks');
}

{
  const state = game();
  const p = state.players[0];
  const start = state.map.startPositions[0];
  spawnBuilding(state, DATA, 'scorch_power', p.id, { x: start.x + 6, y: start.y });
  spawnBuilding(state, DATA, 'scorch_refinery', p.id, { x: start.x + 10, y: start.y });
  spawnBuilding(state, DATA, 'scorch_barracks', p.id, { x: start.x + 12, y: start.y });
  p.credits = 2500;
  const msg = getGuidance(state, DATA, 0, ui({ selection: [1] }));
  assert.equal(msg?.id, 'spend-bank');
}

{
  const state = game();
  state.tick = TICK_RATE * 61;
  const msg = getGuidance(state, DATA, 0, ui({ selection: [1] }));
  assert.equal(msg, null);
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
