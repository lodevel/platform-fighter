import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
const out=process.argv[3]??process.env.PF_PROBE_OUT??'docs/review/2026-10-06/dk-all-attack-values/browser';await mkdir(out,{recursive:true});
const url=process.argv[2]??process.env.PF_REWORK_URL??'http://127.0.0.1:4176/platform-fighter/';
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1280,height:900}});
const report={url,pageErrors:[],consoleErrors:[],failedRequests:[],checks:[],scenarios:[]};
page.on('pageerror',e=>report.pageErrors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});page.on('requestfailed',r=>report.failedRequests.push(r.url()));
function check(label,value){report.checks.push({label,passed:!!value});}
try{
 await page.goto(url);await page.waitForFunction(()=>window.__game?.scene.isActive('PasswordGateScene'),null,{timeout:90000});
 const bundle=await page.evaluate(()=>[...document.scripts].map(s=>s.src).find(s=>/\/assets\/index-.*\.js/.test(s)));
 report.bundle=bundle;report.bundleSha256=createHash('sha256').update(await(await page.request.get(bundle)).body()).digest('hex');
 const definitions=[
  ...['jab','jab2','tilt','utilt','dtilt','dashAttack','smash','usmash','dsmash'].map(id=>({name:id,id:`donkeykong.${id}`})),
  ...['nair','fair','bair','uair','dair'].map(id=>({name:id,id:`donkeykong.${id}`,air:true})),
  {name:'forward-tilt-up',id:'donkeykong.tilt',angle:-0.4},{name:'forward-tilt-down',id:'donkeykong.tilt',angle:0.4},
  {name:'punch-ground-tap',id:'donkeykong.neutral_special',charge:0},{name:'punch-ground-partial',id:'donkeykong.neutral_special',charge:55},
  {name:'punch-ground-full',id:'donkeykong.neutral_special',charge:111},{name:'punch-air-tap',id:'donkeykong.neutral_special',charge:0,air:true},
  {name:'punch-air-full',id:'donkeykong.neutral_special',charge:111,air:true},
  {name:'headbutt-ground',id:'donkeykong.side_special'},{name:'headbutt-air',id:'donkeykong.side_special',air:true},
  {name:'headbutt-shield',id:'donkeykong.side_special',shield:true},
  {name:'spin-ground',id:'donkeykong.up_special',up:true},{name:'spin-ground-rear',id:'donkeykong.up_special',up:true,rear:true},
  {name:'spin-air',id:'donkeykong.up_special',up:true,air:true},
  {name:'slap-ground',id:'donkeykong.down_special'},{name:'slap-air',id:'donkeykong.down_special',air:true},
  ...['getupAttack','getupAttackFaceDown','tripAttack','ledgeAttack'].map(id=>({name:id,id:`donkeykong.${id}`,recovery:true})),
  {name:'pummel',grab:'pummel'},...['back','up','down'].map(dir=>({name:`throw-${dir}`,grab:dir})),
  ...['forward','back','up','down'].map(dir=>({name:`cargo-${dir}`,grab:dir,cargo:true})),
  ...['standing','dash','pivot'].flatMap(variant=>[false,true].map(targetAir=>({name:`grab-${variant}-${targetAir?'air':'ground'}`,grab:'capture',variant,targetAir}))),
 ];
 for(const facing of [1,-1]) for(const def of definitions){
  await page.evaluate(()=>{
   const game=window.__game;for(const s of game.scene.getScenes(true))game.scene.stop(s.scene.key);
   game.scene.start('MatchScene',{matchConfig:{mode:'stocks',stockCount:5,stageId:'flat',rngSeed:1007,itemFrequency:'off',players:[
    {index:1,characterId:'donkeykong',paletteIndex:0,inputType:'keyboard_p1'},
    {index:2,characterId:'donkeykong',paletteIndex:1,inputType:'keyboard_p2'},]}});
  });
  await page.waitForFunction(()=>window.__game.scene.getScene('MatchScene').p1?.body);
  const result=await page.evaluate(({def,facing})=>{
   const s=window.__game.scene.getScene('MatchScene');s.physicsEngine.pause();let input={},defInput={};
   s.inputResolver.getMoveVector=p=>({x:(p===1?input:defInput).moveX??0,y:(p===1?input:defInput).moveY??0});
   s.inputResolver.isActionHeld=(p,a)=>(p===1?input:defInput)[a]===true;
   s.inputResolver.getSmash=()=>({buttonHeld:false,stickJustPressed:false,x:0,y:0});
   const floor=s.baseStage.bodies.platformBodies.find(b=>b.label==='platform.solid');
   const contacts=[];const apply=s.p2.applyHitDetailed.bind(s.p2);s.p2.applyHitDetailed=hit=>{const r=apply(hit);contacts.push({hit:JSON.parse(JSON.stringify(hit)),result:r});return r;};
   let capturedGrounded=null;const grabConnect=s.p1.resolveGrabConnect.bind(s.p1);s.p1.resolveGrabConnect=target=>{capturedGrounded=target.isGrounded();return grabConnect(target);};
   const step=(next={},victim={})=>{input=next;defInput=victim;s.physicsEngine.resume();s.update(0,s.physicsEngine.fixedTimestepMs);s.physicsEngine.pause();};
   for(let i=0;i<120;i++)step();
   const x=floor.position.x,y=floor.bounds.min.y-42;
   const distance=def.rear?-65: ['utilt','usmash','uair','dair','slap-air'].includes(def.name)?60: def.name==='spin-air'?70: ['jab2','slap-ground','spin-ground'].includes(def.name)?70:95;
   s.p1.resetForRound(x,y);s.p1.setFacing(facing);s.p2.resetForRound(x+distance*facing,y);s.p2.setFacing(-facing);
   for(let i=0;i<12;i++)step();
   if(def.name==='usmash')s.p2.resetForRound(x+distance*facing,y-60);
   if(def.air){s.p1.resetForRound(x,y-150);s.p2.resetForRound(x+distance*facing,y-150+(def.name==='uair'?-60:def.name==='dair'?70:0));s.p1.setFacing(facing);s.p2.setFacing(-facing);
    // Fixture places both at flight height; neutral physics is still stepped.
    step();}
   let selected=null,throwDamage=null,throwRecovery=null,pummelCaptured=null;
   if(def.grab){
    if(def.variant==='dash'||def.variant==='pivot'){
     s.p2.resetForRound(x+450*facing,y);
     for(let i=0;i<24;i++)step({moveX:facing});
     const pos=s.p1.getPosition();
     s.p2.resetForRound(pos.x+(def.variant==='pivot'?-facing:facing)*95,y-(def.targetAir?50:0));
     step({moveX:def.variant==='pivot'?-facing:facing,grab:true});
    }else{
    s.p2.resetForRound(x+70*facing,y);s.p2.setFacing(-facing);for(let i=0;i<2;i++)step();
     if(def.targetAir)s.p2.resetForRound(x+70*facing,y-50);
     step({grab:true});
    }
    const grabVariant=JSON.parse(JSON.stringify(s.p1.grabVariantSpec));
    for(let i=0;i<15;i++)step();const captured=s.p2.isGrabbed();
    if(def.grab==='capture')return {def,facing,captured,capturedGrounded,grabVariant,throwDamage:s.p2.getDamagePercent(),contacts,engineVersion:s.getMatchStartMetadata().engineVersion};
    if(def.cargo){step({moveX:facing});for(let i=0;i<16;i++)step();}
    const dir=def.grab;const axes={moveX:dir==='back'?-facing:dir==='forward'?facing:0,moveY:dir==='up'?-1:dir==='down'?1:0};
    step({...axes,attack:def.cargo||dir==='pummel'});for(let i=0;i<25;i++)step();
    throwDamage=s.p2.getDamagePercent();throwRecovery=s.p1.getGrabState().cooldownRemaining;pummelCaptured=s.p2.isGrabbed();
    return {def,facing,captured,throwDamage,throwRecovery,pummelCaptured,contacts,engineVersion:s.getMatchStartMetadata().engineVersion};
   }
   if(def.angle!==undefined){step({moveX:facing*.5,moveY:def.angle});step({moveX:facing*.5,moveY:def.angle,attack:true});}
   else if(def.charge!==undefined){s.p1.fireNeutralChargeSpecial(def.id,def.charge);}
   else if(def.up)s.p1.executeUpSpecial(0,-1);
   else if(def.recovery&&def.name==='tripAttack'){s.p1.applyTrip();step({attack:true});}
   else if(def.recovery&&def.name==='getupAttack'){s.p1.knockdownRemaining=40;s.p1.knockdownFaceDown=false;step({attack:true});}
   else if(def.recovery&&def.name==='getupAttackFaceDown'){s.p1.knockdownRemaining=40;s.p1.knockdownFaceDown=true;step({attack:true});}
   else if(def.recovery&&def.name==='ledgeAttack')s.p1.applyLedgeReleasePhysics('attack');
   else s.p1.attemptAttack(def.id);
   selected=JSON.parse(JSON.stringify(s.p1.getActiveAttack()?.move??null));
   const frames=[];
   for(let i=0;i<125;i++){
    step({},def.shield?{shield:true}:{});
    const a=s.p1.getActiveAttack();frames.push({frame:i,id:a?.move.id??null,elapsed:a?.framesElapsed,live:a?.hitboxBody!=null,
      sensors:s.p1.transientHitboxes.map(t=>({id:t.body.plugin.moveId,hits:t.body.plugin.collisionHits,damage:t.body.plugin.damage}))});
   }
   return {def,facing,selected,contacts,frames,percent:s.p2.getDamagePercent(),shield:s.p2.getShieldHealth(),engineVersion:s.getMatchStartMetadata().engineVersion};
  },{def,facing});
  report.scenarios.push(result);
  console.log(JSON.stringify({scenario:def.name,facing,contacts:result.contacts.length,captured:result.captured,startup:result.grabVariant?.startupFrames}));
  const label=`${def.name} facing ${facing}`;
  if(def.grab){check(label+' actual grab contact',result.captured);
   const expected=def.grab==='capture'?0:def.grab==='pummel'?1.6:def.cargo?{forward:12,back:13,up:12,down:11}[def.grab]:{back:11,up:9,down:7}[def.grab];
   check(label+' sourced damage',Math.abs(result.throwDamage-expected)<1e-9);
   if(def.grab==='capture'){check(label+' native startup',result.grabVariant.startupFrames==={standing:7,dash:10,pivot:11}[def.variant]);check(label+' target situation at contact',result.capturedGrounded===!def.targetAir);}
   if(def.grab==='pummel')check(label+' capture retained',result.pummelCaptured);
  }else{
   check(label+' move route',result.selected?.id===def.id);
   check(label+' actual contact',result.contacts.length>0);
   if(def.shield){check(label+' shield bonus',result.contacts.some(c=>c.hit.shieldDamage===25));check(label+' no percent damage',result.percent===0);}
   if(def.angle!==undefined)check(label+' angled 9%',result.selected?.damage===9);
   if(def.name==='punch-air-full')check(label+' air source',result.selected?.damage===25&&result.selected?.recoveryFrames===27);
  }
 }
 await page.screenshot({path:`${out}/match.png`});
 check('No page errors',report.pageErrors.length===0);check('No console errors',report.consoleErrors.length===0);check('No failed requests',report.failedRequests.length===0);
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
const failed=report.checks.filter(c=>!c.passed);console.log(JSON.stringify({scenarios:report.scenarios.length,checks:report.checks.length,failed},null,2));assert.equal(failed.length,0);
