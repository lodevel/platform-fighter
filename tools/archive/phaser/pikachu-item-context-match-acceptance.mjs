import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const output=process.env.PF_REGISTRY_OUTPUT ?? 'docs/review/2026-10-06/pikachu-character/integration/items-initial';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-gpu']});
const page=await browser.newPage({viewport:{width:1280,height:720}});
const report={errors:[],rows:[],scope:'Actual existing six authored item kits; real spawn/pickup input, current solved carry socket, replacement attack and five relative throw directions. Instantaneous pickup/throw remain existing game-item adaptations, not native Smash item status commitments.'};
page.on('pageerror',e=>report.errors.push(e.message));
await page.exposeFunction('__captureItem',async name=>page.screenshot({path:`${output}/${name}`}));
try{
 await page.goto(process.env.PF_REGISTRY_URL ?? 'http://127.0.0.1:4235/platform-fighter/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__game?.scene.isActive('PasswordGateScene'));
 report.bundle=await page.evaluate(()=>[...document.scripts].map(s=>s.src).find(s=>/\/assets\/index-.*\.js/.test(s)));
 report.bundleSha256=createHash('sha256').update(await(await page.request.get(report.bundle)).body()).digest('hex');
 report.rows=await page.evaluate(async()=>{
  const game=window.__game;for(const s of game.scene.getScenes(true))game.scene.stop(s.scene.key);
  game.scene.start('MatchScene',{matchConfig:{mode:'stocks',stockCount:5,stageId:'flat',rngSeed:931,itemFrequency:'off',players:[{index:1,characterId:'pikachu',paletteIndex:0,inputType:'keyboard_p1'},{index:2,characterId:'donkeykong',paletteIndex:0,inputType:'keyboard_p2'}]}});
  const s=game.scene.getScene('MatchScene');s.physicsEngine.pause();s.roundStartCountdown=0;let input={};
  s.inputResolver.getMoveVector=slot=>({x:slot===1?input.moveX??0:0,y:slot===1?input.moveY??0:0});
  s.inputResolver.isActionHeld=(slot,key)=>slot===1&&input[key]===true;
  const step=(i={})=>{input=i;s.physicsEngine.resume();s.update(0,s.physicsEngine.fixedTimestepMs);s.physicsEngine.pause();};
  const floor=s.baseStage.bodies.platformBodies.find(b=>b.label==='platform.solid'),a=s.p1;
  const pos={x:floor.position.x,y:floor.bounds.min.y-25};
  const rows=[];
  for(const facing of [1,-1])for(let typeIndex=0;typeIndex<5;typeIndex++)for(const requestedDirection of ['use','forward','back','up','down','drop']){
   const direction=requestedDirection==='use'?'forward':requestedDirection;
   s.getInventory(s.playerSlots[0].playerIndex)?.drop(0,pos);
   for(const item of s.getItemRegistry().getActive()){item.markDespawned(s.physicsEngine.getCurrentFrame?.()??0);s.itemVisuals.get(item.id)?.destroy();}
   s.thrownItems=[];
   a.resetForRound(pos.x,pos.y);s.p2.resetForRound(floor.bounds.max.x-40,floor.bounds.min.y-25);
   for(let n=0;n<12;n++)step();a.setFacing(facing);
   s.itemSpawnTypeIndex=typeIndex;
   const tr=s.baseStage.transform,scale=s.stage.scale;
   let spawn=true;s.itemSpawnManager.step=(frame)=>spawn?(spawn=false,[{frame,anchorIndex:0,anchor:{x:(pos.x-tr.offsetX)/scale,y:(floor.bounds.min.y-tr.offsetY)/scale},spawnPosition:{x:(pos.x-tr.offsetX)/scale,y:(floor.bounds.min.y-tr.offsetY)/scale}}]):[];
   step();const item=s.getItemRegistry().getActive().at(-1);if(!item)throw Error('spawn branch produced no item');
   item.markGrounded(0,{x:a.getPosition().x,y:floor.bounds.min.y});step({attack:true});
   if(s.getInventory(s.playerSlots[0].playerIndex)?.getHeldItem()!==item)throw Error(`${item.definition.type}/${facing}: actual attack edge pickup missed ${JSON.stringify({item:item.getSnapshot(),actor:a.getPosition(),canUse:a.canUseItemsBeforeInput(),active:a.getActiveAttack()?.move.id,held:s.getInventory(s.playerSlots[0].playerIndex)?.getHeldItem()?.definition.type})}`);
   if(a.getActiveAttack())throw Error('pickup input also fired attack');
   step();
   const observe=()=>{const v=s.itemVisuals.get(item.id),p=a.getPosition();return {actor:p,facing:a.getFacing(),snapshot:item.getSnapshot(),visual:{x:v.x,y:v.y},hand:{x:p.x+12*a.getFacing(),y:p.y-4},bodyTexture:s.playerSlots[0].sprite.texture.key,bodyFrame:Number(s.playerSlots[0].sprite.frame.name)};};
   const carry=[];for(let n=0;n<3;n++){step({moveX:facing*.5});carry.push(observe());}
   const captures=[];
   if(requestedDirection==='use'){
    const name=`${item.definition.type}-${facing}-carry.png`;await window.__captureItem(name);captures.push({screenshot:name,observation:observe()});
    step();s.p2.resetForRound(a.getPosition().x+45*facing,floor.bounds.min.y-25);s.p2.setDamagePercent(0);step({attack:true});const attack=a.getActiveAttack();
    const replacement={id:attack?.move.id??null,phase:attack?.phase,damageBefore:s.p2.getDamagePercent()};
    const attackName=`${item.definition.type}-${facing}-replacement.png`;await window.__captureItem(attackName);captures.push({screenshot:attackName,observation:observe()});
    for(let n=0;n<80;n++)step();replacement.damageAfter=s.p2.getDamagePercent();replacement.contactVerified=replacement.damageAfter>replacement.damageBefore;
    rows.push({kind:'carry-and-replacement',type:item.definition.type,facing,carry,replacement,captures});
    continue;
   }
   step();a.setFacing(facing);
   const before=observe();const i={grab:true,moveX:direction==='forward'?facing:direction==='back'?-facing:0,moveY:direction==='up'?-1:direction==='down'?1:0};
   step(i);const thrown=s.thrownItems.find(t=>t.entity.id===item.id);
   const after=observe();
   if(!thrown)throw Error(`${item.definition.type}/${direction}: throw runtime absent`);
   const velocity={x:thrown.vx,y:thrown.vy-.45};
   const launch={x:thrown.x-velocity.x,y:thrown.y-velocity.y};
   if(typeIndex===0){const name=`bat-${facing}-${direction}-release.png`;await window.__captureItem(name);captures.push({screenshot:name,observation:after});}
   rows.push({kind:'throw',type:item.definition.type,facing,direction,before,after,launch,velocity,throwSpec:item.definition.throwBehavior,captures});
  }
  return rows;
 });
 for(const row of report.rows){
  if(row.kind==='carry-and-replacement'){
   assert.ok(row.replacement.id?.startsWith('item.'),`${row.type}: override selects actual kit`);
   assert.equal(row.replacement.contactVerified,true,`${row.type}/${row.facing}: real replacement contact must damage receiver`);
   for(const c of row.carry){assert.deepEqual(c.snapshot.position,c.hand);assert.deepEqual(c.visual,c.hand);}
  }else{
   for(const axis of ['x','y'])assert.ok(Math.abs(row.launch[axis]-row.after.hand[axis])<1e-8,`${row.type}/${row.facing}/${row.direction} hand==releasedworldpoint`);
   const v=row.throwSpec[row.direction];assert.equal(row.velocity.x,v.velocityX*row.after.facing);assert.equal(row.velocity.y,v.velocityY);
   assert.notEqual(row.after.snapshot.state,'held');
  }
 }
 assert.deepEqual(report.errors,[]);report.result='PASS';console.log(JSON.stringify({result:report.result,rows:report.rows.length}));
}catch(e){report.result='FAIL';report.assertionFailure=e.stack;throw e;}
finally{await writeFile(`${output}/item-context-match-observations.json`,JSON.stringify(report,null,2)+'\n');await browser.close();}
