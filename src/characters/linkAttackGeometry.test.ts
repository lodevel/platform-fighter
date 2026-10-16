/** Schema and coverage checks for the generated native hit geometry
 * (tools/native-hit-positions.py --fighter link). */
import { describe, expect, it } from 'vitest';
import geometry from './linkAttackGeometry.json';
import { LINK_ATTACK_DATA } from './linkAttackData';
import { LINK_NORMAL_RULES } from './linkNormalRules';

interface Row {
  readonly age: number; readonly bone: string; readonly end: readonly number[]; readonly id: number;
  readonly radius: number; readonly role: string; readonly sample: number; readonly start: readonly number[];
  readonly situation?: string;
}
interface Move { readonly kind: string; readonly motion: string; readonly nativeFrames: number; readonly rows: readonly Row[]; }
const moves = geometry.moves as unknown as Record<string, Move>;
const ids = (packets: readonly { readonly id: number }[]) => new Set(packets.map(p => p.id));
const key = (r: Row) => `${r.age}/${r.role}/${r.id}`;

function numbers(value: unknown, path: string, out: string[] = []): string[] {
  if (typeof value === 'number') { if (!Number.isFinite(value)) out.push(path); }
  else if (Array.isArray(value)) value.forEach((v, i) => numbers(v, `${path}[${i}]`, out));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([k, v]) => numbers(v, `${path}.${k}`, out));
  return out;
}

describe('link attack geometry data', () => {
  it('has the declared schema, units and only finite numbers', () => {
    expect(geometry.schema).toBe('link-attack-geometry/1');
    expect(geometry.bodyCentreFromRootY).toBe(-36);
    expect(numbers(geometry, 'geometry')).toEqual([]);
  });

  it('covers the 16 normals, 4 recovery attacks, both spins and the 3 catch boxes', () => {
    expect(Object.keys(moves).sort()).toEqual([
      ...Object.keys(LINK_NORMAL_RULES), 'link.getupAttack', 'link.getupAttackFaceDown', 'link.tripAttack',
      'link.ledgeAttack', 'link.spin.ground', 'link.spin.air', 'link.catch', 'link.catch_dash', 'link.catch_turn'].sort());
  });

  it('keeps every row well formed, unique and in sorted order', () => {
    for (const [name, move] of Object.entries(moves)) {
      const seen = new Set<string>();
      let previous = '';
      for (const r of move.rows) {
        expect(r.end).toHaveLength(2); expect(r.start).toHaveLength(2);
        expect(r.radius, `${name} ${key(r)} radius`).toBeGreaterThan(0);
        for (const v of [...r.start, ...r.end]) expect(Math.abs(v), `${name} ${key(r)} offset`).toBeLessThan(500);
        expect(Number.isInteger(r.age) && r.age >= 0 && Number.isInteger(r.sample) && r.sample >= 0).toBe(true);
        expect(seen.has(key(r)), `${name} duplicate ${key(r)}`).toBe(false);
        seen.add(key(r));
        const order = `${String(r.age).padStart(4, '0')}/${r.role}/${String(r.id).padStart(3, '0')}`;
        expect(order >= previous, `${name} order at ${key(r)}`).toBe(true);
        previous = order;
      }
    }
  });

  it('gives each normal rows for every age of every source window, with known packet ids', () => {
    for (const [name, rule] of Object.entries(LINK_NORMAL_RULES)) {
      const move = moves[name]!, phases = LINK_ATTACK_DATA.normals[name]!.phases;
      expect(move.kind).toBe('normal');
      for (const r of move.rows) {
        expect(r.age, `${name} ${key(r)} inside the move`).toBeLessThan(rule.animationFrames);
        expect(phases[r.role] && ids(phases[r.role]!.packets).has(r.id), `${name} ${key(r)} packet id`).toBe(true);
      }
      for (const w of rule.windows) {
        for (let age = w.first - 1; age <= w.last - 1; age++) {
          for (const p of phases[w.role]!.packets)
            expect(move.rows.some(r => r.age === age && r.role === w.role && r.id === p.id), `${name} ${w.role}/${p.id} age ${age}`).toBe(true);
        }
      }
    }
  });

  it('gives each recovery attack rows for its phases within the public animation length', () => {
    for (const [id, row] of Object.entries(LINK_ATTACK_DATA.recovery)) {
      const move = moves[id]!;
      expect(move.kind).toBe('recovery');
      for (const r of move.rows) {
        expect(r.age).toBeLessThan(row.animationFrames);
        expect(r.id).toBe(row.phases[0]!.packets[0]!.id);
      }
      for (const phase of row.phases) {
        for (let age = phase.first - 1; age <= phase.last - 1; age++) {
          expect(move.rows.some(r => r.age === age && r.role === phase.role), `${id} ${phase.role} age ${age}`).toBe(true);
        }
      }
    }
  });

  it('gives each spin and catch rows with known packet ids inside the native motion', () => {
    const spinIds = new Map<string, Set<number>>();
    for (const variant of ['ground', 'air'] as const) {
      for (const g of LINK_ATTACK_DATA.spin[variant].phases) spinIds.set(`link.spin.${variant}/${g.role}`, ids(g.packets));
    }
    for (const name of ['link.spin.ground', 'link.spin.air']) {
      const move = moves[name]!;
      expect(move.rows.length).toBeGreaterThan(0);
      for (const r of move.rows) {
        expect(r.age).toBeLessThan(move.nativeFrames);
        expect(spinIds.get(`${name}/${r.role}`)?.has(r.id), `${name} ${key(r)} packet id`).toBe(true);
      }
    }
    for (const name of ['link.catch', 'link.catch_dash', 'link.catch_turn']) {
      const move = moves[name]!;
      expect(new Set(move.rows.map(r => `${r.id}${r.situation}`))).toEqual(new Set(['0G', '1A']));
      for (const r of move.rows) expect(r.age).toBeLessThan(move.nativeFrames);
    }
  });

  it('lists release points for the arrow, boomerang, bomb and Ancient Arrow', () => {
    const articles = new Set(geometry.releasePoints.map(p => p.article));
    expect([...articles].sort()).toEqual(['ancientArrow', 'arrow', 'bomb', 'boomerang']);
    for (const p of geometry.releasePoints) {
      expect(p.point).toHaveLength(2);
      expect(p.age).toBeGreaterThanOrEqual(0);
      expect(p.sample).toBeGreaterThanOrEqual(0);
    }
  });
});
