import { describe, expect, it } from 'vitest';
import { pikachuCrawlMotion, pikachuCrouchCrawlDrawing, tickPikachuCrouchCrawl,
  type PikachuCrouchCrawlInput, type PikachuCrouchCrawlState } from './pikachuCrouchCrawl';
const down: PikachuCrouchCrawlInput = { down: true, moveX: 0, facing: 1, grounded: true, eligible: true };

describe('Pikachu source-guided crouch and crawl', () => {
  it('source Trans delta conserves displacement over repeated16/22-native-step loops in both facings', () => {
    // Independently parsed source final Trans.z values, measured by
    // tools/pikachu-locomotion-source-audit.py / ssbh_data_py0.9.1.
    for (const [sheet, frames, nativeEndZ] of [['crawl', 16, 10.074700355529785], ['crawl_back', 22, -9.789999961853027]] as const)
      for (const facing of [1, -1] as const) {
        const steps = Array.from({ length: frames * 3 }, (_, age) => pikachuCrawlMotion(sheet, age, facing)!);
        expect(steps.reduce((sum, s) => sum + s.velocityX, 0)).toBeCloseTo(nativeEndZ * 5 * facing * 3, 8);
        expect(steps[frames]!.phase).toBe(0);
        expect(steps.every(s => s.artFrameIndex < 4)).toBe(true); // native loop endpoint excluded
      }
  });
  it('keeps source-order start/end while direction chooses crawl without flipping body facing', () => {
    let state: PikachuCrouchCrawlState | null = tickPikachuCrouchCrawl(null, down);
    for (let n = 1; n < 7; n++) { state = tickPikachuCrouchCrawl(state, down); expect(state?.phase).toBe('start'); }
    state = tickPikachuCrouchCrawl(state, down); expect(state?.phase).toBe('hold');
    state = tickPikachuCrouchCrawl(state, { ...down, moveX: -1, facing: -1 });
    expect(state).toEqual({ phase: 'crawl_back', framesElapsed: 0, facing: 1 });
    state = tickPikachuCrouchCrawl(state, { ...down, moveX: 1 }); expect(state?.phase).toBe('crawl');
    state = tickPikachuCrouchCrawl(state, { ...down, down: false }); expect(state?.phase).toBe('end');
    for (let n = 1; n < 7; n++) state = tickPikachuCrouchCrawl(state, { ...down, down: false });
    expect(state?.framesElapsed).toBe(6);
    expect(tickPikachuCrouchCrawl(state, { ...down, down: false })).toBeNull();
  });
  it('ordinary release completes the source-cancel7 startup before entering end; priority input can interrupt', () => {
    let state = tickPikachuCrouchCrawl(null, down);
    // Release immediately after actual entry; native start must remain entered
    // for the authored seven-step cancel span, independently of held intent.
    for (let age = 1; age < 7; age++) {
      state = tickPikachuCrouchCrawl(state, { ...down, down: false });
      expect(state).toEqual({ phase: 'start', framesElapsed: age, facing: 1 });
    }
    expect(tickPikachuCrouchCrawl(state, { ...down, down: false }))
      .toEqual({ phase: 'end', framesElapsed: 0, facing: 1 });
    expect(tickPikachuCrouchCrawl(state, { ...down, down: false, eligible: false })).toBeNull();
  });
  it('freezes clocks while priority interruptions and loss of ground clear stale drawing eligibility', () => {
    const state = { phase: 'crawl' as const, framesElapsed: 15, facing: 1 as const };
    expect(tickPikachuCrouchCrawl(state, { ...down, advance: false, moveX: -1 })).toBe(state);
    expect(tickPikachuCrouchCrawl(state, { ...down, advance: false, eligible: false })).toBeNull();
    expect(tickPikachuCrouchCrawl(state, { ...down, grounded: false })).toBeNull();
    expect(pikachuCrouchCrawlDrawing({ phase: 'hold', framesElapsed: 600, facing: 1 })?.artFrameIndex).toBe(4);
  });
});
