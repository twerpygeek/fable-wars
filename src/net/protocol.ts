import type { Command, FactionId } from '../core/types';

export const PROTOCOL_VERSION = 1;

export type RoomPlayer = {
  id: string;
  name: string;
  faction: FactionId;
  colorIdx: number;
  ready: boolean;
};

export type ClientHelloMessage = {
  v: typeof PROTOCOL_VERSION;
  type: 'hello';
  name: string;
  faction: FactionId;
  colorIdx: number;
};

export type ClientReadyMessage = {
  v: typeof PROTOCOL_VERSION;
  type: 'ready';
  ready: boolean;
};

export type ClientStartMessage = {
  v: typeof PROTOCOL_VERSION;
  type: 'start';
  battleCode: string;
};

export type ClientCommandFrameMessage = {
  v: typeof PROTOCOL_VERSION;
  type: 'command';
  tick: number;
  commands: Command[];
};

export type ClientChatMessage = {
  v: typeof PROTOCOL_VERSION;
  type: 'chat';
  text: string;
};

export type ClientRoomMessage =
  | ClientHelloMessage
  | ClientReadyMessage
  | ClientStartMessage
  | ClientCommandFrameMessage
  | ClientChatMessage;

export type ServerWelcomeMessage = {
  v: typeof PROTOCOL_VERSION;
  type: 'welcome';
  clientId: string;
  room: string;
};

export type ServerRoomMessage = {
  v: typeof PROTOCOL_VERSION;
  type: 'room';
  room: string;
  players: RoomPlayer[];
};

export type ServerErrorMessage = {
  v: typeof PROTOCOL_VERSION;
  type: 'error';
  message: string;
};

export type ServerRelayedMessage = (ClientStartMessage | ClientCommandFrameMessage | ClientChatMessage) & {
  from: string;
  at: number;
};

export type ServerRoomMessageEnvelope = ServerWelcomeMessage | ServerRoomMessage | ServerErrorMessage | ServerRelayedMessage;

export function createClientHello(input: { name: string; faction: FactionId; colorIdx: number }): ClientHelloMessage {
  return {
    v: PROTOCOL_VERSION,
    type: 'hello',
    name: input.name,
    faction: input.faction,
    colorIdx: input.colorIdx,
  };
}

export function createReadyMessage(ready: boolean): ClientReadyMessage {
  return { v: PROTOCOL_VERSION, type: 'ready', ready };
}

export function createStartMessage(battleCode: string): ClientStartMessage {
  return { v: PROTOCOL_VERSION, type: 'start', battleCode };
}

export function createCommandFrame(tick: number, commands: Command[]): ClientCommandFrameMessage {
  return { v: PROTOCOL_VERSION, type: 'command', tick, commands };
}

export function createChatMessage(text: string): ClientChatMessage {
  return { v: PROTOCOL_VERSION, type: 'chat', text: sanitizeChatText(text) };
}

export function isClientRoomMessage(value: unknown): value is ClientRoomMessage {
  if (!isObject(value) || value.v !== PROTOCOL_VERSION || typeof value.type !== 'string') return false;
  if (value.type === 'hello') {
    const colorIdx = value.colorIdx;
    return (
      typeof value.name === 'string' &&
      isFaction(value.faction) &&
      typeof colorIdx === 'number' &&
      Number.isInteger(colorIdx) &&
      colorIdx >= 0 &&
      colorIdx <= 7
    );
  }
  if (value.type === 'ready') return typeof value.ready === 'boolean';
  if (value.type === 'start') return typeof value.battleCode === 'string' && value.battleCode.trim().length > 0;
  if (value.type === 'command') {
    const tick = value.tick;
    return typeof tick === 'number' && Number.isInteger(tick) && tick >= 0 && Array.isArray(value.commands);
  }
  if (value.type === 'chat') return typeof value.text === 'string' && sanitizeChatText(value.text).length > 0;
  return false;
}

function sanitizeChatText(text: string): string {
  return text.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFaction(value: unknown): value is FactionId {
  return value === 'scorch' || value === 'tide' || value === 'verdant';
}
