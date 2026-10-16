/** Per-move table: Link's 16 normals against SmashWiki (Link (SSBU) pages,
 * values recorded in linkAttackData.json). One row per strike: first packet's
 * damage / angle / BKB / KBG / FKB and the public 1-based active frames. */
import { describe, expect, it } from 'vitest';
import { FRESH_LINK_NORMALS } from './linkFreshNormals';
import { LINK_NORMAL_RULES, type LinkNormalId } from './linkNormalRules';

type Row = readonly [id: LinkNormalId, strike: string, first: number, last: number,
  damage: number, angle: number, bkb: number, kbg: number, fkb: number];
const TABLE: readonly Row[] = [
  ['link.jab', 'jab1', 7, 8, 3, 361, 25, 25, 0],
  ['link.jab2', 'jab2', 5, 6, 3, 361, 25, 25, 0],
  ['link.jab3', 'jab3', 6, 7, 4, 30, 70, 70, 0],
  ['link.tilt', 'tilt', 15, 19, 13, 361, 55, 82, 0],
  ['link.utilt', 'utilt', 8, 12, 11, 95, 30, 103, 0],
  ['link.dtilt', 'dtilt', 10, 11, 9, 85, 90, 30, 0],
  ['link.dashAttack', 'dash', 20, 23, 14, 45, 70, 85, 0],
  ['link.smash', 'smash1', 17, 18, 7, 69, 45, 12, 0],
  ['link.smash2', 'smash2', 10, 11, 13, 48, 85, 89, 0],
  ['link.usmash', 'hit1', 10, 15, 4, 105, 0, 100, 55],
  ['link.usmash', 'hit2', 25, 30, 3, 105, 0, 100, 55],
  ['link.usmash', 'hit3', 41, 45, 11, 80, 60, 101, 0],
  ['link.dsmash', 'hit1', 12, 13, 16, 78, 40, 88, 0],
  ['link.dsmash', 'hit2', 24, 25, 12, 30, 80, 63, 0],
  ['link.nair', 'nair', 7, 31, 11, 361, 22, 100, 0],
  ['link.fair', 'hit1', 16, 17, 8, 43, 31, 28, 0],
  ['link.fair', 'hit2', 24, 25, 10, 44, 43, 120, 0],
  ['link.bair', 'hit1', 6, 8, 5, 73, 0, 100, 50],
  ['link.bair', 'hit2', 15, 17, 7, 361, 45, 98, 0],
  ['link.uair', 'uair', 11, 40, 15, 85, 23, 93, 0],
  ['link.dair', 'dair', 14, 64, 18, 270, 30, 80, 0],
];

describe('Link normals against SmashWiki', () => {
  it('covers all 16 normals', () => {
    expect(new Set(TABLE.map(r => r[0]))).toEqual(new Set(Object.keys(LINK_NORMAL_RULES)));
    expect(Object.keys(LINK_NORMAL_RULES)).toHaveLength(16);
  });

  it.each(TABLE)('%s %s frames %i-%i', (id, strike, first, last, damage, angle, bkb, kbg, fkb) => {
    const windows = FRESH_LINK_NORMALS[id].hitWindows!.filter(w => w.group === strike);
    expect(windows.length).toBeGreaterThan(0);
    expect(Math.min(...windows.map(w => w.startFrame)) + 1).toBe(first);
    expect(Math.max(...windows.map(w => w.endFrame))).toBe(last);
    const hit = windows[0]!.collisionHits![0]!;
    expect(hit.damage).toBe(damage);
    expect(hit.knockback!.reference).toMatchObject({ angle, base: bkb, growth: kbg, fixed: fkb });
  });

  it('forward smash strike 1 is one strike of three hitboxes (7 / 14 sweetspot / 7), plus the 0% beam', () => {
    const hits = FRESH_LINK_NORMALS['link.smash'].hitWindows![0]!.collisionHits!;
    expect(hits.map(h => [h.damage, h.knockback!.reference!.base, h.knockback!.reference!.growth]))
      .toEqual([[7, 45, 12], [14, 30, 100], [7, 45, 12]]);
  });
});
