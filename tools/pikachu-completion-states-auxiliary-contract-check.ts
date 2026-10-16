/** Source-contract comparison, not running-match qualification. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { selectPikachuAuxiliaryBody, pikachuAuxiliaryBodyEndExclusive,
  pikachuAuxiliarySourceStatus, pikachuAuxiliaryBodyLoopFrames } from '../src/characters/pikachuAuxiliaryBody';
const base = 'docs/review/2026-10-06/pikachu-character';
const json = (file: string) => JSON.parse(readFileSync(file, 'utf8'));
const clock = json(`${base}/sources/state-runtime-clock-contract.json`);
const source = json(`${base}/art/completion-states-family-audit/auxiliary-source-contract.json`);
const receiving = ['ledge-getup-candidates.json', 'reactions-misc-candidates.json']
  .flatMap(name => json(`${base}/sources/full-body-native-review/tiled-receiving/${name}`).rows);
let fixedSourceAges = 0;
for (const profile of source.profiles) {
  const action = clock.actions.find((row: any) => row.sheet === profile.sheet);
  assert(action);
  assert.equal(pikachuAuxiliaryBodyEndExclusive(profile.sheet), action.nativeFinalFrameIndex + 1);
  assert.deepEqual(pikachuAuxiliarySourceStatus(profile.sheet), profile.sourceStatus);
  const loop = pikachuAuxiliaryBodyLoopFrames(profile.sheet);
  assert.equal(loop, action.nativeLoopFlag ? action.nativeFinalFrameIndex : null);
  for (let age = 0; age <= action.nativeFinalFrameIndex; age++) {
    const effectiveAge = loop ? age % loop : age;
    const window = action.nativeWindows.find((row: any) => row.nativeStart <= effectiveAge && effectiveAge < row.nativeEnd);
    assert(window);
    const expected = receiving.find((row: any) => row.sheet === profile.sheet && row.artFrameIndex === window.artFrameIndex);
    assert(expected);
    const actual = selectPikachuAuxiliaryBody(profile.sheet, age);
    assert(actual);
    assert.equal(actual.artFrameIndex, expected.artFrameIndex);
    assert.equal(actual.nativeSample, expected.nativeSample);
    assert.deepEqual(actual.hurtboxes, expected.hurtboxes);
    assert(Number.isFinite(actual.sourceRootDelta.x) && Number.isFinite(actual.sourceRootDelta.y));
    fixedSourceAges++;
  }
  if (loop) {
    for (const age of [loop, loop + 1, 37, loop * 20 + 12])
      assert.deepEqual(selectPikachuAuxiliaryBody(profile.sheet, age), selectPikachuAuxiliaryBody(profile.sheet, age % loop));
  } else assert.equal(selectPikachuAuxiliaryBody(profile.sheet, action.nativeFinalFrameIndex + 1), null);
  for (const age of [-1, NaN, Infinity])
    assert.equal(selectPikachuAuxiliaryBody(profile.sheet, age), null);
}
for (const sheet of ['__proto__', 'constructor', 'not-an-accepted-source-family']) {
  assert.equal(selectPikachuAuxiliaryBody(sheet, 0), null);
  assert.equal(pikachuAuxiliaryBodyEndExclusive(sheet), null);
  assert.equal(pikachuAuxiliarySourceStatus(sheet), null);
  assert.equal(pikachuAuxiliaryBodyLoopFrames(sheet), null);
}
const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
const report = { state: 'PASS_SOURCE_CONTRACT_ONLY', families: source.profiles.length,
  fixedSourceAges, leafSha256: sha('src/characters/pikachuAuxiliaryBody.ts'),
  sourceContractSha256: sha(`${base}/art/completion-states-family-audit/auxiliary-source-contract.json`),
  scope: 'All exact sparse drawing/native-window boundaries and source12caps at each integer source age; invalid/prototype inputs return null; non-loop terminal ages return null, source loop endpoint is excluded and wraps repeatedly. No actual physics/input/clock/protection claim.' };
writeFileSync(`${base}/art/completion-states-family-audit/source-contract-check.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
