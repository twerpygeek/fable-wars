/**
 * Fable Wars realtime room relay.
 *
 * Deploy this with PartyKit, then set VITE_MULTIPLAYER_WS in Vercel to the
 * deployed WebSocket origin, for example:
 *   wss://fable-wars.<your-account>.partykit.dev
 *
 * The browser client connects to /rooms/<ROOM_CODE>. This relay keeps room
 * presence and broadcasts JSON messages. The game client owns deterministic
 * simulation and sends explicit Crystal Rush commands through the room.
 */
export default class FableWarsRoom {
  constructor(room) {
    this.room = room;
    this.players = new Map();
  }

  onConnect(conn) {
    const player = {
      id: conn.id,
      name: 'Commander',
      faction: 'scorch',
      colorIdx: 0,
      ready: false,
    };
    this.players.set(conn.id, player);
    conn.send(JSON.stringify({ type: 'welcome', clientId: conn.id, room: this.room.id }));
    this.broadcastRoom();
  }

  onMessage(message, sender) {
    let msg;
    try {
      msg = JSON.parse(String(message));
    } catch {
      sender.send(JSON.stringify({ type: 'error', message: 'Invalid JSON message.' }));
      return;
    }

    if (msg.type === 'hello') {
      const player = this.players.get(sender.id);
      if (player) {
        player.name = cleanName(msg.name);
        player.faction = cleanFaction(msg.faction);
        player.colorIdx = cleanColor(msg.colorIdx);
      }
      this.broadcastRoom();
      return;
    }

    if (msg.type === 'ready') {
      const player = this.players.get(sender.id);
      if (player) player.ready = msg.ready === true;
      this.broadcastRoom();
      return;
    }

    if (msg.type === 'start' || msg.type === 'command' || msg.type === 'chat') {
      this.room.broadcast(JSON.stringify({ ...msg, from: sender.id, at: Date.now() }));
    }
  }

  onClose(conn) {
    this.players.delete(conn.id);
    this.broadcastRoom();
  }

  broadcastRoom() {
    this.room.broadcast(
      JSON.stringify({
        type: 'room',
        room: this.room.id,
        players: [...this.players.values()],
      }),
    );
  }
}

function cleanName(value) {
  return String(value ?? 'Commander').replace(/[^\w .-]/g, '').trim().slice(0, 20) || 'Commander';
}

function cleanFaction(value) {
  return value === 'tide' || value === 'verdant' ? value : 'scorch';
}

function cleanColor(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(7, n | 0)) : 0;
}
