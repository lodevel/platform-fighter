import { describe, expect, it } from 'vitest';
import { cycleChoice } from './optionsMenu';

const CHOICES = [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }, { value: 'c', label: 'C' }] as const;

describe('cycleChoice', () => {
  it('moves and wraps both ways', () => {
    expect(cycleChoice(CHOICES, 'a', 1)).toBe('b');
    expect(cycleChoice(CHOICES, 'c', 1)).toBe('a');
    expect(cycleChoice(CHOICES, 'a', -1)).toBe('c');
  });
  it('treats an unknown value as the first choice', () => {
    expect(cycleChoice(CHOICES, 'x' as 'a', 1)).toBe('b');
  });
});
