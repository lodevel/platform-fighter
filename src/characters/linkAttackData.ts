/** Link's melee move data, the way DK's comes from donkeykongAttackData.ts:
 * packet values and public windows from linkAttackData.json (SmashWiki wins
 * over native script values; overrides recorded in that file) and per-age
 * capsules from linkAttackGeometry.json (posed native skeleton,
 * tools/native-hit-positions.py). One builder turns them into engine
 * hit windows for the normals, the recovery attacks and Spin Attack. */
import data from './linkAttackData.json';
import geometry from './linkAttackGeometry.json';
import type { AttackCollisionHit, AttackHitWindow, AttackMove } from './attacks';
import { attackSensorGeometry } from './attacks';

export interface LinkAttackPacket {
  readonly id: number;
  readonly damage: number;
  readonly angle: number;
  readonly bkb: number;
  readonly kbg: number;
  readonly fkb: number;
  readonly setWeight?: boolean;
  readonly hitlag: number;
  readonly sdi: number;
  readonly shieldDamage: number;
  readonly trip?: number;
  readonly setoff: 'on' | 'off' | 'through';
  readonly lr: 'forward' | 'back' | 'position';
  readonly situation?: 'ground' | 'air';
  readonly category?: 'fighter';
  readonly attribute: string;
  readonly height?: 'low' | 'high';
  readonly heightSource?: { readonly sourceScript: string; readonly sourceLine: number };
  /** Only for a SmashWiki-only packet with no native sample (Dair after bounce). */
  readonly capsule?: { readonly x: number; readonly y: number; readonly radius: number };
}
export interface LinkNormalPhaseData { readonly nativeStart: number | null; readonly packets: readonly LinkAttackPacket[] }
export interface LinkRecoveryPhaseData { readonly first: number; readonly last: number; readonly role: string; readonly packets: readonly LinkAttackPacket[] }
export interface LinkRecoveryData {
  readonly motion: string; readonly firstActionable: number; readonly animationFrames: number;
  /** Public intangibility end (exclusive, 1-based) by ledge-grab count; one entry for getups. */
  readonly intangibleUntilByGrab: readonly number[];
  readonly phases: readonly LinkRecoveryPhaseData[];
}
export interface LinkSpinPhaseData {
  readonly role: string; readonly active: readonly [number, number]; readonly nativeStart: number;
  readonly packets: readonly LinkAttackPacket[];
}
export interface LinkSpinData { readonly motion: string; readonly phases: readonly LinkSpinPhaseData[] }

export const LINK_ATTACK_DATA = data as unknown as {
  readonly normals: Readonly<Record<string, { readonly phases: Readonly<Record<string, LinkNormalPhaseData>> }>>;
  readonly recovery: Readonly<Record<string, LinkRecoveryData>>;
  readonly spin: { readonly ground: LinkSpinData; readonly air: LinkSpinData };
};

interface GeometryRow {
  readonly age: number; readonly id: number; readonly role: string; readonly radius: number;
  readonly start: readonly [number, number]; readonly end: readonly [number, number];
}
const GEOMETRY = geometry.moves as unknown as Readonly<Record<string, { readonly rows: readonly GeometryRow[] }>>;
type Capsule = AttackCollisionHit['capsule'];

/** The capsule of one packet at one gameplay age (geometry move key, e.g. `link.jab`, `link.spin.air`). */
export function linkGeometryCapsule(move: string, age: number, role: string, id: number): Capsule {
  const row = GEOMETRY[move]?.rows.find(r => r.age === age && r.role === role && r.id === id);
  if (!row) throw new Error(`Missing Link hit geometry: ${move} age ${age} ${role} id ${id}`);
  return { start: { x: row.start[0], y: row.start[1] }, end: { x: row.end[0], y: row.end[1] }, radius: row.radius };
}

export function linkPacketKnockback(p: LinkAttackPacket): AttackMove['knockback'] {
  return { x: 0, y: 0, scaling: 0, reference: { angle: p.angle, base: p.bkb, growth: p.kbg, fixed: p.fkb, setWeight: p.setWeight === true } };
}

/** Engine hit values of one packet; the caller supplies the capsule. */
export function linkPacketHit(p: LinkAttackPacket): Omit<AttackCollisionHit, 'capsule'> {
  return { id: p.id, damage: p.damage, knockback: linkPacketKnockback(p), hitlagMultiplier: p.hitlag, sdiMultiplier: p.sdi,
    shieldDamage: p.shieldDamage, nativeCollisionAttribute: p.attribute, setoff: p.setoff, launchDirection: p.lr,
    targetCategory: p.category ?? 'all',
    ...(p.trip ? { tripChance: p.trip } : {}),
    ...(p.situation ? { situation: p.situation } : {}),
    ...(p.height ? { nativeAttackHeight: p.height, nativeAttackHeightSource: p.heightSource } : {}) };
}

const sameHits = (a: readonly AttackCollisionHit[], b: readonly AttackCollisionHit[]) =>
  a.length === b.length && a.every((h, i) => JSON.stringify(h) === JSON.stringify(b[i]));

/** One strike's hit windows over zero-based ages [firstAge, lastAge]. A capsule
 * that moves gets a window per age; every window of the strike shares `group`,
 * so a victim is hit once per strike. Unchanged consecutive ages merge. */
export function linkStrikeWindows(move: string, firstAge: number, lastAge: number, role: string, group: string,
  packets: readonly LinkAttackPacket[]): AttackHitWindow[] {
  const windows: AttackHitWindow[] = [];
  for (let age = firstAge; age <= lastAge; age++) {
    const collisionHits = packets.map(p => ({ ...linkPacketHit(p), capsule: linkGeometryCapsule(move, age, role, p.id) }));
    const previous = windows.at(-1);
    if (previous?.collisionHits && sameHits(previous.collisionHits, collisionHits)) {
      windows[windows.length - 1] = { ...previous, endFrame: age + 1 };
      continue;
    }
    windows.push({ startFrame: age, endFrame: age + 1, group, damage: packets[0]!.damage,
      shieldDamage: packets[0]!.shieldDamage, collisionHits });
  }
  return windows;
}

interface ReleaseRow { readonly move: string; readonly bone: string; readonly point: readonly [number, number] }
const RELEASES = geometry.releasePoints as unknown as readonly ReleaseRow[];
/** Native bone each article leaves from (A1/crosscheck.md): the Bow's Pull
 * bone for the arrow, the throwing right hand for the boomerang and the bomb,
 * the bow hand (right) at Final frame 60 for the Ancient Arrow (its model origin
 * sits on the bow; the drawn shaft then ends at the drawing left hand). */
const RELEASE_SOURCE = { arrow: ['link.neutral_special', 'bow:pull'], boomerang: ['link.side_special', 'haver'],
  bomb: ['link.down_special', 'haver'], ancientArrow: ['link.final', 'haver'] } as const;
export type LinkArticleKind = keyof typeof RELEASE_SOURCE;
/** Where an article spawns, fighter-local px (x forward, y down from the body centre). */
export function linkReleasePoint(article: LinkArticleKind, airborne: boolean): { readonly x: number; readonly y: number } {
  const [move, bone] = RELEASE_SOURCE[article], key = airborne ? `${move}_air` : move;
  const row = RELEASES.find(r => r.move === key && r.bone === bone);
  if (!row) throw new Error(`Missing Link release point: ${key} ${bone}`);
  return { x: row.point[0], y: row.point[1] };
}

/** The broadphase box that holds every capsule of the move. */
export function linkMoveBounds(windows: readonly AttackHitWindow[]): AttackMove['hitbox'] {
  const collisionHits = windows.flatMap(w => w.collisionHits ?? []);
  if (!collisionHits.length) throw new Error('Link move has no hit geometry');
  return attackSensorGeometry({ hitbox: { offsetX: 0, offsetY: 0, width: 0, height: 0 }, collisionHits });
}
