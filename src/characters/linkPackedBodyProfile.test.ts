import { describe, expect, it } from 'vitest';
import { LINK_SHEET_ALIASES } from './linkPackedBodyProfile';
import { installedPackedSheet, packedBodyProfile } from './packedBodyPresentation';
import { legacySheet } from '../assets/legacyFighterSheets';
import capturedMotions from '../../docs/review/2026-10-12/link-character/rework/sources/native/archive-motion-metadata.json';

describe('Link packed-body profile', () => {
  const clips = packedBodyProfile('link')!.clips;
  it('is registered with the installed gameplay.json and draws nothing for a missing pose', () => {
    expect(packedBodyProfile('link')?.missingSheet).toBe('invisible');
    expect(clips.idle).toBeDefined();
    expect(legacySheet('link', 'idle')?.scaleToWorld).toBe(0.4666667);
  });
  it('aliases every engine sheet to an installed clip', () => {
    for (const sheet of Object.keys(LINK_SHEET_ALIASES))
      expect(clips[installedPackedSheet('link', sheet)], sheet).toBeDefined();
  });
  it.each(['special_s1_blank', 'special_air_s1_blank'])('keeps the failed %s body on its actual retained source file', motion => {
    const source = capturedMotions.rows.find(row => row.actionIds.includes(`link.${motion}`));
    expect(source).toBeDefined();
    const sheet = installedPackedSheet('link', motion);
    expect(`${sheet}.nuanmb`).toBe(source!.resource);
    expect(clips[sheet]!.frameCount).toBeGreaterThan(1);
  });
});
