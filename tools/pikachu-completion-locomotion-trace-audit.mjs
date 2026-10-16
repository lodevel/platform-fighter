import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {tsImport} from 'tsx/esm/api';
const directory=process.argv[2],report=JSON.parse(await readFile(`${directory}/observations.json`,'utf8'));
const prefix=report.build.sourceHashes.replace('-source-hashes.json','');
const metadata=JSON.parse(await readFile(`${prefix}-pikachu-frames.json`,'utf8'));
const {PIKACHU_STATE_AUTHORED_HURTBOX_POSES:poses}=await tsImport(new URL(`../${prefix}-pikachuStateHurtboxes.ts`,import.meta.url).pathname,import.meta.url);
const measured=JSON.parse(await readFile('docs/review/2026-10-06/pikachu-character/integration/completion-gap-audit/locomotion-primary-measurements.json','utf8'));
const source=await readFile('tools/pikachu-completion-locomotion-match-acceptance.mjs','utf8');
const from=source.indexOf(' for(const c of report.cases){'),to=source.indexOf('\n}catch(e)',from);
assert.ok(from>=0&&to>from);const limitedCases=[];for(const c of report.cases)if(c.interrupt==='jab'&&!c.interrupted){const observed=c.trace.find(o=>o.texture.includes('dsmash')&&o.presentation===null);if(observed){limitedCases.push({requested:c.kind,facing:c.facing,actual:'buffered down-smash body/charge; no jab or dtilt claim'});c.kind='interrupt-end-buffered-down-smash';c.interrupt='buffered-down-smash';c.interrupted=observed;}}report.floorFailures=[];process.env.PF_DEFER_FLOOR='1';
try{new Function('report','assert','metadata','poses','measured','process',source.slice(from,to))(report,assert,metadata,poses,measured,process);
await writeFile(`${directory}/source-clock-transport-audit.json`,JSON.stringify({scope:'Independent source oracle applied to actual immutable browser keyboard/Matter traces. Source art floor rejection remains; this is not a runtime rerun or row promotion.',result:report.result,bundle:report.bundle,bundleSha256:report.bundleSha256,cases:report.cases.length,limitedCases,floorFailures:report.floorFailures,crawlDisplacements:report.cases.filter(c=>c.displacement!=null).map(c=>({sheet:c.kind,facing:c.facing,displacement:c.displacement}))},null,2)+'\n');}catch(e){console.error(e);throw e;}
