# Fable Wars Unreal/GPT Images/Magnific Asset Pipeline

This repo remains a fast Canvas 2D browser RTS, but high-value art should be produced like
pre-rendered 3D source art. Use Unreal Engine, GPT Images, or Magnific to create polished
isometric assets, then import the final PNGs into `public/sprites`.

## Central Crystal Objective

Crystal Rush can now load a generated objective sprite from:

```text
public/sprites/objectives/central_crystal.png
```

The sprite is declared in `public/sprites/manifest.json` under `objectives`. If the file is
missing or fails to load, the renderer uses the built-in canvas crystal fallback.

## GPT Images Prompt

Use this as the repeatable art direction for the central crystal:

```text
Use case: stylized-concept
Asset type: isometric RTS objective sprite for a browser game, to be cut out as transparent PNG
Primary request: Create a premium Unreal Engine inspired 3D isometric central crystal mountain objective for Fable Wars.
Scene/backdrop: perfectly flat solid #00ff00 chroma-key background only, no floor plane, no shadows on the background.
Subject: a majestic central crystal mountain made of large translucent cyan, violet, and magenta shards rising from a rugged rocky base, with smaller crystal clusters embedded around the base. It should look like a high-value RTS control point/resource objective, fantasy sci-fi, Warcraft 3 / StarCraft 2 style readability, pre-rendered 3D game asset, fixed 2:1 isometric camera, top-left key light, strong silhouette, polished materials, crisp edges, high contrast, no text, no UI ring, no arrow, no labels, no watermark.
Composition: single centered object, generous padding, full object visible, base sits visually on an isometric diamond footprint, transparent-friendly edges.
Avoid: cartoon flat vector look, Minecraft blocks, low-poly toy look, cheap UI text, arrows, labels, humans, units, logos, cast shadow, contact shadow, background gradients, texture in the green background, #00ff00 anywhere in the subject.
```

After saving the generated source image, import it with chroma-key removal:

```bash
node scripts/import-objective-asset.mjs central_crystal /path/to/generated-crystal.png --chroma
```

## Magnific MCP Pipeline

Use Magnific for fast concept-to-game-asset work when the asset needs stronger 3D material
read, lighting, or polish than the procedural fallback.

Recommended sequence:

1. Generate 1-2 candidates with a strict isometric RTS prompt and a flat `#00ff00` chroma background.
2. Pick the candidate with the clearest silhouette at 220px wide.
3. Remove chroma key to alpha using the importer above.
4. Crop transparent bounds and resize objective sprites to about 768px wide before committing.
5. Register the sprite in `public/sprites/manifest.json`.
6. Verify with `tsx tests/objectiveArt.ts`, `tsx tests/menuVisuals.ts`, `tsc --noEmit`, and `vite build`.

For unit packs, use Magnific image generation for a clean front-facing source, then Image-to-3D
for GLB if needed. Render back to Canvas-compatible PNG sprites as 5 real facings
(`s`, `sw`, `w`, `nw`, `n`) and up to 4 walk frames. Keep the feet around y=52 in 64x64
unit sprites so anchors do not drift.

Do not ship raw 2K generation output directly. Browser game sprites should be cropped,
transparent, and resized to the smallest size that preserves readability.

## Unreal Render Settings

When Unreal is available, use these settings for matching assets:

- Camera: orthographic, 2:1 isometric, 35.264 degree elevation, 45 degree yaw.
- Lighting: warm key light from top-left/NW, cool fill from lower-right at low intensity.
- Background: flat `#00ff00` chroma key or true alpha export when available.
- Output: PNG, full object visible, transparent background after keying.
- Scale: central objective should read well when drawn around 218 screen pixels wide at zoom 1.

Do not add in-image UI rings, labels, arrows, or objective text. The engine owns gameplay UI.
