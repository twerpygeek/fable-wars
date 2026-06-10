# Pocket Alert — "RA2 Feel" Enhancement Plan (v2)

Inputs: playtester feedback (camera, gliding units, tooltips, score screen, history),
brainstorm decisions (crates, force-fire+stances, recorded SFX + barks, all visual juice,
RA2-style stats), and two completed research passes — RA2 primary sources (manual,
rules.ini, CnCNet/OpenRA source) and license-verified open-source techniques/assets.

## Phase 1 — Camera & feel (the direct complaints)

1. **Edge-scroll overhaul** (research-spec'd from RA2 manual + OpenRA + CnCNet):
   - Trigger band: 8px at the **browser window edge only**; the **entire sidebar and HUD are
     hard deadzones** (this kills the "scrolls when I go to the sidebar" bug — in fullscreen
     RA2 the cursor physically pinned at the screen border; a browser needs the deadzone).
   - ~120ms dwell before scrolling starts (kills accidental triggers; imperceptible when intended).
   - **Constant velocity** (RA2 has no acceleration): default 1200 px/s at 1.0× zoom, scaled by
     1/zoom; diagonals normalized so corners aren't faster.
   - **Scroll Rate slider** (7 ticks, 400–2000 px/s — the CnCNet range) in the ESC menu; applies
     to edge + keyboard + RMB scrolling. Persisted in localStorage.
   - RA2's **green directional arrow cursors** while scrolling, red when clamped at map edge.
   - **Right-mouse-drag joystick panning** (in the RA2 manual!, ~2× speed, 8px deadzone).
2. **Walk feel** — units stop gliding: 1.5–2px walk-bob with two footfalls per tile
   (renderer transform, works with the new 1-frame art), slight per-unit phase offset;
   infantry get RA2's subtle tile-boundary hitch. Air units keep their float.
3. **Battlefield hover tooltips** (RA2 had them at 2s; we use the modern 550ms):
   nameplate with name, HP bar, veterancy chevrons + one-line blurb for any visible unit/building.
   Sidebar tooltips upgraded to a proper panel (250ms): name / $cost / build seconds / power Δ /
   role line / red "Requires: X" when locked. Defense structures show a translucent **range ellipse**
   while being placed.
4. **Feel details from rules.ini**: health bars turn yellow at 50% and red at 25% (RA2's
   ConditionYellow/Red); green move-flash ring at ordered destinations; context cursors
   (move/attack/no-move/sell/repair swaps).
5. **QoL bundle** (research top-5): repeat-build (Ctrl+click = infinite ∞ badge, Shift+click = ×5),
   double-click factory = **Primary** tag, T = select-same-type (double-tap = map-wide), X = scatter,
   C = cheer (all units celebrate; auto-cheer on victory), Tab cycles production buildings,
   `[` `]` keyboard zoom, zoom-out floor raised 0.5 → 0.65 (Remastered's authenticity clamp).
   Anti-features deliberately avoided: right-click-orders default, stance trees, parallel structure queues.

## Phase 2 — Score screen & match history

6. **Extended sim stats** per player: units killed/lost, buildings killed/lost, credits harvested,
   live score (RA2-style points: infantry 10, vehicles 25, harvesters 55, tier-3 60, buildings ≈ cost/20).
7. **RA2-style end screen**: VICTORY/DEFEAT banner + music sting → score table (player color swatch +
   name per row; columns: Creatures Killed | Creatures Lost | Buildings Destroyed | Buildings Lost |
   Crystals Harvested | Score), match duration, **Play Again (same settings)** + Main Menu.
8. **Local match history** (localStorage): each finished match stores date/time, map seed/size/water,
   your faction, opponents (faction+difficulty), result, duration, score. Front page gets a
   "Service Record" panel: scrollable list + a ↻ button per row that pre-fills the lobby with that
   exact setup (seed included — replay the same map).

## Phase 3 — Mechanics (brainstorm picks + engine fixes)

9. **Crates** (faithful to [CrateRules]): lobby toggle (default ON); one crate every ~180s on a random
   passable tile (cap 6); RA2 weights — money 20 ($1000+rng900) / veterancy 20 (3-tile radius,
   friend-or-foe) / free unit 20 / full heal 10 / reveal map 10 / armor ×1.5 10 / speed ×1.2 10 /
   firepower ×2 10. Glow effect + announcer line on pickup. No evil crates (RA2 shipped them disabled).
10. **Force-fire + stances**: Ctrl+click (alias: hold F, for macOS) = force-fire at ground or any
    target (new `attackGround` order; lets you pre-fire positions, break own walls); simple stance
    toggle per selection — Aggressive (default, RA2 auto-acquire) / Hold Fire. No 4-stance tree.
11. **Harvester traffic fix** (clean-room reimplementation of OpenRA's mechanism, techniques only):
    per-tile claim registry so harvesters stop converging on one crystal, refinery-direction bias,
    failure backoff. Fixes late-game harvester dogpiles.
12. **Group movement fix** (clean-room reimplementation of 0 A.D.'s unit pushing): soft-push pass
    after movement — moving units slide around each other instead of stop-start jamming; idle units
    don't get shoved; crossing groups nudge perpendicular. 12-unit attack-moves stay coherent.
13. **AI unpredictability** (OpenRA SquadManager patterns): randomized wave thresholds (+0–30%
    rolled per wave), desynchronized think cadences, opportunistic rush when an exposed ConYard is
    spotted, and **AI taunt toasts** ("Ha ha ha", "You coward.") on key events — parody personality.

## Phase 4 — Audio (license-verified adopt list)

14. **Recorded SFX**: cherry-pick ~1.3MB from Kenney Sci-Fi / Impact / Interface packs (all CC0,
    URLs + licenses verified) for explosions, lasers, impacts, UI; transcoded to mp3/m4a (Safari
    can't decode ogg); loaded via a small buffer-loader **with the existing synth as fallback**.
15. **ZzFX** (MIT, 3.5KB) replaces hand-rolled oscillator recipes for the remaining synth layer.
16. **Creature voice barks**: 2-note species-signature chirps (pitch/timbre per creature family)
    on select/order acknowledge — RA2's "lead unit responds" rule, parody-style. EVA announcer unchanged.
17. *(Optional)* one CC0 battle music track (cynicmusic "Battle Theme A", verified) layered with the
    procedural loop as fallback; skip the CC-BY tracks to keep zero attribution burden.

## Phase 5 — Visual juice (all four picks)

18. **Deaths**: creatures faint with a rising spirit wisp; vehicles leave debris + scorch mark
    (RA2 has no husks); buildings collapse with debris cloud; screen shake when anything ≥400 HP
    dies (rules.ini ShakeScreen=400).
19. **Build-up animation**: structures rise from the ground with dust as buildProgress advances
    (replaces the egg-scaffold pop); selling plays it in reverse (RA2 behavior).
20. **Combat flash**: muzzle flashes, 80ms white hit-flicker on damaged targets, projectile tracers.
21. **Ambient life**: drifting cloud shadows, butterflies/birds over grass, animated shoreline foam.
22. *(Optional)* mapgen upgrade to simplex-noise fBm (verified deterministic with our seeds) for
    natural coastlines; gem patches (2× value, no regrowth) at contested map centers + slow ore
    regrowth near depleted home fields.

## Phase 6 — Performance & ship

23. **Sprite payload**: downscale the art pack 256→128px units (rendered at 64px; 17MB → ~5MB),
    preload during the loading screen with a progress bar.
24. Regression: headless AI-vs-AI suite re-run (crates/pushing/claims affect balance), balance
    matrix re-check, full browser QA pass, deploy to Vercel.

## Execution notes
- Implementation via parallel workstream agents where files are disjoint (input/camera vs sim vs
  renderer vs UI screens vs audio), inline integration after each phase, headless + browser
  verification before each deploy. GPL sources are treated as *technique descriptions only* —
  all reimplementations are clean-room from prose specs (noted in code comments).
- Phases ship incrementally: 1→2 first (the direct complaints), then 3→6.
