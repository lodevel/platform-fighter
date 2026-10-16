import { chromium } from 'playwright';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const base=path.join(root,'docs/review/2026-10-06/pikachu-character');
const posed=true;
const packed=process.argv.includes('--packed');
const timeline=packed||process.argv.includes('--timeline');
const build=JSON.parse(readFileSync(path.join(base,packed?'up-air-packed-preview-build.json':timeline?'up-air-timeline-preview-build.json':'up-air-preview-build.json'),'utf8'));
const candidates=posed?JSON.parse(readFileSync(path.join(base,'up-air/hurtbox-preparation/candidates.json'),'utf8')).rows:null;
const sourceContacts=JSON.parse(readFileSync(path.join(base,'sources/posed-resources/up-air-contact-candidates.json'))).frames;
const out=path.join(base,packed?'up-air/packed-browser':timeline?'up-air/timeline-browser':'up-air/browser');mkdirSync(out,{recursive:true});
const report={visualCapture:'Actual runtime Canvas pixel export after two presentation frames; paused gameplay clock, no rescaling/recentering',scope:`Isolated rough eleven-pose upair, shared fixture body, one-pixel probe; single continuous strike and ordinary shared hit-stop formula${posed?'; authored posed damage capsules with incoming contact and synthetic launch checks':''}; native movement/hitstop timing, native radius/status parity and full fighter not qualified`,
  url:packed?'http://127.0.0.1:4192/pikachu-up-air-packed-preview.html':timeline?'http://127.0.0.1:4191/pikachu-up-air-timeline-preview.html':'http://127.0.0.1:4189/pikachu-up-air-preview.html',build:build.buildIdentity,input:'Simulated browser keyboard F/N and pointer controls; preview F translates to Character upward C-stick heavy aerial input',cases:[],freeze:[],errors:[]};
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1200,height:980},deviceScaleFactor:1});
page.on('pageerror',e=>report.errors.push(e.message));
const state=()=>page.evaluate(()=>window.__pikachuUpAirPreview.state());
const ready=(s,facing)=>{
  assert(s.elapsed===null&&s.pose==='neutral'&&s.texture===(packed?'pikachu-packed-idle':'pikachu-neutral'),'Ready/return drawing is wrong');
  assert(s.regions.length===0&&s.flipped===(facing===-1),'Ready has contact regions or incorrect mirror');
  assert(s.airborne&&s.artScale===(70/600*(packed?4:1))&&s.artOrigin.x===.5&&s.artOrigin.y===(packed?.75:880/1024),'Ready root/scale/aerial fixture is wrong');
  if(posed)assert(s.hurtboxes.length===1&&s.hurtboxes[0].id==='body'&&!s.hurtboxes[0].capsule,'Ended/reset attack retained posed hurtboxes');
};
const check=(s)=>{
  const e=s.elapsed;if(e===null)return;
  assert(Number.isInteger(e)&&e>=0&&e<26,'Attack escaped 26-step gameplay clock');
  const pose=build.poseSchedule.find(p=>e>=p.startElapsed&&e<p.endElapsed);
  if(timeline)assert(s.explicitTimeline&&s.selectedArtFrameIndex===build.poseSchedule.indexOf(pose),'Shared selector disagrees with reviewed art strip index');
  assert(pose&&s.pose===pose.pose&&s.drawingSourceIndex===pose.sourceIndex,'Drawing disagrees with reviewed clock/hold mapping');
  assert(s.texture===(packed?'pikachu-packed-uair':`pikachu-${pose.pose}`)&&s.artOrigin.x===.5&&s.artOrigin.y===.75&&s.artScale===(70/600*(packed?4:1)),'Attack drawing registration changed');
  if(packed)assert(s.packedArt&&s.driver?.frameIndex===s.selectedArtFrameIndex&&Number(s.spriteFrame)===s.selectedArtFrameIndex&&s.driver.state==='pikachu.up-air'&&Math.abs(s.artWidth-2048*70/600)<1e-8&&Math.abs(s.artHeight-1536*70/600)<1e-8,'Actual Match sprite driver/strip frame or footprint disagrees');
  assert(s.airborne&&s.moveId==='pikachu.up-air','Fair did not enter the actual airborne attack route');
  if(posed){const expected=candidates.find(row=>row.pose===s.pose);assert(s.hurtboxPolicy==='reviewed-authored-2d-sparse-pose-holds'&&JSON.stringify(s.hurtboxes)===JSON.stringify(expected.hurtboxes),'Posed vulnerability disagrees with drawing clock or body default was retained');}
  const active=e>=3&&e<8;
  assert(s.regions.length===(active?3:0),`Wrong active/clear region count at${e}`);
  if(active){
    const frame=sourceContacts.find(frame=>frame.gameFrame===e+1);
    for(const region of frame.regions){
      const hit=s.regions.find(hit=>hit.id===region.id);
      assert(hit&&JSON.stringify(hit.capsule)===JSON.stringify({start:region.start,end:region.end,radius:region.radius})
        &&hit.damage===region.damage&&hit.knockback.reference.angle===region.angle&&hit.knockback.reference.base===region.base
        &&hit.knockback.reference.growth===region.growth,'Early/late source tail payload or projection changed');
    }
  }
};
try{
  await page.goto(report.url,{waitUntil:'networkidle'});await page.waitForFunction(()=>window.__pikachuUpAirPreview?.ready);
  const bundle=(await page.content()).match(/src="([^\"]*\/assets\/pikachu-up-air-(?:(?:timeline|packed)-)?preview-[^\"]+\.js)"/)?.[1];assert(bundle,'Missing exact upair bundle');
  const bytes=new Uint8Array(await(await fetch(new URL(bundle,report.url))).arrayBuffer());report.bundle=bundle;report.bundleSha256=hash(bytes);assert(report.bundleSha256===build.files[bundle.replace(/^\//,'')],'Served bundle differs from build');
  report.servedArt={};for(const[file,expected]of Object.entries(build.files).filter(([file])=>file.endsWith('.png'))){const response=await fetch(new URL(file,report.url));assert(response.ok,`Missing served art ${file}`);const actual=hash(new Uint8Array(await response.arrayBuffer()));assert(actual===expected,`Changed served art ${file}`);report.servedArt[file]=actual;}
  assert(Object.keys(report.servedArt).length===(build.servedPngCount??12)&&Object.keys(build.art).length===12,'Neutral plus11 reviewed drawings required');
  for(const saved of timeline?[false,true]:[false])for(const facing of[1,-1])for(const automatic of[false,true])for(const probe of['near','late','edge','miss']){
    await page.evaluate(({saved,facing,automatic,probe})=>{const p=window.__pikachuUpAirPreview;p.setSaved(saved);p.setFacing(facing);p.setAutomaticHitlag(automatic);p.setProbe(probe);},{saved,facing,automatic,probe});
    ready(await state(),facing);await page.keyboard.press('f');let s=await state();assert(s.elapsed===0,'F did not start fair at elapsed0');
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
    const expected=probe==='near'?[3]:probe==='late'?[7]:probe==='edge'?[7]:[];
    assert(JSON.stringify(s.contacts.map(h=>h.elapsed))===JSON.stringify(expected),`Target-relative hit clock differs: ${facing}/${automatic}/${probe}`);
    assert(s.contacts.every(h=>h.damage===(h.elapsed===3?6:4)),'Damage did not preserve early/late values');
    if(!automatic)assert(timeline.length===26,'Non-frozen action must occupy exactly26 physical steps');
    if(automatic&&expected.length){assert(timeline.some((t,i)=>i>0&&t.elapsed===timeline[i-1].elapsed&&t.hitlagRemaining>0),'Automatic contact did not freeze the drawing/clock');}
    console.log(JSON.stringify({facing,automatic,probe,contacts:s.contacts}));
    report.cases.push({saved,facing,automaticHitlag:automatic,probe,passed:true,contacts:s.contacts,damage:s.damage,physicalSteps:timeline.length,timeline});
  }
  for(const facing of[1,-1]){
    await page.evaluate(facing=>{const p=window.__pikachuUpAirPreview;p.setFacing(facing);p.setAutomaticHitlag(false);p.setProbe('miss');},facing);
    await page.keyboard.press('f');for(let i=0;i<5;i++)await page.keyboard.press('n');const before=await state();
    await page.click('#freeze');for(let i=0;i<3;i++){await page.keyboard.press('n');const frozen=await state();assert(frozen.elapsed===before.elapsed&&frozen.pose===before.pose&&JSON.stringify(frozen.regions)===JSON.stringify(before.regions)&&(!posed||JSON.stringify(frozen.hurtboxes)===JSON.stringify(before.hurtboxes)),'Manual freeze moved pose/contact/hurtbox timeline');}
    await page.keyboard.press('n');assert((await state()).elapsed===before.elapsed+1,'Clock did not resume after freeze');report.freeze.push({facing,elapsed:before.elapsed,pose:before.pose,passed:true});
  }
  await page.click('#reset');await page.keyboard.press('f');await page.click('#play');await page.waitForTimeout(140);await page.click('#play');const paused=await state();await page.waitForTimeout(150);const later=await state();assert(paused.elapsed!==null&&paused.elapsed>0&&JSON.stringify(paused)===JSON.stringify(later),'Play/pause did not preserve fixed-step state');report.pause={passed:true,elapsed:paused.elapsed,pose:paused.pose};
  if(posed){
    report.incoming=[];report.launch=[];
    for(const facing of[1,-1])for(const row of candidates){
      await page.evaluate(facing=>{const p=window.__pikachuUpAirPreview;p.setFacing(facing);p.setAutomaticHitlag(false);p.setProbe('miss');},facing);
      await page.keyboard.press('f');for(let i=0;i<row.startElapsed;i++)await page.keyboard.press('n');
      check(await state());
      for(const hurtbox of row.hurtboxes){const c=hurtbox.capsule,x=(c.start.x+c.end.x)/2,y=(c.start.y+c.end.y)/2;
        const result=await page.evaluate(({x,y})=>window.__pikachuUpAirPreview.probeHurtbox(x,y),{x,y});
        assert(result.confirmed&&result.state.elapsed===row.startElapsed,`Incoming centre missed or advanced clock: ${row.pose}/${facing}/${hurtbox.id}`);
        report.incoming.push({facing,pose:row.pose,hurtbox:hurtbox.id,point:{x,y},confirmed:true});
      }
      const maxX=Math.max(...row.hurtboxes.flatMap(h=>[h.capsule.start.x+h.capsule.radius,h.capsule.end.x+h.capsule.radius]));
      const miss=await page.evaluate(x=>window.__pikachuUpAirPreview.probeHurtbox(x,0),maxX+2);
      assert(!miss.confirmed,`Beyond-envelope probe hit: ${row.pose}/${facing}`);
      report.incoming.push({facing,pose:row.pose,point:{x:maxX+2,y:0},confirmed:false});
    }
    for(const facing of[1,-1]){
      await page.evaluate(facing=>{const p=window.__pikachuUpAirPreview;p.setFacing(facing);p.setAutomaticHitlag(false);p.setProbe('miss');},facing);
      await page.keyboard.press('f');for(let i=0;i<18;i++)await page.keyboard.press('n');
      const before=await state(),c=before.hurtboxes[1].capsule;
      const launched=await page.evaluate(({x,y})=>window.__pikachuUpAirPreview.probeHurtbox(x,y,true),{x:(c.start.x+c.end.x)/2,y:(c.start.y+c.end.y)/2});
      assert(launched.confirmed&&launched.state.receivedDamage===5&&launched.state.elapsed===null
        &&launched.state.hitlagRemaining>0&&launched.state.velocity.x===0&&launched.state.velocity.y===0,'Synthetic incoming contact did not damage/interrupt/freeze defender');
      assert(launched.state.hurtboxes.length===1&&!launched.state.hurtboxes[0].capsule,'Interrupted move retained posed vulnerability');
      for(let i=0;i<launched.state.hitlagRemaining;i++)await page.keyboard.press('n');
      const released=await state();
      assert(released.hitstun>0&&released.velocity.x*facing>0&&released.velocity.y<0,'Queued launch/stun did not begin after hit-stop or mirrored incorrectly');
      report.launch.push({facing,passed:true,frozen:launched.state,released,scope:'Synthetic5-damage probe; shared applyHit interruption/launch, not sourced Pikachu launch parity'});
    }
  }
  assert(report.errors.length===0,'Browser reported errors');report.status='passed';
}catch(error){report.status='failed';report.failure=error.stack??String(error);throw error;}
finally{writeFileSync(path.join(out,'acceptance.json'),JSON.stringify(report,null,2)+'\n');await browser.close();}
console.log(JSON.stringify({status:report.status,cases:report.cases.length,freeze:report.freeze.length,incoming:report.incoming?.length,launch:report.launch?.length,servedArt:Object.keys(report.servedArt??{}).length,errors:report.errors}));
