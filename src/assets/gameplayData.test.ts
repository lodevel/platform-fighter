/**
 * The simulation's per-fighter data lives in assets/characters/<id>/gameplay.json; frames.json keeps only the legacy
 * sheets (display), so deleting it removes nothing the simulation reads (docs/review/2026-10-19/phase6/gameplay-data.md).
 * After a pipeline tool rewrites frames.json, run `python3 tools/split-gameplay-data.py`.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getPikachuSheetRenderMetrics } from '../characters/pikachuPresentation';
import { PIKACHU_CAPTURE_CLEARANCE_REVIEW, PIKACHU_CAPTURE_DAMAGE_CLEARANCE_REVIEW } from '../characters/pikachuCaptureBodyClearance';

const FIGHTERS = ['donkeykong', 'link', 'pikachu'] as const;
type Data = { readonly animations: Readonly<Record<string, Readonly<Record<string, unknown>>>> } & Readonly<Record<string, unknown>>;
const read = (text: string): Data => JSON.parse(text) as Data;
const installed = (id: string, file: string) => read(readFileSync(`assets/characters/${id}/${file}`, 'utf8'));
const FILES = Object.fromEntries(FIGHTERS.map(id => [id, { sheets: installed(id, 'frames.json'), poses: installed(id, 'gameplay.json') }]));
const fields = (part: 'sheets' | 'poses') =>
  new Set(Object.values(FILES).flatMap(file => Object.values(file[part].animations).flatMap(clip => Object.keys(clip))));

/** The last commit with the mixed frames.json; the split must reproduce every value of it. */
const BASELINE = '9fa28f3';
const baseline = (id: string): Data | null => {
  try {
    return read(execFileSync('git', ['show', `${BASELINE}:assets/characters/${id}/frames.json`],
      { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch { return null; } // shallow clone or exported tree
};
const hasBaseline = baseline('link') !== null;

describe('gameplay.json beside the legacy frames.json', () => {
  it('a clip field is display (frames.json) or gameplay (gameplay.json) for every fighter, never both', () => {
    const display = fields('sheets');
    expect([...fields('poses')].filter(field => display.has(field))).toEqual([]);
  });

  it.each(FIGHTERS)('%s: both files name the same clips, each with a pose count; Final victims are gameplay', id => {
    const { sheets, poses } = FILES[id]!;
    expect(Object.keys(poses.animations)).toEqual(Object.keys(sheets.animations));
    for (const [name, clip] of Object.entries(poses.animations)) expect(Number.isSafeInteger(clip.frameCount), name).toBe(true);
    expect(sheets).not.toHaveProperty('runtimeFinalVictimProfiles');
  });

  it.skipIf(!hasBaseline).each(FIGHTERS)(`%s: every value is byte-identical to the mixed frames.json of ${BASELINE}`, id => {
    const before = baseline(id)!, { sheets, poses } = FILES[id]!;
    expect(Object.keys(sheets.animations)).toEqual(Object.keys(before.animations));
    for (const [name, clip] of Object.entries(before.animations)) {
      const sheet = sheets.animations[name]!, pose = poses.animations[name]!;
      expect([...Object.keys(sheet), ...Object.keys(pose)].sort(), name).toEqual(Object.keys(clip).sort());
      for (const [field, value] of Object.entries(clip))
        expect(JSON.stringify(Object.hasOwn(sheet, field) ? sheet[field] : pose[field]), `${name}.${field}`).toBe(JSON.stringify(value));
    }
    for (const [key, value] of Object.entries(before)) if (key !== 'animations')
      expect(JSON.stringify(key === 'runtimeFinalVictimProfiles' ? poses[key] : sheets[key]), key).toBe(JSON.stringify(value));
  });

  it('Pikachu capture clearance keeps the registration of the strips it was measured on', () => {
    for (const review of [PIKACHU_CAPTURE_CLEARANCE_REVIEW, PIKACHU_CAPTURE_DAMAGE_CLEARANCE_REVIEW]) {
      const { rootY, scaleToWorld, bodyCentreFromRootY } = getPikachuSheetRenderMetrics(review.bodySheet);
      expect(review.registration).toEqual({ rootY, scaleToWorld, bodyCentreFromRootY });
    }
  });
});
