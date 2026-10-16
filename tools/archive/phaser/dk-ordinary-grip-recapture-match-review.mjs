/** Prepared APP15 actual ordinary-held target-anchor/depth review. Requires
 * accepted, installed own calibration+clip grip metadata. Never installs
 * capture state or resolver override. The explicit fallback-to-supported fixture
 * temporarily removes/restores ONLY recipient-owned authored calibration.
 * Specs are independently pinned authored fixtures, not pointer-save proof. */
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {chromium} from 'playwright';
import {createHash} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
const hash=b=>createHash('sha256').update(b).digest('hex');
const need=k=>{const v=process.env[k];assert.match(v??'',/^[a-f0-9]{64}$/,`${k} mandatory`);return v;};
const expectedBundle=need('PF_EXPECT_BUNDLE_SHA'),expectedMetadata=need('PF_EXPECT_DK_METADATA_SHA'),manifestSHA=need('PF_ORDINARY_GRIP_REVIEW_SHA');
const path=process.env.PF_ORDINARY_GRIP_REVIEW,prefix=process.env.PF_FROZEN_SOURCE_DIR,out=process.env.PF_ORDINARY_GRIP_OUT;assert.ok(path&&prefix&&out);await mkdir(out,{recursive:false});
const report={cases:[],errors:[],failedResponses:[],pins:[],scope:'Repeated capture birth after natural hold release, same live stock DK/PK instances and reset generations, both physical input slots/faces. Explicit fallback-to-supported variant toggles recipient-only optional authored calibration; no input clock/capture/resolver override or native constraint claim.'};
let browser,page,manifest;const held=new Set();
const down=async k=>{await page.keyboard.down(k);held.add(k);},up=async k=>{await page.keyboard.up(k);held.delete(k);};
async function release(){if(page)for(const k of [...held])await up(k);}
async function pin(p,expected){const b=await readFile(p);if(expected)assert.equal(hash(b),expected,p);report.pins.push({path:p,sha256:hash(b)});return b;}
const check=(c,label,pass,actual,expected)=>c.checks.push({label,pass,actual,expected});
const read=()=>page.evaluate(()=>window.__dkGrip.read()),step=(n=1)=>page.evaluate(n=>window.__dkGrip.step(n),n);
async function keypad(grab=true,pressed=true){const cdp=await page.context().newCDPSession(page);await cdp.send('Input.dispatchKeyEvent',{type:pressed?'keyDown':'keyUp',key:grab?'4':'1',code:grab?'Numpad4':'Numpad1',windowsVirtualKeyCode:grab?100:97,nativeVirtualKeyCode:grab?100:97,location:3,isKeypad:true});await cdp.detach();}
async function install(slot,facing,captorSpec,recipientSpec,route){await release();await page.evaluate(({slot,facing,captorSpec,recipientSpec,route})=>{
 const g=window.__game;for(const s of g.scene.getScenes(true))g.scene.stop(s.scene.key);
 const make=(index,dk)=>({index,characterId:dk?'donkeykong':'pikachu',inputType:index===1?'keyboard_p1':'keyboard_p2',paletteIndex:0,...(route==='saved'?{customCharacter:{slotId:dk?'donkeykong-grip-fixture':'pikachu-anchor-fixture',spec:dk?captorSpec:recipientSpec}}:{})});
 const configuredPlayers=[make(1,slot===1),make(2,slot===2)];
 g.scene.start('MatchScene',{matchConfig:{mode:'stocks',stockCount:5,stageId:'flat',rngSeed:815011,itemFrequency:'off',players:configuredPlayers}});
 const s=g.scene.getScene('MatchScene');s.physicsEngine.pause();s.roundStartCountdown=0;s.cpuControllers.clear();
 const floor=s.baseStage.bodies.platformBodies.find(b=>b.label==='platform.solid');if(!floor)throw Error('Missing real floor');for(const b of s.baseStage.bodies.platformBodies)if(b!==floor){b.collisionFilter.mask=0;s.matter.world.remove(b);}
 const captor=slot===1?s.p1:s.p2,recipient=slot===1?s.p2:s.p1,copy=x=>x==null?null:JSON.parse(JSON.stringify(x));
 const sprite=f=>{const i=f===s.p1?0:1,sp=s.playerSlots[i].sprite;return{key:sp.texture.key,frame:Number(sp.frame.name),x:sp.x,y:sp.y,depth:sp.depth,flipX:sp.flipX,originX:sp.originX,originY:sp.originY,scaleX:sp.scaleX,scaleY:sp.scaleY};};
 const body=f=>({id:f.id,bodyId:f.body.id,position:f.getPosition(),velocity:f.getVelocity(),face:f.getFacing(),grounded:f.isGrounded(),percent:f.getDamagePercent(),freeze:f.getHitlagRemaining(),stun:f.getHitstunRemaining(),resetGeneration:f.getPositionResetGeneration(),grab:copy(f.getGrabState()),capture:copy(f.getCapturePresentationState()),body:copy(f.getPackedBodyState()),sprite:sprite(f),dimensions:{width:f.getTuning().width,height:f.getTuning().height}});
 const events=[];const callback=s.hitboxDamageHandler.callback;s.hitboxDamageHandler.callback=(index,hit,context)=>{const result=callback(index,hit,context);events.push({index,hit:copy(hit),context:copy({...context,attackInstance:undefined}),result:copy(result),frame:s.physicsEngine.getFrame()});return result;};
 const read=()=>{const d=captor.getCaptureAttachmentDiagnostic();return{frame:s.physicsEngine.getFrame(),floor:floor.bounds.min.y,captor:body(captor),recipient:body(recipient),attachment:copy(d),bindingCurrent:d?.status==='paired'?captor.isCaptureAttachmentResultCurrent(d):false,events:copy(events)};};
 const step=(n=1)=>{for(let i=0;i<n;i++){s.physicsEngine.resume();s.update(0,s.physicsEngine.fixedTimestepMs);s.physicsEngine.pause();}return read();};
 captor.resetForRound(floor.position.x-120,floor.bounds.min.y-42);recipient.resetForRound(floor.position.x-120+70*facing,floor.bounds.min.y-25);captor.setDamagePercent(0);recipient.setDamagePercent(0);captor.setInvincibility(0);recipient.setInvincibility(0);step(12);captor.setFacing(facing);recipient.setFacing(-facing);events.length=0;
 const kit=f=>({id:f.id,moves:copy([...f.attacks.values()].sort((a,b)=>a.id.localeCompare(b.id))),grab:copy(f.getGrabSpec()),calibration:copy(f.getCaptureAttachmentCalibration()),dimensions:{width:f.getTuning().width,height:f.getTuning().height}});
 const ownCalibration=recipient.getCaptureAttachmentCalibration();
 window.__dkGrip={s,captor,recipient,read,step,route,unsupported:()=>recipient.setCaptureAttachmentCalibration(null),restoreOwn:()=>recipient.setCaptureAttachmentCalibration(ownCalibration),restage:()=>{s.matter.body.setPosition(captor.body,{x:floor.position.x-120,y:floor.bounds.min.y-42});s.matter.body.setPosition(recipient.body,{x:floor.position.x-120+70*facing,y:floor.bounds.min.y-25});s.matter.body.setVelocity(captor.body,{x:0,y:0});s.matter.body.setVelocity(recipient.body,{x:0,y:0});captor.setFacing(facing);recipient.setFacing(-facing);},configuredPlayers:copy(configuredPlayers),freeze:n=>captor.armAttackerHitlag(n),kits:{captor:kit(captor),recipient:kit(recipient)},resetRecipient:()=>recipient.resetForRound(floor.position.x+450,floor.bounds.min.y-25)};
 },{slot,facing,captorSpec,recipientSpec,route});return read();}
function descriptorEqual(a,b){return ['poseKey','profileKey','artFrameIndex','nativeSample','provenance'].every(k=>a[k]===b[k])&&JSON.stringify(a.point)===JSON.stringify(b.point)&&JSON.stringify(a.dimensions)===JSON.stringify(b.dimensions);}
async function validate(c,o){const d=o.attachment;check(c,'actually paired live reciprocal capture',d?.status==='paired'&&o.bindingCurrent&&o.recipient.capture?.active,d);if(d?.status!=='paired')return false;
 const grip=manifest.grips.find(a=>descriptorEqual(a,d.selection.grip)&&a.context===d.context&&a.facingPolicy===d.selection.grip.facingPolicy&&a.occlusion===d.occlusion),anchor=manifest.anchors.find(a=>descriptorEqual(a,d.selection.anchor)&&a.context===d.context);check(c,'selected own descriptors equal independently reviewed input',!!grip&&!!anchor,{grip:d.selection.grip,anchor:d.selection.anchor});if(!grip||!anchor)return false;
 const D=d.selection.captorDrawingFacing,R=d.exact.recipientFacing,P=o.captor.position,A=anchor.point,G=grip.point;
 const centre={x:P.x+G.x*D-A.x*R,y:P.y+G.y-A.y};const correction=d.stage.correctionWorld;const expected={x:centre.x+correction.x,y:centre.y+correction.y};
 check(c,'actual postsolver own-anchor recipient follows computed unequal target points',Math.abs(o.recipient.position.x-expected.x)<1e-6&&Math.abs(o.recipient.position.y-expected.y)<1e-6,{actual:o.recipient.position,exact:centre,stage:d.stage},expected);
 const expectedBack=grip.occlusion==='recipient-back',expectedFront=grip.occlusion==='recipient-front';check(c,'actual sprite ordering applies declared whole-recipient policy',expectedBack?o.recipient.sprite.depth<o.captor.sprite.depth:expectedFront?o.recipient.sprite.depth>o.captor.sprite.depth:true,{captor:o.captor.sprite,recipient:o.recipient.sprite},grip.occlusion);
 check(c,'receiving native/body/source sprite context recorded independently',o.captor.sprite.key.endsWith('.grab_pull')||o.captor.sprite.key.endsWith('.grab_hold'),o.captor.sprite);return true;}
try{
 manifest=JSON.parse(await pin(path,manifestSHA));
 if(manifest.state==='STAGED_REVIEWED_BODY_INPUTS_NOT_RUNTIME_QUALIFIED'){
  const packed=manifest;assert.ok(process.env.PF_ORDINARY_GRIP_CAPTOR_SPEC&&process.env.PF_ORDINARY_GRIP_RECIPIENT_SPEC,'Actual authored spec fixture pins mandatory for packed data');
  const ownPKPath='docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art/ordinary-grip-anchor-review-01/pikachu-ordinary-target-calibration-with-floor-candidate-02.json';
  const ownPK=JSON.parse(await pin(ownPKPath,'fa9c9581fa6975872565959cd0c8b3c296213e35aee80d22912d572b6cdb5516'));
  const identity=packed.captorCalibrationIdentity;assert.ok(identity?.profileKey&&identity.revision);assert.ok(!identity.grips);
  manifest={kind:'ordinary-held-authored-target-grip-review',captorSpec:{path:process.env.PF_ORDINARY_GRIP_CAPTOR_SPEC,sha256:need('PF_ORDINARY_GRIP_CAPTOR_SPEC_SHA')},recipientSpec:{path:process.env.PF_ORDINARY_GRIP_RECIPIENT_SPEC,sha256:need('PF_ORDINARY_GRIP_RECIPIENT_SPEC_SHA')},grips:['grab_pull','grab_hold'].flatMap(key=>packed.animations[key].captureGripPoses).map(row=>({...row,profileKey:identity.profileKey+'@'+identity.revision})),anchors:ownPK.anchors.map(row=>({...row,profileKey:ownPK.profileKey+'@'+ownPK.revision})),reviewPins:[packed.bodyReview,packed.ordinaryReview,packed.gripCalibration],captorCalibrationIdentity:identity,recipientCalibration:ownPK};
  report.reviewAdapter={format:'Actual pack builder metadata-fragment.json',identity,ownPKPath};
 }
 assert.equal(manifest.kind,'ordinary-held-authored-target-grip-review');const captorSpec=JSON.parse(await pin(manifest.captorSpec.path,manifest.captorSpec.sha256)),recipientSpec=JSON.parse(await pin(manifest.recipientSpec.path,manifest.recipientSpec.sha256));assert.equal(captorSpec.id,'donkeykong');assert.equal(recipientSpec.id,'pikachu');assert.equal(captorSpec.moves.grab.attachmentPolicy,'pose-anchors-beta-v1');if(manifest.captorCalibrationIdentity)assert.deepEqual(captorSpec.captureAttachmentCalibration,manifest.captorCalibrationIdentity);if(manifest.recipientCalibration)assert.deepEqual(recipientSpec.captureAttachmentCalibration,manifest.recipientCalibration);assert.ok(!captorSpec.captureAttachmentCalibration?.grips?.length,'Clip grip rows must be sole owner; DK calibration identity only');assert.ok(manifest.grips.length&&manifest.anchors.length);for(const p of manifest.reviewPins??[])await pin(p.path,p.sha256);assert.equal(hash(await readFile('assets/characters/donkeykong/frames.json')),expectedMetadata);for(const n of ['Character.ts','captureAttachmentCoordinator.ts','captureAttachmentDepth.ts','donkeykongCaptureAttachment.ts'])await pin(`${prefix}/src/characters/${n}`);
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>report.errors.push(e.message));page.on('response',r=>{if(r.status()>=400)report.failedResponses.push({url:r.url(),status:r.status()});});await page.goto(process.env.PF_REWORK_URL??'http://127.0.0.1:4196/platform-fighter/',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__game?.scene.isActive('PasswordGateScene'));const bundle=await page.evaluate(()=>[...document.scripts].find(s=>/assets\/index-/.test(s.src))?.src);assert.ok(bundle);assert.equal(hash(await(await page.request.get(bundle)).body()),expectedBundle);
 const routes=process.env.PF_ORDINARY_GRIP_ROUTE_FILTER?[process.env.PF_ORDINARY_GRIP_ROUTE_FILTER]:['stock','saved'];assert.ok(routes.every(r=>r==='stock'||r==='saved'),'Route filter must be stock or saved');
 for(const initial of ['paired','fallback'])for(const slot of [1,2])for(const facing of [1,-1]){const c={name:`recapture-${initial}-slot${slot}-face${facing}`,checks:[],samples:[]};report.cases.push(c);try{
  let o=await install(slot,facing,captorSpec,recipientSpec,'stock');
  const resets=[o.captor.resetGeneration,o.recipient.resetGeneration],bodies=[o.captor.bodyId,o.recipient.bodyId];
  if(initial==='fallback')await page.evaluate(()=>window.__dkGrip.unsupported());
  if(slot===1)await down('t');else await keypad(true,true);o=await step();if(slot===1)await up('t');else await keypad(true,false);
  for(let n=0;n<18&&!o.recipient.capture?.active;n++)o=await step();
  check(c,'first normal hardware CATCH birth once',o.recipient.capture?.active&&o.events.filter(e=>e.context.kind==='grab').length===1,o);
  check(c,'first paired or explicitly unsupported fallback domain',o.attachment?.status===initial,o.attachment);
  assert.ok(o.recipient.capture?.active);const firstId=o.recipient.capture.captureId;
  if(initial==='paired')await validate(c,o);
  // Normal expiry ages the held budget; no throw/reset/capture-state injection.
  for(let n=0;n<120&&o.recipient.capture?.active;n++)o=await step();
  check(c,'normal hold release leaves a stale prior diagnostic',!o.recipient.capture?.active&&o.attachment!==null&&!o.bindingCurrent,o);
  const retained=o.attachment;
  o=await page.evaluate(()=>{const t=window.__dkGrip;for(let n=0;n<100;n++){t.restage();t.step();}return t.read();});
  check(c,'same instances and reset identities across normal immunity and release clocks',JSON.stringify([o.captor.bodyId,o.recipient.bodyId])===JSON.stringify(bodies)&&JSON.stringify([o.captor.resetGeneration,o.recipient.resetGeneration])===JSON.stringify(resets),o,{bodies,resets});
  check(c,'old diagnostic remains present before second fresh physical grab',JSON.stringify(o.attachment)===JSON.stringify(retained),o.attachment,retained);
  if(initial==='fallback')await page.evaluate(()=>window.__dkGrip.restoreOwn());
  await page.evaluate(()=>window.__dkGrip.restage());o=await step(5);
  check(c,'ordinary whiff-ready grounded after original release and stun',o.captor.grab.name==='idle'&&o.captor.grounded&&o.recipient.grounded&&o.recipient.stun===0&&o.recipient.freeze===0,o);
  if(slot===1)await down('t');else await keypad(true,true);o=await step();if(slot===1)await up('t');else await keypad(true,false);
  for(let n=0;n<18&&!o.recipient.capture?.active;n++)o=await step();
  c.samples.push(o);check(c,'second original sampler CATCH birth at held age0 with new capture revision',o.recipient.capture?.active&&o.captor.grab.active?.framesElapsed===0&&o.recipient.capture.captureId>firstId&&o.events.filter(e=>e.context.kind==='grab').length===2,o,{firstId});
  await validate(c,o);await page.screenshot({path:`${out}/${c.name}-second-birth.png`});
  o=await step();c.samples.push(o);await validate(c,o);
  check(c,'established second link advances exactly one normal hold step',o.captor.grab.active?.framesElapsed===1,o.captor.grab);
 }catch(e){c.error=e.stack;console.error(e.stack);check(c,'case completed',false,e.message);}}
 report.status=report.cases.every(c=>c.checks.every(q=>q.pass))&&!report.errors.length&&!report.failedResponses.length?'PASS_SCOPED_TARGET_ANCHOR_DEPTH':'FAIL';if(report.status==='FAIL')process.exitCode=1;
}catch(e){report.status='ERROR';report.error=e.stack;console.error(e.stack);process.exitCode=1;}
finally{await release().catch(()=>{});await browser?.close();report.caseCount=report.cases.length;report.checkCount=report.cases.reduce((n,c)=>n+c.checks.length,0);report.passedChecks=report.cases.reduce((n,c)=>n+c.checks.filter(q=>q.pass).length,0);await writeFile(`${out}/observations.json`,JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({out,status:report.status,cases:report.caseCount,checks:report.checkCount,passed:report.passedChecks,error:report.error}));
