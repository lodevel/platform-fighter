/** Lightweight exact data normalization; no image decode/fit/native evaluation.
 * Index pins all ten accepted receiving/probe packets and acceptance reviews.
 * Original expected classes/coordinates/clearances are retained, not inferred
 * from runtime receiving. Only the exact APP14 native8 reuse may restamp0→3. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const [indexPath,outPath]=process.argv.slice(2);
assert.ok(indexPath&&outPath,'Usage: node tools/dk-full-standing-grab-normalize-probes.mjs INDEX.json NEW-OUTPUT.json');
const hash=b=>createHash('sha256').update(b).digest('hex'),pins=[];
async function bytesPin(p){assert.ok(p&&typeof p.path==='string');assert.match(p.sha256??'',/^[a-f0-9]{64}$/);const bytes=await readFile(p.path);assert.equal(hash(bytes),p.sha256,p.path);pins.push({...p});return bytes;}
async function pin(p){return JSON.parse(await bytesPin(p));}
const bytes=await readFile(indexPath),index=JSON.parse(bytes),ages=[0,3,6,7,8,9,10,23,32,37];
const retained8SHA='d0658da1f7db166da7420dcc77f2db28952b6abe85929e0e1a1bccda6e4aa113';
const retained8TargetSHA='70a51e567de10bc47cc8dd7018c5cf3f3bb9fbb895092f8cb10f762e46a0c85f';
const mandatory38ExtraSHA='7bff443997df63a2a6e3743a4216f7e9c41e324a889b275aa2c0b44e6618b49a';
assert.equal(index.kind,'accepted-full-standing-own-probe-index');assert.equal(index.cells?.length,10);assert.deepEqual(index.cells.map(r=>r.sourceAge),ages);
function rawProbes(packet,schema){
 if(schema==='indexed-expected'){assert.ok(Array.isArray(packet.probes));return packet.probes.map(p=>({name:p.name,expected:p.expected,point:p.actorRelativeWorld,alpha:p.targetAlphaAtPoint,radius:p.probeRadiusWorld,distance:p.receivingSignedDistanceWorld,pass:p.matchesExpectedFit,region:p.region,selection:p.selection}));}
 if(schema==='art-actual-review'){assert.ok(Array.isArray(packet.skinProbes)&&Array.isArray(packet.gapMisses));return [...packet.skinProbes,...packet.gapMisses].map(p=>({name:p.id,expected:p.kind,point:p.actorRelativeWorldPoint,alpha:p.actualTargetRGBA?.[3],radius:p.probeRadiusWorld,distance:-p.allPrimitiveMaximumInsetWorld,pass:p.analyticalPass,region:p.region,selection:p.selection}));}
 if(schema==='art-branch-final'){assert.ok([4,7,33].includes(packet.nativeSample),'Bounded no-art-index receipt schema only native4/7/33');assert.ok(Array.isArray(packet.probes));return packet.probes.map(p=>({name:p.name??p.id,expected:p.kind,point:p.actorRelativeWorldPoint,alpha:p.actualTargetRGBARechecked?.[3],radius:p.probeRadiusWorld,distance:-p.finalAllPrimitiveMaximumInsetWorld,pass:p.finalAnalyticalPass,region:p.region,selection:p.selection}));}
 if(schema==='app14-native8-digits'){assert.equal(packet.finalDigitProbes?.length,5);return packet.finalDigitProbes.flatMap(p=>[{name:p.digit+'-skin',expected:'skin',point:p.contactProbe.actorRelativeWorldPoint,alpha:p.contactProbe.RGBA[3],radius:.1,distance:-p.finalActiveHandPrimitiveInsetWorld,pass:true,region:p.contactProbe.region,selection:'Retained APP14 actual own skin core; original target/receiving byte pins'}, {name:p.digit+'-gap',expected:'gap',point:p.transparentGapMiss.actorRelativeWorldPoint,alpha:p.transparentGapMiss.RGBA[3],radius:.1,distance:p.finalAllPrimitiveGapClearanceWorld,pass:true,region:p.contactProbe.region,selection:'Retained APP14 actual alpha0 gap; original target/receiving byte pins'}]);}
 throw Error('Explicit probeSchema required: indexed-expected / art-actual-review / art-branch-final / app14-native8-digits');
}
const cells=[];
for(let artFrameIndex=0;artFrameIndex<index.cells.length;artFrameIndex++){
 const row=index.cells[artFrameIndex];assert.equal(row.nativeSample,row.sourceAge+1);assert.match(row.targetImageSha256??'',/^[a-f0-9]{64}$/);if(row.artFrameIndex!==undefined)assert.equal(row.artFrameIndex,artFrameIndex);
 const packet=await pin(row.ownProbePacket),review=await pin(row.acceptanceReview);assert.equal(packet.nativeSample,row.nativeSample);
 if(packet.sourceGameplayAge!==undefined)assert.equal(packet.sourceGameplayAge,row.sourceAge);
 const isRetained8=row.nativeSample===8;
 if(isRetained8){assert.equal(row.probeSchema,'app14-native8-digits');assert.equal(row.ownProbePacket.sha256,retained8SHA);assert.equal(row.targetImageSha256,retained8TargetSHA);assert.equal(artFrameIndex,3);}
 else assert.notEqual(row.probeSchema,'app14-native8-digits','No global art-index bypass');
 const candidatePin=row.receivingCandidate??(isRetained8?row.ownProbePacket:packet.candidate),candidate=await pin(candidatePin);
 if(packet.candidate)assert.equal(candidatePin.sha256,packet.candidate.sha256);
 assert.equal(candidate.nativeSample,row.nativeSample);assert.equal(candidate.targetImageSha256,row.targetImageSha256);
 const originalIndex=isRetained8?0:artFrameIndex;
 if(row.probeSchema==='art-branch-final'){assert.ok([4,7,33].includes(row.nativeSample));assert.equal(packet.artFrameIndex,undefined,'Branch raw schema has no implicit art index');assert.equal(packet.candidate.sha256,candidatePin.sha256);assert.equal(candidate.artIndexRestamp?.selectedArtFrameIndex,artFrameIndex);assert.equal(packet.target?.sha256,row.targetImageSha256);}else assert.equal(packet.artFrameIndex,originalIndex);
 assert.equal(candidate.artFrameIndex,originalIndex);assert.equal(candidate.hurtboxPoses?.length,1);assert.equal(candidate.hurtboxPoses[0].artFrameIndex,originalIndex);assert.equal(candidate.hurtboxPoses[0].nativeSample,row.nativeSample);
 if(isRetained8)assert.equal(candidatePin.sha256,retained8SHA,'Exact old receiving only; pixels/geometry unchanged');
 assert.deepEqual(candidate.root,[128,208]);assert.ok(Math.abs(candidate.scaleToWorld-5/6.5)<1e-12);assert.equal(candidate.bodyCentreFromRootY,-42);
 await bytesPin({path:candidate.targetImage,sha256:row.targetImageSha256});assert.ok(JSON.stringify(review).includes(candidatePin.sha256),'Acceptance review must bind exact receiving candidate SHA');
 let original=rawProbes(packet,row.probeSchema);const extraPins=[];
 for(const extraPin of row.extraOwnProbePackets??[]){const extra=await pin(extraPin);const own=Array.isArray(extra.rows)?extra.rows.filter(r=>r.nativeSample===row.nativeSample):[extra];assert.equal(own.length,1);assert.equal(own[0].nativeSample,row.nativeSample);assert.equal(own[0].candidate?.sha256,candidatePin.sha256);assert.ok(Array.isArray(own[0].probes));original.push(...rawProbes({skinProbes:own[0].probes.filter(p=>p.kind==='skin'),gapMisses:own[0].probes.filter(p=>p.kind==='gap')},'art-actual-review'));extraPins.push(extraPin);}
 if(row.nativeSample===38){assert.ok(extraPins.some(p=>p.sha256===mandatory38ExtraSHA),'Native38 own5skin/2gap supplemental receipt mandatory');}
 const names=new Set(),probes=[];
 for(const p of original){assert.ok(p.expected==='skin'||p.expected==='gap');assert.ok(typeof p.name==='string'&&p.name&&!names.has(p.name));names.add(p.name);assert.ok(p.point&&Number.isFinite(p.point.x)&&Number.isFinite(p.point.y));assert.ok(Number.isFinite(p.alpha));assert.ok(p.expected==='skin'?p.alpha>=32:p.alpha<32,`${p.name}: alpha32 class contradiction`);assert.ok(Number.isFinite(p.radius)&&p.radius>0&&p.radius<=.15,`${p.name}: finite packet fixture radius required`);assert.equal(p.pass,true,`${p.name}: failed fit remains rejected`);assert.ok(Number.isFinite(p.distance));assert.ok(p.expected==='skin'?p.distance<=-p.radius:p.distance>=p.radius,`${p.name}: finite footprint lacks clearance`);probes.push({name:p.name,expected:p.expected,[p.expected==='skin'?'core':'gap']:{...p.point},radius:p.radius,region:p.region??null,targetAlphaAtPoint:p.alpha,receivingSignedDistanceWorld:p.distance,selection:p.selection??null});}
 assert.ok(probes.some(p=>p.core)&&probes.some(p=>p.gap),'Every own target needs both class invariants');if(isRetained8){assert.equal(probes.filter(p=>p.core).length,5);assert.equal(probes.filter(p=>p.gap).length,5);}
 cells.push({sourceAge:row.sourceAge,nativeSample:row.nativeSample,artFrameIndex,targetImageSha256:row.targetImageSha256,probeSchema:row.probeSchema,rawArtIndexBinding:row.probeSchema==='art-branch-final'?'exact packet candidate SHA + independently validated candidate art/pose/restamp index':null,ownProbePacket:row.ownProbePacket,acceptanceReview:row.acceptanceReview,receivingCandidate:candidatePin,extraOwnProbePackets:extraPins,restamp:isRetained8?{from:0,to:3,policy:'Exact retained APP14native8 pixels/geometry only'}:null,probes});
}
const output={kind:'full-standing-own-probes-normalized-for-actual-match',index:{path:indexPath,sha256:hash(bytes)},pins,cells,scope:'Exact own target-alpha32 skin/gap data; original finite footprint. Only APP14native8 0→3 restamp. Existing failed points remain rejected. Actual Match/CATCH/grip unqualified.'};
await writeFile(outPath,JSON.stringify(output,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({outPath,sha256:hash(await readFile(outPath)),cells:cells.length,skin:cells.reduce((n,c)=>n+c.probes.filter(p=>p.core).length,0),gap:cells.reduce((n,c)=>n+c.probes.filter(p=>p.gap).length,0)}));
