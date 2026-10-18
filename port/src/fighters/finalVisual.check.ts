import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import metadata from '../../../assets/characters/pikachu/final-visual-frames.json';
import originalSheets from '../../../assets/characters/pikachu/frames.json';
import originals from '../../../assets/characters/pikachu/gameplay.json';
import { finalBodyPose } from '../../../src/finalSmash/finalBodyPose';
import { finalVictimBodyPose } from '../../../src/finalSmash/finalVictimBodyPose';
import type { SimulationAnimationSnapshot, SimulationSpritePose } from '../../../src/characters/simulationSpriteAnimation';
import { pikachuFinalVisualPose, replacedPikachuFinalOwnerPage } from './finalVisual';
import { fighterDraw, fighterDrawFromArt } from './poses';
import { preloadLegacyMatchArt } from './backends/legacyResources';
import { LegacySpriteAppearance } from './backends/legacySprite';
import { createLegacyPreviewAppearanceRequest, createLegacySnapshotAppearanceRequest } from '../../../src/characterPresentation/legacy/bridge';
import type { TextureStore } from '../engine/sprites/textureStore';
import type { SpriteDraw } from '../engine/sprites/spriteLayer';

const sheets = Object.keys(metadata.clips) as (keyof typeof metadata.clips)[];
const actor = { characterId: 'pikachu', position: { x: 210, y: 280 }, facing: -1 as const };
const art: SimulationSpritePose = { key: 'pikachu.final.anim', state: 'final', frameIndex: 0, facing: -1,
  scaleX: 1, scaleY: 1, crouchClip: false };
const snapshot = (sheet: string, age: number, patch: Partial<SimulationAnimationSnapshot> = {}) => ({
  characterId: 'pikachu', assetCharacterId: 'pikachu', facing: -1, destroyed: false, frame: 100,
  frozen: false, hitlagRemaining: 0, grounded: true, finalVictimSelection: null, finalVictimPose: null,
  finalSmash: { runId: 1, role: 'owner', phase: 'startup', sheet, age, facing: -1, rotationDegrees: 35,
    intangible: false, noDead: false, terrainBypass: false, jostle: true, gravityDisabled: false, velocity: null }, ...patch,
} as SimulationAnimationSnapshot);

describe('Pikachu Final independent dense display bank', () => {
  it('keeps the seven original authoritative clips unchanged without pinning unrelated art', () => {
    const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
      : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, canonical(child)])) : value;
    // The clip as one record: its sheet (frames.json) and its pose track (gameplay.json).
    const clips = Object.fromEntries(sheets.map(sheet => [sheet, { ...originalSheets.animations[sheet], ...originals.animations[sheet] }]));
    expect(createHash('sha256').update(JSON.stringify(canonical(clips))).digest('hex'))
      .toBe('f80db2f96a33168d17412f307ecf850159f6a82fb6b07e8c3c80e4330121181f');
    expect(sheets.reduce((sum, sheet) => sum + originals.animations[sheet].frameCount, 0)).toBe(187);
    expect(sheets.reduce((sum, sheet) => sum + metadata.clips[sheet].frames.length, 0)).toBe(423);
  });

  it.each(sheets)('covers every integer %s pose while receiving/outgoing/attachments keep their original clock', sheet => {
    const clip = metadata.clips[sheet], original = originals.animations[sheet];
    for (let age = 0; age <= clip.nativeEnd + 5; age += .5) {
      const pose = finalBodyPose('pikachu', sheet, age), before = JSON.stringify(pose);
      const selected = pikachuFinalVisualPose(sheet, age)!;
      expect(selected.nativeSample).toBe(Math.floor(clip.loopDuration ? age % clip.loopDuration : Math.min(age, clip.nativeEnd)));
      const sampleAge = clip.loopDuration ? age % clip.loopDuration : age;
      const sourceIndex = original.nativeSampleIndices.reduce((last, sample, index) => sample <= sampleAge ? index : last, -1);
      expect(pose?.sourceDrawingIndex).toBe(sourceIndex);
      expect(pose?.receiving).toEqual(original.hurtboxPoses[sourceIndex]!.hurtboxes);
      expect(JSON.stringify(finalBodyPose('pikachu', sheet, age))).toBe(before);
    }
  });

  it('clamps end poses, preserves loop closure, and repeats or rewinds without an internal clock', () => {
    for (const age of [4, 4, 6, 1, 4]) expect(pikachuFinalVisualPose('final', age)?.nativeSample).toBe(age);
    expect(pikachuFinalVisualPose('final', -1)?.nativeSample).toBe(0);
    expect(pikachuFinalVisualPose('final', 1000)?.nativeSample).toBe(63);
    expect(pikachuFinalVisualPose('final_dash', 6)?.nativeSample).toBe(0);
    expect(pikachuFinalVisualPose('idle', 1)).toBeNull();
  });

  it('uses semantic age in match and preview while preserving mirrored root and status rotation', () => {
    const visual = pikachuFinalVisualPose('final', 1)!;
    const draw = fighterDrawFromArt(actor, art, 0xffffff, null, snapshot('final', 1))!;
    expect(draw).toMatchObject({ key: visual.key, frame: visual.frame, x: 210, y: 305,
      originX: 1 - visual.originX, originY: visual.originY, flipX: true, rotation: 35 * Math.PI / 180 });
    expect(fighterDraw({ ...actor, x: 210, y: 305 }, 'final', 1, 0xffffff)).toMatchObject({ key: visual.key, frame: visual.frame });
    const backend = new LegacySpriteAppearance(), draws: SpriteDraw[] = [];
    const request = createLegacySnapshotAppearanceRequest(snapshot('final', 1), { position: actor.position });
    backend.update(request); backend.submit({ sprite: draw => draws.push(draw), geometry: () => undefined });
    expect(draws[0]).toMatchObject({ key: visual.key, frame: visual.frame });
    expect(backend.diagnostics()).toMatchObject({ key: visual.key, frame: visual.frame });
    backend.update(request); expect(backend.diagnostics()).toMatchObject({ key: visual.key, frame: visual.frame });
    backend.reset(); backend.update(createLegacyPreviewAppearanceRequest({ characterId: 'pikachu', action: 'final', age: 1, position: actor.position }));
    expect(backend.diagnostics()).toMatchObject({ key: visual.key, frame: visual.frame }); backend.dispose();
  });

  it('keeps a captured Pikachu on its own authored victim page even if an old owner lease exists', () => {
    const selection = { targetFighter: 'pikachu', profileKey: 'final_victim_jungle_entry', authoredAge: 3,
      facing: -1, sampleBasis: 'authored-final-victim-recipe-index', nativeSample: null } as const;
    const victim = finalVictimBodyPose(selection)!;
    expect(victim).not.toBeNull();
    const draw = fighterDrawFromArt(actor, { ...art, key: `pikachu.${victim.sheet}.anim`, frameIndex: victim.index }, 0xffffff, null,
      snapshot('final', 1, { finalVictimSelection: selection, finalVictimPose: victim }))!;
    expect(draw.key).toBe(`char.pikachu.${victim.sheet}`);
    expect(draw.frame).toBe(victim.index); expect(draw.rotation).toBe(0);
    expect(replacedPikachuFinalOwnerPage(draw.key)).toBe(false);
  });

  it('prepares new pages and all victim pages without decoding the seven replaced owner pages', async () => {
    const load = vi.fn(async () => ({ texture: { image: { width: 1, height: 1 } } }));
    const textures = { load, retainMatchFighters: vi.fn(), recordPreparation: vi.fn() } as unknown as TextureStore;
    await preloadLegacyMatchArt(textures, ['pikachu'], () => undefined, () => undefined);
    const loaded = load.mock.calls.map(call => (call as unknown as [string])[0]);
    for (const page of Object.keys(metadata.pages)) expect(loaded).toContain(`char.pikachu.${page}`);
    for (const sheet of sheets) expect(loaded).not.toContain(`char.pikachu.${sheet}`);
    expect(loaded.some(key => key.includes('final_victim_'))).toBe(true);
    const bytes = Object.values(metadata.pages).reduce((sum, page) => sum + page.atlas[0]! * page.atlas[1]! * 4, 0);
    expect(bytes).toBe(metadata.decodedBytes); expect(bytes).toBeLessThanOrEqual(176 * 1024 * 1024);
    expect(Object.values(metadata.pages).every(page => Math.max(...page.atlas) <= 2048)).toBe(true);
  });
});
