/** Ultimate Hammer and Golden Hammer. Provenance and conflicts: phase-6/sources.json.
 * SmashWiki wins: normal damage 22 (native 27), duration 8s (same page also says 7s),
 * 1/8 headless, walking/one ground jump, no other actions/drop except tumble;
 * Golden doubles native body cadence and floats with jump taps. Golden duration is native-derived920frames. Numeric
 * growth, squeaky probability and float impulse are authored where native dumps are silent.
 */
import { ASSET_KEYS } from '../assets/manifest';
import type { ItemDefinition } from './ItemDefinition';
import { ultimateItemThrowProfile } from './nativeItemThrow';
import type { HitInfo } from '../characters/combat';

export const HAMMER_RNG_STREAM='item-hammer' as const;
export const GOLDEN_HAMMER_RNG_STREAM='item-golden-hammer' as const;
export interface HammerSpec {
 readonly durationFrames:number; readonly swingRate:1|2; readonly rehitFrames:number;
 readonly damage:number; readonly knockback:{readonly base:number;readonly growth:number;readonly fixed:number;readonly angle:number};
 readonly hitlagMultiplier:number; readonly malfunctionChance:number; readonly golden:boolean;
 readonly growthFrames:number; readonly floatVelocity:number;
}
/** contactFrames are next allowed motionElapsed values per target. Hitlag cannot expire them. */
export interface HammerState {readonly elapsed:number;readonly motionElapsed:number;readonly malfunction:'headless'|'squeaky'|null;readonly detached:boolean;readonly contactFrames:Readonly<Record<number,number>>}
export function beginHammer(spec:HammerSpec,roll:number):HammerState {
 return {elapsed:0,motionElapsed:0,malfunction:roll<spec.malfunctionChance?(spec.golden?'squeaky':'headless'):null,detached:false,contactFrames:{}};
}
export function stepHammer(spec:HammerSpec,state:HammerState):{state:HammerState;expired:boolean}{
 const elapsed=state.elapsed+1;return {state:{...state,elapsed,motionElapsed:state.motionElapsed+1},expired:elapsed>=spec.durationFrames};
}
export function hammerMotion(spec:HammerSpec,state:HammerState,grounded:boolean,moveX:number){
 return {sheet:!grounded?'item_hammer_jump':Math.abs(moveX)>.01?'item_hammer_move':'item_hammer_wait',age:state.motionElapsed*spec.swingRate%16};
}
/** Native HaveAttack spheres projected into the hand's Y/Z side-view axes (5 world px/native unit).
 * The draw socket uses the registered hand rather than the unsampled native root: authored 2D retargeting.
 */
export function hammerAreas(spec:HammerSpec,socket:{x:number;y:number;angle:number|null;length:number;zAngle?:number;zLength?:number}){
 const y=(socket.angle??0)*Math.PI/180,z=(socket.zAngle??(socket.angle??0)+90)*Math.PI/180;
 const l=socket.length,zl=socket.zLength??1,depth=spec.golden?2.5:2.2;
 return [{y:0,z:0,r:2},{y:4,z:0,r:2},{y:11,z:-depth,r:4},{y:11,z:depth,r:4}].map(p=>({
  x:socket.x+5*(p.y*Math.sin(y)*l+p.z*Math.sin(z)*zl),
  y:socket.y-5*(p.y*Math.cos(y)*l+p.z*Math.cos(z)*zl),radius:p.r*5}));
}
export function hammerHit(spec:HammerSpec,facing:1|-1,multiplier=1):HitInfo {
 return {damage:spec.damage*multiplier,knockback:{x:0,y:0,scaling:0,reference:spec.knockback},facing,
 hitlagMultiplier:spec.hitlagMultiplier,sdiMultiplier:1,direct:false};
}
export const HAMMER_SPEC:HammerSpec=Object.freeze({durationFrames:480,swingRate:1,rehitFrames:30,
 damage:22,knockback:Object.freeze({base:105,growth:50,fixed:0,angle:75}),hitlagMultiplier:1.5,
 malfunctionChance:.125,golden:false,growthFrames:0,floatVelocity:0});
export const GOLDEN_HAMMER_SPEC:HammerSpec=Object.freeze({durationFrames:920,swingRate:2,rehitFrames:10,
 damage:30,knockback:Object.freeze({base:80,growth:60,fixed:0,angle:45}),hitlagMultiplier:1.5,
 malfunctionChance:.125,golden:true,growthFrames:60,floatVelocity:-2});
const hammerKinetics=Object.freeze({gravity:.08,terminalFallSpeed:2.3,airBrakeX:.0025,maxSpeedX:Number.POSITIVE_INFINITY,
 throwRebound:Object.freeze({mul:.12,addX:0,addY:1.9})});
export const HAMMER_DEFINITION:ItemDefinition=Object.freeze({type:'hammer',itemClass:'locked',hammer:HAMMER_SPEC,
 ttlFrames:960,brokenDespawnFrames:30,throwProfile:ultimateItemThrowProfile({damage:0,mapBottom:5,kinetics:hammerKinetics}),
 visual:Object.freeze({spriteKey:ASSET_KEYS.itemHammer,width:42,height:70,restAngle:0})});
export const GOLDEN_HAMMER_DEFINITION:ItemDefinition=Object.freeze({...HAMMER_DEFINITION,type:'goldenHammer',hammer:GOLDEN_HAMMER_SPEC,
 throwProfile:ultimateItemThrowProfile({damage:0,mapBottom:5,kinetics:{...hammerKinetics,gravity:.074,terminalFallSpeed:2.2}}),
 visual:Object.freeze({...HAMMER_DEFINITION.visual!,spriteKey:ASSET_KEYS.itemGoldenHammer})});
/** Head detached from a bad Hammer; a powerful throwable, never a stage-spawn switch entry. */
export const HAMMER_HEAD_DEFINITION:ItemDefinition=Object.freeze({type:'hammerHead',itemClass:'throwing',ttlFrames:960,brokenDespawnFrames:30,
 throwProfile:ultimateItemThrowProfile({damage:25,mapBottom:4,attackRadius:4.2,kinetics:{...hammerKinetics,throwRebound:{mul:.05,addX:.2,addY:1.9}},
 knockback:{base:30,growth:100,fixed:0,angle:361}}),
 thrownHit:{damageByAction:{'throw-ground-forward-ordinary':38.7,'throw-ground-back-ordinary':38.7,'throw-ground-up-ordinary':37.8,
 'throw-ground-down-ordinary':24.3,'throw-ground-forward-strong':42.7,'throw-ground-back-strong':42.7,'throw-ground-up-strong':44.1,
 'throw-ground-down-strong':24.3,'dash-throw':41.7,'air-z-drop':39,'throw-air-forward-ordinary':39,'throw-air-back-ordinary':39,
 'throw-air-up-ordinary':40.8,'throw-air-down-ordinary':37.8,'throw-air-forward-strong':42.4,'throw-air-back-strong':42.4,
 'throw-air-up-strong':44.1,'throw-air-down-strong':37.8}},
 visual:Object.freeze({spriteKey:ASSET_KEYS.itemHammerHead,width:40,height:26,restAngle:0})});
