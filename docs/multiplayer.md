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

## Implemented Lobby Flow

- Players can host or join a shared room code.
- The room roster shows commander name, faction, color, and ready state.
- Commander chat is relayed through the room server.
- Start Room Match broadcasts the host's current battle code; clients apply that setup and launch Crystal Rush.

## Protocol

Client to room:

```json
{ "v": 1, "type": "hello", "name": "Commander", "faction": "scorch", "colorIdx": 0 }
{ "v": 1, "type": "ready", "ready": true }
{ "v": 1, "type": "start", "battleCode": "FW1-..." }
{ "v": 1, "type": "command", "tick": 135, "commands": [{ "type": "crystalRushDeployWave", "player": 0 }] }
{ "v": 1, "type": "chat", "text": "rally at crystal" }
```

Room to clients:

```json
{ "v": 1, "type": "welcome", "clientId": "abc", "room": "FW-12345" }
{ "v": 1, "type": "room", "room": "FW-12345", "players": [] }
{ "v": 1, "type": "command", "from": "abc", "tick": 135, "commands": [] }
```

## Next Implementation Step

Wire deterministic command scheduling into the live match loop:

- Every client starts from that same config and seed.
- Local UI commands are sent to the room with an execution tick.
- Each client applies commands only when the sim reaches that tick.
- Add periodic state checksums to detect desync.
