# Skill Rivals AI Arena For Fable Wars

## Product Intent

Skill Rivals should become the competitive layer around Fable Wars: a place where humans and AI commanders can challenge each other, climb ladders, and share match results. Fable Wars remains the game title. Skill Rivals becomes the arena, profile, leaderboard, and tournament identity.

The first AI feature should be an AI-vs-AI Crystal Rush ladder. Crystal Rush is the right starting mode because it already has macro commands, deterministic simulation, clear win conditions, and fewer command types than Classic RTS.

## Player Promise

Players should be able to visit Skill Rivals and understand that Fable Wars has active commanders competing even when no friends are online. They can watch top AI battles, see which strategies win, and eventually submit their own bot.

The experience should feel like:

- "My bot is a commander in the Fable Wars arena."
- "It can fight other bots while I am away."
- "The leaderboard proves which strategies are strongest."
- "I can watch replays and learn why a bot won."

## MVP Scope

The MVP is local/headless first, then hosted.

1. Define a small `CrystalRushAgent` interface.
2. Add built-in baseline agents:
   - `balanced`: mixes crystal and base pressure.
   - `greedy`: prioritizes crystal income and economy upgrades.
   - `aggressive`: prioritizes base pressure and wave upgrades.
3. Add a headless AI Arena runner that plays seeded Crystal Rush matches between agents.
4. Produce a deterministic match result object with:
   - winner
   - loser
   - duration ticks
   - crystals earned
   - units killed
   - bases destroyed
   - final score
   - replay seed/config metadata
5. Add an Elo-style leaderboard calculation for batches of matches.
6. Add a static "AI Arena" menu/lobby panel showing sample rankings and explaining that hosted bot submission is coming.

Hosted submission, auth, durable online leaderboards, and user-created external code execution are intentionally not part of the first implementation slice.

## Agent Contract

The first agent API should be safe and narrow:

```ts
export interface CrystalRushAgentView {
  tick: number;
  player: PlayerId;
  credits: number;
  incomeRate: number;
  stance: CrystalRushStance;
  waveLevel: number;
  economyLevel: number;
  defenseLevel: number;
  nextWaveInTicks: number;
  deployCooldownTicks: number;
  crystalControl: number[];
  baseHealth: number[];
  alivePlayers: boolean[];
}

export interface CrystalRushAgentDecision {
  stance?: CrystalRushStance;
  deployWave?: boolean;
  upgrade?: CrystalRushUpgradeId;
}

export interface CrystalRushAgent {
  id: string;
  name: string;
  description: string;
  decide(view: CrystalRushAgentView): CrystalRushAgentDecision;
}
```

Agents do not receive raw entity maps in v1. That keeps the game macro-focused, prevents bot authors from depending on unstable internals, and makes hosted sandboxing simpler later.

## Scoring

The MVP should separate "match winner" from "leaderboard score".

Match result:

- Win/loss comes from existing Crystal Rush victory.
- Duration must stay within the current 5-12 minute tuning target.

Score:

```text
score =
  winBonus
  + crystalsEarned * 0.04
  + unitsKilled * 8
  + basesDestroyed * 350
  - unitsLost * 4
  - durationMinutes * 12
```

Elo:

- Start every agent at 1000.
- Use K=32.
- Run both mirrored player slots for fairness where practical.

The displayed leaderboard should sort by Elo first, then average score.

## Replay Metadata

The first version should not build a full replay viewer. It should save enough metadata to reproduce a match:

```ts
{
  mode: 'crystalRush',
  seed,
  mapSize,
  agents: [agentIdA, agentIdB, ...],
  winner,
  durationTicks
}
```

Later, a replay viewer can run the same seed and agent decisions back through the deterministic sim.

## UI Placement

Add an "AI Arena" entry to the main menu after Online Battle.

The panel should show:

- Title: `AI Arena`
- Subtitle: `Watch commanders compete for Skill Rivals ranking.`
- Three sample bot cards with name, style, Elo, win rate, and favorite faction.
- A "Run Local Exhibition" button for a quick local generated match summary.
- A note that public bot submission and hosted ladders are coming after the multiplayer room relay is stable.

This UI should use the existing premium RTS menu styling. No prototype labels, no cheap badges, no cartoon bot mascots.

## Architecture

Suggested files:

- `src/arena/agents.ts`: agent interfaces and baseline agents.
- `src/arena/runCrystalRushArena.ts`: headless arena match runner.
- `src/arena/leaderboard.ts`: Elo and score aggregation.
- `src/ui/aiArenaPanel.ts` or a focused section in `src/ui/menu.ts`: menu surface for arena results.
- `tests/aiArena.ts`: deterministic runner and leaderboard checks.

The runner should reuse:

- `createGame`
- `tickGame`
- `DATA`
- existing Crystal Rush commands
- existing `GameConfig`

It should not fork the sim or introduce a separate combat model.

## Hosted Roadmap

After the MVP:

1. Store match results in a hosted database.
2. Add Skill Rivals profiles.
3. Let users submit declarative strategy configs first, not arbitrary code.
4. Add server-side scheduled tournaments.
5. Add replay playback from seed plus decision log.
6. Add external bot API only after sandboxing and abuse controls are designed.

## Non-Goals

- No arbitrary hosted JavaScript execution in v1.
- No full Classic RTS bot ladder yet.
- No multiplayer dependency for local AI Arena.
- No 3D renderer or WebGL rewrite.
- No new units or factions.

## Acceptance Criteria

- `tests/aiArena.ts` runs a deterministic Crystal Rush AI Arena exhibition to completion.
- The same seed and agents produce the same winner and score summary.
- Leaderboard Elo changes after a batch of matches.
- The main menu includes an AI Arena surface that explains Skill Rivals without overwhelming new users.
- Existing Crystal Rush and Classic RTS tests still pass.
- The implementation does not weaken current multiplayer, state hashing, or room command code.
