export const MULTIPLAYER_ROOM_PARAM = 'room';

type ImportMetaWithEnv = ImportMeta & {
  env?: Record<string, string | boolean | undefined>;
};

export function multiplayerEndpoint(): string | null {
  const raw = ((import.meta as ImportMetaWithEnv).env?.VITE_MULTIPLAYER_WS ?? '') as string;
  const trimmed = raw.trim().replace(/\/+$/, '');
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeRoomCode(value: string): string {
  const code = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/-+/g, '-')
    .slice(0, 16);
  return code || randomRoomCode();
}

export function randomRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'FW-';
  for (let i = 0; i < 5; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

export function roomUrl(roomCode: string, base = window.location.href): string {
  const url = new URL(base);
  url.searchParams.set(MULTIPLAYER_ROOM_PARAM, normalizeRoomCode(roomCode));
  return url.toString();
}

export function roomSocketUrl(roomCode: string, endpoint = multiplayerEndpoint()): string | null {
  if (endpoint === null) return null;
  return `${endpoint.replace(/\/+$/, '')}/rooms/${encodeURIComponent(normalizeRoomCode(roomCode))}`;
}
