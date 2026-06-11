import { TICK_RATE } from '../core/constants';
import type { GameData, GameState, PlayerId, ProductionTab, UIState } from '../core/types';

export interface GuidanceMessage {
  id: string;
  title: string;
  body: string;
  severity: 'info' | 'warn';
}

const STRUCTURE: ProductionTab = 'structure';
const VEHICLE: ProductionTab = 'vehicle';

function queuedOrReady(state: GameState, player: PlayerId, defId: string): boolean {
  const p = state.players[player];
  for (const q of Object.values(p.queues)) {
    if (q.readyBuilding === defId || q.items.includes(defId)) return true;
  }
  return false;
}

function hasBuilding(state: GameState, player: PlayerId, defId: string): boolean {
  for (const e of state.entities.values()) {
    if (e.kind === 'building' && e.owner === player && e.defId === defId && e.hp > 0) return true;
  }
  return false;
}

function hasOrQueuedStructure(state: GameState, player: PlayerId, key: string): boolean {
  const faction = state.players[player].faction;
  const defId = `${faction}_${key}`;
  return hasBuilding(state, player, defId) || queuedOrReady(state, player, defId);
}

function ownUnitCount(state: GameState, player: PlayerId, pred: (defId: string) => boolean): number {
  let n = 0;
  for (const e of state.entities.values()) {
    if (e.kind === 'unit' && e.owner === player && e.hp > 0 && pred(e.defId)) n++;
  }
  return n;
}

function queuedUnits(state: GameState, player: PlayerId, tab: ProductionTab): number {
  return state.players[player].queues[tab].items.length;
}

export function getGuidance(
  state: GameState,
  data: GameData,
  humanPlayer: PlayerId,
  ui: UIState,
): GuidanceMessage | null {
  if (state.winner !== null || ui.paused || ui.showMenu) return null;
  const p = state.players[humanPlayer];
  const faction = p.faction;
  const firstMinute = state.tick < TICK_RATE * 60;

  if (p.powerProduced < p.powerConsumed) {
    return {
      id: 'low-power',
      title: 'Power shortage',
      body: 'Build another power plant. Low power slows production and shuts down advanced systems.',
      severity: 'warn',
    };
  }

  const harvesters = ownUnitCount(state, humanPlayer, (defId) => data.units[defId]?.harvester !== undefined);
  if (harvesters === 0 && queuedUnits(state, humanPlayer, VEHICLE) === 0) {
    return {
      id: 'rebuild-harvester',
      title: 'No harvesters',
      body: 'Queue a harvester from the vehicle tab or protect your economy before attacking.',
      severity: 'warn',
    };
  }

  if (!firstMinute) return null;

  if (ui.selection.length === 0) {
    return {
      id: 'select-start',
      title: 'Start by selecting',
      body: 'Drag-select your creatures or click the Citadel, then right-click to move or set rally points.',
      severity: 'info',
    };
  }

  if (!hasOrQueuedStructure(state, humanPlayer, 'power')) {
    return {
      id: 'build-power',
      title: 'Build power',
      body: `Open BLD and queue ${data.buildings[`${faction}_power`].name} so your base can expand.`,
      severity: 'info',
    };
  }

  if (!hasOrQueuedStructure(state, humanPlayer, 'refinery')) {
    return {
      id: 'build-refinery',
      title: 'Start your economy',
      body: `Queue ${data.buildings[`${faction}_refinery`].name} near Rare Candy crystals.`,
      severity: 'info',
    };
  }

  if (!hasOrQueuedStructure(state, humanPlayer, 'barracks')) {
    return {
      id: 'build-barracks',
      title: 'Train defenders',
      body: `Queue ${data.buildings[`${faction}_barracks`].name}, then make a few infantry before the first raid.`,
      severity: 'info',
    };
  }

  if (
    p.credits >= 2500 &&
    p.queues[STRUCTURE].items.length === 0 &&
    p.queues[STRUCTURE].readyBuilding === null
  ) {
    return {
      id: 'spend-bank',
      title: 'Spend your bank',
      body: 'You have enough credits to expand production, defenses, or tech. Idle credits do not win battles.',
      severity: 'info',
    };
  }

  return null;
}
