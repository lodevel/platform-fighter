import {createRequire} from 'node:module';
import {describe,expect,it} from 'vitest';
import independentCores from '../../docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art/firstclips-batch06-independent-region-core-crosscheck.json';
import frames from '../../assets/characters/donkeykong/gameplay.json';
import {DONKEYKONG_DTILT} from '../characters/DonkeyKong';
import {CHARACTER_LABEL} from '../characters/Character';
import {selectPackedBodyReceiving} from '../characters/packedBodyPresentation';
import {spawnHitbox,type AttackMove} from '../characters/attacks';
import type {SimulationAnimationSnapshot} from '../characters/simulationSpriteAnimation';
import {HitboxDamageHandler} from './HitboxDamageHandler';
const require=createRequire(import.meta.url),Engine=require('../physics/matter/source/lib/core/Engine.js'),Events=require('../physics/matter/source/lib/core/Events.js'),Bodies=require('../physics/matter/source/lib/factory/Bodies.js'),Body=require('../physics/matter/source/lib/body/Body.js'),Composite=require('../physics/matter/source/lib/body/Composite.js');
const custom={...DONKEYKONG_DTILT,startupFrames:10,activeFrames:4,recoveryFrames:8};
const snapshots=(move:AttackMove,age:number,facing:1|-1)=>({characterId:'donkeykong',facing,grounded:true,packedBody:{surfaceTech:null,committed:null,heavyItem:null,itemCue:null,clock:null},ledgeHang:{active:null},dodge:{active:null},activeAttack:{move,framesElapsed:age,facing}} as unknown as SimulationAnimationSnapshot);
// Pinned independent actual-target label cores, not points derived from the
// receiving implementation under test. No native hit_data parity claim.
// The cores sit on that native sample's anatomy, so only ages that show that sample's own drawing
// (not a drawing held over from an earlier sample) are comparable.
const dtiltWindows=(frames.animations.dtilt as {hurtboxPoses:{nativeSample:number;drawingNativeSample?:number}[]}).hurtboxPoses;
const drawn=(native:number)=>dtiltWindows.some(row=>row.nativeSample===native&&row.drawingNativeSample===undefined);
const cases=independentCores.records.filter(row=>drawn(row.nativeSample)).flatMap(row=>row.coreProbes.flatMap(probe=>[1,-1].map(facing=>({native:row.nativeSample,region:probe.desiredRegion,point:probe.world,facing:facing as 1|-1,protected:probe.expectedClass==='protected'}))));
function incoming(move:AttackMove,age:number,facing:1|-1,point:readonly number[]){
 const engine=Engine.create();engine.gravity.y=0;const hits:unknown[]=[];
 const boxes=selectPackedBodyReceiving(snapshots(move,age,facing))!;
 const handler=new HitboxDamageHandler((_index,hit,context)=>{hits.push({hit,context});return{confirmed:true};});
 handler.setFacingLookup(()=>facing);handler.setGroundedLookup(()=>true);handler.setHurtboxLookup(()=>boxes);
 const scene:any={matter:{body:Body,add:{rectangle(x:number,y:number,w:number,h:number,options:object){const b=Bodies.rectangle(x,y,w,h,options);Composite.add(engine.world,b);return b;}},world:{remove(b:unknown){Composite.remove(engine.world,b);}}}};
 const pulse:AttackMove={id:'incoming.paired-protection-fixture',type:'jab',damage:1,knockback:{x:1,y:-1,scaling:0},startupFrames:0,activeFrames:3,recoveryFrames:0,cooldownFrames:0,hitbox:{offsetX:0,offsetY:0,width:.1,height:.1},collisionHits:[{id:0,capsule:{start:{x:0,y:0},end:{x:0,y:0},radius:.05}}]};
 spawnHitbox(scene,{id:'incoming',bodyId:-1,position:{x:point[0]!*facing,y:point[1]!}},pulse,1);
 const target=Bodies.rectangle(0,0,60,84,{isStatic:true,label:CHARACTER_LABEL,plugin:{characterId:'donkeykong'},collisionFilter:{category:4}});Composite.add(engine.world,target);handler.registerPlayer(0,target);
 const deliver=(event:any)=>handler.handleCollisionStart(event);Events.on(engine,'collisionStart',deliver);Events.on(engine,'collisionActive',deliver);
 for(let i=0;i<3;i++){Engine.update(engine,1000/60);handler.sampleHurtboxContacts(Composite.allBodies(engine.world));}
 Engine.clear(engine);Composite.clear(engine.world,false);return{hits,boxes};
}
describe('paired protection on actual isolated Matter receiving contacts (not full Match qualification)',()=>{
 it.each(cases)('native$native $region face$facing preserves source protection after custom retiming',c=>{
  const sourceAge=c.native-1,elapsed=sourceAge<5?sourceAge*2:sourceAge<7?10+(sourceAge-5)*2:14+(sourceAge-7)*8/17;
  const stock=incoming(DONKEYKONG_DTILT,sourceAge,c.facing,c.point),retimed=incoming(custom,elapsed,c.facing,c.point);
  expect(stock.hits).toHaveLength(c.protected?0:1);expect(retimed.hits).toHaveLength(c.protected?0:1);
  if(c.region==='shoulderl'||c.region==='arml'||c.region==='handl')expect(Math.abs(c.point[0]!)).toBeGreaterThan(30);
 });
 it.each([1,-1] as const)('fractional source6.9995 remains protected then source7 clears on actual incoming sensors face%s',facing=>{
  const row7=independentCores.records.find(r=>r.nativeSample===7)!,row8=independentCores.records.find(r=>r.nativeSample===8)!;
  const arm7=row7.coreProbes.find(p=>p.desiredRegion==='arml')!,arm8=row8.coreProbes.find(p=>p.desiredRegion==='arml')!;
  expect(incoming(custom,13.999,facing,arm7.world).hits).toHaveLength(0);
  expect(incoming(custom,14,facing,arm8.world).hits).toHaveLength(1);
 });
});
