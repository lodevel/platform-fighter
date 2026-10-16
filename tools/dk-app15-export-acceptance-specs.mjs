/** Run only after root grants APP15 execution. Export authoritative compiled
 * defaults and explicitly authored phase fixtures; never claims pointer SAVE. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {tsImport} from 'tsx/esm/api';
const out=process.argv[2],prefix=process.env.PF_FROZEN_SOURCE_DIR;
assert.ok(out&&prefix,'New output directory and frozen-source prefix mandatory');
const hash=b=>createHash('sha256').update(b).digest('hex');
const checked=[];
for(const path of ['src/characters/authorableCharacterRegistry.ts','src/characters/characterSerializer.ts','src/characters/DonkeyKong.ts','src/characters/Pikachu.ts','src/characters/captureAttachmentDefaultData.ts']){const live=await readFile(path),frozen=await readFile(`${prefix}/${path}`);assert.equal(hash(live),hash(frozen));checked.push({path,sha256:hash(live)});}
const {getAuthorableCharacterSpec}=await tsImport(resolve('src/characters/authorableCharacterRegistry.ts'),import.meta.url);
const {serializeCharacterDataSpec}=await tsImport(resolve('src/characters/characterSerializer.ts'),import.meta.url);
await mkdir(out,{recursive:false});const files=[];
async function save(name,spec,provenance){const bytes=Buffer.from(JSON.stringify(spec,null,2)+'\n'),path=`${out}/${name}.json`;await writeFile(path,bytes,{flag:'wx'});files.push({name,path,sha256:hash(bytes),provenance});}
const dk=serializeCharacterDataSpec(getAuthorableCharacterSpec('donkeykong')),pk=serializeCharacterDataSpec(getAuthorableCharacterSpec('pikachu'));
assert.equal(dk.moves.grab.attachmentPolicy,'pose-anchors-beta-v1');assert.ok(!dk.captureAttachmentCalibration.grips);assert.equal(pk.captureAttachmentCalibration.anchors.length,4);assert.ok(!pk.moves.grab.attachmentPolicy);assert.deepEqual(dk.body,{width:60,height:84,chamfer:dk.body.chamfer});
await save('compiled-donkeykong-default',dk,'Authoritative compiled registry export; NOT pointer-saved proof');await save('compiled-pikachu-default',pk,'Authoritative recipient-owned compiled registry export; NOT pointer-saved proof');
for(const [name,phases] of [['custom-stretched',[14,6,56]],['custom-short',[1,1,3]]]){const custom=structuredClone(dk);[custom.moves.grab.startupFrames,custom.moves.grab.activeFrames,custom.moves.grab.whiffRecoveryFrames]=phases;await save(name,custom,`Explicit authored saved-spec phase fixture${phases.join('/')} preserving all other move/source fields; NOT a pointer timing edit`);}
const receipt={state:'AUTHORITATIVE_COMPILED_AND_EXPLICIT_CUSTOM_FIXTURES_EXPORTED',checked,files,limits:['Only actual pointer Lab runner exported specs prove pointer SAVE/reload','Custom phase resampling is authored; shortened total cannot visit every source cell','No calibration setters/Match capture state injection']};await writeFile(`${out}/export-receipt.json`,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({out,files}));
