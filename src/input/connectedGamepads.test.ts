import { describe, expect, it } from 'vitest';
import { connectedGamepad, connectedGamepads, type IndexedGamepad } from './connectedGamepads';

describe('connected controller collection', () => {
  it('filters sparse/disconnected entries without renumbering or copying controller objects', () => {
    const one = { index: 1, connected: true, id: 'first' };
    const five = { index: 5, connected: true, id: 'second' };
    const pads: Array<typeof one | null | undefined> = [];
    pads[1] = one;
    pads[2] = null;
    pads[3] = { index: 3, connected: false, id: 'removed' };
    pads[5] = five;
    const live = connectedGamepads(pads);
    expect(live).toEqual([one, five]);
    expect(live[0]).toBe(one);
    expect(live[1]).toBe(five);
    expect(pads[5]).toBe(five);
    expect(0 in pads).toBe(false);
    expect(connectedGamepad(live, 1)).toBe(one);
    expect(connectedGamepad(live, 5)).toBe(five);
    expect(connectedGamepad(live, 0)).toBeUndefined();
  });

  it('does not match an absent keyboard/CPU controller index to an array hole', () => {
    const pads: Array<IndexedGamepad | undefined> = [];
    pads[1] = { index: 1, connected: true };
    expect(connectedGamepad(pads, undefined)).toBeUndefined();
    expect(connectedGamepad(pads, 1)).toBe(pads[1]);
    expect(connectedGamepads(undefined)).toEqual([]);
    expect(connectedGamepad(undefined, 1)).toBeUndefined();
  });

  it('reflects disconnect and index reuse on each read, without caching the old controller', () => {
    const old = { index: 1, connected: true };
    const pads = [undefined, old];
    expect(connectedGamepad(pads, 1)).toBe(old);
    old.connected = false;
    expect(connectedGamepad(pads, 1)).toBeUndefined();
    expect(connectedGamepads(pads)).toEqual([]);
    const replacement = { index: 1, connected: true };
    pads[1] = replacement;
    expect(connectedGamepad(pads, 1)).toBe(replacement);
  });

  it('accepts wrappers without a connection flag but rejects invalid physical indices', () => {
    const valid = { index: 5 };
    const pads = [valid, ...[-1, 0.5, NaN, Infinity].map(index => ({ index }))];
    expect(connectedGamepads(pads)).toEqual([valid]);
    for (const index of [-1, 0.5, NaN, Infinity]) {
      expect(connectedGamepad(pads, index)).toBeUndefined();
    }
  });
});
