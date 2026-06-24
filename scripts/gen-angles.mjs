// Generate the 4 extra facings (sw, w, nw, n) for creatures, using the already
// generated front sprite as a reference image so the character stays consistent.
// The engine mirrors w/sw/nw -> e/se/ne automatically, so we only make the left set.
//
// Usage:
//   node scripts/gen-angles.mjs scorch_charmandar tide_squirtul ...
//   node scripts/gen-angles.mjs --test     # the 6 test creatures
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { loadEnv, generate, saveB64 } from './seedream.mjs';
import { buildUnitPrompts } from './sprites.config.mjs';

const UNIT_PROMPTS = buildUnitPrompts();

const TEST_CREATURES = [
  'scorch_charmandar', 'scorch_peekachoo', 'tide_squirtul',
  'verdant_bulbasore', 'tide_krabber', 'scorch_ryhorrn',
];

// Facing -> how to describe the rotation of the SAME character.
const FACINGS = {
  sw: 'turned to face the lower-left, a three-quarter front view from its left side',
  w: 'in a left side profile, its body facing directly to the left',
  nw: 'seen from behind at a three-quarter angle, facing the upper-left, mostly showing its back with its head turned slightly left',
  n: 'seen directly from behind, facing away from the camera, showing the back of its body',
};

const STYLE =
  '3/4 high-angle isometric real-time strategy game camera, dark fantasy pre-rendered ' +
  '3D RTS unit sprite, crisp silhouette, realistic armor mass, upper-left key light, ' +
  'single unit centered, full body, no text, no logo, no ground shadow, plain solid ' +
  'flat uniform light grey background, not cute, not chibi, not mascot-like';

const args = process.argv.slice(2);
const skipExisting = args.includes('--skip-existing');
let ids = [];
if (args.includes('--test')) ids = TEST_CREATURES;
if (args.includes('--units')) ids.push(...Object.keys(UNIT_PROMPTS));
ids.push(...args.filter((a) => UNIT_PROMPTS[a]));
ids = [...new Set(ids)];
if (!ids.length) {
  console.error('No creature ids selected. Use --test, --units, or explicit unit ids.');
  process.exit(1);
}

const env = loadEnv();
const apiKey = env.BYTEPLUS_MODELARK_API_KEY;

function refDataUri(id) {
  // Prefer the raw grey-bg front (full color, same background to replicate).
  const raw = `tmp/raw/${id}.png`;
  const path = existsSync(raw) ? raw : `public/sprites/units/${id}_s_0.png`;
  return `data:image/png;base64,${readFileSync(path).toString('base64')}`;
}

async function genFacing(id, dir, ref, attempt = 1) {
  const out = `public/sprites/units/${id}_${dir}_0.png`;
  if (skipExisting && existsSync(out)) {
    console.log(`  · ${id} ${dir} (exists, skipped)`);
    return true;
  }
  const prompt =
    `The exact same character as the reference image: identical species, colors, ` +
    `markings, proportions and art style. Redraw it ${FACINGS[dir]}. ${STYLE}.`;
  try {
    const json = await generate({ apiKey, prompt, image: ref });
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) throw new Error('no image: ' + JSON.stringify(json).slice(0, 200));
    saveB64(b64, `tmp/raw/${id}_${dir}.png`);
    execFileSync('python3', ['scripts/process_sprite.py', `tmp/raw/${id}_${dir}.png`, out, '256', 'bottom'], { stdio: 'pipe' });
    console.log(`  ✓ ${id} ${dir}`);
    return true;
  } catch (e) {
    const msg = String(e.message || e).slice(0, 160);
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 1500 * attempt));
      return genFacing(id, dir, ref, attempt + 1);
    }
    console.log(`  ✗ ${id} ${dir} FAILED: ${msg}`);
    return false;
  }
}

async function run() {
  console.log(`Generating facings for ${ids.length} creature(s)\n`);
  const done = {};
  for (const id of ids) {
    console.log(id);
    const ref = refDataUri(id);
    // 3 concurrent facings per creature.
    const dirs = Object.keys(FACINGS);
    const oks = await Promise.all(dirs.map((d) => genFacing(id, d, ref)));
    done[id] = ['s', ...dirs.filter((_, i) => oks[i])];
  }

  const mpath = 'public/sprites/manifest.json';
  const manifest = JSON.parse(readFileSync(mpath, 'utf8'));
  manifest.units ||= {};
  for (const [id, facings] of Object.entries(done)) {
    manifest.units[id] = { facings, frames: 1 };
  }
  writeFileSync(mpath, JSON.stringify(manifest, null, 2) + '\n');
  console.log('\nManifest updated with facings.');
}

run();
