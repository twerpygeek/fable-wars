import { inflateSync } from 'node:zlib';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;

const bannedTerms = [
  'charmandar',
  'peekachoo',
  'magmarr',
  'prof. cinder',
  'prof cinder',
  'torkoala',
  'ryhorrn',
  'arcanyne',
  'magnetonn',
  'groudonn',
  'zubattler',
  'moltrez',
  'magcarggo',
  'slugmariner',
  'squirtul',
  'horsean',
  'polywrath',
  'prof. brine',
  'prof brine',
  'krabber',
  'vaporeonix',
  'blastoyse',
  'starmiez',
  'kyogrre',
  'wingullet',
  'pelipperator',
  'tentacrush',
  'sharpeedo',
  'gyarrados',
  'bulbasore',
  'beedrillz',
  'oddishooter',
  'scytherr',
  'prof. oakley',
  'prof oakley',
  'torterrar',
  'sceptilash',
  'venosore',
  'tanglevine',
  'snorlux',
  'pidgeottoh',
  'butterfrei',
  'lotadder',
  'ludicolossus',
  'pokemon',
];

const scannedRoots = ['src', 'public/sprites/manifest.json', 'scripts', 'SPRITES.md', 'DESIGN.md', 'ARCHITECTURE.md'];
const textExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.json', '.md']);
const spritesSource = readFileSync(join(root, 'src/render/sprites.ts'), 'utf8');

function listFiles(path: string, out: string[] = []): string[] {
  const absolute = join(root, path);
  const stat = statSync(absolute);
  if (stat.isFile()) return [...out, absolute];
  for (const entry of readdirSync(absolute)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'tmp') continue;
    listFiles(join(path, entry), out);
  }
  return out;
}

const offenders: string[] = [];
for (const scanRoot of scannedRoots) {
  for (const file of listFiles(scanRoot)) {
    if (!textExtensions.has(file.slice(file.lastIndexOf('.')))) continue;
    const text = readFileSync(file, 'utf8').toLowerCase();
    for (const term of bannedTerms) {
      if (text.includes(term)) offenders.push(`${relative(root, file)} contains ${term}`);
    }
  }
}

if (offenders.length > 0) {
  throw new Error(`Old parody character identity still appears:\n${offenders.join('\n')}`);
}

interface Png {
  width: number;
  height: number;
  data: Buffer;
}

function readPng(path: string): Png {
  const bytes = readFileSync(path);
  if (bytes.toString('ascii', 1, 4) !== 'PNG') throw new Error(`${path} is not a PNG`);
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      const colorType = data[9];
      if (bitDepth !== 8 || colorType !== 6) throw new Error(`${path} must be 8-bit RGBA`);
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const data = Buffer.alloc(width * height * 4);
  let input = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[input++];
    const row = data.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? row[x - 4] : 0;
      const up = y > 0 ? data[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= 4 ? data[(y - 1) * stride + x - 4] : 0;
      const value = raw[input++];
      if (filter === 0) row[x] = value;
      else if (filter === 1) row[x] = (value + left) & 255;
      else if (filter === 2) row[x] = (value + up) & 255;
      else if (filter === 3) row[x] = (value + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        row[x] = (value + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)) & 255;
      } else {
        throw new Error(`Unsupported PNG filter ${filter}`);
      }
    }
  }
  return { width, height, data };
}

for (const file of readdirSync(join(root, 'public/sprites/buildings'))) {
  if (!file.endsWith('.png')) continue;
  const png = readPng(join(root, 'public/sprites/buildings', file));
  let haloPixels = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i];
    const g = png.data[i + 1];
    const b = png.data[i + 2];
    const a = png.data[i + 3];
    if (a > 16 && a < 235 && r > 220 && g > 220 && b > 220) haloPixels++;
  }
  if (haloPixels > 40) {
    throw new Error(`${file} has ${haloPixels} semi-transparent white matte pixels`);
  }
}

if (!/function sanitizeBuildingOverride/.test(spritesSource)) {
  throw new Error('building overrides must be sanitized before drawing so white cutout mattes do not render in game');
}
if (!/sanitizeBuildingOverride\(ovImg\)/.test(spritesSource)) {
  throw new Error('constructed building overrides should use sanitizeBuildingOverride(ovImg) before scaling');
}

{
  const png = readPng(join(root, 'public/sprites/buildings/verdant_power.png'));
  let nearWhiteBlobPixels = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i];
    const g = png.data[i + 1];
    const b = png.data[i + 2];
    const a = png.data[i + 3];
    if (a > 70 && r > 212 && g > 212 && b > 212 && Math.max(r, g, b) - Math.min(r, g, b) < 34) {
      nearWhiteBlobPixels++;
    }
  }
  if (nearWhiteBlobPixels > 20) {
    throw new Error(`verdant_power.png has ${nearWhiteBlobPixels} near-white matte pixels`);
  }
}

console.log('art identity checks passed');
