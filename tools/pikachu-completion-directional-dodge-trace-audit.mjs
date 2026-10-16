import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {tsImport} from 'tsx/esm/api';
const directory=process.argv[2],report=JSON.parse(await readFile(`${directory}/observations.json`,'utf8'));
const prefix=report.build.sourceHashes.replace('-source-hashes.json','');
const metadata=JSON.parse(await readFile(`${prefix}-pikachu-frames.json`,'utf8'));
const {PIKACHU_STATE_AUTHORED_HURTBOX_POSES:poses}=await tsImport(new URL(`../${prefix}-pikachuStateHurtboxes.ts`,import.meta.url).pathname,import.meta.url);
const candidates=JSON.parse(await readFile('docs/review/2026-10-06/pikachu-character/sources/full-body-native-review/tiled-receiving/defense-candidates.json','utf8'));
const final83=candidates.rows.find(r=>r.sheet==='air_dodge'&&r.nativeSample===83),samples=[0,4,12,24,44,64,83];
const source=await readFile('tools/pikachu-completion-directional-dodge-match-acceptance.mjs','utf8');
const from=source.indexOf(' const mirrored='),to=source.indexOf('\n}catch(e)',from);
assert.ok(from>=0&&to>from);
report.contacts??=[];report.landingReceivingFailures=[];report.floorFailures=[];process.env.PF_RETAINED_TRACE='1';process.env.PF_DEFER_FLOOR='1';process.env.PF_DEFER_LANDING_RECEIVING='1';const limitedCases=[];
for(const c of report.cases){const grounded=c.trace.findIndex(o=>o.grounded);if(grounded>=0&&grounded<c.total){limitedCases.push({direction:c.name,facing:c.facing,requestedAirborneTotal:c.total,actualNaturalLandingAge:grounded,scope:'Only pre-landing source phase/body and natural landing exit verified; requested full airborne total remains untested.'});c.total=grounded;c.exit=c.trace[grounded+1];}}
const audit={scope:'Independent source oracle applied to retained actual immutable keyboard/Matter traces, including phase receiving, freeze, gravity/control and landing. Camera interpolation excluded from fighter freeze comparison. This is not a browser rerun, visual approval or row promotion.',bundle:report.bundle,bundleSha256:report.bundleSha256,cases:report.cases.length,landings:report.landings.length,contacts:report.contacts.map(c=>({facing:c.facing,protectedAges:c.trace.filter(o=>o.dodge.active?.framesElapsed>=1&&o.dodge.active.framesElapsed<19).map(o=>o.dodge.active.framesElapsed),firstEligibleMelee:c.trace.find(o=>o.damage>0),fixtureScope:c.fixtureScope})),limitedCases};
try{new Function('report','assert','metadata','poses','final83','samples',source.slice(from,to))(report,assert,metadata,poses,final83,samples);audit.result=report.result;audit.landingReceivingFailures=report.landingReceivingFailures;audit.floorFailures=report.floorFailures;audit.landingAlphaMeasured=report.landings.every(c=>c.lock.every(o=>!!o.alpha));}catch(e){audit.result='FAIL';audit.assertionFailure=e.stack;process.exitCode=1;console.error(e.message);}
await writeFile(`${directory}/source-clock-physics-audit.json`,JSON.stringify(audit,null,2)+'\n');
