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
- Crystal Rush clients send periodic state checksums so the room can surface desync warnings.
- If the room closes or errors, the Online Battle screen clears stale roster data and turns the main action into a reconnect button.

## Protocol

Client to room:

```json
{ "v": 1, "type": "hello", "name": "Commander", "faction": "scorch", "colorIdx": 0 }
{ "v": 1, "type": "ready", "ready": true }
{ "v": 1, "type": "start", "battleCode": "FW1-..." }
{ "v": 1, "type": "command", "tick": 135, "commands": [{ "type": "crystalRushDeployWave", "player": 0 }] }
{ "v": 1, "type": "stateCheck", "tick": 240, "hash": "a1b2c3d4" }
{ "v": 1, "type": "chat", "text": "rally at crystal" }
```

Room to clients:

```json
{ "v": 1, "type": "welcome", "clientId": "abc", "room": "FW-12345" }
{ "v": 1, "type": "room", "room": "FW-12345", "players": [] }
{ "v": 1, "type": "command", "from": "abc", "tick": 135, "commands": [] }
{ "v": 1, "type": "stateCheck", "from": "abc", "tick": 240, "hash": "a1b2c3d4" }
```

## Next Implementation Step

Harden the online match session:

- Add room ownership / host transfer.
- Add a post-match room summary so friends can rematch.
