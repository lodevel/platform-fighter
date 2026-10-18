import { describe, expect, it } from 'vitest';
import { canonicalJson, withRevision } from './canonical';
import type { CharacterPackage } from './types';
import { SAMPLE } from '../testing/samplePackage';
import { validatePackage } from './validate';

const edit = (change: (pkg: any) => void): unknown => { const pkg = structuredClone(SAMPLE); change(pkg); return pkg; };

describe('validatePackage', () => {
  it('accepts a complete package', () => expect(validatePackage(SAMPLE)).toEqual([]));

  it('rejects gaps, overlaps and windows that do not start at 0', () => {
    expect(validatePackage(edit(p => { p.actions.idle.drawings.windows[1].start = 6; })))
      .toContain('actions.idle.drawings.windows[1]: starts at 6, expected 5 (windows must be contiguous from 0)');
    expect(validatePackage(edit(p => { p.actions.idle.drawings.windows[0].start = 1; })))
      .toContain('actions.idle.drawings.windows[0]: starts at 1, expected 0 (windows must be contiguous from 0)');
    expect(validatePackage(edit(p => { p.actions.idle.drawings.windows = []; })))
      .toContain('actions.idle.drawings.windows: needs at least one window');
  });

  it('rejects references to missing drawings and pages, and unused ones', () => {
    expect(validatePackage(edit(p => { p.actions.idle.drawings.windows[0].drawing = 'run/0'; })))
      .toEqual(expect.arrayContaining(['actions.idle.drawings.windows[0].drawing: unknown drawing run/0', 'drawings.idle/0: no action shows this drawing']));
    expect(validatePackage(edit(p => { p.drawings['idle/1'].page = 'p9'; })))
      .toContain('drawings.idle/1.page: unknown page p9');
    expect(validatePackage(edit(p => { p.pages.p1 = { ...p.pages.p0 }; }))).toEqual(['pages.p1: no drawing uses this page']);
  });

  it('rejects drawings outside their page and unknown fields', () => {
    expect(validatePackage(edit(p => { p.drawings['idle/1'].rect = [40, 0, 32, 32]; }))).toEqual(['drawings.idle/1.rect: outside page p0']);
    expect(validatePackage(edit(p => { p.actions.idle.hurtboxes = []; }))).toEqual(['actions.idle.hurtboxes: unknown field']);
    expect(validatePackage(edit(p => { p.pages.p0.file = '../escape.png'; }))).toEqual(['pages.p0.file: must be a relative path inside the package']);
  });

  it('checks socket values', () => {
    expect(validatePackage(edit(p => { p.actions.idle.sockets.item.schedule.windows[0].length = 2; })))
      .toEqual(['actions.idle.sockets.item.schedule.windows[0].length: must be between 0 and 1']);
  });
});

describe('canonical form', () => {
  it('is independent of key order and sets a content revision', async () => {
    const shuffled = reverseKeys(SAMPLE) as CharacterPackage;
    expect(JSON.stringify(shuffled)).not.toBe(JSON.stringify(SAMPLE));
    expect(canonicalJson(shuffled)).toBe(canonicalJson(SAMPLE));
    const a = await withRevision(SAMPLE), b = await withRevision(edit(p => { p.actions.idle.bodyCentreFromRootY = -21; }) as CharacterPackage);
    expect(a.revision).toMatch(/^[0-9a-f]{64}$/);
    expect((await withRevision(a)).revision).toBe(a.revision);
    expect(b.revision).not.toBe(a.revision);
  });
});

function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverseKeys(child)]));
}
