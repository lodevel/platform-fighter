import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {tsImport} from 'tsx/esm/api';
import {verifyPikachuSurfaceTechTrace} from './pikachu-completion-surface-tech-trace-verify.mjs';

const directory=process.env.PF_REGISTRY_OUTPUT??'docs/review/2026-10-06/pikachu-character/integration/completion-surface-tech';
const rawBytes=await readFile(`${directory}/observations.json`),report=JSON.parse(rawBytes);
const prefix=process.env.PF_STAGED_PREFIX;assert.ok(prefix,'Set the original immutable PF_STAGED_PREFIX');
const staged=JSON.parse(await readFile(`${prefix}-assets-staged.json`,'utf8'));
const framesBytes=await readFile(`${prefix}-pikachu-frames.json`),metadata=JSON.parse(framesBytes),hashes=JSON.parse(await readFile(staged.sourceHashes,'utf8'));
assert.equal(report.bundleSha256,staged.bundleSha256);assert.deepEqual(report.build,staged);
assert.equal(createHash('sha256').update(framesBytes).digest('hex'),staged.pikachuFramesSha256);
for(const name of ['pikachuAuxiliaryBody','pikachuSurfaceTech'])assert.equal(createHash('sha256').update(await readFile(`${staged.sourceLeafDirectory}/${name}.ts`)).digest('hex'),hashes[`src/characters/${name}.ts`]);
const {selectPikachuSurfaceTechBody}=await tsImport(new URL(`../${staged.sourceLeafDirectory}/pikachuSurfaceTech.ts`,import.meta.url).pathname,import.meta.url);
const audit={state:'IMMUTABLE_ACTUAL_RUNTIME_TRACE_RECHECK',scope:'All recorded production MatchScene traces are rechecked against the original immutable source graph and metadata. This is not a new browser capture, not a unit-test qualification and not an overwrite of the initial failed floating-point oracle.',rawTracePath:`${directory}/observations.json`,rawTraceSha256:createHash('sha256').update(rawBytes).digest('hex'),originalReportedResult:report.result,originalAssertionFailure:report.assertionFailure,bundleSha256:report.bundleSha256,...verifyPikachuSurfaceTechTrace(report,metadata,selectPikachuSurfaceTechBody)};
await writeFile(`${directory}/trace-verification.json`,JSON.stringify(audit,null,2)+'\n');
console.log(JSON.stringify({result:audit.result,actualCases:audit.actualCases,actualCaptures:audit.actualCaptures}));
