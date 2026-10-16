/** Ultimate Link's Sword Beam: forward smash's first swing fires it only while
 * Link is at 0% (SmashWiki Link_(SSBU)/Forward_smash/Hit_1 and Link_(SSBU);
 * UFD link: beam active 17-48 uncharged, 17-56 fully charged). Every
 * parameter scales linearly from no charge to full charge (60 frames):
 * X/Y offsets 11, 6; lifetime 32-40; damage 5 + 8 * charge/60 (5%-13%);
 * size multiplier 0.8-1.1 (SmashWiki: charging enlarges the beam);
 * initial speed 2.4-3.4; friction 0.01. Hitbox capsule: radius 1.8 on the
 * top bone from -7 to 7 along the flight axis, 0.5 up. */
export interface LinkSwordBeamPlan {
  readonly damage:number;readonly life:number;readonly speedNative:number;readonly scale:number;
  readonly rootOffset:{readonly x:number;readonly y:number};readonly brakeNative:number;
  readonly capsule:{readonly start:{readonly x:number;readonly y:number};readonly end:{readonly x:number;readonly y:number};readonly radius:number};
}
/** The beam's hit (SmashWiki Forward_smash/Hit_1, Sword Beam row): 361 (Sakurai), BKB 45, KBS 15,
 * FKB 0, hitlag 1.0x, SDI 1.0x, reflectable and absorbable. */
export const LINK_SWORD_BEAM_HIT = Object.freeze({ angle: 361, base: 45, growth: 15, fixed: 0,
  hitlag: 1, sdi: 1, reflectable: true, absorbable: true });
export function linkSwordBeamPlan(chargeFrames:number,pixelsPerUnit=5):LinkSwordBeamPlan {
  if(!Number.isFinite(chargeFrames)||chargeFrames<0||!Number.isFinite(pixelsPerUnit)||pixelsPerUnit<=0)
    throw new Error('Beam requires finite charge and scale');
  const ratio=Math.min(1,chargeFrames/60),p=pixelsPerUnit;
  return Object.freeze({damage:5+8*ratio,life:Math.floor(32+8*ratio),speedNative:2.4+ratio,
    scale:.8+.3*ratio,rootOffset:Object.freeze({x:11*p,y:-6*p}),brakeNative:.01,
    capsule:Object.freeze({start:Object.freeze({x:-7*p,y:-.5*p}),end:Object.freeze({x:7*p,y:-.5*p}),radius:1.8*p})});
}
