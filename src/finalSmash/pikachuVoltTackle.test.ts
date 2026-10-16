import {describe,expect,it} from 'vitest';
import {beginVoltTackle,confirmVoltTackleTargets,stepVoltTackle,voltCameraBoundary,
 voltBoundaryReflectAngle,voltTackleWorldPolicy,type VoltTacklePolicy,type VoltTackleState,type VoltPoint} from './pikachuVoltTackle';

// Independent retained sources: FinalDash main/loop speed8/frame16;
// FinalHit end vortex120; Return init/loop speed20,dist20,frame30. Motion
// resources end at63(start),90/61(miss),94/39(finish). Common scheduler/FOV
// precision remains an adapter; these tests establish execution and liveness.
const policy=(air:boolean):VoltTacklePolicy=>({startupFrames:63,missRecoveryFrames:air?61:90,
 finishRecoveryFrames:air?39:94,pixelsPerUnit:5,simulationViewportAspect:16/9});
function tick(state:VoltTackleState,p:VoltTacklePolicy,overrides:Partial<Parameters<typeof stepVoltTackle>[2]>={}){
 return stepVoltTackle(state,p,{clockAdvances:true,substatusTicks:true,nativeStatusFrame:state.age+1,
  hitMotionEnded:state.phase==='hit'&&state.age+1>=6,cameraBoundaryReached:false,
  nativeReflectAngleDegrees:90,selfRoot:{x:0,y:0},primaryVictimRoot:{x:200,y:0},...overrides});
}
function dash(air:boolean,facing:1|-1){let state=beginVoltTackle(air,facing);for(let n=0;n<63;n++)state=tick(state,policy(air)).state;return state;}
describe('Pikachu Ultimate automated Volt Tackle route',()=>{
 it.each([false,true])('retains the hitlag clock,16-frame dash and distinct miss recovery air=%s',air=>{
  const p=policy(air);let state=beginVoltTackle(air,-1);
  expect(tick(state,p,{clockAdvances:false}).state).toBe(state);
  for(let n=0;n<62;n++)state=tick(state,p).state;
  expect(state.phase).toBe('startup');state=tick(state,p).state;
  expect(state).toMatchObject({phase:'dash',age:0,velocity:{x:-40,y:0}});
  for(let n=0;n<15;n++)state=tick(state,p).state;expect(state.phase).toBe('dash');
  state=tick(state,p).state;expect(state).toMatchObject({phase:'miss',age:0,motionAge:0,velocity:{x:-15,y:0}});
  const elapsedRecovery=air?61:129;
  for(let n=0;n<elapsedRecovery-1;n++)state=tick(state,p).state;
  expect(state.phase).toBe('miss');const final=tick(state,p);
  expect(final.state.phase).toBe('done');expect(final.events).toContainEqual({kind:'complete',outcome:'miss'});
 });
 it.each([1,-1]as const)('consumes miss speed3/brake.09 without reversing and keeps elapsed clock integral facing%s',facing=>{
  const p=policy(false);let state=dash(false,facing);for(let n=0;n<16;n++)state=tick(state,p).state;
  expect(state.velocity.x).toBe(15*facing);state=tick(state,p).state;expect(state.velocity.x).toBeCloseTo(14.55*facing,8);
  for(let n=1;n<34;n++)state=tick(state,p).state;
  expect(state.age).toBe(34);expect(state.motionAge).toBeCloseTo(24.1,8);expect(state.velocity.x).toBe(0);
  for(let n=0;n<20;n++)state=tick(state,p).state;expect(state.velocity.x).toBe(0);
 });
 it('deduplicates confirmed contacts, retains first route target and caps native array at7',()=>{
  const p=policy(false),d=dash(false,1),hit=confirmVoltTackleTargets(d,[3,3,1,7,4,2,8,9,10],{x:40,y:-100},p);
  expect(hit.state.hitTargets).toEqual([3,1,7,4,2,8,9]);expect(hit.state.firstTarget).toBe(3);
  expect(hit.events.filter(e=>e.kind==='lock')).toEqual([{kind:'lock',target:3}]);
  const again=confirmVoltTackleTargets(hit.state,[3,10],{x:999,y:999},p);
  expect(again.state).toBe(hit.state);expect(again.events).toEqual([]);
  expect(again.state.savedHitPosition).toEqual({x:40,y:-100});
 });
 it.each([[false,1],[false,-1],[true,1],[true,-1]]as const)('returns,finishes exactly once and restores protection air=%s facing=%s',(air,facing)=>{
  const p=policy(air),saved={x:0,y:-100};let self:VoltPoint={...saved};
  let state=confirmVoltTackleTargets(dash(air,facing),[1],saved,p).state;
  const phases=new Set<string>([state.phase]);let finishHits=0,completed=0;
  for(let n=0;n<1000&&state.phase!=='done';n++){
   const boundary=state.clipBounds?voltCameraBoundary(self,state.velocity,state.age+1,state.clipBounds):null;
   const next=tick(state,p,{selfRoot:self,primaryVictimRoot:{x:100*facing,y:0},cameraBoundaryReached:boundary?.reached===true,
    nativeReflectAngleDegrees:boundary?.angleBasisNative?voltBoundaryReflectAngle(state.velocity,boundary.angleBasisNative):90});
   state=next.state;phases.add(state.phase);
   for(const event of next.events){
    if(event.kind==='snap')self=event.position;
    if(event.kind==='finish-hit'){finishHits++;expect(state.age).toBe(9);expect(event.damage).toBe(20);}
    if(event.kind==='complete')completed++;
   }
   self={x:self.x+state.velocity.x,y:self.y+state.velocity.y};
   expect(Number.isFinite(self.x)&&Number.isFinite(self.y)).toBe(true);
  }
  expect(phases).toEqual(new Set(['hit','attack','attack2','attack-finish','return','finish','done']));
  expect(finishHits).toBe(1);expect(completed).toBe(1);expect(state.phase).toBe('done');
  expect(voltTackleWorldPolicy(state)).toBeNull();
 });
 it('does not finish the vortex until a camera boundary after its120 ticks',()=>{
  const p=policy(false);let state=confirmVoltTackleTargets(dash(false,1),[1],{x:0,y:0},p).state;
  for(let n=0;n<6;n++)state=tick(state,p).state;
  for(let n=0;n<130;n++)state=tick(state,p).state;
  expect(state).toMatchObject({phase:'attack',vortexFramesRemaining:0});
  state=tick(state,p,{cameraBoundaryReached:true}).state;expect(state.phase).toBe('attack-finish');
 });
 it('uses the30-frame return timeout without snapping a distant saved point',()=>{
  const p=policy(false);let state=confirmVoltTackleTargets(dash(false,1),[1],{x:0,y:0},p).state;
  for(let n=0;n<6;n++)state=tick(state,p).state;
  for(let n=0;n<120;n++)state=tick(state,p).state;
  state=tick(state,p,{cameraBoundaryReached:true}).state;
  state=tick(state,p,{cameraBoundaryReached:true,nativeStatusFrame:2}).state;
  expect(state.phase).toBe('return');
  const next=tick(state,p,{selfRoot:{x:2000,y:0},nativeStatusFrame:30});
  expect(next.state.phase).toBe('finish');expect(next.events.some(e=>e.kind==='snap')).toBe(false);
 });
});
