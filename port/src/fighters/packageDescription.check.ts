import { describe, expect, it } from 'vitest';
import { SAMPLE } from '../../../character/testing/samplePackage';
import { decodeDescription, describePackage, encodeDescription, PALETTE_WIDTH } from './packageDescription';

describe('package descriptions', () => {
  const pkg = { ...SAMPLE, palette: ['#00000000', '#704023ff'], pages: { p0: { ...SAMPLE.pages.p0!, format: 'indexed' as const } } };
  const bytes = new TextEncoder().encode(JSON.stringify(pkg, null, 2));

  it('parses, validates and builds one palette row per costume', () => {
    const described = describePackage('sample', bytes, undefined);
    expect([described.pkg, described.costumes, described.palette.length]).toEqual([pkg, 2, PALETTE_WIDTH * 2 * 4]);
    expect(() => describePackage('sample', bytes, 'other')).toThrow(/sample: package revision .* is not the pinned other/);
  });

  it('crosses from the worker as compact JSON bytes and comes back equal', () => {
    const described = describePackage('sample', bytes, undefined), encoded = encodeDescription(described);
    expect(encoded.json.length).toBeLessThan(bytes.length);
    expect(decodeDescription(encoded)).toEqual(described);
  });
});
