/** Newly captured Link grab/absolute-throw packets. Root-top geometry is an
 * explicit5px/native projection; incoming/captor grips remain paired art.
 * Captured-target-only prehits and the absolute release never double-hit. */
import source from './linkFreshCaptureSource.json';
import type { GrabSpec } from './grabSchema';
import type { ThrowSpec, ThrowSet } from './throwSchema';
import { attackSensorGeometry } from './attacks';
import type { AttackCollisionHit } from './attacks';
const contracts=source.captureContracts;
function number(raw:string|undefined):number {
  const result=raw===undefined?NaN:Number(raw.replace(/%$/,''));
  if(!Number.isFinite(result))throw new Error(`Missing complete Link capture numeric ${raw}`);
  return result;
}
function timing(raw:string,label:string):number[] {
  const cell=new RegExp(`!${label}\\s*\\n\\|([^\\n]+)`).exec(raw)?.[1]?.trim();
  if(!cell)throw new Error(`Missing selected Link capture timing ${label}`);
  return cell.split('-').map(number);
}
function captureShapes(variant:number):readonly AttackCollisionHit[] {
  const source=contracts.grabs[variant]!;
  return source.wiki.captureRows.map(row=>{
    const f=row.fields as Readonly<Record<string,string|undefined>>;
    if(f.bn!=='top')throw new Error('Link capture requires recorded source-root bone');
    const z=f.zpos!.split(' to ').map(number),y=number(f.ypos)*-5+36;
    return {id:number(f.id),capsule:{start:{x:z[0]!*5,y},end:{x:(z[1]??z[0])!*5,y},radius:number(f.r)*5},
      situation:f.a==='f'?'ground':'air',targetCategory:'fighter'};
  });
}
function absoluteThrow(index:number):ThrowSpec {
  const source=contracts.throws[index]!,rows=source.wiki.packetRows;
  const row=rows.find(r=>r.template==='UltimateThrowTableRow'&&!('kind' in r.fields));
  const hit=rows.find(r=>r.template==='UltimateHitboxTableRow');
  if(!row)throw new Error('Missing primary Link absolute throw packet');
  const f=row.fields as Readonly<Record<string,string|undefined>>;
  const release=timing(source.wiki.timingSource,'Throw Release')[0]!,faf=timing(source.wiki.timingSource,'Interruptible')[0]!;
  const pre=hit?.fields as Readonly<Record<string,string|undefined>>|undefined;
  return {launchFacing:'actor',damage:number(f.damage),knockback:{x:0,y:0,scaling:0,reference:{base:number(f.bk),growth:number(f.ks),
    fixed:number(f.fkv),angle:number(f.angle)}},animationFrames:release,recoveryFrames:faf-release-1,
    invincibilityFrames:timing(source.wiki.timingSource,'Invincibility').at(-1)!,hitlagMultiplier:number(f.ff),
    ...(pre?{heldTargetHits:[{frame:timing(source.wiki.timingSource,'Hitbox')[0]!-1,damage:number(pre.damage),
      hitlagMultiplier:number(pre.ff)}]}:{})};
}
const shapes=captureShapes(0),dash=captureShapes(1),pivot=captureShapes(2);
const broad=(collisionHits:readonly AttackCollisionHit[])=>attackSensorGeometry({hitbox:{offsetX:0,offsetY:0,width:1,height:1},collisionHits});
export const FRESH_LINK_GRAB:GrabSpec=Object.freeze({id:'link.grab',ultimateCapture:true,throwClock:'native-sample-one',
  hitbox:broad(shapes),collisionHits:shapes,
  startupFrames:5,activeFrames:2,whiffRecoveryFrames:27,
  // Ignored by Ultimate capture law; required legacy shape keeps compatibility.
  holdFramesMax:120,throwRecoveryFrames:0,
  pummel:{damage:1.3,startupFrames:0,cooldownFrames:6,motionFrames:24,hitlagMultiplier:2.1,sdiMultiplier:1,
    knockback:{x:0,y:0,scaling:0,reference:{base:0,growth:100,fixed:30,angle:361}}},
  dashGrab:{rangeBonusX:0,momentumRetain:1,startupFrames:8,activeFrames:2,whiffRecoveryFrames:32,
    hitbox:broad(dash),collisionHits:dash},
  pivotGrab:{rangeBonusX:0,momentumRetain:1,startupFrames:9,activeFrames:2,whiffRecoveryFrames:26,
    hitbox:broad(pivot),collisionHits:pivot},
  throws:{forward:absoluteThrow(0),back:absoluteThrow(1),up:absoluteThrow(2),down:absoluteThrow(3)} as ThrowSet,
});
