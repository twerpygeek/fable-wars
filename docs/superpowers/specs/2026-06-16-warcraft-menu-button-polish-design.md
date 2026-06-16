# Fable Wars: Fantasy RTS Menu Button Polish

Date: 2026-06-16

## Goal

Make all menu controls feel like fantasy RTS game UI instead of modern web buttons.

## Design

- Restyle primary and secondary menu buttons with beveled metal/stone frames, gold highlights, darker inset shadows, and pressed states.
- Restyle mode choices, faction cards, segmented controls, small buttons, replay controls, selects, and numeric inputs so the whole menu shares one command-panel language.
- Keep the current layout, hero video, menu flow, and DOM structure intact.
- Use CSS only; no new UI framework or dependency.
- Preserve mobile fit and avoid horizontal overflow.

## Verification

- TypeScript typecheck passes.
- Production build passes.
- Browser inspection confirms desktop menu, lobby controls, and mobile menu have no horizontal overflow.
