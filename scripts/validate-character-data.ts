/**
 * scripts/validate-character-data.ts — post-M5 character architecture pass.
 *
 * Reads every `data/characters/<id>.json` file, parses+validates it via
 * `parseCharacterDataFile`, and cross-checks the parsed values against
 * the in-code constants in `fighterMovementProfiles.ts` plus each
 * character's authored move tables. Exits non-zero on any mismatch.
 *
 * Why this exists
 * ---------------
 *
 * The data files at `data/characters/*.json` are the eventual source of
 * truth for character authoring (see the post-M2 architecture plan).
 * Until the compile step that *generates* TS from JSON ships, the two
 * representations live side-by-side. The vitest suite already locks
 * them together (see `characterSerializer.test.ts:"data files — kept
 * honest"`); this script exposes the same check as a standalone CLI so
 * a CI pipeline or pre-build hook can fail fast on a balance edit that
 * skipped one side.
 *
 * Usage:
 *
 *     npx tsx scripts/validate-character-data.ts
 *
 * Exits 0 on success, 1 on any validation / mismatch error.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseCharacterDataFile } from '../src/characters/characterSerializer';
import {
  BEAR_MOVEMENT_PROFILE,
  CAT_MOVEMENT_PROFILE,
  OWL_MOVEMENT_PROFILE,
  WOLF_MOVEMENT_PROFILE,
} from '../src/characters/fighterMovementProfiles';
import {
  WOLF_DOWN_SPECIAL,
  WOLF_FAIR,
  WOLF_JAB,
  WOLF_NEUTRAL_SPECIAL,
  WOLF_SIDE_SPECIAL,
  WOLF_SMASH,
  WOLF_TILT,
  WOLF_UP_SPECIAL,
} from '../src/characters/Wolf';
import type { CharacterId } from '../src/types';
import type { FighterMovementProfile } from '../src/characters/movesetContract';

interface CrossCheck {
  readonly id: CharacterId;
  readonly profile: FighterMovementProfile;
  /**
   * Optional in-code move references to spot-check; keyed by slot
   * name. Values are intentionally typed `unknown` so any Move /
   * Aerial / Special record can be passed in — the deepEqual check
   * is structural, not nominal.
   */
  readonly moves?: Record<string, unknown>;
}

const CROSS_CHECKS: ReadonlyArray<CrossCheck> = [
  {
    id: 'wolf',
    profile: WOLF_MOVEMENT_PROFILE,
    moves: {
      jab: WOLF_JAB,
      tilt: WOLF_TILT,
      smash: WOLF_SMASH,
      fair: WOLF_FAIR,
      neutralSpecial: WOLF_NEUTRAL_SPECIAL,
      sideSpecial: WOLF_SIDE_SPECIAL,
      upSpecial: WOLF_UP_SPECIAL,
      downSpecial: WOLF_DOWN_SPECIAL,
    },
  },
  { id: 'cat', profile: CAT_MOVEMENT_PROFILE },
  { id: 'owl', profile: OWL_MOVEMENT_PROFILE },
  { id: 'bear', profile: BEAR_MOVEMENT_PROFILE },
];

const DATA_DIR = resolve(process.cwd(), 'data/characters');

interface Mismatch {
  readonly characterId: string;
  readonly field: string;
  readonly inCode: unknown;
  readonly inFile: unknown;
}

const mismatches: Mismatch[] = [];
const errors: Error[] = [];

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false;
  }
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) {
      return false;
    }
  }
  return true;
}

function loadAndValidate(id: CharacterId): void {
  const filePath = resolve(DATA_DIR, `${id}.json`);
  const fileLabel = `data/characters/${id}.json`;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch (err) {
    errors.push(new Error(`${fileLabel}: ${(err as Error).message}`));
    return;
  }
  let spec;
  try {
    spec = parseCharacterDataFile(raw, fileLabel);
  } catch (err) {
    errors.push(err as Error);
    return;
  }

  const check = CROSS_CHECKS.find((c) => c.id === id);
  if (!check) {
    errors.push(
      new Error(
        `${fileLabel}: no in-code cross-check entry exists for id '${id}'`,
      ),
    );
    return;
  }

  // Movement profile cross-check.
  if (!deepEqual(spec.movement, check.profile)) {
    mismatches.push({
      characterId: id,
      field: 'movement',
      inCode: check.profile,
      inFile: spec.movement,
    });
  }

  // Move spot-checks (only the slots we have an in-code constant for).
  if (check.moves && spec.moves) {
    for (const [slot, expected] of Object.entries(check.moves)) {
      if (expected === undefined) continue;
      const actual = (spec.moves as Record<string, unknown>)[slot];
      if (!deepEqual(actual, expected)) {
        mismatches.push({
          characterId: id,
          field: `moves.${slot}`,
          inCode: expected,
          inFile: actual,
        });
      }
    }
  }
}

function main(): void {
  // Discover ids by reading the data directory (so a new character file
  // is automatically picked up). Only validate files we have a known
  // CharacterId for; bail on anything unknown.
  const presentFiles = readdirSync(DATA_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''));

  const knownIds: ReadonlyArray<CharacterId> = ['wolf', 'cat', 'owl', 'bear'];
  for (const f of presentFiles) {
    if (!knownIds.includes(f as CharacterId)) {
      errors.push(
        new Error(
          `data/characters/${f}.json: unknown character id (must be one of ${knownIds.join(', ')})`,
        ),
      );
    }
  }
  for (const id of knownIds) {
    if (!presentFiles.includes(id)) {
      errors.push(new Error(`data/characters/${id}.json: missing — every roster id must have a data file`));
      continue;
    }
    loadAndValidate(id);
  }

  if (errors.length === 0 && mismatches.length === 0) {
    // eslint-disable-next-line no-console
    console.log(`✓ All ${knownIds.length} character data files valid and in sync with in-code constants.`);
    process.exit(0);
  }

  for (const e of errors) {
    // eslint-disable-next-line no-console
    console.error(`✗ ${e.message}`);
  }
  for (const m of mismatches) {
    // eslint-disable-next-line no-console
    console.error(
      `✗ ${m.characterId}: ${m.field} differs between data file and in-code constant.\n  in code: ${JSON.stringify(m.inCode)}\n  in file: ${JSON.stringify(m.inFile)}`,
    );
  }
  process.exit(1);
}

main();
