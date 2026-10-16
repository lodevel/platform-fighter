import type {
  CharacterDataSpec,
  CharacterMovesSpec,
} from '../characters/characterSerializer';
import {getDonkeyKongPairedProtectionTimeline} from '../characters/donkeykongPairedProtectionClock';

export type CharacterEditorSection = 'movement' | 'body' | 'move';

export interface CharacterEditorNumericField {
  readonly id: string;
  readonly label: string;
  readonly path: ReadonlyArray<string>;
  readonly value: number;
  readonly step: number;
  readonly min: number;
  readonly max: number;
  readonly integer: boolean;
  /** Decimal places retained by stepping and displayed by the Lab. */
  readonly precision?: number;
}

interface FieldDefinition {
  readonly key: string;
  readonly label: string;
  readonly step: number;
  readonly min: number;
  readonly max: number;
  readonly integer?: boolean;
  readonly path?: ReadonlyArray<string>;
  readonly precision?: number;
}

const MOVEMENT_FIELDS: ReadonlyArray<FieldDefinition> = [
  { key: 'maxRunSpeed', label: 'Max run speed', step: 0.25, min: 0.5, max: 30 },
  { key: 'groundAccel', label: 'Ground acceleration', step: 0.05, min: 0.05, max: 5 },
  { key: 'airAccel', label: 'Air acceleration', step: 0.05, min: 0.05, max: 5 },
  { key: 'groundDamping', label: 'Ground damping', step: 0.01, min: 0.01, max: 1 },
  { key: 'airDamping', label: 'Air damping', step: 0.01, min: 0.01, max: 1 },
  { key: 'jumpImpulse', label: 'Jump impulse', step: 0.25, min: 0.5, max: 40 },
  { key: 'donkeykongOrdinaryVertical.totalGravity',path:['donkeykongOrdinaryVertical','totalGravity'],
    label:'Ordinary total gravity',step:.005,min:.005,max:5,precision:6 },
  ...[0,1,2,3].map(i=>({key:`donkeykongOrdinaryVertical.fullHopStepVelocitiesY.${i}`,
    path:['donkeykongOrdinaryVertical','fullHopStepVelocitiesY',String(i)],
    label:`Full-hop vertical speed step ${i+1}`,step:.1,min:-100,max:-.1,precision:6})),
  { key: 'maxJumps', label: 'Maximum jumps', step: 1, min: 1, max: 10, integer: true },
  { key: 'mass', label: 'Mass', step: 0.5, min: 1, max: 100 },
  { key: 'referenceWeight', label: 'Reference weight', step: 1, min: 1, max: 300 },
  { key: 'referenceLaunch.gravity', path: ['referenceLaunch', 'gravity'],
    label: 'Launch gravity (units/frame²)', step: 0.001, min: 0, max: 5, precision: 6 },
  { key: 'referenceLaunch.fallSpeed', path: ['referenceLaunch', 'fallSpeed'],
    label: 'Launch fall cap (units/frame)', step: 0.01, min: 0.01, max: 30, precision: 6 },
  { key: 'referenceLaunch.verticalGravity', path: ['referenceLaunch', 'verticalGravity'],
    label: 'Vertical launch gravity (units/frame²)', step: 0.001, min: 0, max: 5, precision: 6 },
  { key: 'referenceLaunch.verticalFallSpeed', path: ['referenceLaunch', 'verticalFallSpeed'],
    label: 'Vertical launch fall cap (units/frame)', step: 0.01, min: 0.01, max: 30, precision: 6 },
  { key: 'fallAccel', label: 'Fall acceleration', step: 0.01, min: 0, max: 5 },
  { key: 'maxFallSpeed', label: 'Maximum fall speed', step: 0.25, min: 0.5, max: 50 },
  { key: 'fastFallSpeed', label: 'Fast-fall speed', step: 0.25, min: 0.5, max: 70 },
  { key: 'jumpCutFactor', label: 'Short-hop factor', step: 0.01, min: 0.05, max: 1 },
  { key: 'maxAirSpeed', label: 'Maximum air speed', step: 0.1, min: 0.1, max: 30 },
  { key: 'shortHopImpulse', label: 'Short-hop impulse', step: 0.1, min: 0.1, max: 40 },
  { key: 'riseAccel', label: 'Rise acceleration', step: 0.01, min: 0, max: 5 },
  { key: 'shortHopRiseAccel', label: 'Short-hop rise acceleration', step: 0.01, min: 0, max: 5 },
  { key: 'airJumpImpulse', label: 'Air jump impulse', step: 0.1, min: 0.1, max: 40 },
  { key: 'airJumpRiseAccel', label: 'Air jump rise acceleration', step: 0.01, min: 0, max: 5 },
  { key: 'softLandingFrames', label: 'Soft landing frames', step: 1, min: 0, max: 60, integer: true },
  { key: 'hardLandingFrames', label: 'Hard landing frames', step: 1, min: 0, max: 60, integer: true },
  { key: 'hardLandingSpeedFrames', label: 'Full-speed fall steps for hard landing', step: 1, min: 0, max: 60, integer: true },
  { key: 'airDodgeLandingFrames', label: 'Air-dodge landing frames', step: 1, min: 0, max: 60, integer: true },
  { key: 'directionalAirDodgeLandingFrames', label: 'Directional air-dodge landing frames', step: 1, min: 0, max: 60, integer: true },
  { key: 'directionalAirDodgeLateLandingFrames', label: 'Directional air-dodge landing frames at dodge end', step: 1, min: 0, max: 60, integer: true },
];

const BODY_FIELDS: ReadonlyArray<FieldDefinition> = [
  { key: 'width', label: 'Hurtbox width', step: 1, min: 4, max: 300, integer: true },
  { key: 'height', label: 'Hurtbox height', step: 1, min: 4, max: 300, integer: true },
  { key: 'chamfer', label: 'Body corner radius', step: 1, min: 0, max: 100, integer: true },
];

function titleCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/^./, (letter) => letter.toUpperCase());
}

function formatMovePath(path: ReadonlyArray<string>): string {
  if (path.includes('collisionHits')) {
    return path.join('.').replace(/hitWindows\.(\d+)/g, (_, n) => `Strike ${Number(n) + 1}`)
      .replace(/collisionHits\.(\d+)/g, (_, n) => `Hitbox ${Number(n) + 1}`)
      .replace(/\.capsule\./g, '.').replace(/\.reference\./g, '.Ref KB.')
      .split('.').map(titleCase).join(' / ');
  }
  return path
    .map((part) => part === 'additionalHitstunFrames' ? 'Added Hitstun'
      : /^\d+$/.test(part) ? `#${Number(part) + 1}` : titleCase(part))
    .join(' / ');
}

function limitsForMovePath(path: ReadonlyArray<string>): Pick<
  CharacterEditorNumericField,
  'step' | 'min' | 'max' | 'integer'
> {
  const leaf = path[path.length - 1] ?? '';
  const joined = path.join('.');
  if (joined === 'dodge.stickThreshold') return { step: 0.05, min: 0, max: 1, integer: false };
  if (joined.startsWith('dodge.') && leaf === 'activeFrames') return { step: 1, min: 1, max: 600, integer: true };
  if (joined.includes('collisionHits.') && leaf === 'id') return { step: 1, min: 0, max: 255, integer: true };
  if (/capsule\.(start|end)\.[xy]$/.test(joined)) return { step: 0.5, min: -1000, max: 1000, integer: false };
  if (/capsule\.radius$/.test(joined)) return { step: 0.5, min: 0.5, max: 1000, integer: false };
  if (joined === 'jabChain.advanceWindowStart'||joined==='jabChain.continuationWindowEndFrame') {
    return { step: 1, min: 0, max: 600, integer: true };
  }
  if (path[path.length - 2] === 'reference') {
    if (leaf === 'angle') return { step: 1, min: 0, max: 367, integer: true };
    if (leaf === 'base' || leaf === 'growth' || leaf === 'fixed') return { step: 1, min: 0, max: 300, integer: false };
    if (leaf === 'additionalHitstunFrames') return { step: 1, min: 0, max: 600, integer: true };
  }
  if (joined === 'rebound.upwardSpeed') {
    return { step: 0.25, min: 0.25, max: 300, integer: false };
  }
  if (joined === 'rebound.rehitFrames') {
    return { step: 1, min: 1, max: 600, integer: true };
  }
  const integer = /(frame|count|lifetime|interval|concurrent)/i.test(joined);
  const signed = /(offset|knockback\.[xy]$|speed$|velocity|impulse|distance|drift|force)/i.test(
    joined,
  );
  const ratio = /(scaling|multiplier|factor)/i.test(leaf);
  const dimension = /(width|height|range|radius)/i.test(leaf);
  const damage = /damage/i.test(leaf);

  return {
    step: integer ? 1 : ratio ? 0.05 : damage ? 0.5 : dimension ? 1 : 0.25,
    min: signed ? -200 : 0,
    max: integer ? 600 : ratio ? 10 : damage ? 100 : dimension ? 1000 : 300,
    integer,
  };
}

/** Boolean flags such as reference.setWeight remain JSON authoring fields;
 * the Lab preserves them while exposing only its supported numeric controls. */
function collectNumericLeaves(
  value: unknown,
  path: ReadonlyArray<string>,
  out: CharacterEditorNumericField[],
): void {
  if (typeof value === 'number') {
    const limits = limitsForMovePath(path);
    out.push({
      id: path.join('.'),
      label: formatMovePath(path),
      path,
      value,
      ...limits,
    });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectNumericLeaves(entry, [...path, String(index)], out));
    return;
  }
  if (value === null || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  const allWindowsHaveCollisionHits = Array.isArray(record.hitWindows) && record.hitWindows.length > 0
    && record.hitWindows.every(window => window !== null && typeof window === 'object'
      && Array.isArray((window as Record<string, unknown>).collisionHits)
      && ((window as Record<string, unknown>).collisionHits as unknown[]).length > 0);
  const referenceKnockback = record.reference !== undefined &&
    record.x !== undefined && record.y !== undefined && record.scaling !== undefined;
  for (const [key, entry] of Object.entries(record)) {
    if ((record.collisionHits !== undefined || allWindowsHaveCollisionHits)
      && (key === 'hitbox' || key === 'sweetSpot')) continue;
    if (referenceKnockback && ['x', 'y', 'scaling', 'baseMagnitude', 'damageGrowth'].includes(key)) continue;
    if (record.knockbackMode === 'damage-only' && ['minKnockback', 'maxKnockback'].includes(key)) continue;
    collectNumericLeaves(entry, [...path, key], out);
  }
}

export function listEditableMoves(
  spec: CharacterDataSpec,
): ReadonlyArray<keyof CharacterMovesSpec> {
  if (!spec.moves) return [];
  return Object.keys(spec.moves).filter(
    (key) => spec.moves?.[key as keyof CharacterMovesSpec] !== undefined,
  ) as Array<keyof CharacterMovesSpec>;
}

export function buildCharacterEditorFields(
  spec: CharacterDataSpec,
  section: CharacterEditorSection,
  moveKey?: keyof CharacterMovesSpec,
): ReadonlyArray<CharacterEditorNumericField> {
  if (section === 'move') {
    if (!moveKey || !spec.moves?.[moveKey]) return [];
    const out: CharacterEditorNumericField[] = [];
    collectNumericLeaves(spec.moves[moveKey], [], out);
    const record=spec.moves[moveKey] as unknown as Record<string,unknown>;
    const paired=spec.id==='donkeykong'&&typeof record.id==='string'
      ?getDonkeyKongPairedProtectionTimeline({id:record.id,type:typeof record.type==='string'?record.type:undefined,
        sheetVariant:typeof record.sheetVariant==='string'?record.sheetVariant:undefined,aerialDirection:typeof record.aerialDirection==='string'?record.aerialDirection:undefined}):null;
    const optedChain=paired&&record.type==='jab'&&record.jabChain!==null&&typeof record.jabChain==='object'
      &&(record.jabChain as Record<string,unknown>).continuationWindowEndFrame!==undefined;
    return paired?out.map(field=>field.path[0]==='protectionWindows'
      ?{...field,label:`Source age / ${field.label}`,max:paired.timeline.endFrame}
      :optedChain&&field.path[0]==='jabChain'?{...field,label:`Source age / ${field.label}`}:field):out;
  }

  const definitions = section === 'movement' ? MOVEMENT_FIELDS : BODY_FIELDS;
  const source = spec[section] as unknown as Record<string, unknown>;
  const fields = definitions.flatMap(definition => {
    if(section==='movement'&&spec.movement.donkeykongOrdinaryVertical&&
      ['jumpImpulse','riseAccel','shortHopRiseAccel','airJumpRiseAccel','fallAccel'].includes(definition.key))return [];
    const path = definition.path ?? [definition.key];
    let value: unknown = source;
    for (const part of path) {
      value = value !== null && typeof value === 'object'
        ? (value as Record<string, unknown>)[part] : undefined;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)
      || (definition.key === 'jumpCutFactor' && source.shortHopImpulse !== undefined)) return [];
    return [{
      id: `${section}.${definition.key}`,
      label: definition.label,
      path,
      value,
      step: definition.step,
      min: definition.min,
      max: definition.max,
      integer: definition.integer ?? false,
      ...(definition.precision === undefined ? {} : { precision: definition.precision }),
    }];
  });
  if (section === 'movement' && spec.movement.dodge !== undefined) {
    const nested: CharacterEditorNumericField[] = [];
    collectNumericLeaves(spec.movement.dodge, ['dodge'], nested);
    fields.push(...nested.map(field => ({ ...field, id: `movement.${field.id}` })));
  }
  return fields;
}

export function stepCharacterEditorField(
  field: CharacterEditorNumericField,
  direction: -1 | 1,
  multiplier = 1,
): number {
  let raw = field.value + direction * field.step * multiplier;
  // Reference angles 362-366 have no implemented consumer. Step directly
  // between Sakurai 361 and the supported contextual autolink angle 367.
  if (field.path[field.path.length - 2] === 'reference'
    && field.path[field.path.length - 1] === 'angle' && raw > 361 && raw < 367) {
    raw = direction === 1 ? 367 : 361;
  }
  const clamped = Math.min(field.max, Math.max(field.min, raw));
  if (field.integer) return Math.round(clamped);
  const scale = 10 ** (field.precision ?? 3);
  return Math.round(clamped * scale) / scale;
}
