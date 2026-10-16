import type { PlayerSlot } from '../../../../src/types';

/** Player colours (Smash convention), as CSS custom properties from menu.css. */
export const PLAYER_COLOURS = ['var(--p1)', 'var(--p2)', 'var(--p3)', 'var(--p4)'] as const;
export const CPU_COLOUR = 'var(--cpu)';

export const slotColour = (slotIndex: number): string => PLAYER_COLOURS[(slotIndex - 1) % PLAYER_COLOURS.length]!;
export const playerColour = (p: Pick<PlayerSlot, 'index' | 'inputType'>): string =>
  (p.inputType === 'ai' ? CPU_COLOUR : slotColour(p.index));
