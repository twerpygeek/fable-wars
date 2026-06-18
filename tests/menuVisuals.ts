import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/ui/menu.ts', import.meta.url), 'utf8');

assert.match(source, /crystal-rush-gameplay-preview\.png/);
assert.match(source, /classic-rts-gameplay-preview\.png/);
assert.match(source, /modePreview/);
assert.match(source, /pa-choice-section/);
assert.match(source, /Choose Army/);
assert.match(source, /Choose Battle/);
assert.match(source, /Harvest crystals/);
assert.match(source, /Fantasy browser RTS/);
assert.match(source, /iangoh\.com/);
assert.match(source, /github\.com\/iangoh/);
assert.match(source, /href="https:\/\/iangoh\.com"/);
assert.match(source, /href="https:\/\/github\.com\/iangoh"/);
assert.doesNotMatch(source, /Browser RTS prototype/);
assert.doesNotMatch(source, /Hero video online/);
assert.match(source, /Watch Trailer/);
assert.match(source, /showTrailer/);
assert.match(source, /TRAILERS/);
assert.match(source, /fable-wars-cinematic-trailer\.mp4/);
assert.match(source, /pa-trailer-tab/);
assert.match(source, /FACTION_CLASS_STATS/);
assert.match(source, /paintFactions/);
assert.match(source, /paintLobbyFactions/);
assert.match(source, /factionStatBars/);
assert.match(source, /pa-faction-stat/);
assert.match(source, /Assault/);
assert.equal(existsSync(new URL('../public/media/fable-wars-cinematic-trailer.mp4', import.meta.url)), true);
assert.equal(existsSync(new URL('../public/media/fable-wars-cinematic-trailer-poster.jpg', import.meta.url)), true);

console.log('PASS menu visuals');
