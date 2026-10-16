/** Ultimate technical data published by SmashWiki, captured 2026-10-07.
 * Five pixels per native unit matches this game's source-coordinate contract.
 * This preset is sourced; its custom 2D execution is not a native-engine parity claim.
 */
import type { AttackMove } from './attacks';
import type { ProjectileSpecialMove } from './specialSchema';
import type { DashStrikeSideSpecialMove } from './sideSpecialSchema';
import type { DirectionalJumpUpSpecialMove } from './upSpecialSchema';
import type { ThunderDownSpecialMove } from './downSpecialSchema';

export type PikachuSpecialKind = 'thunderJolt' | 'skullBash' | 'quickAttack' | 'thunder';
export interface PikachuSpecialPreset {
  readonly kind: PikachuSpecialKind;
  readonly source: 'ssbu-published-2026-10-07';
}
export function validatePikachuSpecialPreset(raw: unknown): PikachuSpecialPreset {
  const x = raw as Partial<PikachuSpecialPreset> | null;
  if (!x || x.source !== 'ssbu-published-2026-10-07'
    || !['thunderJolt', 'skullBash', 'quickAttack', 'thunder'].includes(x.kind ?? '')) {
    throw new Error('Unknown Pikachu special mechanic preset');
  }
  return { kind: x.kind!, source: x.source };
}
const preset = (kind: PikachuSpecialKind): PikachuSpecialPreset => ({ kind, source: 'ssbu-published-2026-10-07' });
export const PIKACHU_SPECIAL_SCALE = 5;
export function pikachuSpecialKnockback(angle: number, base: number, growth: number, fixed?: number): AttackMove['knockback'] {
  return { x: angle <= 360 ? Math.cos(angle * Math.PI / 180) : 1,
    y: angle <= 360 ? -Math.sin(angle * Math.PI / 180) : 0, scaling: 0,
    reference: { angle, base, growth, ...(fixed === undefined ? {} : { fixed }) } };
}
const base = (id: string, type: AttackMove['type'], damage: number, startup: number, active: number, total: number,
  knockback: AttackMove['knockback']): AttackMove => ({ id: `pikachu.${id}`, type, damage, knockback,
  hitbox: { offsetX: 0, offsetY: 0, width: 30, height: 30 }, startupFrames: startup,
  activeFrames: active, recoveryFrames: total - startup - active, cooldownFrames: 0 });
export const PIKACHU_NEUTRAL_SPECIAL: ProjectileSpecialMove = {
  ...base('neutral_special', 'special', 4.8, 18, 1, 51, pikachuSpecialKnockback(361, 35, 30)), type: 'special',
  specialKind: 'projectile', pikachuSpecial: preset('thunderJolt'), hitlagMultiplier: 0.3, shieldDamage: -1.9, electricCollision: true,
  projectile: { speed: 2 * 5, lifetimeFrames: 98, width: 30, height: 30, spawnOffsetX: 6.5 * 5, spawnOffsetY: 25 - 1 * 5 },
};
export const PIKACHU_SIDE_SPECIAL: DashStrikeSideSpecialMove = {
  ...base('side_special', 'sideSpecial', 6.2, 17, 35, 96, pikachuSpecialKnockback(361, 40, 78)), type: 'sideSpecial',
  sideSpecialKind: 'dashStrike', pikachuSpecial: preset('skullBash'),
  dashStrike: { dashSpeed: 1.6 * 5, dashFrames: 35, helplessAfterDash: false },
};
export const PIKACHU_UP_SPECIAL: DirectionalJumpUpSpecialMove = {
  ...base('up_special', 'upSpecial', 2, 14, 5, 52, pikachuSpecialKnockback(70, 20, 50)), type: 'upSpecial',
  upSpecialKind: 'directionalJump', pikachuSpecial: preset('quickAttack'), shieldDamage: 5, electricCollision: true,
  specialLandingLagFrames: 24,
  directionalJump: { burstSpeed: 11 * 5, burstFrames: 5, snapToOctant: false, helplessAfterBurst: true },
};
export const PIKACHU_DOWN_SPECIAL: ThunderDownSpecialMove = {
  ...base('down_special', 'downSpecial', 15, 12, 3, 86, pikachuSpecialKnockback(361, 70, 77)), type: 'downSpecial',
  downSpecialKind: 'thunder', pikachuSpecial: preset('thunder'),
  shieldDamage: 2, launchDirection: 'position', electricCollision: true,
};
export function createPikachuSpecialMoves() {
  return { neutralSpecial: PIKACHU_NEUTRAL_SPECIAL, sideSpecial: PIKACHU_SIDE_SPECIAL,
    upSpecial: PIKACHU_UP_SPECIAL, downSpecial: PIKACHU_DOWN_SPECIAL };
}
export const PIKACHU_SPECIAL_SOURCE = {
  urls: ['Neutral_special', 'Side_special', 'Up_special', 'Down_special'].map(move => `https://www.ssbwiki.com/Pikachu_(SSBU)/${move}`),
  captures: 'docs/review/2026-10-06/pikachu-character/sources/special-wiki-{other,up}-current.json',
  runtimeUnits: '5 pixels per native unit; screen Y down; frame windows zero-based and half-open',
  framePolicy: 'Published gameplay intervals; conditional local status clocks remain separate from original press',
};
