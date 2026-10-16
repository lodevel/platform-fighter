import {describe,it,expect} from 'vitest';
import {selectLinkShieldTilt,parseLinkShieldTiltFacts} from './linkShieldTilt';
import raw from './linkShieldTiltFacts.json';
// Independent cardinal receipts come from strict source extraction. No test
// imports the implementation's radius/angle constants as its expectation.
const input=(x:number,y:number,facing:1|-1=1,hp=50)=>({moveX:x,moveY:y,facing,currentHP:hp,actorSourceRoot:{x:100,y:200}});
describe('selected Link parametric shield mechanical adapter',()=>{
 it('keeps zero input at source raw0, fullHP native10.9x5',()=>{
  const r=selectLinkShieldTilt(input(0,0));expect(r.rawAngle).toBe(0);expect(r.magnitude).toBe(0);
  expect(r.centre.x).toBeCloseTo(114,4);expect(r.centre.y).toBeCloseTo(164.49979,4);expect(r.radius).toBeCloseTo(54.5,8);
 });
 it('canvas up is source90 and source Throw—not physical Shield joint',()=>{
  const r=selectLinkShieldTilt(input(0,-1));expect(r.rawAngle).toBe(90);
  expect(r.centre.x).toBeCloseTo(98.99999,4);expect(r.centre.y).toBeCloseTo(146.99982,4);
 });
 it('half magnitude blends the centre without claiming bodyblend',()=>{
  const r=selectLinkShieldTilt(input(0,-.5));expect(r.rawAngle).toBe(90);expect(r.magnitude).toBe(.5);
  expect(r.centre.x).toBeCloseTo(106.5,4);expect(r.centre.y).toBeCloseTo(155.749805,4);
  expect(r.nativeBodyBlendProven).toBe(false);expect(r.nativeBubbleParentProven).toBe(false);
 });
 it('relative angle and offset mirror once at facingleft',()=>{
  const forward=selectLinkShieldTilt(input(-1,0,-1));expect(forward.rawAngle).toBe(0);expect(forward.centre.x).toBeCloseTo(86,4);
  const behind=selectLinkShieldTilt(input(1,0,-1));expect(behind.rawAngle).toBe(180);expect(behind.centre.x).toBeCloseTo(113.49999,4);
 });
 it('down wraps270 and fractional angles use adjacent source points',()=>{
  expect(selectLinkShieldTilt(input(0,1)).rawAngle).toBe(270);
  const r=selectLinkShieldTilt(input(Math.cos(Math.PI/360),-Math.sin(Math.PI/360)));expect(r.rawAngle).toBeCloseTo(.5,8);
  expect(Number.isFinite(r.centre.x)).toBe(true);
 });
 it('applies public HP scale with finite boundaries',()=>{
  expect(selectLinkShieldTilt(input(0,0,1,25)).radius).toBeCloseTo(31.3375,8);
  expect(selectLinkShieldTilt(input(0,0,1,0)).radius).toBeCloseTo(8.175,8);
  expect(selectLinkShieldTilt(input(0,0,1,90)).radius).toBeCloseTo(54.5,8);
 });
 it('rejects corrupt closed inputs/source identity and missing points',()=>{
  expect(()=>selectLinkShieldTilt({...input(0,0),moveX:NaN})).toThrow();
  expect(()=>selectLinkShieldTilt({...input(0,0),extra:true} as never)).toThrow();
  expect(()=>parseLinkShieldTiltFacts({...raw,points:raw.points.slice(1)})).toThrow();
  expect(()=>parseLinkShieldTiltFacts({...raw,resource:{...raw.resource,sha256:'0'.repeat(64)}})).toThrow();
 });
});
