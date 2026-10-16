import {createRequire} from 'node:module';
import {describe,expect,it} from 'vitest';
import {DonkeyKong} from './DonkeyKong';
import {Character,type CharacterInput} from './Character';
import {createCharacterById} from './characterFactory';
import {getAuthorableCharacterSpec} from './authorableCharacterRegistry';
import {parseCharacterDataFile,serializeCharacterDataSpec} from './characterSerializer';
import {stepCharacterPhysics} from './stepCharacterPhysics';
import {COLLISION_CATEGORIES} from '../engine/collisionCategories';
import {PLATFORM_LABELS} from '../stages/stageBodies';
import {CharacterEditState} from '../characterBuilder/characterEditState';
import {buildCharacterEditorFields} from '../characterBuilder/characterEditorFields';
import {captureSimulationAnimation} from './simulationSpriteAnimation';
import {packedBodyCandidate} from './packedBodyPresentation';
import {FIGHTER_MOVEMENT_PROFILES} from './fighterMovementProfiles';
const require=createRequire(import.meta.url);
const Engine=require('../physics/matter/source/lib/core/Engine.js');
const Events=require('../physics/matter/source/lib/core/Events.js');
const Bodies=require('../physics/matter/source/lib/factory/Bodies.js');
const Body=require('../physics/matter/source/lib/body/Body.js');
const Composite=require('../physics/matter/source/lib/body/Composite.js');
const neutral:CharacterInput={moveX:0,jump:false};
function fixture(saved?:ReturnType<typeof parseCharacterDataFile>,floorWidth=2000){
 const engine=Engine.create(),names:Record<string,string>={collisionstart:'collisionStart',collisionactive:'collisionActive',collisionend:'collisionEnd'};
 const scene:any={matter:{body:Body,add:{rectangle(x:number,y:number,w:number,h:number,o:object){const b=Bodies.rectangle(x,y,w,h,o);Composite.add(engine.world,b);return b;}},world:{on(n:string,f:any){Events.on(engine,names[n]??n,f);},off(n:string,f:any){Events.off(engine,names[n]??n,f);},remove(b:any){Composite.remove(engine.world,b);}}}};
 const actor=saved?createCharacterById(scene,'donkeykong',{spawnX:0,spawnY:445,...saved.body,...saved.movement}):new DonkeyKong(scene,{spawnX:0,spawnY:445});
 Composite.add(engine.world,Bodies.rectangle(0,500,floorWidth,20,{isStatic:true,label:PLATFORM_LABELS.solid,collisionFilter:{category:COLLISION_CATEGORIES.PLATFORM_SOLID}}));
 let frame=0;
 const step=(input:CharacterInput=neutral)=>{actor.applyInput(input,++frame);stepCharacterPhysics({characters:[actor],bodies:Composite.allBodies(engine.world),gravity:engine.gravity,body:Body,deltaMs:1000/60,stepWorld:dt=>Engine.update(engine,dt)});return {position:actor.getPosition(),velocity:actor.getVelocity(),vertical:actor.getDonkeyKongVerticalMotionState()};};
 for(let i=0;i<20;i++)step();expect(actor.isGrounded()).toBe(true);
 const takeoff=(mini=false)=>{let y=actor.getPosition().y;step({...neutral,jump:true});let sample;
  for(let i=0;i<6;i++){y=actor.getPosition().y;sample=step({...neutral,jump:!mini});if(actor.getVelocity().y<-1)break;}
  expect(actor.getJumpPresentationState()?.shortHop).toBe(mini);return {y,sample:sample!};};
 return{actor,engine,scene,step,takeoff,getFrame:()=>frame};
}
describe('DK ordinary vertical owner through actual Matter; full opening is calibrated',()=>{
 it.each([1,2.5])('fits first-four rise and total height without inheriting world gravity %s',worldGravity=>{
  const {actor,engine,step,takeoff}=fixture();engine.gravity.y=worldGravity;
  const {y,sample}=takeoff(),trace=[sample];for(let i=0;i<24;i++)trace.push(step());
  expect(y-trace[3]!.position.y).toBeCloseTo(18.7*5,6);
  expect(Math.max(...trace.map(s=>y-s.position.y))).toBeCloseTo(34*5,3);
  for(let i=4;i<20;i++)expect(trace[i]!.velocity.y-trace[i-1]!.velocity.y).toBeCloseTo(.085*5,9);
  expect(actor.getDonkeyKongVerticalMotionState()?.nextOpeningStep).toBeNull();
 });
 it('mini and air entry consume independently published0F impulse exactly once',()=>{
  const f=fixture(),g=.085*5,mini=(Math.sqrt(2*.085*17.3)+.085/2)*5,air=(Math.sqrt(2*.085*35.5)+.085/2)*5;
  const entry=f.takeoff(true);expect(entry.sample.velocity.y).toBeCloseTo(-mini+g,9);
  f.step();const jump=f.step({...neutral,jump:true});expect(f.actor.getJumpPresentationState()?.kind).toBe('air');
  expect(jump.velocity.y).toBeCloseTo(-air+g,9);expect(jump.vertical?.nextOpeningStep).toBeNull();
 });
 it('hitlag pauses the prescribed opening and the final skipped input step',()=>{
  const f=fixture(),entry=f.takeoff();f.actor.armAttackerHitlag(3);
  for(let i=0;i<3;i++){const o=f.step();expect(o.position.y).toBeCloseTo(entry.sample.position.y,10);expect(o.vertical?.nextOpeningStep).toBe(1);}
  const resumed=f.step();expect(resumed.vertical?.nextOpeningStep).toBe(2);
  expect(resumed.position.y-entry.sample.position.y).toBeCloseTo(-28.40789732219021,8);
 });
 it('a real solid ceiling cancels upward movement and retires the remaining prescribed opening',()=>{
  const f=fixture();Composite.add(f.engine.world,Bodies.rectangle(0,380,600,20,{isStatic:true,label:PLATFORM_LABELS.solid,collisionFilter:{category:COLLISION_CATEGORIES.PLATFORM_SOLID}}));
  f.step({...neutral,jump:true});let stopped=false;
  for(let i=0;i<6;i++){f.step({...neutral,jump:true});if(f.actor.getJumpPresentationState()&&f.actor.getVelocity().y>=-1e-6){stopped=true;break;}}
  expect(stopped).toBe(true);expect(f.actor.getDonkeyKongVerticalMotionState()?.nextOpeningStep).toBeNull();
  const y=f.actor.getPosition().y;const next=f.step();expect(next.velocity.y).toBeCloseTo(.425,8);
  expect(next.position.y).toBeGreaterThan(y);expect(next.vertical?.nextOpeningStep).toBeNull();
 });
 it('ordinary aerial retains jump energy; dodge retires it without stale reopening',()=>{
  const aerial=fixture();aerial.takeoff();const o=aerial.step({...neutral,attack:true});
  expect(aerial.actor.getActiveAttack()?.move.type).toBe('aerial');expect(o.vertical?.nextOpeningStep).toBe(2);
  const dodge=fixture();dodge.takeoff();dodge.step({...neutral,dodge:true});
  expect(dodge.actor.getDonkeyKongVerticalMotionState()?.nextOpeningStep).toBeNull();
  for(let i=0;i<55;i++)expect(dodge.step().vertical?.nextOpeningStep).toBeNull();
 });
 it('an owner that interrupts the opening carries ordinary jump energy, never an opening sample',()=>{
  // Peak above the ground for each post-takeoff press step k. The full hop
  // peaks at 34 native; a special/dodge started inside the opening must not
  // launch DK higher than that, nor differ by k beyond the height already risen.
  const peak=(press:CharacterInput,k:number)=>{const f=fixture(),ground=f.actor.getPosition().y;f.takeoff();
   for(let s=1;s<k;s++)f.step();f.step(press);let top=0;
   for(let s=0;s<150;s++){top=Math.max(top,ground-f.actor.getPosition().y);f.step();}return top;};
  const presses:Record<string,CharacterInput>={neutral:{...neutral,special:true},side:{...neutral,moveX:1,special:true},
   down:{...neutral,moveY:1,special:true},dodge:{...neutral,dodge:true}};
  for(const [name,press] of Object.entries(presses)){const late=peak(press,4);
   for(const k of [1,2,3]){const early=peak(press,k);
    expect(early,`${name} k=${k}`).toBeLessThanOrEqual(34*5+1);
    expect(Math.abs(early-late),`${name} k=${k} vs k=4 (${late})`).toBeLessThan(35);
   }
  }
 });
 it('landing/reset/capture and actual landed damage replace the opening owner',()=>{
  for(const kind of ['reset','capture','damage'] as const){const f=fixture();f.takeoff();
   if(kind==='reset')f.actor.resetForRound(100,-300);
   if(kind==='capture'){const captor=new Character(f.scene,{id:'pikachu',spawnX:400,spawnY:100});f.actor.applyGrabbed(captor);}
   if(kind==='damage')expect(f.actor.applyHitDetailed({damage:1,hitlagMultiplier:0,facing:1,knockback:{x:1,y:-1,scaling:0}}).outcome).toBe('landed');
   expect(f.actor.getDonkeyKongVerticalMotionState()?.nextOpeningStep).toBeNull();
  }
 });
 it('uses total gravity and exact fall caps while preserving explicit external excess',()=>{
  const f=fixture();f.actor.resetForRound(0,-1000);Body.setVelocity(f.actor.body,{x:0,y:2});
  expect(f.step().velocity.y).toBeCloseTo(2.425,9);
  for(let i=0;i<25;i++)f.step();expect(f.actor.getVelocity().y).toBeCloseTo(8.15,9);
  expect(f.step({...neutral,moveY:1}).velocity.y).toBeCloseTo(13.04,9);
  expect(f.step().velocity.y).toBeCloseTo(13.04,9);
  Body.setVelocity(f.actor.body,{x:0,y:20});expect(f.step().velocity.y).toBeCloseTo(20,9);
 });
 it('neutral air dodge and aerial item throw relax excess by source.075 per step',()=>{
  for(const mode of ['dodge','item'] as const){const f=fixture();f.actor.resetForRound(0,-1000);f.step();Body.setVelocity(f.actor.body,{x:0,y:13.04});
   if(mode==='item')expect(f.actor.beginItemAction('throw-air-forward-ordinary',f.getFrame()+1)).toBe(true);
   const o=f.step({...neutral,dodge:mode==='dodge'});expect(o.velocity.y).toBeCloseTo(13.04-.015*5,9);
   expect(f.step().velocity.y).toBeCloseTo(13.04-2*.015*5,9);
  }
 });
 it('Headbutt replaces ordinary energy with its published half-gravity owner',()=>{
  for(const rawY of [0,-4]){const f=fixture();f.actor.resetForRound(0,-1000);f.step();Body.setVelocity(f.actor.body,{x:2,y:rawY});
   const entry=f.step({...neutral,moveX:1,special:true});expect(f.actor.getActiveAttack()?.move.gravityScale).toBe(.5);
   expect(entry.velocity.y).toBeCloseTo(rawY*.5+.085*5*.5,9);
   expect(f.step().velocity.y-entry.velocity.y).toBeCloseTo(.085*5*.5,9);
  }
 });
 it('keeps footstool beta basis separate, consumes source repeat.75 and eight-step cooldown',()=>{
  const f=fixture();f.actor.resetForRound(0,-2000);f.step();f.actor.queueFootstoolJump(true);
  const first=f.step();expect(first.velocity.y).toBeCloseTo(-14.305555555555552*1.3+.425,9);
  expect(first.vertical?.footstool).toMatchObject({repeatCount:1,cooldownRemaining:8});
  expect(f.actor.getFootstoolParticipant(0,{...neutral,jump:true}).mayJump).toBe(false);
  f.actor.armAttackerHitlag(3);for(let i=0;i<3;i++)expect(f.step().vertical?.footstool.cooldownRemaining).toBe(8);
  for(let i=1;i<=8;i++)expect(f.step().vertical?.footstool.cooldownRemaining).toBe(8-i);
  f.actor.queueFootstoolJump(true);const repeated=f.step();
  expect(repeated.velocity.y).toBeCloseTo(-14.305555555555552*1.3*.75+.425,9);
  f.actor.resetForRound(0,-2000);expect(f.actor.getDonkeyKongVerticalMotionState()?.footstool).toMatchObject({repeatCount:0,cooldownRemaining:0});
 });
 it('saved Lab movement transports custom opening and gravity into the match factory',()=>{
  const original=getAuthorableCharacterSpec('donkeykong'),file=serializeCharacterDataSpec(original);
  const edit=new CharacterEditState(original),fields=buildCharacterEditorFields(original,'movement');
  const speedField=fields.find(f=>f.id==='movement.donkeykongOrdinaryVertical.fullHopStepVelocitiesY.0')!;
  expect(speedField.min).toBeLessThan(-30);expect(speedField.max).toBeLessThan(0);
  edit.setMovementNumericField(speedField.path,-30);expect(edit.getSpec().movement.donkeykongOrdinaryVertical?.fullHopStepVelocitiesY[0]).toBe(-30);
  edit.undo();expect(edit.getSpec().movement.donkeykongOrdinaryVertical).toEqual(original.movement.donkeykongOrdinaryVertical);
  edit.redo();expect(edit.getSpec().movement.donkeykongOrdinaryVertical?.fullHopStepVelocitiesY[0]).toBe(-30);
  const selected={totalGravity:.5,fullHopStepVelocitiesY:[-30,-25,-20,-10]};
  const saved=parseCharacterDataFile({...file,movement:{...file.movement,donkeykongOrdinaryVertical:selected}});
  const roundtrip=parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec(saved))));
  expect(roundtrip.movement.donkeykongOrdinaryVertical).toEqual(selected);
  const f=fixture(roundtrip),entry=f.takeoff();expect(entry.sample.position.y-entry.y).toBeCloseTo(-30,9);
  expect(f.actor.getDonkeyKongVerticalMotionState()?.profile).toEqual(selected);
  expect(()=>parseCharacterDataFile({...file,movement:{...file.movement,donkeykongOrdinaryVertical:{...selected,fullHopStepVelocitiesY:[-1]}}})).toThrow('four opening');
 });
});
describe('DK ground jump keeps facing through jumpsquat (Ultimate: no turn in jumpsquat; back jump)',()=>{
 const body=(f:ReturnType<typeof fixture>)=>packedBodyCandidate(captureSimulationAnimation(f.actor,f.getFrame(),false));
 /** Stick held `side` (-1 back / +1 forward / 0) from the jump press (same step) through takeoff and the rise. */
 const hop=(facing:1|-1,side:-1|0|1,mini:boolean,saved?:ReturnType<typeof parseCharacterDataFile>)=>{
  const f=fixture(saved);f.actor.setFacing(facing);f.step();
  const stick={...neutral,moveX:side*facing},floorY=f.actor.getPosition().y;
  f.step({...stick,jump:true});expect(f.actor.getJumpsquatRemaining()).toBe(3);
  expect(f.actor.getFacing()).toBe(facing);expect(body(f)).toMatchObject({sheet:'jumpsquat',facing});
  let rise=f.step({...stick,jump:!mini});
  while(!f.actor.getJumpPresentationState()){expect(f.actor.getFacing()).toBe(facing);rise=f.step({...stick,jump:!mini});}
  expect(f.actor.getJumpPresentationState()).toMatchObject({kind:'ground',facing,moveX:side*facing,shortHop:mini});
  let top=floorY;
  for(let i=0;i<60&&!(i>2&&f.actor.isGrounded());i++){
   if(rise.velocity.y<0){expect(f.actor.getFacing()).toBe(facing);
    expect(body(f)).toMatchObject({sheet:`${mini?'jump_short':'jump'}${side<0?'_b':''}`,facing});
    if(side!==0)expect(Math.sign(rise.velocity.x)).toBe(side*facing);}
   top=Math.min(top,rise.position.y);rise=f.step({...stick,jump:!mini});
  }
  return floorY-top;
 };
 it.each([[1,false],[-1,false],[1,true],[-1,true]] as const)('back stick keeps facing%s and takes off backward into jump_b / jump_short_b (mini=%s)',(facing,mini)=>{
  expect(hop(facing,-1,mini)).toBeCloseTo(mini?17.3*5:34*5,0);
 });
 it.each([1,-1] as const)('forward and neutral hops are unchanged (facing%s)',facing=>{
  for(const mini of [false,true])for(const side of [1,0] as const)expect(hop(facing,side,mini)).toBeCloseTo(mini?17.3*5:34*5,0);
 });
 it('the capability is a Lab-transported movement flag held only by DK and Pikachu',()=>{
  const file=serializeCharacterDataSpec(getAuthorableCharacterSpec('donkeykong'));
  const roundtrip=parseCharacterDataFile(JSON.parse(JSON.stringify(file)));
  expect(roundtrip.movement.locomotion?.jumpsquatKeepsFacing).toBe(true);
  expect(hop(-1,-1,false,roundtrip)).toBeCloseTo(34*5,0);
  const holders=Object.entries(FIGHTER_MOVEMENT_PROFILES).filter(([,p])=>p.locomotion?.jumpsquatKeepsFacing).map(([id])=>id);
  expect(holders.sort()).toEqual(['donkeykong','pikachu']);
 });
});
describe('DK ground-jump takeoff horizontal speed: stick x jump_speed_x(.95) + ground x jump_speed_x_mul(.8), capped jump_speed_x_max(1.6), x5',()=>{
 // Flat stage floor width measured by the live probe (floorX 277.5..1162.5); DK starts mid-stage.
 const STAGE_WIDTH=885,STABLE=1.208*5,AIR_BRAKE=.015*5,GROUND_BRAKE=.123*5;
 /** Optional `dashSteps` of stick before the jump press (a dash carried into jumpsquat); the stick is held throughout. */
 const jump=(facing:1|-1,side:-1|0|1,mini:boolean,dashSteps:number)=>{
  const f=fixture(undefined,STAGE_WIDTH);f.actor.setFacing(facing);f.step();
  const stick={...neutral,moveX:side*facing};
  for(let i=0;i<dashSteps;i++)f.step(stick);
  const entryX=f.actor.getVelocity().x,squat=[f.step({...stick,jump:true}).velocity.x];
  let o=f.step({...stick,jump:!mini});
  while(!f.actor.getJumpPresentationState()){squat.push(o.velocity.x);o=f.step({...stick,jump:!mini});}
  const takeoffX=o.velocity.x,air=[takeoffX];
  for(let i=0;i<150&&!f.actor.isGrounded();i++)air.push(f.step({...stick,jump:!mini}).velocity.x);
  return {f,entryX,squat,takeoffX,air,landedX:f.actor.getPosition().x};
 };
 it.each([[1,1],[1,-1],[-1,1],[-1,-1]] as const)('standing hop facing%s side%s: jumpsquat never dashes, takeoff is .95 x 5 toward the stick',(facing,side)=>{
  for(const mini of [false,true]){const r=jump(facing,side,mini,0);
   for(const v of r.squat)expect(v).toBe(0);
   expect(r.takeoffX).toBeCloseTo(side*facing*4.75,9);
  }
 });
 it.each([[1,1],[1,-1],[-1,1],[-1,-1]] as const)('dash carried into jumpsquat facing%s side%s: ground speed only brakes, takeoff capped at 8 px/step, then relaxes to the stable cap',(facing,side)=>{
  for(const mini of [false,true]){const r=jump(facing,side,mini,1),dir=side*facing;
   expect(Math.sign(r.entryX)).toBe(dir);expect(Math.abs(r.entryX)).toBeGreaterThan(10);
   // While grounded the Matter floor contact solve removes a further ~.004 px/step on top of the commanded
   // ground_brake (the reported velocity is the Verlet position delta), so grounded brakes are checked to 2 decimals.
   expect(r.squat[0]).toBeCloseTo(r.entryX-dir*GROUND_BRAKE,2);
   for(let i=1;i<r.squat.length;i++)expect(r.squat[i]!-r.squat[i-1]!).toBeCloseTo(-dir*GROUND_BRAKE,2);
   expect(r.takeoffX).toBeCloseTo(dir*8,9);
   for(let i=1;i<r.air.length-1;i++){
    const expected=Math.max(STABLE,Math.abs(r.air[i-1]!)-AIR_BRAKE);
    expect(Math.abs(r.air[i]!)).toBeCloseTo(expected,9);expect(Math.sign(r.air[i]!)).toBe(dir);
   }
  }
 });
 it.each([1,-1] as const)('forward and back full and short hops from mid-stage land on the stage (facing%s)',facing=>{
  for(const side of [1,-1] as const)for(const mini of [false,true])for(const dashSteps of [0,1]){
   const r=jump(facing,side,mini,dashSteps);
   expect(r.f.actor.isGrounded()).toBe(true);
   expect(Math.abs(r.landedX)).toBeLessThan(STAGE_WIDTH/2-r.f.actor.getTuning().width/2);
  }
 });
 it('neutral hop air drift accelerates by (.01+.05) x 5 to the stable 6.04 cap and never past it',()=>{
  const f=fixture();f.step();f.takeoff();expect(f.actor.getVelocity().x).toBe(0);
  let prev=0;
  for(let i=0;i<30&&!f.actor.isGrounded();i++){const v=f.step({...neutral,moveX:1}).velocity.x;
   expect(v).toBeCloseTo(Math.min(STABLE,prev+.3),9);prev=v;}
  expect(prev).toBeCloseTo(STABLE,9);
 });
});
