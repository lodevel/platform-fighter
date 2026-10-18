import { describe, expect, it } from 'vitest';
import { SAMPLE } from '../testing/samplePackage';
import { costumePalette } from './palette';

const pkg = { ...SAMPLE, palette: ['#00000000', '#704023ff', '#ffffffff'] };

describe('costumePalette', () => {
  it('is the palette as drawn in costume 0', () => {
    expect([...costumePalette(pkg, 0)]).toEqual([0, 0, 0, 0, 0x70, 0x40, 0x23, 255, 255, 255, 255, 255]);
  });
  it('moves the region colour to the costume colour and leaves other entries alone', () => {
    const blue = costumePalette(pkg, 1);
    // Costume 1 turns fur #6b4a2b (costume 0) into #2b62d9; the region key #704023 follows the same shift.
    expect(blue[6]! > blue[4]! && blue[6]! > 150).toBe(true);
    expect([...blue.slice(0, 4)]).toEqual([0, 0, 0, 0]);
    expect([...blue.slice(8)]).toEqual([255, 255, 255, 255]);
  });
});
