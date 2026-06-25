import type { Command, FactionId } from '../core/types';
import {
  createChatMessage,
  createClientHello,
  createCommandFrame,
  createReadyMessage,
  createStartMessage,
  createStateCheckMessage,
  PROTOCOL_VERSION,
  type ClientRoomMessage,
  type ServerRoomMessageEnvelope,
} from './protocol';

export type RoomClientStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

export interface WebSocketLike {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(data: string): void;
  close(): void;
}

export interface RoomClientOptions {
  socketFactory?: (url: string) => WebSocketLike;
  onMessage?: (message: ServerRoomMessageEnvelope) => void;
  onStatus?: (status: RoomClientStatus) => void;
  onError?: (message: string) => void;
}

export interface RoomClient {
  connect(): void;
  close(): void;
  hello(input: { name: string; faction: FactionId; colorIdx: number }): void;
  ready(ready: boolean): void;
  start(battleCode: string): void;
  commandFrame(tick: number, commands: Command[]): void;
  stateCheck(tick: number, hash: string): void;
  chat(text: string): void;
}

export function createRoomClient(url: string, options: RoomClientOptions = {}): RoomClient {
  let socket: WebSocketLike | null = null;
  let status: RoomClientStatus = 'idle';
  const socketFactory = options.socketFactory ?? ((target) => new WebSocket(target) as WebSocketLike);

  const setStatus = (next: RoomClientStatus) => {
    if (status === next) return;
    status = next;
    options.onStatus?.(next);
  };

  const send = (message: ClientRoomMessage) => {
    if (!socket) {
      options.onError?.('Room socket is not connected.');
      return;
    }
    socket.send(JSON.stringify(message));
  };

  return {
    connect(): void {
      if (socket) return;
      setStatus('connecting');
      socket = socketFactory(url);
      socket.onopen = () => setStatus('open');
      socket.onclose = () => setStatus('closed');
      socket.onerror = () => setStatus('error');
      socket.onmessage = (event) => {
        let message: ServerRoomMessageEnvelope | null;
        try {
          message = parseServerMessage(event.data);
        } catch {
          options.onError?.('Invalid room message JSON.');
          return;
        }
        if (message === null) {
          options.onError?.('Ignored unsupported room message.');
          return;
        }
        options.onMessage?.(message);
      };
    },

    close(): void {
      socket?.close();
      socket = null;
    },

    hello(input): void {
      send(createClientHello(input));
    },

    ready(ready): void {
      send(createReadyMessage(ready));
    },

    start(battleCode): void {
      send(createStartMessage(battleCode));
    },

    commandFrame(tick, commands): void {
      send(createCommandFrame(tick, commands));
    },

    stateCheck(tick, hash): void {
      send(createStateCheckMessage(tick, hash));
    },

    chat(text): void {
      send(createChatMessage(text));
    },
  };
}

function parseServerMessage(data: unknown): ServerRoomMessageEnvelope | null {
  let value: unknown;
  try {
    value = typeof data === 'string' ? JSON.parse(data) : data;
  } catch {
    throw new Error('Invalid room message JSON.');
  }
  if (!isObject(value) || value.v !== PROTOCOL_VERSION || typeof value.type !== 'string') return null;
  if (value.type === 'welcome') {
    return typeof value.clientId === 'string' && typeof value.room === 'string'
      ? { v: PROTOCOL_VERSION, type: 'welcome', clientId: value.clientId, room: value.room }
      : null;
  }
  if (value.type === 'room') {
    return typeof value.room === 'string' && Array.isArray(value.players)
      ? { v: PROTOCOL_VERSION, type: 'room', room: value.room, players: value.players }
      : null;
  }
  if (value.type === 'error') {
    return typeof value.message === 'string' ? { v: PROTOCOL_VERSION, type: 'error', message: value.message } : null;
  }
  if (
    (value.type === 'start' || value.type === 'command' || value.type === 'stateCheck' || value.type === 'chat') &&
    typeof value.from === 'string' &&
    typeof value.at === 'number'
  ) {
    return value as ServerRoomMessageEnvelope;
  }
  return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
