// Seedream (BytePlus ModelArk) image generation helper.
// Loads BYTEPLUS_MODELARK_API_KEY from .env.local and calls the OpenAI-compatible
// images/generations endpoint. Usage examples at the bottom; importable too.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const ENV_PATH = resolve(process.cwd(), '.env.local');
export function loadEnv() {
  const txt = readFileSync(ENV_PATH, 'utf8');
  const env = {};
  for (const line of txt.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

const BASE = 'https://ark.ap-southeast.bytepluses.com/api/v3';
export const MODEL = 'seedream-4-5-251128';

export async function generate({ apiKey, prompt, size = '2048x2048', model = MODEL, image }) {
  // `image`: optional reference for image-to-image (data URI/URL, or array of them).
  const body = { model, prompt, size, response_format: 'b64_json', watermark: false };
  if (image) body.image = image;
  const res = await fetch(`${BASE}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return JSON.parse(text);
}

export function saveB64(b64, outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, Buffer.from(b64, 'base64'));
}

// --- direct probe: node scripts/seedream.mjs "<prompt>" out.png ---
if (import.meta.url === `file://${process.argv[1]}`) {
  const env = loadEnv();
  const apiKey = env.BYTEPLUS_MODELARK_API_KEY;
  const prompt = process.argv[2] || 'a cute cartoon flame salamander, transparent background';
  const out = process.argv[3] || 'tmp/probe.png';
  console.log('model:', MODEL, '\nprompt:', prompt);
  const json = await generate({ apiKey, prompt });
  const item = json.data?.[0];
  if (item?.b64_json) {
    saveB64(item.b64_json, out);
    console.log('saved', out, '\nusage:', JSON.stringify(json.usage || {}));
  } else {
    console.log('unexpected response:', JSON.stringify(json).slice(0, 800));
  }
}
