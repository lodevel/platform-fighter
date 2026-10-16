import type { StageLayout } from '../../../../src/types';
import type { StageTheme } from '../contract';
import { crumblingTemple } from './crumblingTemple';
import { inferno } from './inferno';
import { magmaCaldera } from './magmaCaldera';
import { skyFerry } from './skyFerry';
import { skyRuins } from './skyRuins';
import { windCanyon } from './windCanyon';

/**
 * Arena look per `StageLayout.backgroundTheme` (the game's theme ids).
 * Unknown ids (custom stages) fall back to Magma Caldera when the stage has
 * lava, which only it can draw, and to Sky Ruins otherwise.
 */
const THEMES: Readonly<Record<string, StageTheme>> = {
  midnight: skyRuins,
  'lava-cavern': magmaCaldera,
  'wind-canyon': windCanyon,
  'crumbling-temple': crumblingTemple,
  'sky-ferry': skyFerry,
  inferno,
};

export function themeFor(layout: StageLayout): StageTheme {
  const hasLava = layout.hazards.some((h) => h.type === 'lava');
  return THEMES[layout.backgroundTheme ?? ''] ?? (hasLava ? magmaCaldera : skyRuins);
}
