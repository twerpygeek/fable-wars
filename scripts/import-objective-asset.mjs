#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const [, , id, source, ...flags] = process.argv;
if (!id || !source) {
  console.error('Usage: node scripts/import-objective-asset.mjs <objective_id> <source.png> [--chroma]');
  process.exit(1);
}

const src = resolve(source);
if (!existsSync(src)) {
  console.error(`Missing source image: ${src}`);
  process.exit(1);
}

const out = resolve(`public/sprites/objectives/${id}.png`);
mkdirSync(dirname(out), { recursive: true });

if (flags.includes('--chroma')) {
  const tmp = resolve(`tmp/${id}-objective-keyed.png`);
  mkdirSync(dirname(tmp), { recursive: true });
  const helper = resolve(`${process.env.CODEX_HOME ?? `${process.env.HOME}/.codex`}/skills/.system/imagegen/scripts/remove_chroma_key.py`);
  execFileSync('python3', [
    helper,
    '--input',
    src,
    '--out',
    tmp,
    '--auto-key',
    'border',
    '--soft-matte',
    '--transparent-threshold',
    '12',
    '--opaque-threshold',
    '220',
    '--despill',
  ]);
  renameSync(tmp, out);
} else {
  copyFileSync(src, out);
}

const manifestPath = resolve('public/sprites/manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.objectives = Array.from(new Set([...(manifest.objectives ?? []), id])).sort();
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Imported objective sprite: ${out}`);
