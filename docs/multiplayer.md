# Fable Wars Multiplayer

Fable Wars can use Vercel for the game, lobby, and static assets. Real-time battles need a WebSocket room server because Vercel Functions are not the right place for long-lived game sockets.

## First Online Mode

Start with Crystal Rush multiplayer.

- Players send macro commands: choose stance, deploy wave, buy upgrades.
- The command stream is much smaller than Classic RTS unit micro.
- The same deterministic sim can be used once commands are scheduled by tick.

Classic RTS multiplayer should come after Crystal Rush is stable.

## Deployment Shape

1. Deploy the Vercel app as usual.
2. Deploy `realtime/partykit` with PartyKit.
3. Set this Vercel environment variable:

```bash
VITE_MULTIPLAYER_WS=wss://fable-wars.<your-account>.partykit.dev
```

4. Redeploy Vercel.

The Online Battle menu will then show the room server as configured and generate room invite links.

## Protocol

Client to room:

```json
{ "type": "hello", "name": "Commander", "faction": "scorch", "colorIdx": 0 }
{ "type": "ready", "ready": true }
{ "type": "start", "config": {}, "startTick": 120 }
{ "type": "command", "tick": 135, "command": { "type": "crystalRushDeployWave" } }
```

Room to clients:

```json
{ "type": "welcome", "clientId": "abc", "room": "FW-12345" }
{ "type": "room", "room": "FW-12345", "players": [] }
{ "type": "command", "from": "abc", "tick": 135, "command": {} }
```

## Next Implementation Step

Wire `src/net/multiplayer.ts` into the match loop:

- Host builds a Crystal Rush `GameConfig`.
- Every client starts from that same config and seed.
- Local UI commands are sent to the room with an execution tick.
- Each client applies commands only when the sim reaches that tick.
- Add periodic state checksums to detect desync.
