// Driver: generate sprites with Seedream, key out the background, place into
// public/sprites/, and register them in the manifest.
//
// Usage:
//   node scripts/gen.mjs --test                 # small diverse batch
//   node scripts/gen.mjs --units                # all 41 creatures
//   node scripts/gen.mjs --buildings            # all 45 structures
//   node scripts/gen.mjs scorch_ryhorrn tide_krabber   # specific ids
//   node scripts/gen.mjs --units --concurrency 4
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { loadEnv, generate, saveB64 } from './seedream.mjs';
import { buildUnitPrompts, buildBuildingPrompts } from './sprites.config.mjs';

const UNIT_PROMPTS = buildUnitPrompts();
const BUILDING_PROMPTS = buildBuildingPrompts();

const TEST_IDS = [
  'scorch_charmandar', // basic infantry / flame glow
  'scorch_peekachoo', // electric sparks, yellow
  'tide_squirtul', // water faction
  'verdant_bulbasore', // grass faction
  'tide_krabber', // harvester + pink/cyan crystals
  'scorch_ryhorrn', // GREY creature on grey bg — keying stress test
  'scorch_conyard', // building style check
];

const args = process.argv.slice(2);
let concurrency = 3;
const ci = args.indexOf('--concurrency');
if (ci >= 0) concurrency = parseInt(args[ci + 1], 10) || 3;

let ids = [];
if (args.includes('--test')) ids = TEST_IDS;
if (args.includes('--units')) ids.push(...Object.keys(UNIT_PROMPTS));
if (args.includes('--buildings')) ids.push(...Object.keys(BUILDING_PROMPTS));
ids.push(...args.filter((a) => UNIT_PROMPTS[a] || BUILDING_PROMPTS[a]));
ids = [...new Set(ids)];
const skipExisting = args.includes('--skip-existing');
if (!ids.length) {
  console.error('No ids selected. Use --test, --units, --buildings, or explicit ids.');
  process.exit(1);
}

const env = loadEnv();
const apiKey = env.BYTEPLUS_MODELARK_API_KEY;
mkdirSync('tmp/raw', { recursive: true });
mkdirSync('public/sprites/units', { recursive: true });
mkdirSync('public/sprites/buildings', { recursive: true });

function kind(id) {
  return UNIT_PROMPTS[id] ? 'unit' : 'building';
}
function prompt(id) {
  return UNIT_PROMPTS[id] || BUILDING_PROMPTS[id];
}
function outPath(id) {
  return kind(id) === 'unit'
    ? `public/sprites/units/${id}_s_0.png`
    : `public/sprites/buildings/${id}.png`;
}

if (skipExisting) {
  const before = ids.length;
  ids = ids.filter((id) => !existsSync(outPath(id)));
  console.log(`--skip-existing: ${before - ids.length} already present, ${ids.length} to generate.`);
}

async function genOne(id, attempt = 1) {
  const raw = `tmp/raw/${id}.png`;
  try {
    const json = await generate({ apiKey, prompt: prompt(id) });
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) throw new Error('no image: ' + JSON.stringify(json).slice(0, 300));
    saveB64(b64, raw);
    const size = kind(id) === 'unit' ? '256' : '384';
    execFileSync('python3', ['scripts/process_sprite.py', raw, outPath(id), size, 'bottom'], {
      stdio: 'pipe',
    });
    console.log(`✓ ${id} -> ${outPath(id)}`);
    return { id, ok: true };
  } catch (e) {
    const msg = String(e.message || e).slice(0, 200);
    if (attempt < 3) {
      console.log(`… retry ${id} (attempt ${attempt + 1}): ${msg}`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
      return genOne(id, attempt + 1);
    }
    console.log(`✗ ${id} FAILED: ${msg}`);
    return { id, ok: false, error: msg };
  }
}

async function run() {
  console.log(`Generating ${ids.length} sprite(s), concurrency ${concurrency}\n`);
  const results = [];
  const queue = [...ids];
  async function worker() {
    while (queue.length) {
      const id = queue.shift();
      results.push(await genOne(id));
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));

  // Register successes in the manifest.
  const mpath = 'public/sprites/manifest.json';
  const manifest = JSON.parse(readFileSync(mpath, 'utf8'));
  manifest.units ||= {};
  manifest.buildings ||= [];
  for (const r of results) {
    if (!r.ok) continue;
    if (kind(r.id) === 'unit') {
      manifest.units[r.id] = { facings: ['s'], frames: 1 };
    } else if (!manifest.buildings.includes(r.id)) {
      manifest.buildings.push(r.id);
    }
  }
  manifest.buildings.sort();
  writeFileSync(mpath, JSON.stringify(manifest, null, 2) + '\n');

  const ok = results.filter((r) => r.ok).length;
  console.log(`\nDone: ${ok}/${results.length} succeeded. Manifest updated.`);
  const failed = results.filter((r) => !r.ok);
  if (failed.length) console.log('Failed:', failed.map((f) => f.id).join(', '));
}

run();
