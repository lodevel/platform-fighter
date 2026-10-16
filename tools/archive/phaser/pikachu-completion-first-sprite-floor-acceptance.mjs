import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';

const prefix=process.env.PF_STAGED_PREFIX;
if(!prefix)throw Error('Set immutable PF_STAGED_PREFIX');
const build=JSON.parse(await readFile(`${prefix}-assets-staged.json`,'utf8'));
const metadata=JSON.parse(await readFile(`${prefix}-pikachu-frames.json`,'utf8'));
assert.equal(createHash('sha256').update(await readFile(`${prefix}-pikachu-frames.json`)).digest('hex'),build.pikachuFramesSha256);
const sourceHashes=JSON.parse(await readFile(build.sourceHashes,'utf8'));
const output=process.env.PF_REGISTRY_OUTPUT;
if(!output)throw Error('Set PF_REGISTRY_OUTPUT');
await mkdir(`${output}/source-leaves`,{recursive:true});
const sourceModules={};
for(const [name,exportName] of Object.entries({pikachuJabHurtboxes:'PIKACHU_JAB_AUTHORED_HURTBOX_POSES',pikachuVerticalTiltHurtboxes:'PIKACHU_VERTICAL_TILT_AUTHORED_HURTBOX_POSES',pikachuSmashHurtboxes:'PIKACHU_SMASH_AUTHORED_HURTBOX_POSES',pikachuStateHurtboxes:'PIKACHU_STATE_AUTHORED_HURTBOX_POSES'})){
 // Normal attack leaves are hashed by the immutable build but are not copied
 // into its partial import tree. Read only bytes matching that recorded hash,
 // retain them with the observations, and parse the authored JSON literal.
 let bytes;
 try{bytes=await readFile(`${build.sourceLeafDirectory}/${name}.ts`);}
 catch(error){if(error.code!=='ENOENT')throw error;bytes=await readFile(`src/characters/${name}.ts`);}
 assert.equal(createHash('sha256').update(bytes).digest('hex'),sourceHashes[`src/characters/${name}.ts`]);
 await writeFile(`${output}/source-leaves/${name}.ts`,bytes);
 const literal=bytes.toString().match(new RegExp(`export const ${exportName}\\s*=\\s*(\\[[\\s\\S]*?\\])\\s+as const;`));
 assert.ok(literal,`${name} authored JSON array`);
 sourceModules[name]={[exportName]:JSON.parse(literal[1])};
}
const sourcePoses={
 'pikachu.jab':sourceModules.pikachuJabHurtboxes.PIKACHU_JAB_AUTHORED_HURTBOX_POSES,
 'pikachu.down-tilt':sourceModules.pikachuVerticalTiltHurtboxes.PIKACHU_VERTICAL_TILT_AUTHORED_HURTBOX_POSES.filter(p=>p.action==='down-tilt'),
 'pikachu.down-smash':sourceModules.pikachuSmashHurtboxes.PIKACHU_SMASH_AUTHORED_HURTBOX_POSES.filter(p=>p.action==='down-smash'),
};
const report={build,errors:[],scope:'Targeted actual production body-floor replay after bounded first-sprite corrections: public jab/down-tilt/down-smash routes and all five idle source drawings, bothfacings. All played ages use actual sprite alpha32 pixel centres and true physical vertices. Prior independently qualified move/contact/input contracts are retained; this replay owns visual-floor acceptance only.'};
if(process.env.PF_FIRST_BODY_ONLY==='1')report.scope='Actual production first drawing at public attack age0 for jab/down-tilt/down-smash, plus all five idle drawings in both facings. Zero-delta unpaused render resolves the new body without advancing gameplay. Later body floor failures remain independently retained; this scope cannot qualify whole attack rows.';
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-gpu']});
const page=await browser.newPage({viewport:{width:1280,height:720}});
page.on('pageerror',error=>report.errors.push(error.message));
await page.exposeFunction('__captureFloor',name=>page.screenshot({path:`${output}/${name}`}));
try{
 await page.goto(process.env.PF_REGISTRY_URL,{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForFunction(()=>window.__game?.scene.isActive('PasswordGateScene'),null,{timeout:60000});
 report.bundle=await page.evaluate(()=>[...document.scripts].map(s=>s.src).find(s=>/\/assets\/index-.*\.js/.test(s)));
 report.bundleSha256=createHash('sha256').update(await(await page.request.get(report.bundle)).body()).digest('hex');
 assert.equal(report.bundleSha256,build.bundleSha256);
 report.rows=await page.evaluate(async({firstBodyOnly})=>{
  const game=window.__game;for(const s of game.scene.getScenes(true))game.scene.stop(s.scene.key);
  game.scene.start('MatchScene',{matchConfig:{mode:'stocks',stockCount:5,stageId:'flat',rngSeed:1718,itemFrequency:'off',players:[{index:1,characterId:'pikachu',paletteIndex:0,inputType:'keyboard_p1'},{index:2,characterId:'donkeykong',paletteIndex:0,inputType:'keyboard_p2'}]}});
  const scene=game.scene.getScene('MatchScene');scene.physicsEngine.pause();scene.roundStartCountdown=0;
  scene.inputResolver.getMoveVector=()=>({x:0,y:0});scene.inputResolver.isActionHeld=()=>false;
  scene.hitboxDebugLayer.setEnabled(true);
  const floor=scene.baseStage.bodies.platformBodies.find(b=>b.label==='platform.solid');
  for(const b of scene.baseStage.bodies.platformBodies.filter(b=>b!==floor)){b.collisionFilter.mask=0;scene.matter.world.remove(b);}
  const actor=scene.p1,cache=new Map(),rows=[];
  const read=()=>{
   const sp=scene.playerSlots[0].sprite,f=sp.frame,key=`${sp.texture.key}/${f.name}`;
   let pixels=cache.get(key);
   if(!pixels){const c=document.createElement('canvas');c.width=f.cutWidth;c.height=f.cutHeight;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(sp.texture.getSourceImage(),f.cutX,f.cutY,f.cutWidth,f.cutHeight,0,0,f.cutWidth,f.cutHeight);const alpha=ctx.getImageData(0,0,f.cutWidth,f.cutHeight).data;pixels=[];for(let y=0;y<f.cutHeight;y++)for(let x=0;x<f.cutWidth;x++)if(alpha[(y*f.cutWidth+x)*4+3]>=32)pixels.push({x:x+.5,y:y+.5});cache.set(key,pixels);}
   let bottom=-Infinity;for(const p of pixels){let x=(p.x-sp.originX*f.cutWidth)*sp.scaleX,y=(p.y-sp.originY*f.cutHeight)*sp.scaleY;if(sp.flipX)x=-x;if(sp.flipY)y=-y;bottom=Math.max(bottom,sp.y+x*Math.sin(sp.rotation)+y*Math.cos(sp.rotation));}
   const attack=actor.getActiveAttack(),camera=scene.cameras.main,rect=game.canvas.getBoundingClientRect();
   const viewport={camera:{x:camera.x,y:camera.y,zoom:camera.zoom,worldView:{x:camera.worldView.x,y:camera.worldView.y,width:camera.worldView.width,height:camera.worldView.height}},canvas:{left:rect.left,top:rect.top,width:rect.width,height:rect.height,internalWidth:game.canvas.width,internalHeight:game.canvas.height}};
   return{...viewport,move:attack?.move.id??null,age:attack?.framesElapsed??null,texture:sp.texture.key,textureFrame:Number(f.name),position:actor.getPosition(),spritePosition:{x:sp.x,y:sp.y},origin:[sp.originX,sp.originY],scale:[sp.scaleX,sp.scaleY],rotation:sp.rotation,flipX:sp.flipX,flipY:sp.flipY,facing:actor.getFacing(),receiving:actor.getActiveHurtboxes(),grounded:actor.isGrounded(),geometricFeet:Math.max(...actor.body.vertices.map(v=>v.y)),floorY:floor.bounds.min.y,visibleBodyBottom:bottom,alphaClearance:floor.bounds.min.y-bottom,pixels:pixels.length};
  };
  const step=()=>{scene.physicsEngine.resume();scene.update(0,scene.physicsEngine.fixedTimestepMs);scene.physicsEngine.pause();return read();};
  for(const facing of [1,-1])for(const id of ['pikachu.jab','pikachu.down-tilt','pikachu.down-smash','idle']){
   actor.resetForRound(floor.position.x,floor.bounds.min.y-25);scene.p2.resetForRound(floor.position.x+500,floor.bounds.min.y-25);for(let n=0;n<12;n++)step();actor.setFacing(facing);
   if(id!=='idle'&&!actor.attemptAttack(id))throw Error(`Could not begin ${id}/${facing}`);
   scene.physicsEngine.resume();scene.update(0,0);scene.physicsEngine.pause();const row={id,facing,trace:[],captures:[]},seen=new Set();
   for(let age=0;age<(id==='idle'?120:150);age++){
    const o=read();if(id!=='idle'&&!o.move)break;row.trace.push(o);
    const key=`${o.texture}/${o.textureFrame}`;if(!seen.has(key)){seen.add(key);const screenshot=`${id.replaceAll('.','-')}-${facing}-${row.trace.length-1}.png`;await window.__captureFloor(screenshot);row.captures.push({screenshot,observation:o});}
    if(firstBodyOnly&&id!=='idle')break;
    step();
   }
   rows.push(row);
  }
  return rows;
 },{firstBodyOnly:process.env.PF_FIRST_BODY_ONLY==='1'});
 const failures=[];
 for(const row of report.rows){
  assert.ok(row.trace.length>0);if(row.id!=='idle')assert.equal(row.trace[0].textureFrame,0);
  for(const o of row.trace){
   const sheet=o.texture.split('.').at(-1),clip=metadata.animations[sheet];assert.ok(clip);assert.equal(o.grounded,true);assert.ok(o.pixels>0);assert.equal(o.receiving.length,12);
   const pose=row.id==='idle'
    ?sourceModules.pikachuStateHurtboxes.PIKACHU_STATE_AUTHORED_HURTBOX_POSES.find(p=>p.sheet==='idle'&&p.artFrameIndex===o.textureFrame)
    :sourcePoses[row.id].find(p=>p.startElapsed<=o.age&&o.age<p.endElapsed);
   assert.ok(pose,`${row.id} immutable paired source receiving at age${o.age}`);
   assert.deepEqual(o.receiving,pose.hurtboxes,`${row.id} exact paired receiving at age${o.age}`);
   if(row.id!=='idle'){
    const window=clip.frameWindows.find(w=>w.startFrame<=o.age&&o.age<w.endFrame);
    assert.ok(window,`${row.id} immutable drawing window at age${o.age}`);
    assert.equal(o.textureFrame,window.artFrameIndex);
   }
   assert.deepEqual(o.origin,[clip.root[0]/clip.frameWidth,clip.root[1]/clip.frameHeight]);assert.equal(Math.sign(o.scale[0])*(o.flipX?-1:1),row.facing);assert.ok(Math.abs(o.geometricFeet-o.floorY)<=.1);
   if(o.alphaClearance<-.55)failures.push({id:row.id,facing:row.facing,sheet,cell:o.textureFrame,age:o.age,clearance:o.alphaClearance});
  }
 }
 assert.deepEqual(report.errors,[]);report.floorFailures=failures;report.result=failures.length?'FAIL_FLOOR':'PASS';
 console.log(JSON.stringify({result:report.result,cases:report.rows.length,captures:report.rows.flatMap(r=>r.captures).length,floorFailures:failures.length}));
 if(failures.length)process.exitCode=1;
}catch(error){report.result='FAIL';report.failure=error.stack;throw error;}
finally{await writeFile(`${output}/observations.json`,JSON.stringify(report,null,2)+'\n');await browser.close();}
