import {getDefaultCaptureAttachmentCalibration} from './captureAttachmentDefaultData';
import * as PikachuKit from './Pikachu';
import { CHARACTER_IDS, type CharacterId } from '../types';
import { getCharacterSpec } from './roster';
import { getFighterMovementProfile } from './fighterMovementProfiles';
import { parseCharacterDataFile, type CharacterDataSpec, type CharacterMovesData } from './characterSerializer';
import * as LinkKit from './Link';
import * as DonkeyKongKit from './DonkeyKong';

export const DEFAULT_AUTHORABLE_CHARACTER_ID = 'link' as const;

const COMPILED_KITS: Record<CharacterId, Readonly<Record<string, unknown>>> = {
  link: LinkKit, donkeykong: DonkeyKongKit, pikachu: PikachuKit,
};

/** Canonical declarations used by the constructors. Selecting named exports
 * deliberately excludes unused variants sharing an ID. */
const SLOT_EXPORT_SUFFIXES = {
  jab: 'JAB', jab2: 'JAB2', jab3: 'JAB3', tilt: 'TILT', smash: 'SMASH', smash2: 'SMASH2',
  upLight: 'UTILT', upSmash: 'USMASH', downLight: 'DTILT', downSmash: 'DSMASH',
  dashAttack: 'DASHATTACK', nair: 'NAIR', fair: 'FAIR', bair: 'BAIR',
  uair: 'UAIR', dair: 'DAIR', neutralSpecial: 'NEUTRAL_SPECIAL',
  sideSpecial: 'SIDE_SPECIAL', upSpecial: 'UP_SPECIAL', downSpecial: 'DOWN_SPECIAL',
  grab: 'GRAB', getupAttack: 'GETUP_ATTACK', getupAttackFaceDown: 'GETUP_ATTACK_FACE_DOWN',
  tripAttack: 'TRIP_ATTACK', ledgeAttack: 'LEDGE_ATTACK',
  taunts: 'TAUNTS',
} as const satisfies Partial<Record<keyof CharacterMovesData, string>>;

function compiledMoves(id: CharacterId): Record<string, unknown> {
  const kit = COMPILED_KITS[id];
  const prefix = id.toUpperCase();
  return Object.fromEntries(Object.entries(SLOT_EXPORT_SUFFIXES)
    .map(([slot, suffix]) => [slot, kit[`${prefix}_${suffix}`]])
    .filter(([, move]) => move !== undefined));
}

function compiledSpec(id: CharacterId): CharacterDataSpec {
  const live = getCharacterSpec(id);
  const calibration = getDefaultCaptureAttachmentCalibration(id);
  return parseCharacterDataFile({
    ...(calibration ? {captureAttachmentCalibration: calibration} : {}),
    id, displayName: live.displayName, role: live.role,
    body: { width: live.tuning.width, height: live.tuning.height, chamfer: live.tuning.chamfer },
    movement: getFighterMovementProfile(id),
    moves: compiledMoves(id),
  }, `compiled character '${id}'`);
}

const specsById = new Map<CharacterId, CharacterDataSpec>(
  CHARACTER_IDS.map(id => [id, compiledSpec(id)] as const),
);

/** Stable roster order shared by authoring and saved-tune consumers. */
const AUTHORABLE_SPECS: ReadonlyArray<CharacterDataSpec> = Object.freeze(
  CHARACTER_IDS.map(id => {
    const spec = specsById.get(id);
    if (!spec) throw new Error(`Missing authorable character spec: ${id}`);
    return spec;
  }),
);

export function listAuthorableCharacterSpecs(): ReadonlyArray<CharacterDataSpec> {
  return AUTHORABLE_SPECS;
}

export function getAuthorableCharacterSpec(id: CharacterId): CharacterDataSpec {
  const spec = specsById.get(id);
  if (!spec) throw new Error(`Unknown authorable character: ${String(id)}`);
  return spec;
}
