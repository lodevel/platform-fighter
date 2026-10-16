/** Public (SmashWiki) gameplay windows of Link's 16 normals. Packet values
 * and hit positions per window live in linkAttackData.json /
 * linkAttackGeometry.json under the window's `role`. */
export type LinkNormalId='link.jab'|'link.jab2'|'link.jab3'|'link.tilt'|'link.utilt'|'link.dtilt'|
  'link.dashAttack'|'link.smash'|'link.smash2'|'link.usmash'|'link.dsmash'|
  'link.nair'|'link.fair'|'link.bair'|'link.uair'|'link.dair';
/** Public frames are 1-based and inclusive. `strike` groups windows that hit a
 * victim once; `role` names the packet phase in the move data. */
export interface LinkNormalWindow {readonly first:number;readonly last:number;readonly strike:string;readonly role:string;}
export interface LinkNormalRule {readonly motion:string;readonly firstActionable:number;readonly animationFrames:number;
  readonly windows:readonly LinkNormalWindow[];readonly landingLag:number|null;readonly autocancel:readonly (readonly [number,number])[];}
const window=(first:number,last:number,strike:string,role='primary'):LinkNormalWindow=>Object.freeze({first,last,strike,role});
const rule=(motion:string,firstActionable:number,animationFrames:number,windows:readonly LinkNormalWindow[],
  landingLag:number|null=null,autocancel:readonly (readonly [number,number])[]=[]):LinkNormalRule=>
  Object.freeze({motion,firstActionable,animationFrames,windows:Object.freeze(windows),landingLag,autocancel});
export const LINK_NORMAL_RULES:Readonly<Record<LinkNormalId,LinkNormalRule>>=Object.freeze({
  'link.jab':rule('attack_11',24,38,[window(7,8,'jab1')]),
  'link.jab2':rule('attack_12',25,39,[window(5,6,'jab2')]),
  'link.jab3':rule('attack_13',35,49,[window(6,7,'jab3')]),
  'link.tilt':rule('attack_s3_s',40,60,[window(15,15,'tilt','Early hit'),window(16,19,'tilt','Clean hit')]),
  'link.utilt':rule('attack_hi3',36,56,[window(8,12,'utilt')]),
  'link.dtilt':rule('attack_lw3',31,41,[window(10,11,'dtilt')]),
  'link.dashAttack':rule('attack_dash',57,67,[window(20,23,'dash')]),
  'link.smash':rule('attack_s4_s',51,71,[window(17,18,'smash1')]),
  'link.smash2':rule('attack_s4_s2',61,67,[window(10,11,'smash2')]),
  'link.usmash':rule('attack_hi4',78,94,[window(10,13,'hit1','Clean hit 1'),window(14,15,'hit1','Late hit 1'),
    window(25,28,'hit2','Clean hit 2'),window(29,30,'hit2','Late hit 2'),window(41,45,'hit3','Hit 3')]),
  'link.dsmash':rule('attack_lw4',55,68,[window(12,13,'hit1','Hit 1'),window(24,25,'hit2','Hit 2')]),
  'link.nair':rule('attack_air_n',39,59,[window(7,8,'nair','Clean hit'),window(9,31,'nair','Late hit')],6,[[1,3],[36,Infinity]]),
  'link.fair':rule('attack_air_f',52,67,[window(16,17,'hit1','Hit 1'),window(24,25,'hit2','Hit 2')],11,[[53,Infinity]]),
  'link.bair':rule('attack_air_b',31,49,[window(6,8,'hit1','Hit 1'),window(15,17,'hit2','Hit 2')],6,[[29,Infinity]]),
  'link.uair':rule('attack_air_hi',60,59,[window(11,13,'uair','Clean hit'),window(14,40,'uair','Late hit')],14,[[1,10],[43,Infinity]]),
  'link.dair':rule('attack_air_lw',80,99,[window(14,19,'dair','Clean hit'),window(20,64,'dair','Late hit')],19,[[1,9],[65,Infinity]]),
});
/** Fresh tapped edges or held input with a confirmed hit use the conditioned
 * Wiki window; held whiff uses separate earliest14/13. The common native input
 * buffer beyond those windows is not guessed by this pure decision. `age` is the
 * 0-based age of the frame being decided; the next move's first frame replaces it. */
export function linkNormalContinuation(state:{readonly id:LinkNormalId;readonly age:number;readonly hitConfirmed:boolean},
  input:{readonly attackHeld:boolean;readonly attackTapped:boolean}):LinkNormalId|null{
  const frame=state.age+1;
  if(state.id==='link.smash')return input.attackTapped&&frame>=23&&frame<=36?'link.smash2':null;
  if(state.id!=='link.jab'&&state.id!=='link.jab2')return null;
  const first=state.id==='link.jab'?10:8,whiffFirst=state.id==='link.jab'?14:13;
  const eligible=input.attackTapped||input.attackHeld&&state.hitConfirmed?
    frame>=first&&frame<=35:input.attackHeld&&frame>=whiffFirst&&frame<=35;
  return eligible?(state.id==='link.jab'?'link.jab2':'link.jab3'):null;
}
