# ⚡ Pocket Alert — Creature Command

A Red Alert 2-inspired real-time strategy game with a creature-collecting twist. Build your base,
harvest Rare Candy crystals, raise an army of elemental creatures, and erase your enemy from the map.

**Play:** run locally with `npm run dev`, or deploy the static build anywhere (Vercel-ready).

## Features
- Classic RA2 mechanics: ConYard build sidebar, power management, ore→credits economy with harvesters,
  tech tiers, base defenses, repair/sell, engineers, unit veterancy, superweapons, fog of war.
- Three asymmetric factions — 🔥 Scorch Legion, 🌊 Tide Dominion, 🌿 Verdant Swarm — with a
  Fire > Grass > Water > Fire damage triangle and unique superweapons.
- Land, air, and naval combat. 41 creature units, 45 structures.
- Procedurally generated maps (seeded — share a seed with friends), 2–4 player free-for-all skirmish
  against Easy / Medium / Hard AI (no resource cheating — hard is smarter, not richer).
- 100% generated assets: procedural sprites, synthesized SFX/music, speech-synthesis EVA announcer.
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

All names are loving parodies. No copyrighted assets are used; every sprite and sound is generated
in code at load time.
