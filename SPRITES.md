# Custom Sprite Guide — Fable Wars units and buildings

Every sprite in Fable Wars is procedurally drawn, and **every one of them can be replaced
with your own PNG** without touching code. Anything you don't replace keeps the built-in art,
so you can upgrade one unit at a time.

## TL;DR workflow

1. Run the game and open **`/?spritelab`** (works locally at `http://localhost:5173/?spritelab`
   and live at `https://fablewars.vercel.app/?spritelab`). It shows every sprite and downloads
   **correctly-named, correctly-sized PNG templates with guide lines**.
2. Paint over a template in any editor (Aseprite, Krita, Photoshop, Procreate) or generate art
   with an AI image tool and clean it up. Keep the canvas size and the transparent background.
3. Drop the finished PNGs into **`public/sprites/units/`** or **`public/sprites/buildings/`**
   (keep the template's file name).
4. List them in **`public/sprites/manifest.json`** (examples inside the file).
5. `npm run dev` → check in-game and in `/?spritelab` → `vercel deploy --prod`.

## Units — `public/sprites/units/<id>_<dir>_<frame>.png`

- **Canvas: 64×64, transparent background.** Bigger is fine (e.g. 128×128) — it's auto-scaled down.
- **Anchor: feet on the y=52 line, horizontally centered** (the template shows both guides).
- **Facings: paint 5** — `s, sw, w, nw, n` (camera-facing → back). The engine mirrors them for
  `se, e, ne` automatically. (You *may* additionally supply those 3 for asymmetric units.)
- **Frames: `_0` (idle/stand) and `_1` (step — limbs swapped, 1–2px bob).** If walking animation is
  too much work, supply only `_0` and set `"frames": 1` in the manifest.
- **Don't paint team colors** — the engine stamps the player-color band at the feet automatically.
- Full set for one unit = 10 files (5 facings × 2 frames), e.g.
  `scorch_volt_cinder_s_0.png`, `scorch_volt_cinder_s_1.png`, `scorch_volt_cinder_sw_0.png`, …

### All 41 unit ids
| 🔥 Scorch Legion | 🌊 Tide Dominion | 🌿 Verdant Swarm |
|---|---|---|
| scorch_cinder_imp | tide_coral_initiate | verdant_mossling |
| scorch_volt_cinder | tide_rill_lancer | verdant_thorn_wasp |
| scorch_magma_brute | tide_breaker_guard | verdant_spore_pod |
| scorch_ash_savant | tide_reef_savant | verdant_briar_reaper |
| scorch_ember_hauler (harvester) | tide_claw_harvester (harvester) | verdant_root_savant |
| scorch_basalt_ram | tide_glassfin_prowler | verdant_grove_hauler (harvester) |
| scorch_ashrunner | tide_coral_bulwark | verdant_vine_stalker |
| scorch_storm_anvil | tide_prism_array | verdant_bloom_siege |
| scorch_caldera_titan | tide_abyss_sovereign | verdant_tangle_mass |
| scorch_cinderwing | tide_reefwing | verdant_elder_husk |
| scorch_solar_wyrm | tide_storm_bomber | verdant_canopy_raptor |
| scorch_slag_barge | tide_kraken_skiff | verdant_spore_moth |
| scorch_ember_nautilus | tide_razortooth_sub | verdant_bog_skiff |
| | tide_leviathan_ark | verdant_mangrove_colossus |

**Suggested priority** (most-seen on screen): the 3 harvesters, then each faction's basic infantry
(cinder imp / coral initiate / mossling), main battle creatures (basalt ram / coral bulwark / bloom siege),
then tier-3 showpieces (caldera titan / abyss sovereign / elder husk).

## Buildings — `public/sprites/buildings/<id>.png`

- **One image per building** (the under-construction scaffold/egg stays procedural).
- **Canvas size depends on footprint** — use the template's exact size. **Anchor: image is
  bottom-aligned; the ground floor must sit on the dashed footprint diamond** shown in the template.
- Don't paint team colors — the engine adds the player banner.

| Footprint | Canvas | Building keys |
|---|---|---|
| 3×3 tall | 200×180 | conyard, sw (superweapon) |
| 3×3 | 200×160 | factory, navalyard, repair |
| 3×2 | 168×144 | refinery |
| 2×2 | 136×128 | power, barracks, radar, airpad, techlab |
| 1×1 | 72×96 | def_basic, def_adv, def_aa |
| 1×1 wall | 72×58 | wall |

Ids are `<faction>_<key>` for all three factions — 45 total, e.g. `scorch_conyard`,
`tide_refinery`, `verdant_def_aa`. Get every exact name + size from `/?spritelab`.

## Objectives — `public/sprites/objectives/<id>.png`

- `central_crystal.png` replaces the Crystal Rush center objective art.
- Use a transparent PNG. If GPT Images gives a flat chroma-key background, import it with:

```bash
node scripts/import-objective-asset.mjs central_crystal /path/to/generated-crystal.png --chroma
```

- Keep the art in the same pre-rendered 3D isometric style as the units/buildings.
- Do not bake labels, arrows, UI rings, or tutorial text into the image.

## manifest.json

```json
{
  "objectives": ["central_crystal"],
  "units": {
    "scorch_volt_cinder": { "facings": ["s", "sw", "w", "nw", "n"], "frames": 2 },
    "verdant_elder_husk":  { "facings": ["s"], "frames": 1 }
  },
  "buildings": ["scorch_conyard", "scorch_refinery"]
}
```
Partial facings are fine — missing angles fall back to procedural art (it will look mixed, so
finishing all 5 facings per unit looks best).

## Style guide (to match the game)

- **Isometric 2:1 camera** (like RA2): light from the **top-left/NW**, soft shadows baked lightly or
  not at all (the engine draws ground shadows).
- **Chibi proportions** for creatures: big head (~40% of height), large eyes, small body — readable
  at 34px on screen. **Strong silhouettes beat fine detail.**
- 1–2px dark outline (a darker shade of the body color, not pure black) keeps units readable
  against terrain.
- Faction materials for buildings: Scorch = obsidian + glowing lava seams · Tide = white coral +
  aqua glass · Verdant = living wood + moss + leaves.
- **Licensing**: only use art you made or art that is CC0/MIT/CC-BY (credit CC-BY in README).
  The game is publicly hosted — no ripped Pokémon/Nintendo sprites.

## Where things plug in (for the curious)

`src/render/sprites.ts → loadSpriteOverrides()` fetches the manifest + images at match load;
`buildSpriteAtlas(data, overrides)` prefers your PNGs and falls back per-sprite. Sidebar icons
are generated from whatever sprite wins, so custom art shows up in the build menu automatically.
