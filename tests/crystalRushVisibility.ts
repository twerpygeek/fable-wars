import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DATA } from '../src/data/index';
import type { Camera, GameConfig } from '../src/core/types';
import { createGame } from '../src/sim/game';
import { CRYSTAL_RUSH_MIN_ZOOM, fitCameraToTiles, MIN_ZOOM } from '../src/render/camera';

const cfg: GameConfig = {
  mode: 'crystalRush',
  seed: 93713,
  mapSize: 'M',
  waterAmount: 'low',
  crates: false,
  players: [
    { faction: 'scorch', isHuman: true, difficulty: 'medium', colorIdx: 0, name: 'Human Commander' },
    { faction: 'tide', isHuman: false, difficulty: 'medium', colorIdx: 1, name: 'Tide Rush AI' },
    { faction: 'verdant', isHuman: false, difficulty: 'medium', colorIdx: 2, name: 'Verdant Rush AI' },
    { faction: 'scorch', isHuman: false, difficulty: 'medium', colorIdx: 3, name: 'Gold Rush AI' },
  ],
};

const state = createGame(cfg, DATA);
const cam: Camera = { x: 0, y: 0, zoom: 1 };
fitCameraToTiles(cam, state.map, [state.crystalRush!.objective, ...state.map.startPositions], 1920, 1080, {
  minZoom: CRYSTAL_RUSH_MIN_ZOOM,
  maxZoom: 0.82,
  paddingPx: 260,
});

assert.ok(cam.zoom >= CRYSTAL_RUSH_MIN_ZOOM, 'Crystal Rush tactical view should respect its zoom floor');
assert.ok(cam.zoom < MIN_ZOOM, 'Crystal Rush tactical view should be allowed wider than Classic RTS');

const rendererSource = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
assert.match(rendererSource, /state\.config\.mode === 'crystalRush'\) return;/);

const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
assert.match(mainSource, /fitCameraToTiles\(cam, state\.map, overviewPoints/);
assert.match(mainSource, /new CameraControls\(canvas, cam, \(\) => state\.map, CRYSTAL_RUSH_MIN_ZOOM\)/);

console.log('PASS Crystal Rush visibility');
