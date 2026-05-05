/**
 * AC 14 Sub-AC 3 — reconnect-prompt formatter tests.
 *
 * Pure-function coverage for the strings + colour ramp the overlay
 * paints. Mirrors the structure of `damageHudFormat.test.ts` and
 * `desyncReportFormat.test.ts` — every helper called directly under
 * plain Node + vitest, no Phaser.
 */

import { describe, expect, it } from 'vitest';
import {
  RECONNECT_SLOT_ACCENTS,
  buildPromptLines,
  colorIntToHexString,
  formatAffectedSlotsLabel,
  formatPromptBodyLines,
  formatPromptHeadline,
  formatSlotLabel,
  pickPadHintLabel,
  shouldShowOverlay,
  slotAccentColor,
  type ReconnectPromptSnapshot,
} from './reconnectPromptFormat';
import type { PlayerBindingsIndex } from '../types/inputBindings';

// ---------------------------------------------------------------------------
// formatSlotLabel + formatAffectedSlotsLabel
// ---------------------------------------------------------------------------

describe('formatSlotLabel', () => {
  it('renders P1..P4 for each ontology slot', () => {
    expect(formatSlotLabel(1)).toBe('P1');
    expect(formatSlotLabel(2)).toBe('P2');
    expect(formatSlotLabel(3)).toBe('P3');
    expect(formatSlotLabel(4)).toBe('P4');
  });
});

describe('formatAffectedSlotsLabel', () => {
  it('returns the generic "Controller" noun for an empty slot list', () => {
    expect(formatAffectedSlotsLabel([])).toBe('Controller');
  });

  it('renders a single slot bare', () => {
    expect(formatAffectedSlotsLabel([1])).toBe('P1');
    expect(formatAffectedSlotsLabel([3])).toBe('P3');
  });

  it('joins two slots with " + "', () => {
    expect(formatAffectedSlotsLabel([1, 3])).toBe('P1 + P3');
    expect(formatAffectedSlotsLabel([2, 4])).toBe('P2 + P4');
  });

  it('joins three+ slots Oxford-style — commas then " + " for the tail', () => {
    expect(formatAffectedSlotsLabel([1, 2, 3])).toBe('P1, P2 + P3');
    expect(formatAffectedSlotsLabel([1, 2, 3, 4])).toBe('P1, P2, P3 + P4');
  });

  it('preserves input ordering — caller already sorts', () => {
    expect(formatAffectedSlotsLabel([3, 1])).toBe('P3 + P1');
  });
});

// ---------------------------------------------------------------------------
// formatPromptHeadline
// ---------------------------------------------------------------------------

describe('formatPromptHeadline', () => {
  it('names the slot for a single-slot waiting state', () => {
    expect(
      formatPromptHeadline({ affectedSlots: [1], phase: 'waiting' }),
    ).toBe('P1 — Controller disconnected');
  });

  it('uses the plural noun for a multi-slot waiting state', () => {
    expect(
      formatPromptHeadline({ affectedSlots: [1, 3], phase: 'waiting' }),
    ).toBe('P1 + P3 — Controllers disconnected');
  });

  it('falls back to the generic noun when no slot is named', () => {
    expect(formatPromptHeadline({ affectedSlots: [], phase: 'waiting' })).toBe(
      'Controller disconnected',
    );
  });

  it('switches the headline copy for partial-reconnect states', () => {
    expect(
      formatPromptHeadline({ affectedSlots: [3], phase: 'partial-reconnect' }),
    ).toBe('P3 — Still disconnected');
    expect(
      formatPromptHeadline({
        affectedSlots: [1, 2],
        phase: 'partial-reconnect',
      }),
    ).toBe('P1 + P2 — Still disconnected');
  });

  it('reads as singular for the reconnected phase', () => {
    expect(formatPromptHeadline({ affectedSlots: [], phase: 'reconnected' }))
      .toBe('Controller reconnected');
    // Even with leftover affected slots, the reconnected phase reads
    // singular — by definition every tracked pad is back.
    expect(
      formatPromptHeadline({ affectedSlots: [1, 2], phase: 'reconnected' }),
    ).toBe('Controller reconnected');
  });

  it('reads "Continuing without controller" for acknowledged dismissals', () => {
    expect(
      formatPromptHeadline({ affectedSlots: [], phase: 'acknowledged' }),
    ).toBe('Continuing without controller');
  });
});

// ---------------------------------------------------------------------------
// formatPromptBodyLines
// ---------------------------------------------------------------------------

describe('formatPromptBodyLines', () => {
  it('produces a generic plug-in hint when no padLabel is known', () => {
    expect(formatPromptBodyLines({ affectedSlots: [1], phase: 'waiting' }))
      .toEqual([
        'Plug the controller back in to resume.',
        'Press Start on a connected pad to continue without it.',
      ]);
  });

  it('quotes the device name when a padLabel is provided', () => {
    const lines = formatPromptBodyLines({
      affectedSlots: [3],
      padLabels: ['Xbox 360 Controller'],
      phase: 'waiting',
    });
    expect(lines[0]).toBe('Plug "Xbox 360 Controller" back in to resume.');
    expect(lines).toHaveLength(2);
  });

  it('falls back to the generic hint when every padLabel is empty / placeholder', () => {
    const lines = formatPromptBodyLines({
      affectedSlots: [3],
      padLabels: ['', '   ', 'Unknown Gamepad (1234-abcd)'],
      phase: 'waiting',
    });
    expect(lines[0]).toBe('Plug the controller back in to resume.');
  });

  it('flips the noun to plural for a multi-pad partial-reconnect', () => {
    const lines = formatPromptBodyLines({
      affectedSlots: [1, 3],
      phase: 'partial-reconnect',
    });
    expect(lines[0]).toBe('Still waiting on the remaining controllers.');
  });

  it('keeps the noun singular for a single-pad partial-reconnect', () => {
    const lines = formatPromptBodyLines({
      affectedSlots: [3],
      phase: 'partial-reconnect',
    });
    expect(lines[0]).toBe('Still waiting on the remaining controller.');
  });

  it('produces a single resume line for the reconnected phase', () => {
    expect(
      formatPromptBodyLines({ affectedSlots: [], phase: 'reconnected' }),
    ).toEqual(['Resuming match…']);
  });

  it('produces an explicit dismiss line for the acknowledged phase', () => {
    expect(
      formatPromptBodyLines({ affectedSlots: [], phase: 'acknowledged' }),
    ).toEqual([
      'Match continued. Plug a controller in any time to take over.',
    ]);
  });
});

// ---------------------------------------------------------------------------
// pickPadHintLabel
// ---------------------------------------------------------------------------

describe('pickPadHintLabel', () => {
  it('returns null for an empty / null list', () => {
    expect(pickPadHintLabel([])).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(pickPadHintLabel(null as any)).toBeNull();
  });

  it('returns the first usable label, trimmed', () => {
    expect(pickPadHintLabel(['  Xbox 360 Controller  '])).toBe(
      'Xbox 360 Controller',
    );
  });

  it('skips empty / whitespace / "Unknown Gamepad" placeholders', () => {
    expect(
      pickPadHintLabel(['', '   ', 'Unknown Gamepad (xxxx)', 'DualSense']),
    ).toBe('DualSense');
  });

  it('truncates labels longer than the panel can accommodate', () => {
    const long = 'Wireless ' + 'XYZ '.repeat(40);
    const out = pickPadHintLabel([long]);
    expect(out).not.toBeNull();
    expect(out!.length).toBeLessThanOrEqual(46);
    expect(out!.endsWith('…')).toBe(true);
  });

  it('returns null when the only entries are non-strings', () => {
    expect(
      pickPadHintLabel([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        12345 as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        null as any,
      ]),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Slot accent ramp
// ---------------------------------------------------------------------------

describe('slotAccentColor / RECONNECT_SLOT_ACCENTS', () => {
  it('exposes one entry per ontology slot', () => {
    expect(RECONNECT_SLOT_ACCENTS).toHaveLength(4);
    const slots = RECONNECT_SLOT_ACCENTS.map((e) => e.slot).sort();
    expect(slots).toEqual([1, 2, 3, 4]);
  });

  it('returns the per-slot tint for known indices', () => {
    expect(slotAccentColor(1)).toBe(0xff7b6b);
    expect(slotAccentColor(2)).toBe(0x6bb8ff);
    expect(slotAccentColor(3)).toBe(0x6cf0c2);
    expect(slotAccentColor(4)).toBe(0xffe066);
  });

  it('falls back to a neutral slate for an unknown index', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(slotAccentColor(7 as any)).toBe(0xa0a0b8);
  });

  it('the ramp itself is frozen at every level', () => {
    expect(Object.isFrozen(RECONNECT_SLOT_ACCENTS)).toBe(true);
    for (const entry of RECONNECT_SLOT_ACCENTS) {
      expect(Object.isFrozen(entry)).toBe(true);
    }
  });
});

describe('colorIntToHexString', () => {
  it('zero-pads to six hex digits', () => {
    expect(colorIntToHexString(0)).toBe('#000000');
    expect(colorIntToHexString(0xff)).toBe('#0000ff');
    expect(colorIntToHexString(0xff6b6b)).toBe('#ff6b6b');
  });

  it('clamps non-finite / out-of-range values', () => {
    expect(colorIntToHexString(Number.NaN)).toBe('#000000');
    expect(colorIntToHexString(-1)).toBe('#000000');
    expect(colorIntToHexString(0x1ffffff)).toBe('#ffffff');
  });
});

// ---------------------------------------------------------------------------
// buildPromptLines + shouldShowOverlay
// ---------------------------------------------------------------------------

describe('buildPromptLines', () => {
  it('builds the full headline + body block in array order', () => {
    const lines = buildPromptLines({ affectedSlots: [1], phase: 'waiting' });
    expect(lines).toEqual([
      'P1 — Controller disconnected',
      'Plug the controller back in to resume.',
      'Press Start on a connected pad to continue without it.',
    ]);
  });

  it('returns a frozen array', () => {
    const lines = buildPromptLines({ affectedSlots: [1], phase: 'waiting' });
    expect(Object.isFrozen(lines)).toBe(true);
  });

  it('renders a multi-pad partial-reconnect coherently', () => {
    const lines = buildPromptLines({
      affectedSlots: [1, 3],
      phase: 'partial-reconnect',
    });
    expect(lines).toEqual([
      'P1 + P3 — Still disconnected',
      'Still waiting on the remaining controllers.',
      'Press Start on a connected pad to continue without it.',
    ]);
  });

  it('produces deterministic output across repeated calls', () => {
    const snapshot: ReconnectPromptSnapshot = {
      affectedSlots: [2 as PlayerBindingsIndex],
      padLabels: ['DualSense Wireless Controller'],
      phase: 'waiting',
    };
    const a = buildPromptLines(snapshot);
    const b = buildPromptLines(snapshot);
    expect(a).toEqual(b);
  });
});

describe('shouldShowOverlay', () => {
  it('shows the overlay during waiting and partial-reconnect phases', () => {
    expect(shouldShowOverlay({ affectedSlots: [1], phase: 'waiting' })).toBe(
      true,
    );
    expect(
      shouldShowOverlay({ affectedSlots: [1], phase: 'partial-reconnect' }),
    ).toBe(true);
  });

  it('hides the overlay once every pad is back or the player dismissed', () => {
    expect(shouldShowOverlay({ affectedSlots: [], phase: 'reconnected' }))
      .toBe(false);
    expect(shouldShowOverlay({ affectedSlots: [], phase: 'acknowledged' }))
      .toBe(false);
  });

  it('returns false for null / missing snapshot', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(shouldShowOverlay(null as any)).toBe(false);
  });
});
