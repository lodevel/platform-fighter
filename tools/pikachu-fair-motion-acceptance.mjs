import { chromium } from 'playwright';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const base=path.join(root,'docs/review/2026-10-06/pikachu-character');
const posed=process.argv.includes('--posed');
const build=JSON.parse(readFileSync(path.join(base,posed?'fair-posed-motion-build.json':'fair-motion-build.json'),'utf8'));
const candidates=posed?JSON.parse(readFileSync(path.join(base,'fair-motion/hurtbox-preparation/candidates.json'),'utf8')).rows:null;
const out=path.join(base,posed?'fair-motion/posed-browser':'fair-motion/browser');mkdirSync(out,{recursive:true});
const report={scope:`Isolated rough sixteen-pose fair, shared fixture body, one-pixel probe; authored rehit clock and ordinary shared hit-stop formula${posed?'; authored posed damage capsules with incoming contact and synthetic launch checks':''}; native electric timing, native radius/status parity and full fighter not qualified`,
  url:posed?'http://127.0.0.1:4187/pikachu-fair-posed-preview.html':'http://127.0.0.1:4186/pikachu-fair-preview.html',build:build.buildIdentity,input:'Simulated browser keyboard F/N and pointer controls; preview F translates to Character directional-heavy aerial input',cases:[],freeze:[],errors:[]};
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1200,height:980},deviceScaleFactor:1});
page.on('pageerror',e=>report.errors.push(e.message));
const state=()=>page.evaluate(()=>window.__pikachuFairPreview.state());
const ready=(s,facing)=>{
  assert(s.elapsed===null&&s.pose==='neutral'&&s.texture==='pikachu-neutral','Ready/return drawing is wrong');
  assert(s.regions.length===0&&s.flipped===(facing===-1),'Ready has contact regions or incorrect mirror');
  assert(s.airborne&&s.artScale===70/600&&s.artOrigin.x===.5&&s.artOrigin.y===880/1024,'Ready root/scale/aerial fixture is wrong');
  if(posed)assert(s.hurtboxes.length===1&&s.hurtboxes[0].id==='body'&&!s.hurtboxes[0].capsule,'Ended/reset attack retained posed hurtboxes');
};
const check=(s)=>{
  const e=s.elapsed;if(e===null)return;
  assert(Number.isInteger(e)&&e>=0&&e<41,'Attack escaped 41-step gameplay clock');
  const pose=build.poseSchedule.find(p=>e>=p.startElapsed&&e<p.endElapsed);
  assert(pose&&s.pose===pose.pose&&s.drawingSourceIndex===pose.sourceIndex,'Drawing disagrees with reviewed clock/hold mapping');
  assert(s.texture===`pikachu-${pose.pose}`&&s.artOrigin.x===.5&&s.artOrigin.y===880/1280&&s.artScale===70/600,'Attack drawing registration changed');
  assert(s.airborne&&s.moveId==='pikachu.forward-air','Fair did not enter the actual airborne attack route');
  if(posed){const expected=candidates.find(row=>row.pose===s.pose);assert(s.hurtboxPolicy==='reviewed-authored-2d-sparse-pose-holds'&&JSON.stringify(s.hurtboxes)===JSON.stringify(expected.hurtboxes),'Posed vulnerability disagrees with drawing clock or body default was retained');}
  const link=e>=10&&e<=24, finish=e===26;
  assert(s.regions.length===(link?4:finish?1:0),`Wrong clear/active region count at elapsed${e}`);
  if(link){
    for(let id=0;id<4;id++){
      const h=s.regions.find(h=>h.id===id);assert(h?.damage===1.3&&h.rehitFrames===3&&h.capsule.radius===8.5,'Linker source payload changed');
      const y=id%2===0?17.5:-22.5,x=id<2?47.5:65, end=id<2?40:47.5;
      assert(h.capsule.start.x===x&&h.capsule.start.y===y&&h.capsule.end.x===end&&h.capsule.end.y===y,'Linker source capsule changed');
    }
  }
  if(finish){const h=s.regions[0];assert(h.id===0&&h.damage===4.8&&h.rehitFrames===0&&h.capsule.radius===35&&h.capsule.start.x===55&&h.capsule.end.x===45&&h.capsule.start.y===-2.5&&h.capsule.end.y===-2.5,'Finisher source capsule changed');}
};
try{
  await page.goto(report.url,{waitUntil:'networkidle'});await page.waitForFunction(()=>window.__pikachuFairPreview?.ready);
  const bundle=(await page.content()).match(/src="([^\"]*\/assets\/pikachu-fair-(?:posed-)?preview-[^\"]+\.js)"/)?.[1];assert(bundle,'Missing exact fair bundle');
  const bytes=new Uint8Array(await(await fetch(new URL(bundle,report.url))).arrayBuffer());report.bundle=bundle;report.bundleSha256=hash(bytes);assert(report.bundleSha256===build.files[bundle.replace(/^\//,'')],'Served bundle differs from build');
  report.servedArt={};for(const[file,expected]of Object.entries(build.files).filter(([file])=>file.endsWith('.png'))){const response=await fetch(new URL(file,report.url));assert(response.ok,`Missing served art ${file}`);const actual=hash(new Uint8Array(await response.arrayBuffer()));assert(actual===expected,`Changed served art ${file}`);report.servedArt[file]=actual;}
  assert(Object.keys(report.servedArt).length===17&&Object.keys(build.art).length===17,'Neutral plus16 reviewed drawings required');
  for(const facing of[1,-1])for(const automatic of[false,true])for(const probe of['near','late','edge','miss']){
    await page.evaluate(({facing,automatic,probe})=>{const p=window.__pikachuFairPreview;p.setFacing(facing);p.setAutomaticHitlag(automatic);p.setProbe(probe);},{facing,automatic,probe});
    ready(await state(),facing);await page.keyboard.press('f');let s=await state();assert(s.elapsed===0,'F did not start fair at elapsed0');
    const timeline=[];const captured=new Set();
    for(let physical=0;physical<180;physical++){
      s=await state();if(s.elapsed===null)break;check(s);timeline.push(s);
      if(!automatic&&probe==='miss'&&!captured.has(s.pose)){
        const file=`${s.pose}-${facing===1?'right':'left'}.png`;await page.locator('#game').screenshot({path:path.join(out,file)});captured.add(s.pose);
      }
      await page.keyboard.press('n');
    }
    s=await state();ready(s,facing);
    const expected=probe==='near'?[10,13,16,19,22,26]:probe==='late'?[11,14,17,20,23,26]:probe==='edge'?[26]:[];
    assert(JSON.stringify(s.contacts.map(h=>h.elapsed))===JSON.stringify(expected),`Target-relative hit clock differs: ${facing}/${automatic}/${probe}`);
    assert(s.contacts.every(h=>h.damage===(h.elapsed===26?4.8:1.3)),'Damage did not preserve linker/finisher values');
    if(!automatic)assert(timeline.length===41,'Non-frozen action must occupy exactly41 physical steps');
    if(automatic&&expected.length){assert(timeline.some((t,i)=>i>0&&t.elapsed===timeline[i-1].elapsed&&t.hitlagRemaining>0),'Automatic contact did not freeze the drawing/clock');}
    report.cases.push({facing,automaticHitlag:automatic,probe,passed:true,contacts:s.contacts,damage:s.damage,physicalSteps:timeline.length,timeline});
  }
  for(const facing of[1,-1]){
    await page.evaluate(facing=>{const p=window.__pikachuFairPreview;p.setFacing(facing);p.setAutomaticHitlag(false);p.setProbe('miss');},facing);
    await page.keyboard.press('f');for(let i=0;i<14;i++)await page.keyboard.press('n');const before=await state();
    await page.click('#freeze');for(let i=0;i<3;i++){await page.keyboard.press('n');const frozen=await state();assert(frozen.elapsed===before.elapsed&&frozen.pose===before.pose&&JSON.stringify(frozen.regions)===JSON.stringify(before.regions)&&(!posed||JSON.stringify(frozen.hurtboxes)===JSON.stringify(before.hurtboxes)),'Manual freeze moved pose/contact/hurtbox timeline');}
    await page.keyboard.press('n');assert((await state()).elapsed===before.elapsed+1,'Clock did not resume after freeze');report.freeze.push({facing,elapsed:before.elapsed,pose:before.pose,passed:true});
  }
  await page.click('#reset');await page.keyboard.press('f');await page.click('#play');await page.waitForTimeout(140);await page.click('#play');const paused=await state();await page.waitForTimeout(150);const later=await state();assert(paused.elapsed!==null&&paused.elapsed>0&&JSON.stringify(paused)===JSON.stringify(later),'Play/pause did not preserve fixed-step state');report.pause={passed:true,elapsed:paused.elapsed,pose:paused.pose};
  if(posed){
    report.incoming=[];report.launch=[];
    for(const facing of[1,-1])for(const row of candidates){
      await page.evaluate(facing=>{const p=window.__pikachuFairPreview;p.setFacing(facing);p.setAutomaticHitlag(false);p.setProbe('miss');},facing);
      await page.keyboard.press('f');for(let i=0;i<row.startElapsed;i++)await page.keyboard.press('n');
      check(await state());
      for(const hurtbox of row.hurtboxes){const c=hurtbox.capsule,x=(c.start.x+c.end.x)/2,y=(c.start.y+c.end.y)/2;
        const result=await page.evaluate(({x,y})=>window.__pikachuFairPreview.probeHurtbox(x,y),{x,y});
        assert(result.confirmed&&result.state.elapsed===row.startElapsed,`Incoming centre missed or advanced clock: ${row.pose}/${facing}/${hurtbox.id}`);
        report.incoming.push({facing,pose:row.pose,hurtbox:hurtbox.id,point:{x,y},confirmed:true});
      }
      const maxX=Math.max(...row.hurtboxes.flatMap(h=>[h.capsule.start.x+h.capsule.radius,h.capsule.end.x+h.capsule.radius]));
      const miss=await page.evaluate(x=>window.__pikachuFairPreview.probeHurtbox(x,0),maxX+2);
      assert(!miss.confirmed,`Beyond-envelope probe hit: ${row.pose}/${facing}`);
      report.incoming.push({facing,pose:row.pose,point:{x:maxX+2,y:0},confirmed:false});
    }
    for(const facing of[1,-1]){
      await page.evaluate(facing=>{const p=window.__pikachuFairPreview;p.setFacing(facing);p.setAutomaticHitlag(false);p.setProbe('miss');},facing);
      await page.keyboard.press('f');for(let i=0;i<18;i++)await page.keyboard.press('n');
      const before=await state(),c=before.hurtboxes[1].capsule;
      const launched=await page.evaluate(({x,y})=>window.__pikachuFairPreview.probeHurtbox(x,y,true),{x:(c.start.x+c.end.x)/2,y:(c.start.y+c.end.y)/2});
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
