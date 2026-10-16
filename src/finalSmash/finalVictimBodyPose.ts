/** Authored cinematic recipient banks. These are separate real recipe/sample
 * identities, never captured NUANMB indices or aliases of ordinary flinches. */
import donkey from '../../assets/characters/donkeykong/frames.json';
import pikachu from '../../assets/characters/pikachu/frames.json';
import link from '../../assets/characters/link/frames.json';
import { parseLinkBodyRenderMetrics, parseLinkDrawingGeometry } from '../characters/linkBodyProfileValidation';
import type { Hurtbox } from '../characters/moveSchema';
import type { FinalVictimFighter, FinalVictimProfileKey } from './finalVictimPresentation';
import { selectFinalVictimPresentation } from './finalVictimPresentation';

const keys: readonly FinalVictimProfileKey[] = ['final_victim_jungle_entry', 'final_victim_jungle_stagger_a',
  'final_victim_jungle_stagger_b', 'final_victim_jungle_uppercut_pre', 'final_victim_volt_caught',
  'final_victim_volt_vortex', 'final_victim_volt_burst_pre', 'final_victim_ancient_impact'];
type Geometry = ReturnType<typeof parseLinkDrawingGeometry>;
type Metrics = ReturnType<typeof parseLinkBodyRenderMetrics>;
interface VictimDrawing extends Geometry {
  readonly startAge: number; readonly endAgeExclusive: number; readonly frameIndex: number;
  readonly nativeSample: null; readonly authoredSampleIndex: number;
  readonly render?: { readonly sheet: string; readonly frameIndex: number };
}
export interface FinalVictimBodyProfile extends Metrics {
  readonly coordinateOrigin: 'actorSourceRoot';
  readonly sourceSampleBasis: 'authored-final-victim-recipe-index';
  readonly authoredSourceIdentity: { readonly kind: 'AUTHORED_FINAL_CINEMATIC_RECIPIENT'; readonly recipeId: string; readonly sha256: string };
  readonly endAgeExclusive: number; readonly terminalHold: boolean;
  readonly rootDelta: readonly { readonly x: 0; readonly y: 0 }[];
  readonly drawings: readonly VictimDrawing[];
}
export interface FinalVictimBodyRegistry {
  readonly targetFighter: FinalVictimFighter;
  readonly profiles: Readonly<Partial<Record<FinalVictimProfileKey, FinalVictimBodyProfile>>>;
}
function object(value: unknown, path: string, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${path} must be object`);
  const row = value as Record<string, unknown>;
  if (required.some(key => !Object.hasOwn(row, key)) || Object.keys(row).some(key => !required.includes(key) && !optional.includes(key)))
    throw new TypeError(`${path} must have exact authored profile fields`);
  return row;
}
function finite(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new TypeError(`${path} must be finite nonnegative age`);
  return value;
}
function integer(value: unknown, path: string): number {
  const n = finite(value, path); if (!Number.isSafeInteger(n)) throw new TypeError(`${path} must be safe integer`); return n;
}
function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${path} must be actual identity text`); return value;
}
export function parseFinalVictimBodyProfiles(value: unknown, targetFighter: FinalVictimFighter): FinalVictimBodyRegistry {
  if (!['donkeykong', 'pikachu', 'link'].includes(targetFighter)) throw new TypeError('Actual supported recipient fighter required');
  if (value === undefined) return Object.freeze({ targetFighter, profiles: Object.freeze({}) });
  const root = object(value, 'finalVictimProfiles', ['schema', 'targetFighter', 'profiles']);
  if (root.schema !== 'authored-final-victim-profiles/1' || root.targetFighter !== targetFighter)
    throw new TypeError('Final victim registry target/schema mismatch');
  const rows = object(root.profiles, 'finalVictimProfiles.profiles', [], keys);
  const profiles: Partial<Record<FinalVictimProfileKey, FinalVictimBodyProfile>> = {};
  for (const [key, value] of Object.entries(rows)) {
    const path = `finalVictimProfiles.${key}`;
    const row = object(value, path, ['coordinateOrigin', 'sourceSampleBasis', 'authoredSourceIdentity',
      'sheet', 'frameWidth', 'frameHeight', 'scaleToWorld', 'bodyCentreFromRootY', 'endAgeExclusive', 'terminalHold', 'rootDelta', 'drawings']);
    if (row.coordinateOrigin !== 'actorSourceRoot' || row.sourceSampleBasis !== 'authored-final-victim-recipe-index'
      || typeof row.terminalHold !== 'boolean') throw new TypeError(`${path} requires explicit authored ROOT/hold basis`);
    const source = object(row.authoredSourceIdentity, `${path}.authoredSourceIdentity`, ['kind', 'recipeId', 'sha256']);
    if (source.kind !== 'AUTHORED_FINAL_CINEMATIC_RECIPIENT' || typeof source.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(source.sha256))
      throw new TypeError(`${path} requires actual immutable authored recipe SHA`);
    const metrics = parseLinkBodyRenderMetrics({ sheet: row.sheet, frameWidth: row.frameWidth, frameHeight: row.frameHeight,
      scaleToWorld: row.scaleToWorld, bodyCentreFromRootY: row.bodyCentreFromRootY }, path);
    const endAgeExclusive = finite(row.endAgeExclusive, `${path}.endAgeExclusive`);
    if (endAgeExclusive <= 0 || !Array.isArray(row.drawings) || row.drawings.length === 0 || !Array.isArray(row.rootDelta) || row.rootDelta.length === 0)
      throw new TypeError(`${path} needs positive real authored drawing coverage and explicit zero displacement`);
    const rootDelta = row.rootDelta.map((v, index) => {
      const p = object(v, `${path}.rootDelta[${index}]`, ['x', 'y']);
      if (p.x !== 0 || p.y !== 0) throw new TypeError('Cinematic victim mechanics owns ROOT; artwork cannot duplicate displacement');
      return Object.freeze({ x: 0 as const, y: 0 as const });
    });
    const drawings = row.drawings.map((value, index): VictimDrawing => {
      const p = `${path}.drawings[${index}]`;
      const d = object(value, p, ['startAge', 'endAgeExclusive', 'frameIndex', 'nativeSample', 'authoredSampleIndex',
        'receiving', 'attachments', 'originX', 'originY'], ['render', 'headContact', 'captureSupport']);
      const startAge = finite(d.startAge, `${p}.startAge`), end = finite(d.endAgeExclusive, `${p}.endAgeExclusive`);
      if (d.nativeSample !== null || end <= startAge || end > endAgeExclusive)
        throw new TypeError(`${p} cannot fabricate a native sample or invalid interval`);
      let render: VictimDrawing['render'];
      if (d.render !== undefined) {
        const page = object(d.render, `${p}.render`, ['sheet', 'frameIndex']);
        render = Object.freeze({ sheet: text(page.sheet, `${p}.render.sheet`), frameIndex: integer(page.frameIndex, `${p}.render.frameIndex`) });
      }
      const geometry = parseLinkDrawingGeometry(d, p);
      if (key !== 'final_victim_ancient_impact' && (!Object.hasOwn(d, 'captureSupport')
        || !geometry.attachments.some(a => a.role === 'capture-anchor')))
        throw new TypeError(`${p} captured recipient needs actual same-drawing anchor and explicit support review`);
      return Object.freeze({ ...geometry, startAge, endAgeExclusive: end,
        frameIndex: integer(d.frameIndex, `${p}.frameIndex`), nativeSample: null,
        authoredSampleIndex: integer(d.authoredSampleIndex, `${p}.authoredSampleIndex`), ...(render ? { render } : {}) });
    });
    if (drawings[0]!.startAge !== 0 || drawings.at(-1)!.endAgeExclusive !== endAgeExclusive
      || drawings.some((d, i) => i > 0 && drawings[i - 1]!.endAgeExclusive !== d.startAge)
      || new Set(drawings.map(d => d.frameIndex)).size !== drawings.length
      || new Set(drawings.map(d => d.authoredSampleIndex)).size !== drawings.length)
      throw new TypeError(`${path} needs exact contiguous unique authored drawing/sample coverage`);
    profiles[key as FinalVictimProfileKey] = Object.freeze({ ...metrics, coordinateOrigin: 'actorSourceRoot',
      sourceSampleBasis: 'authored-final-victim-recipe-index', authoredSourceIdentity: Object.freeze({
        kind: 'AUTHORED_FINAL_CINEMATIC_RECIPIENT', recipeId: text(source.recipeId, `${path}.recipeId`), sha256: source.sha256 }),
      endAgeExclusive, terminalHold: row.terminalHold, rootDelta: Object.freeze(rootDelta), drawings: Object.freeze(drawings) });
  }
  return Object.freeze({ targetFighter, profiles: Object.freeze(profiles) });
}

type Selection = ReturnType<typeof selectFinalVictimPresentation>;
export function selectFinalVictimBodyPose(registry: FinalVictimBodyRegistry, selection: Selection) {
  if (selection.targetFighter !== registry.targetFighter || selection.nativeSample !== null
    || selection.sampleBasis !== 'authored-final-victim-recipe-index' || !keys.includes(selection.profileKey)
    || ![1, -1].includes(selection.facing)) throw new TypeError('Actual authored victim selection identity invalid');
  const age = finite(selection.authoredAge, 'selection.authoredAge'), profile = registry.profiles[selection.profileKey];
  if (!profile || age >= profile.endAgeExclusive && !profile.terminalHold) return null;
  const drawing = age >= profile.endAgeExclusive ? profile.drawings.at(-1)!
    : profile.drawings.find(d => d.startAge <= age && age < d.endAgeExclusive)!;
  const receiving: readonly Hurtbox[] = Object.freeze(drawing.receiving.map(c => {
    const minX = Math.min(c.start.x, c.end.x) - c.radius, minY = Math.min(c.start.y, c.end.y) - c.radius;
    const maxX = Math.max(c.start.x, c.end.x) + c.radius, maxY = Math.max(c.start.y, c.end.y) + c.radius;
    return Object.freeze({ id: c.id, region: c.region, offsetX: (minX + maxX) / 2, offsetY: (minY + maxY) / 2,
      width: maxX - minX, height: maxY - minY, capsule: Object.freeze({ start: c.start, end: c.end, radius: c.radius }) });
  }));
  // Same unmirrored convention as finalBodyPose; Character/Scene applies the
  // victim's genuinely latched facing once to ROOT-relative shapes/rendering.
  return Object.freeze({ sheet: drawing.render?.sheet ?? profile.sheet, index: drawing.render?.frameIndex ?? drawing.frameIndex,
    sourceDrawingIndex: drawing.frameIndex, sample: null, receiving, outgoing: Object.freeze([]),
    attachments: drawing.attachments, headContact: drawing.headContact, captureSupport: drawing.captureSupport,
    rootDelta: Object.freeze({ x: 0, y: 0 }), originX: drawing.originX, originY: drawing.originY,
    scaleToWorld: profile.scaleToWorld, bodyCentreFromRootY: profile.bodyCentreFromRootY,
    sourceSampleBasis: profile.sourceSampleBasis, authoredPoseIdentity: Object.freeze({
      recipeId: profile.authoredSourceIdentity.recipeId, recipeSha256: profile.authoredSourceIdentity.sha256,
      sampleIndex: drawing.authoredSampleIndex }) });
}
interface PackedVictimProfiles { readonly runtimeFinalVictimProfiles?: unknown; }
const registries = {
  donkeykong: parseFinalVictimBodyProfiles((donkey as unknown as PackedVictimProfiles).runtimeFinalVictimProfiles, 'donkeykong'),
  pikachu: parseFinalVictimBodyProfiles((pikachu as unknown as PackedVictimProfiles).runtimeFinalVictimProfiles, 'pikachu'),
  link: parseFinalVictimBodyProfiles((link as unknown as PackedVictimProfiles).runtimeFinalVictimProfiles, 'link'),
};
export function finalVictimBodyPose(selection: Selection) {
  return selectFinalVictimBodyPose(registries[selection.targetFighter], selection);
}
