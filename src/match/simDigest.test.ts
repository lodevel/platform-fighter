import { describe, expect, it } from 'vitest';
import { fnv1a64, simDigest } from './simDigest';

describe('fnv1a64', () => {
  it('equals independent BigInt arithmetic for arbitrary UTF-16, long records and overflowing words', () => {
    const reference = (value: string) => {
      let hash = 0xcbf29ce484222325n;
      for (let i = 0; i < value.length; i++) {
        for (const byte of [value.charCodeAt(i) & 255, value.charCodeAt(i) >>> 8]) {
          hash = ((hash ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn;
        }
      }
      return hash.toString(16).padStart(16, '0');
    };
    let seed = 0x7394abcd;
    for (let length = 0; length < 2048; length += 13) {
      let value = '';
      for (let i = 0; i < length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        value += String.fromCharCode(seed & 0xffff);
      }
      expect(fnv1a64(value)).toBe(reference(value));
    }
    const record = JSON.stringify({ world: Array.from({ length: 4000 }, (_, i) => ({ id: i, x: i * .125, label: '世界⚡' })) });
    expect(fnv1a64(record)).toBe(reference(record));
  });

  it('matches the FNV-1a 64 reference values (low byte then high byte per code unit)', () => {
    expect(fnv1a64('')).toBe('cbf29ce484222325');
    expect(fnv1a64('a')).toBe('089be207b544f1e4');
  });
});

describe('simDigest', () => {
  it('keeps the evidence text and hashes it', () => {
    const evidence = JSON.stringify({ frame: 7, world: [1, 2] });
    const digest = simDigest(evidence);
    expect(digest.text).toBe(evidence);
    expect(digest.hash).toBe(fnv1a64(evidence));
    expect(simDigest(JSON.stringify({ frame: 8, world: [1, 2] })).hash).not.toBe(digest.hash);
  });
});
