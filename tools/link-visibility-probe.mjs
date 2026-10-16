// Actual Three host, saved DOM inputs and explicit accepted-hit fixtures.
// The hit fixture diagnoses presentation only; it is not an attack-input test.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { openMatchHost, launchMatch } from './browser-match-host.mjs';
const arg=(n,d)=>{const i=process.argv.indexOf('--'+n);return i<0?d:process.argv[i+1];};
const out=arg('out','docs/review/2026-10-15/user-bugs/link/visibility');await mkdir(out,{recursive:true});
const report={url:arg('url','http://127.0.0.1:5173/'),errors:[],rows:[],input:'Real DOM saved keys for ordinary actions; accepted-hit API fixture for launched art'};
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1280,height:800}});page.on('pageerror',e=>report.errors.push(e.message));
try {
 report.build=await openMatchHost(page,report.url);
 const config={mode:'stocks',stockCount:5,stageId:'flat',rngSeed:1510,itemFrequency:'off',players:[
  {index:1,characterId:'link',paletteIndex:0,inputType:'keyboard_p1'},
  {index:2,characterId:'donkeykong',paletteIndex:0,inputType:'keyboard_p2'}]};
 await launchMatch(page,config);
 await page.evaluate(()=>{window.__visibilityRead=()=>{
  window.__sim.draw();const s=window.__sim.match,v=window.__sim.view();
  return {frame:window.__sim.frame,intro:s.getSourceIntroSnapshot(),actors:v.fighters.map(f=>({id:f.characterId,index:f.playerIndex,
   position:f.position,velocity:s.playerSlots[f.playerIndex].character.getVelocity(),grounded:f.animation.grounded,
   reaction:f.animation.reactionPresentation,eliminated:f.eliminated,pose:(()=>{const p=window.__sim.presentation(f.playerIndex);return p&&{key:p.key,frame:p.frame,artState:p.art?.state,
    visible:p.visible,submitted:p.submitted,textureResident:p.textureResident,x:p.x,y:p.y,scaleX:p.scaleX,scaleY:p.scaleY,
    layers:p.layers?.map(l=>({key:l.key,frame:l.frame,clipRows:l.clipRows}))};})(),
   final:f.animation.finalSmash,sourceRoute:s.playerSlots[f.playerIndex].character.getSourceContextualPresentationRoute()})),
   renderer:(()=>{const d=window.__sim.renderDiagnostics?.();return d&&{rgbaBytes:d.textures.rgbaBytes,resident:d.textures.resident.length,pending:d.textures.pending,failures:d.textures.failures,memory:d.renderer.memory,render:d.renderer.render};})()};};});
 for(let frame=0;frame<155;frame++){
  if(frame)await page.evaluate(()=>window.__sim.step());
  const row=await page.evaluate(()=>window.__visibilityRead());row.scenario='intro';report.rows.push(row);
  if([0,30,60,100,120,121,130].includes(frame))await page.screenshot({path:`${out}/intro-${frame}.png`});
 }
 const bindings=await page.evaluate(()=>{
  const s=window.__sim.match,slot=s.playerSlots[0],profile=window.__sim.inputResolver.dispatcher.bindings.get(slot.bindingsSlot);
  const floor=s.baseStage.bodies.platformBodies.find(b=>b.label==='platform.solid');
  for(const [i,slot] of s.playerSlots.entries())slot.character.resetForRound(floor.position.x+(i-1)*250,floor.bounds.min.y-slot.character.getTuning().height/2);
  return Object.fromEntries(Object.entries(profile.bindings).map(([key,value])=>[key,value.filter(b=>b.kind==='keyboard').map(b=>String.fromCharCode(b.keyCode))]));
 });report.bindings=bindings;
 for(let i=0;i<10;i++)await page.evaluate(()=>window.__sim.step());
 const run=async(name,segments)=>{for(const [keys,n]of segments){for(const key of keys)await page.keyboard.down(bindings[key]?.[0]??key);
  for(let i=0;i<n;i++){await page.evaluate(()=>window.__sim.step());const row=await page.evaluate(()=>window.__visibilityRead());row.scenario=name;report.rows.push(row);}
  for(const key of keys)await page.keyboard.up(bindings[key]?.[0]??key);}};
 await run('jab',[[['attack'],1],[[],45]]);
 await run('jump-aerial-landing',[[['jump'],5],[['attack'],1],[[],80]]);
 await run('shield-roll',[[['shield'],12],[['shield','right'],1],[[],55]]);
 await run('bow',[[['special'],12],[[],80]]);
 await run('dash-turn',[[['right'],22],[['left'],22],[[],35]]);
 for(const fighter of ['link','donkeykong','pikachu'])for(const angle of [25,80,270]){
  if(fighter==='pikachu'&&angle===25){
   await launchMatch(page,{...config,linkIntroPolicy:'none',players:[config.players[0],{...config.players[1],characterId:'pikachu'}]});
   for(let i=0;i<20;i++)await page.evaluate(()=>window.__sim.step());
  }
  await page.evaluate(({fighter,angle})=>{
   const s=window.__sim.match,a=s.playerSlots.find(slot=>slot.character.id===fighter).character;
   const floor=s.baseStage.bodies.platformBodies.find(b=>b.label==='platform.solid');
   a.resetForRound(floor.position.x,floor.bounds.min.y-a.getTuning().height/2-140);a.setDamagePercent(100);
   a.applyHitDetailed({damage:18,knockback:{base:14,growth:0,angle,reference:{base:110,growth:20,angle}},facing:1,hitlagMultiplier:0});
  },{fighter,angle});
  for(let i=0;i<60;i++){await page.evaluate(()=>window.__sim.step());const row=await page.evaluate(()=>window.__visibilityRead());row.scenario=`launch-${fighter}-${angle}`;report.rows.push(row);
   if(i===4||i===20)await page.screenshot({path:`${out}/launch-${fighter}-${angle}-${i}.png`});}
 }
 report.missing=report.rows.flatMap(r=>r.actors.filter(a=>!a.eliminated&&!a.pose?.visible).map(a=>({scenario:r.scenario,frame:r.frame,...a})));
 report.scenarios=[...new Set(report.rows.map(r=>r.scenario))].map(scenario=>{
  const rows=report.rows.filter(r=>r.scenario===scenario);return {scenario,frames:rows.length,sheets:[...new Set(rows.flatMap(r=>r.actors.map(a=>a.pose?.key)))],missing:rows.reduce((n,r)=>n+r.actors.filter(a=>!a.eliminated&&!a.pose?.visible).length,0)};
 });
 console.log(JSON.stringify({errors:report.errors,scenarios:report.scenarios,missing:report.missing.length}));
} finally {await writeFile(out+'/report.json',JSON.stringify(report,null,1)+'\n');await browser.close();}
