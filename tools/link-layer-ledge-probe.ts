import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { FIRE_FLOWER_DEFINITION } from '../src/items/FireFlower';
import { openMatchHost, launchMatch } from './browser-match-host.mjs';
const out=process.argv[2]??'docs/review/2026-10-15/user-bugs/link/final-layer-ledge';mkdirSync(out,{recursive:true});
const report:any={errors:[],rows:[]};
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1280,height:800}});page.on('pageerror',e=>report.errors.push(e.message));
try{
 report.build=await openMatchHost(page);
 await launchMatch(page,{mode:'stocks',stockCount:5,stageId:'flat',rngSeed:1510,itemFrequency:'off',linkIntroPolicy:'none',players:[
  {index:1,characterId:'link',paletteIndex:0,inputType:'keyboard_p1'},{index:2,characterId:'pikachu',paletteIndex:0,inputType:'keyboard_p2'}]});
 const bindings=await page.evaluate((definition:any)=>{
  const h=(window as any).__sim,s=h.match;for(let i=0;i<60;i++)h.step();const a=s.p1,floor=s.baseStage.bodies.platformBodies.find((b:any)=>b.label==='platform.solid');
  a.resetForRound(floor.position.x,floor.bounds.min.y-36);s.p2.resetForRound(floor.position.x-350,floor.bounds.min.y-30);for(let i=0;i<10;i++)h.step();
  const entity=s.spawnLinkArticleItem(definition,{x:a.getPosition().x+15,y:a.getPosition().y},s.physicsEngine.getFrame());
  const b=h.inputResolver.dispatcher.bindings.get(s.playerSlots[0].bindingsSlot).bindings;
  (window as any).__layerRead=()=>{h.draw();const f=h.view().fighters[0],p=h.presentation(0);return{frame:h.frame,position:f.position,item:s.p1.getEquippedItem()?.definition.type,
   shooting:f.animation.itemShooting,ledge:f.animation.ledgeHang,pose:p&&{key:p.key,frame:p.frame,visible:p.visible,submitted:p.submitted,layers:p.layers}};};
  return Object.fromEntries(['attack','right','jump'].map(key=>[key,String.fromCharCode(b[key].find((row:any)=>row.kind==='keyboard').keyCode)]));
 },FIRE_FLOWER_DEFINITION);
 await page.keyboard.down(bindings.attack);await page.evaluate(()=>(window as any).__sim.step());await page.keyboard.up(bindings.attack);
 for(let i=0;i<30;i++)await page.evaluate(()=>(window as any).__sim.step());
 // Fire from neutral first. Simultaneous fresh right+attack is a valid
 // forward-smash throw of this item, so it does not exercise shooting layers.
 await page.keyboard.down(bindings.attack);await page.evaluate(()=>(window as any).__sim.step());
 await page.keyboard.down(bindings.right);
 for(let i=0;i<40;i++){
  await page.evaluate(()=>(window as any).__sim.step());const row=await page.evaluate(()=>(window as any).__layerRead());row.scenario='walking-fire-flower';report.rows.push(row);
  if(row.pose?.layers?.length===2&&row.shooting?.upper?.sheet==='item_fflower_shoot_loop_upper'&&row.shooting.upper.age>=4&&!report.layerShot){report.layerShot=true;await page.screenshot({path:out+'/walking-fire-flower.png'});}
 }
 await page.keyboard.up(bindings.right);await page.keyboard.up(bindings.attack);
 report.ledgeSetup=await page.evaluate(()=>{
  const h=(window as any).__sim,s=h.match,a=s.p1;const ledges=s.baseStage.getLedgeCandidates(),ledge=ledges[0];
  a.resetForRound(ledge.x-14,ledge.y+20);a.setFacing(1);s.matter.body.setVelocity(a.body,{x:0,y:1});return ledges;
 });
 for(let i=0;i<30;i++){await page.evaluate(()=>(window as any).__sim.step());const row=await page.evaluate(()=>(window as any).__layerRead());row.scenario='ledge';report.rows.push(row);
  if(row.ledge.name==='hanging'&&row.pose?.key==='char.link.g01cliffwait'&&!report.ledgeShot){report.ledgeShot=true;await page.screenshot({path:out+'/ledge.png'});}}
 report.summary={layered:report.rows.filter((r:any)=>r.pose?.layers?.length===2).length,ledgeHanging:report.rows.filter((r:any)=>r.ledge.name==='hanging').length,
  missing:report.rows.filter((r:any)=>!r.pose?.visible).length};console.log(JSON.stringify(report.summary));
 if(report.errors.length||!report.summary.layered||!report.summary.ledgeHanging||report.summary.missing)throw new Error('Actual shooting layers or ledge body acceptance failed');
}finally{writeFileSync(out+'/report.json',JSON.stringify(report,null,2)+'\n');await browser.close();}
