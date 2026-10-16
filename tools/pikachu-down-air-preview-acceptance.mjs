import { chromium } from 'playwright';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const base=path.join(root,'docs/review/2026-10-06/pikachu-character');
const posed=true;
const packed=process.argv.includes('--packed');
const build=JSON.parse(readFileSync(path.join(base,packed?'down-air-packed-preview-build.json':'down-air-preview-build.json'),'utf8'));
const candidates=posed?JSON.parse(readFileSync(path.join(base,'down-air/hurtbox-preparation/candidates.json'),'utf8')).rows:null;
const sourceContacts=JSON.parse(readFileSync(path.join(base,'sources/posed-resources/down-air-contact-candidates.json'))).frames;
const sourceEffects=JSON.parse(readFileSync(path.join(base,'sources/posed-resources/down-air-effect-anchor-candidates.json')));
const out=path.join(base,packed?'down-air/packed-browser':'down-air/browser');mkdirSync(out,{recursive:true});
const report={visualCapture:'Actual runtime Canvas pixel export after two presentation frames; paused gameplay clock, no rescaling/recentering',packedArt:packed,presentationAliases:build.presentationAliases,scope:`Isolated rough twenty-nine-pose downair/landing, shared fixture body/gravity, one-pixel target-relative probe; single continuous strike and ordinary shared hit-stop formula${posed?'; authored posed damage capsules with incoming contact and synthetic launch checks':''}; native movement/hitstop timing, native radius/status parity and full fighter not qualified`,
  url:`http://127.0.0.1:${build.previewPort??4193}/${packed?'pikachu-down-air-packed-preview.html':'pikachu-down-air-preview.html'}`,build:build.buildIdentity,input:'Simulated browser keyboard F/N and pointer controls; preview F translates to Character downward C-stick heavy aerial input',cases:[],freeze:[],errors:[]};
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1200,height:980},deviceScaleFactor:1});
page.on('pageerror',e=>report.errors.push(e.message));
const state=()=>page.evaluate(()=>window.__pikachuDownAirPreview.state());
const ready=(s,facing)=>{
  assert(s.elapsed===null&&s.pose==='neutral'&&s.texture===(packed?'pikachu-packed-idle':'pikachu-neutral'),'Ready/return drawing is wrong');
  assert(s.regions.length===0&&s.flipped===(facing===-1),'Ready has contact regions or incorrect mirror');
  assert(s.airborne&&s.artScale===70/600*(packed?4:1)&&s.artOrigin.x===.5&&s.artOrigin.y===(packed?.75:880/1024),'Ready root/scale/aerial fixture is wrong');
  if(posed)assert(s.hurtboxes.length===1&&s.hurtboxes[0].id==='body'&&!s.hurtboxes[0].capsule,'Ended/reset attack retained posed hurtboxes');
};
const check=(s)=>{
  const e=s.elapsed;if(e===null)return;
  assert(Number.isInteger(e)&&e>=0&&e<47,'Attack escaped 47-step gameplay clock');
  const pose=build.poseSchedule.find(p=>e>=p.startElapsed&&e<p.endElapsed);
  assert(s.explicitTimeline&&s.selectedArtFrameIndex===build.poseSchedule.indexOf(pose),'Shared selector disagrees with reviewed art strip index');
  assert(pose&&s.pose===pose.pose&&s.drawingSourceIndex===pose.sourceIndex,'Drawing disagrees with reviewed clock/hold mapping');
  assert(s.texture===(packed?'pikachu-packed-dair':`pikachu-${pose.pose}`)&&s.artOrigin.x===.5&&s.artOrigin.y===.75&&s.artScale===70/600*(packed?4:1),'Attack drawing registration changed');
  assert(s.airborne&&s.moveId==='pikachu.down-air','Down air did not enter the actual airborne attack route');
  if(packed)assert(s.driver?.key==='link.dair.anim'&&s.driver.frameIndex===s.selectedArtFrameIndex&&Number(s.spriteFrame)===s.selectedArtFrameIndex,'Shared Match driver airborne frame mismatch');
  const anchors=sourceEffects.rows.find(row=>e>=row.startElapsed&&e<row.endElapsed);
  const expectedEffects=Object.entries(sourceEffects.nativeActivation)
    .filter(([,value])=>e>=value.startGame-1&&e<value.offGame-1)
    .map(([kind,value])=>({kind,anchor:anchors.anchors[kind],nativeScale:value.scale}));
  assert(JSON.stringify(s.effects)===JSON.stringify(expectedEffects),'Electrical activation/off boundary or held-pose anchor changed');
  if(posed){const expected=candidates.find(row=>row.pose===s.pose);assert(s.hurtboxPolicy==='reviewed-authored-2d-sparse-pose-holds'&&JSON.stringify(s.hurtboxes)===JSON.stringify(expected.hurtboxes),'Posed vulnerability disagrees with drawing clock or body default was retained');}
  const active=e>=13&&e<26;
  assert(s.regions.length===(active?1:0),`Wrong active/clear region count at${e}`);
  if(active){
    const frame=sourceContacts.find(frame=>frame.gameFrame===e+1);
    for(const region of frame.regions){
      const hit=s.regions.find(hit=>hit.id===region.id);
      assert(hit&&JSON.stringify(hit.capsule)===JSON.stringify({start:region.start,end:region.end,radius:region.radius})
        &&hit.damage===region.damage&&hit.knockback.reference.angle===region.angle&&hit.knockback.reference.base===region.base
        &&hit.knockback.reference.growth===region.growth,'Early/late source head payload or projection changed');
    }
  }
};
try{
  await page.goto(report.url,{waitUntil:'networkidle'});await page.waitForFunction(()=>window.__pikachuDownAirPreview?.ready);
  const bundle=(await page.content()).match(/src="([^\"]*\/assets\/pikachu-down-air-(?:packed-)?preview-[^\"]+\.js)"/)?.[1];assert(bundle,'Missing exact downair bundle');
  const bytes=new Uint8Array(await(await fetch(new URL(bundle,report.url))).arrayBuffer());report.bundle=bundle;report.bundleSha256=hash(bytes);assert(report.bundleSha256===build.files[bundle.replace(/^\//,'')],'Served bundle differs from build');
  report.servedArt={};for(const[file,expected]of Object.entries(build.files).filter(([file])=>file.endsWith('.png'))){const response=await fetch(new URL(file,report.url));assert(response.ok,`Missing served art ${file}`);const actual=hash(new Uint8Array(await response.arrayBuffer()));assert(actual===expected,`Changed served art ${file}`);report.servedArt[file]=actual;}
  assert(Object.keys(report.servedArt).length===(build.servedPngCount??30)&&Object.keys(build.art).length===30,'Neutral plus29 reviewed drawings required');
  for(const saved of[false,true])for(const facing of[1,-1])for(const automatic of[false,true])for(const probe of['near','late','edge','miss']){
    await page.evaluate(({saved,facing,automatic,probe})=>{const p=window.__pikachuDownAirPreview;p.setRealFloor(false);p.setSaved(saved);p.setFacing(facing);p.setAutomaticHitlag(automatic);p.setProbe(probe);},{saved,facing,automatic,probe});
    ready(await state(),facing);await page.keyboard.press('f');let s=await state();assert(s.elapsed===0,'F did not start down-air at elapsed0');
    const timeline=[];const captured=new Set();
    for(let physical=0;physical<180;physical++){
      s=await state();if(s.elapsed===null)break;check(s);timeline.push(s);
      if(!saved&&!automatic&&probe==='miss'&&!captured.has(s.pose)){
        const file=`${s.pose}-${facing===1?'right':'left'}.png`;
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        const data=await page.locator('#game canvas').evaluate(canvas=>canvas.toDataURL('image/png'));
        writeFileSync(path.join(out,file),Buffer.from(data.split(',')[1],'base64'));captured.add(s.pose);
      }
      await page.keyboard.press('n');
    }
    s=await state();ready(s,facing);
    const outer=sourceContacts.flatMap(f=>f.regions.map(r=>({frame:f.gameFrame-1,...r}))).reduce((a,b)=>a.start.x+a.radius>b.start.x+b.radius?a:b);
    const point={x:outer.start.x+outer.radius-.25,y:outer.start.y};
    const edge=sourceContacts.find(f=>f.regions.some(r=>Math.hypot(Math.max(Math.abs(point.x-r.start.x)-.5,0),Math.max(Math.abs(point.y-r.start.y)-.5,0))<=r.radius)).gameFrame-1;
    const expected=probe==='near'?[13]:probe==='late'?[25]:probe==='edge'?[edge]:[];
    assert(JSON.stringify(s.contacts.map(h=>h.elapsed))===JSON.stringify(expected),`Target-relative hit clock differs: ${facing}/${automatic}/${probe}`);
    assert(s.contacts.every(h=>h.damage===(h.elapsed<15?13:12)),'Damage did not preserve early/late values');
    if(!automatic)assert(timeline.length===47,'Non-frozen action must occupy exactly47 physical steps');
    if(automatic&&expected.length){assert(timeline.some((t,i)=>i>0&&t.elapsed===timeline[i-1].elapsed&&t.hitlagRemaining>0),'Automatic contact did not freeze the drawing/clock');}
    console.log(JSON.stringify({facing,automatic,probe,contacts:s.contacts}));
    report.cases.push({saved,facing,automaticHitlag:automatic,probe,passed:true,contacts:s.contacts,damage:s.damage,physicalSteps:timeline.length,timeline});
  }
  for(const facing of[1,-1]){
    await page.evaluate(facing=>{const p=window.__pikachuDownAirPreview;p.setFacing(facing);p.setAutomaticHitlag(false);p.setProbe('miss');},facing);
    await page.keyboard.press('f');for(let i=0;i<14;i++)await page.keyboard.press('n');const before=await state();
    await page.click('#freeze');for(let i=0;i<3;i++){await page.keyboard.press('n');const frozen=await state();assert(frozen.elapsed===before.elapsed&&frozen.pose===before.pose&&JSON.stringify(frozen.regions)===JSON.stringify(before.regions)&&(!posed||JSON.stringify(frozen.hurtboxes)===JSON.stringify(before.hurtboxes)),'Manual freeze moved pose/contact/hurtbox timeline');}
    await page.keyboard.press('n');assert((await state()).elapsed===before.elapsed+1,'Clock did not resume after freeze');report.freeze.push({facing,elapsed:before.elapsed,pose:before.pose,passed:true});
  }
  await page.click('#reset');await page.keyboard.press('f');await page.click('#play');await page.waitForTimeout(140);await page.click('#play');const paused=await state();await page.waitForTimeout(150);const later=await state();assert(paused.elapsed!==null&&paused.elapsed>0&&JSON.stringify(paused)===JSON.stringify(later),'Play/pause did not preserve fixed-step state');report.pause={passed:true,elapsed:paused.elapsed,pose:paused.pose};
  if(posed){
    report.incoming=[];report.launch=[];
    for(const facing of[1,-1])for(const row of candidates.filter(row=>row.action==='down-air')){
      await page.evaluate(facing=>{const p=window.__pikachuDownAirPreview;p.setFacing(facing);p.setAutomaticHitlag(false);p.setProbe('miss');},facing);
      await page.keyboard.press('f');for(let i=0;i<row.startElapsed;i++)await page.keyboard.press('n');
      check(await state());
      for(const hurtbox of row.hurtboxes){const c=hurtbox.capsule,x=(c.start.x+c.end.x)/2,y=(c.start.y+c.end.y)/2;
        const result=await page.evaluate(({x,y})=>window.__pikachuDownAirPreview.probeHurtbox(x,y),{x,y});
        assert(result.confirmed&&result.state.elapsed===row.startElapsed,`Incoming centre missed or advanced clock: ${row.pose}/${facing}/${hurtbox.id}`);
        report.incoming.push({facing,pose:row.pose,hurtbox:hurtbox.id,point:{x,y},confirmed:true});
      }
      const maxX=Math.max(...row.hurtboxes.flatMap(h=>[h.capsule.start.x+h.capsule.radius,h.capsule.end.x+h.capsule.radius]));
      const miss=await page.evaluate(x=>window.__pikachuDownAirPreview.probeHurtbox(x,0),maxX+2);
      assert(!miss.confirmed,`Beyond-envelope probe hit: ${row.pose}/${facing}`);
      report.incoming.push({facing,pose:row.pose,point:{x:maxX+2,y:0},confirmed:false});
    }
    for(const facing of[1,-1]){
      await page.evaluate(facing=>{const p=window.__pikachuDownAirPreview;p.setFacing(facing);p.setAutomaticHitlag(false);p.setProbe('miss');},facing);
      await page.keyboard.press('f');for(let i=0;i<32;i++)await page.keyboard.press('n');
      const before=await state(),c=before.hurtboxes[1].capsule;
      const launched=await page.evaluate(({x,y})=>window.__pikachuDownAirPreview.probeHurtbox(x,y,true),{x:(c.start.x+c.end.x)/2,y:(c.start.y+c.end.y)/2});
      assert(launched.confirmed&&launched.state.receivedDamage===5&&launched.state.elapsed===null
        &&launched.state.hitlagRemaining>0&&launched.state.velocity.x===0&&launched.state.velocity.y===0,'Synthetic incoming contact did not damage/interrupt/freeze defender');
      assert(launched.state.hurtboxes.length===1&&!launched.state.hurtboxes[0].capsule,'Interrupted move retained posed vulnerability');
      for(let i=0;i<launched.state.hitlagRemaining;i++)await page.keyboard.press('n');
      const released=await state();
      assert(released.hitstun>0&&released.velocity.x*facing>0&&released.velocity.y<0,'Queued launch/stun did not begin after hit-stop or mirrored incorrectly');
      report.launch.push({facing,passed:true,frozen:launched.state,released,scope:'Synthetic5-damage probe; shared applyHit interruption/launch, not sourced Pikachu launch parity'});
    }
  }
  report.floor=[];
  const beginFloor=async(saved,facing,probe='miss',spawnY=300)=>{
    await page.evaluate(({saved,facing,probe,spawnY})=>{const p=window.__pikachuDownAirPreview;p.setSaved(saved);p.setFacing(facing);p.setAutomaticHitlag(false);p.setProbe(probe);p.setLandingSpawnY(spawnY);p.setRealFloor(true);},{saved,facing,probe,spawnY});
    await page.keyboard.press('f');
  };
  const reachLanding=async()=>{
    for(let i=0;i<120;i++){const s=await state();if(s.moveId==='pikachu.down-air-landing')return s;await page.keyboard.press('n');}
    throw new Error('Real descent did not enter landing attack');
  };
  const checkLanding=s=>{
    const e=s.elapsed,row=build.landingPoseSchedule.find(r=>e>=r.startElapsed&&e<r.endElapsed);
    assert(s.moveId==='pikachu.down-air-landing'&&s.grounded&&row&&s.pose===row.pose&&s.selectedArtFrameIndex===build.landingPoseSchedule.indexOf(row),'Landing drawing/grounded clock wrong');
    assert(s.texture===(packed?'pikachu-packed-dair-landing':`pikachu-${row.pose}`)&&s.artOrigin.y===.75&&s.artScale===70/600*(packed?4:1)&&Math.abs(s.root.y-445)<.25,'Landing root/floor registration wrong');
    if(packed)assert(s.driver?.key==='link.tilt.anim'&&s.driver.frameIndex===s.selectedArtFrameIndex&&Number(s.spriteFrame)===s.selectedArtFrameIndex,'Shared Match driver landing frame mismatch');
    assert(s.regions.length===(e<2?1:0),'Landing contact/clear boundary wrong');
    if(e<2)assert(s.regions[0].damage===4&&s.regions[0].capsule.radius===20&&JSON.stringify(s.regions[0].capsule.start)===JSON.stringify({x:-30,y:5})&&JSON.stringify(s.regions[0].capsule.end)===JSON.stringify({x:30,y:5}),'Source landing capsule/payload changed');
    const expected=candidates.find(r=>r.action==='down-air-landing'&&r.pose===s.pose.replace(/^landing-/,''));
    assert(JSON.stringify(s.hurtboxes)===JSON.stringify(expected.hurtboxes)&&s.effects.length===0,'Landing retained airborne geometry/effects');
  };
  for(const saved of[false,true])for(const facing of[1,-1])for(const probe of['near','late','edge','miss']){
    await beginFloor(saved,facing,probe);let s=await reachLanding();assert(s.elapsed===0,'Landing entry clock skipped0');const timeline=[],captured=new Set();
    for(let physical=0;physical<40;physical++){
      s=await state();if(s.elapsed===null)break;checkLanding(s);timeline.push(s);
      if(!saved&&probe==='miss'&&!captured.has(s.pose)){
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        const data=await page.locator('#game canvas').evaluate(canvas=>canvas.toDataURL('image/png'));
        writeFileSync(path.join(out,`${s.pose}-${facing===1?'right':'left'}.png`),Buffer.from(data.split(',')[1],'base64'));captured.add(s.pose);
      }
      await page.keyboard.press('n');
    }
    s=await state();assert(s.elapsed===null&&timeline.length===22&&s.cooldown===0,'Landing did not release after22unfrozen steps');
    const landingContacts=s.contacts.filter(h=>h.moveId==='pikachu.down-air-landing');
    assert(JSON.stringify(landingContacts.map(h=>h.elapsed))===JSON.stringify(probe==='miss'?[]:probe==='late'?[1]:[0])&&landingContacts.every(h=>h.damage===4),'Real landing contact/last/edge/miss routing wrong');
    report.floor.push({saved,facing,probe,passed:true,contacts:s.contacts,timeline});
  }
  for(const facing of[1,-1])for(const row of candidates.filter(row=>row.action==='down-air-landing')){
    await beginFloor(true,facing);await reachLanding();for(let i=0;i<row.startElapsed;i++)await page.keyboard.press('n');checkLanding(await state());
    for(const h of row.hurtboxes){const c=h.capsule,x=(c.start.x+c.end.x)/2,y=(c.start.y+c.end.y)/2;
      const result=await page.evaluate(({x,y})=>window.__pikachuDownAirPreview.probeHurtbox(x,y),{x,y});assert(result.confirmed&&result.state.elapsed===row.startElapsed,'Incoming landing capsule centre missed or moved clock');report.incoming.push({facing,pose:row.pose,hurtbox:h.id,confirmed:true});}
    const maxX=Math.max(...row.hurtboxes.flatMap(h=>[h.capsule.start.x+h.capsule.radius,h.capsule.end.x+h.capsule.radius]));
    const miss=await page.evaluate(x=>window.__pikachuDownAirPreview.probeHurtbox(x,0),maxX+2);assert(!miss.confirmed,'Beyond landing envelope hit');report.incoming.push({facing,pose:row.pose,confirmed:false});
  }
  for(const facing of[1,-1]){
    await beginFloor(true,facing);const before=await reachLanding();await page.click('#freeze');
    for(let i=0;i<3;i++){await page.keyboard.press('n');const frozen=await state();assert(frozen.elapsed===0&&frozen.pose===before.pose&&JSON.stringify(frozen.hurtboxes)===JSON.stringify(before.hurtboxes)&&frozen.cooldown===22,'Landing freeze drifted drawing/vulnerability/commitment');}
    await page.keyboard.press('n');assert((await state()).elapsed===1,'Landing freeze did not resume');report.freeze.push({facing,landing:true,passed:true});
  }
  report.autocancel=[];
  for(const saved of[false,true])for(const facing of[1,-1]){
    await beginFloor(saved,facing,'miss',100);const timeline=[];
    for(let i=0;i<160;i++){const s=await state();timeline.push(s);assert(s.moveId!=='pikachu.down-air-landing','Late descending autocancel spawned landing contact');if(s.grounded&&s.elapsed===null){assert(s.cooldown===0&&s.effects.length===0,'Late landing retained attack lag/effects');break;}await page.keyboard.press('n');}
    assert(timeline.at(-1).grounded&&timeline.at(-1).elapsed===null,'Late descent did not complete/touch down');report.autocancel.push({saved,facing,passed:true,timeline});
  }
  assert(report.errors.length===0,'Browser reported errors');report.status='passed';
}catch(error){report.status='failed';report.failure=error.stack??String(error);throw error;}
finally{writeFileSync(path.join(out,'acceptance.json'),JSON.stringify(report,null,2)+'\n');await browser.close();}
console.log(JSON.stringify({status:report.status,cases:report.cases.length,floor:report.floor?.length,autocancel:report.autocancel?.length,freeze:report.freeze.length,incoming:report.incoming?.length,launch:report.launch?.length,servedArt:Object.keys(report.servedArt??{}).length,errors:report.errors}));
