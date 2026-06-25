import type { Entity, GameState, Projectile } from '../core/types';

export function hashGameState(state: GameState): string {
  const parts: string[] = [
    `t:${state.tick}`,
    `rng:${state.rngState}`,
    `win:${state.winner ?? 'n'}`,
    `next:${state.nextEntityId}:${state.nextProjectileId}`,
  ];

  for (const p of state.players) {
    parts.push(
      [
        'p',
        p.id,
        p.faction,
        p.colorIdx,
        p.eliminated ? 1 : 0,
        Math.floor(p.credits),
        p.powerProduced,
        p.powerConsumed,
        p.superweapon?.defId ?? '-',
        p.superweapon?.readyAtTick ?? 0,
        p.superweapon?.charging ? 1 : 0,
      ].join(':'),
    );
  }

  if (state.crystalRush) {
    parts.push(`cr:${state.crystalRush.objective.x}:${state.crystalRush.objective.y}:${state.crystalRush.radius}`);
    for (let i = 0; i < state.crystalRush.player.length; i++) {
      const crp = state.crystalRush.player[i];
      parts.push(
        [
          'crp',
          i,
          crp.stance,
          crp.incomeRate,
          crp.totalIncome,
          crp.waveLevel,
          crp.economyLevel,
          crp.defenseLevel,
          crp.nextWaveTick,
          crp.nextDeployTick,
        ].join(':'),
      );
    }
  }

  const entities = [...state.entities.values()].sort((a, b) => a.id - b.id);
  for (const e of entities) parts.push(entityDigest(e));

  const projectiles = [...state.projectiles].sort((a, b) => a.id - b.id);
  for (const pr of projectiles) parts.push(projectileDigest(pr));

  return fnv1a(parts.join('|'));
}

function entityDigest(e: Entity): string {
  const rally = e.kind === 'building' && e.rally ? `${round(e.rally.x)},${round(e.rally.y)}` : '-';
  const currentOrder = e.orders[0];
  const order = currentOrder ? `${currentOrder.kind}:${'dest' in currentOrder ? `${round(currentOrder.dest.x)},${round(currentOrder.dest.y)}` : '-'}` : '-';
  return [
    'e',
    e.id,
    e.kind,
    e.defId,
    e.owner,
    round(e.pos.x),
    round(e.pos.y),
    Math.round(e.hp),
    Math.round(e.maxHp),
    Math.round(e.buildProgress * 1000),
    e.repairing ? 1 : 0,
    rally,
    order,
  ].join(':');
}

function projectileDigest(pr: Projectile): string {
  return [
    'pr',
    pr.id,
    pr.owner,
    pr.weaponClass,
    pr.element,
    round(pr.pos.x),
    round(pr.pos.y),
    round(pr.dest.x),
    round(pr.dest.y),
    Math.round(pr.speed * 1000),
    Math.round(pr.damage),
    Math.round(pr.splashRadius * 100),
    pr.targetId ?? '-',
  ].join(':');
}

function round(value: number): number {
  return Math.round(value * 1000);
}

function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
