# Fable Wars Multiplayer Roadmap

## Goal

Add online play without risking the current single-player game. Crystal Rush should be the first multiplayer target because it has fewer player command types, clearer win conditions, and less micro-sensitive input than Classic RTS.

## Recommendation

Ship multiplayer in three phases:

1. **Crystal Rush Online Alpha**
   - Room code matchmaking.
   - One human per faction, AI fills empty slots.
   - Lockstep simulation: clients send commands for future ticks, and all clients run the same sim.
   - Server owns room membership, readiness, tick pacing, reconnect timeout, and command relay.

2. **Classic RTS Skirmish Online**
   - Reuse the same room/lockstep layer.
   - Add full command serialization for selection-independent commands: production, placement, orders, repair, sell, and superweapon targeting.
   - Add desync detection before public use.

3. **Polish and Safety**
   - Reconnect within a short grace window.
   - Spectator/replay stream from recorded command frames.
   - Region/server selection only if latency demands it.

## Architecture

The sim already has the right shape for lockstep: UI and AI send `Command[]`, and `tickGame()` advances deterministic game state. Multiplayer should preserve that boundary.

Add a small networking layer instead of moving game logic into the server:

- `src/net/protocol.ts`: versioned room messages and command-frame schema.
- `src/net/client.ts`: browser WebSocket client, room lifecycle, ready state, command buffering.
- `server/roomServer.ts`: authoritative room/session host, not an authoritative game simulator.
- `tests/multiplayerLockstep.ts`: two local clients feed the same command frames and assert matching state hashes.

## Determinism Requirements

Before online play is trusted:

- All random values must flow through the seeded RNG in `GameState`.
- Commands must be serializable plain data.
- Entity iteration order must remain stable.
- Game-state hashing must ignore render/UI-only fields.
- Each client should periodically compare state hashes through the room server.

## UX Requirements

The menu should add a restrained online panel:

- `Offline Skirmish`
- `Host Crystal Rush`
- `Join Room`
- Room code display and copy button
- Player slots with faction/color/readiness
- AI fill toggle

Do not expose Classic online until Crystal Rush lockstep is proven stable.

## Non-goals

- No WebRTC mesh for the first version.
- No authoritative server combat rewrite.
- No public ranked ladder.
- No accounts or persistent profiles.
- No multiplayer rewrite of rendering, pathing, or combat.

## Acceptance

Crystal Rush Online Alpha is ready when two browser clients can join one room, choose factions, start the same seeded match, issue battle-plan and upgrade commands, finish a match, and report matching state hashes for the whole session.
