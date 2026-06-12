# Fable Wars

An elemental fantasy real-time strategy game about three armies fighting over volatile candy-crystal
rifts. Build your base, harvest crystal fields, raise an army of Scorch, Tide, or Verdant war-creatures,
and erase your enemy from the map.

**Play:** run locally with `npm run dev`, or deploy the static build anywhere (Vercel-ready).

## Features
- Classic RA2 mechanics: ConYard build sidebar, power management, ore→credits economy with harvesters,
  tech tiers, base defenses, repair/sell, engineers, unit veterancy, superweapons, fog of war.
- Three asymmetric factions — 🔥 Scorch Legion, 🌊 Tide Dominion, 🌿 Verdant Swarm — with a
  Fire > Grass > Water > Fire damage triangle and unique superweapons.
- Land, air, and naval combat. 41 creature units, 45 structures.
- Procedurally generated maps (seeded — share a seed with friends), 2–4 player free-for-all skirmish
  against Easy / Medium / Hard AI (no resource cheating — hard is smarter, not richer).
- Generated world art, 3D-style creature sprites, synthesized SFX/music, and speech-synthesis announcer.
- Single player, in-browser, desktop mouse+keyboard.

## Dev
```bash
npm install
npm run dev            # local dev server
npm run typecheck      # strict TS
npm run test:headless  # AI-vs-AI full-match simulation (no DOM)
npm run build          # production build (dist/)
```

## Architecture
See [ARCHITECTURE.md](ARCHITECTURE.md) (engine contract & module map) and
[DESIGN.md](DESIGN.md) (factions, rosters, balance, AI design).

No copyrighted game assets are used; the shipped art and sound are generated or custom-authored for
this prototype.
