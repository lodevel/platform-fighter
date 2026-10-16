import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { openMatchHost, launchMatch } from './browser-match-host.mjs';
const arg=(n,d)=>{const i=process.argv.indexOf('--'+n);return i<0?d:process.argv[i+1];};
const out=arg('out','docs/review/2026-10-15/user-bugs/link/blank-before');await mkdir(out,{recursive:true});
const report={url:arg('url','http://127.0.0.1:4173/platform-fighter/'),errors:[],rows:[]};
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1280,height:800}});page.on('pageerror',e=>report.errors.push(e.message));
try {
 report.build=await openMatchHost(page,report.url);
 for(const air of [false,true]) {
  await launchMatch(page,{mode:'stocks',stockCount:5,stageId:'flat',rngSeed:1510,itemFrequency:'off',linkIntroPolicy:'none',players:[
   {index:1,characterId:'link',paletteIndex:0,inputType:'keyboard_p1'},{index:2,characterId:'donkeykong',paletteIndex:0,inputType:'keyboard_p2'}]});
  const bindings=await page.evaluate(()=>{
   const s=window.__sim.match;for(let i=0;i<20;i++)window.__sim.step();const floor=s.baseStage.bodies.platformBodies.find(b=>b.label==='platform.solid');
   s.p1.resetForRound(floor.position.x,floor.bounds.min.y-36);s.p1.setFacing(1);s.p2.resetForRound(floor.position.x-400,floor.bounds.min.y-42);
   for(let i=0;i<10;i++)window.__sim.step();
   const b=window.__sim.inputResolver.dispatcher.bindings.get(s.playerSlots[0].bindingsSlot).bindings;
   return Object.fromEntries(['right','special'].map(k=>[k,String.fromCharCode(b[k].find(b=>b.kind==='keyboard').keyCode)]));
  });
  await page.keyboard.down(bindings.right);await page.keyboard.down(bindings.special);await page.evaluate(()=>window.__sim.step());await page.keyboard.up(bindings.special);await page.keyboard.up(bindings.right);
  for(let i=0;i<46;i++)await page.evaluate(()=>window.__sim.step());
  if(air)await page.evaluate(()=>{const s=window.__sim.match,p=s.p1.getPosition();s.matter.body.setPosition(s.p1.body,{x:p.x,y:p.y-400});s.matter.body.setVelocity(s.p1.body,{x:0,y:0});window.__sim.step();});
  await page.keyboard.down(bindings.right);await page.keyboard.down(bindings.special);
  const row={air,trace:[]};report.rows.push(row);
  for(let i=0;i<35;i++){
   const r=await page.evaluate(()=>{window.__sim.step();window.__sim.draw();const s=window.__sim.match,f=window.__sim.view().fighters[0],p=window.__sim.presentation(0);
    return {frame:window.__sim.frame,intrinsic:f.animation.packedBody.intrinsic,grounded:f.animation.grounded,articles:s.projectiles.filter(p=>p.link?.kind==='boomerang').length,
     pose:p&&{key:p.key,frame:p.frame,visible:p.visible,submitted:p.submitted}};});row.trace.push(r);
   if(i===0){await page.keyboard.up(bindings.special);await page.keyboard.up(bindings.right);await page.screenshot({path:`${out}/${air?'air':'ground'}-blank.png`});}
   if(i===16&&air)await page.screenshot({path:`${out}/air-blank-settled-camera.png`});
  }
  row.blankFrames=row.trace.filter(r=>r.intrinsic?.sheet.endsWith('_blank'));row.missingBlankFrames=row.blankFrames.filter(r=>!r.pose?.visible).length;
 }
 console.log(JSON.stringify(report.rows.map(r=>({air:r.air,blankFrames:r.blankFrames.length,missingBlankFrames:r.missingBlankFrames}))));
 if(process.argv.includes('--expect-visible')&&report.rows.some(r=>!r.blankFrames.length||r.missingBlankFrames))throw new Error('Blank branch did not keep actual owner art visible');
}finally{await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');await browser.close();}
