import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  homepage?: string;
  repository?: { url?: string };
  bugs?: { url?: string };
};

assert.match(readme, /public\/brand\/fable-wars-logo-alpha\.png/);
assert.match(readme, /public\/social\/fable-wars-og\.jpg/);
assert.match(readme, /public\/art\/classic-rts-gameplay-preview\.png/);
assert.match(readme, /public\/art\/crystal-rush-gameplay-preview\.png/);
assert.match(readme, /public\/media\/fable-wars-cinematic-trailer-poster\.jpg/);
assert.match(readme, /https:\/\/fablewars\.vercel\.app\//);
assert.match(readme, /https:\/\/github\.com\/twerpygeek\/fable-wars/);
assert.match(readme, /https:\/\/iangoh\.com/);
assert.equal(pkg.homepage, 'https://fablewars.vercel.app/');
assert.equal(pkg.repository?.url, 'https://github.com/twerpygeek/fable-wars.git');
assert.equal(pkg.bugs?.url, 'https://github.com/twerpygeek/fable-wars/issues');

for (const asset of [
  '../public/brand/fable-wars-logo-alpha.png',
  '../public/social/fable-wars-og.jpg',
  '../public/art/classic-rts-gameplay-preview.png',
  '../public/art/crystal-rush-gameplay-preview.png',
  '../public/media/fable-wars-cinematic-trailer-poster.jpg',
]) {
  assert.equal(existsSync(new URL(asset, import.meta.url)), true, `Missing README asset: ${asset}`);
}

console.log('PASS README collateral');
