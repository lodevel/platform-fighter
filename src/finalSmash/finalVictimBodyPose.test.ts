import { describe, expect, it } from 'vitest';
import { parseFinalVictimBodyProfiles, selectFinalVictimBodyPose } from './finalVictimBodyPose';
const identity = { kind: 'AUTHORED_FINAL_CINEMATIC_RECIPIENT', recipeId: 'fixture-current-victim-rig', sha256: 'a'.repeat(64) };
const profile = () => ({ coordinateOrigin: 'actorSourceRoot', sourceSampleBasis: 'authored-final-victim-recipe-index',
  authoredSourceIdentity: identity, sheet: 'fixture-logical-victim', frameWidth: 100, frameHeight: 100,
  scaleToWorld: .5, bodyCentreFromRootY: -42, endAgeExclusive: 2, terminalHold: true, rootDelta: [{ x: 0, y: 0 }],
  drawings: [0, 1].map(i => ({ startAge: i, endAgeExclusive: i + 1, frameIndex: i, nativeSample: null,
    authoredSampleIndex: i + 10, render: { sheet: `fixture-victim-page-${i}`, frameIndex: 4 - i },
    receiving: [{ id: 'cranial-actual', region: 'head', start: { x: 8, y: -50 }, end: { x: 12, y: -45 }, radius: 3 }],
    attachments: [{ role: 'capture-anchor', point: { x: 5, y: -20 } }], captureSupport: null, originX: .4, originY: .9 })) });
const selection = { targetFighter: 'link', profileKey: 'final_victim_jungle_entry', authoredAge: 28,
  facing: -1, sampleBasis: 'authored-final-victim-recipe-index', nativeSample: null } as const;
const root = (p = profile()) => ({ schema: 'authored-final-victim-profiles/1', targetFighter: 'link',
  profiles: { final_victim_jungle_entry: p } });
describe('authored cinematic victim banks, prepared only', () => {
  it('retains actual recipe sample/page identity with no fake native index or duplicate root displacement', () => {
    const registry = parseFinalVictimBodyProfiles(root(), 'link'), pose = selectFinalVictimBodyPose(registry, selection)!;
    expect(pose).toMatchObject({ sheet: 'fixture-victim-page-1', index: 3, sourceDrawingIndex: 1, sample: null,
      authoredPoseIdentity: { recipeId: identity.recipeId, recipeSha256: identity.sha256, sampleIndex: 11 }, rootDelta: { x: 0, y: 0 } });
    // Compatible with owner finalBodyPose: these remain unmirrored despite
    // the genuine recipient-facing-1. The actual consumer mirrors once.
    expect(pose.receiving[0]?.capsule?.start.x).toBe(8);
    expect(pose.attachments[0]?.point.x).toBe(5);
    expect(pose.originX).toBe(.4);
  });
  it('requires explicit terminal hold and returns a dependency for absent or completed unheld profiles', () => {
    expect(selectFinalVictimBodyPose(parseFinalVictimBodyProfiles(undefined, 'link'), selection)).toBeNull();
    const registry = parseFinalVictimBodyProfiles(root({ ...profile(), terminalHold: false }), 'link');
    expect(selectFinalVictimBodyPose(registry, selection)).toBeNull();
    expect(selectFinalVictimBodyPose(registry, { ...selection, authoredAge: 0 })?.authoredPoseIdentity.sampleIndex).toBe(10);
    expect(() => selectFinalVictimBodyPose(registry, { ...selection, targetFighter: 'pikachu' })).toThrow();
  });
  it('rejects native aliases, forged sample basis, nonzero mechanics displacement and missing authored identity', () => {
    const p = profile();
    for (const bad of [{ ...p, sourceSampleBasis: 'zero-based-native-index' }, { ...p, rootDelta: [{ x: 1, y: 0 }] },
      { ...p, authoredSourceIdentity: { ...identity, sha256: 'not-real-sha' } },
      { ...p, drawings: p.drawings.map(d => ({ ...d, nativeSample: 28 })) },
      { ...p, sourceIdentity: { resource: 'fake-victim.nuanmb', sha256: 'a'.repeat(64) } }]) {
      expect(() => parseFinalVictimBodyProfiles({ ...root(), profiles: { final_victim_jungle_entry: bad } }, 'link')).toThrow();
    }
  });
  it('rejects coverage gaps, reused logical samples, empty or nonfinite anatomy and crossed targets', () => {
    const p = profile();
    const badDrawings = [p.drawings.slice(1), [{ ...p.drawings[0]!, endAgeExclusive: .5 }, p.drawings[1]!],
      p.drawings.map(d => ({ ...d, authoredSampleIndex: 10 })),
      p.drawings.map(d => ({ ...d, receiving: [] })),
      p.drawings.map(d => ({ ...d, attachments: [] })),
      p.drawings.map(d => ({ ...d, receiving: [{ ...d.receiving[0]!, radius: Infinity }] }))];
    for (const drawings of badDrawings) expect(() => parseFinalVictimBodyProfiles(root({ ...p, drawings }), 'link')).toThrow();
    expect(() => parseFinalVictimBodyProfiles({ ...root(), targetFighter: 'pikachu' }, 'link')).toThrow();
    expect(() => parseFinalVictimBodyProfiles({ ...root(), profiles: { damage_fly_n: p } }, 'link')).toThrow();
  });
});
