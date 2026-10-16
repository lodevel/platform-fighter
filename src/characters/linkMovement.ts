/** STAGED. Native selected parameters mapped into explicit world-unit caps
 * and acceleration fields. Field binding is an engine adapter; no claim that
 * Matter reproduces native kinetic/status/run-start/friction consumers. */
export const LINK_NATIVE_MOVEMENT=Object.freeze({walkSpeed:1.247,dashSpeed:1.98,runSpeed:1.534,
  walkAccelMul:.21,walkAccelAdd:.105,runAccelMul:.13167,runAccelAdd:.044,
  airSpeed:.924,airAccelMul:.04,airAccelAdd:.01,airBrake:.0038,
  gravity:.096,terminalFallSpeed:1.6,fullJumpHeight:27.8,shortJumpHeight:13.38,
  aerialJumpHeight:29,jumpSquatFrames:3,jumpCount:2,weight:104,
  heavyWalkSpeed:1.08988,heavyAccelMul:.08,heavyAccelAdd:.03,
  shooterWalkSpeed:1.247,shooterDashForwardSpeed:1.584,shooterDashBackwardSpeed:1.2672,
  shooterAccelMul:.168,shooterAccelAdd:.084,walkSlowRatio:.2,walkMiddleRatio:.5,walkFastRatio:.75});
export interface LinkKineticFields {readonly speedCap:number;readonly accelerationMul:number;
  readonly accelerationAdd:number;readonly brake:number;readonly gravity:number;readonly fallCap:number;}
export function linkKineticFields(mode:'walk'|'run'|'air'|'heavy'|'shooter',pixelsPerUnit:number):LinkKineticFields{
  if(!Number.isFinite(pixelsPerUnit)||pixelsPerUnit<=0)throw new RangeError('Positive native/world scale required');
  const p=LINK_NATIVE_MOVEMENT;
  const cap=mode==='walk'?p.walkSpeed:mode==='run'?p.runSpeed:mode==='heavy'?p.heavyWalkSpeed:
    mode==='shooter'?p.shooterWalkSpeed:p.airSpeed;
  const mul=mode==='walk'?p.walkAccelMul:mode==='run'?p.runAccelMul:mode==='heavy'?p.heavyAccelMul:
    mode==='shooter'?p.shooterAccelMul:p.airAccelMul;
  const add=mode==='walk'?p.walkAccelAdd:mode==='run'?p.runAccelAdd:mode==='heavy'?p.heavyAccelAdd:
    mode==='shooter'?p.shooterAccelAdd:p.airAccelAdd;
  return Object.freeze({speedCap:cap*pixelsPerUnit,accelerationMul:mul*pixelsPerUnit,
    accelerationAdd:add*pixelsPerUnit,brake:p.airBrake*pixelsPerUnit,
    gravity:p.gravity*pixelsPerUnit,fallCap:p.terminalFallSpeed*pixelsPerUnit});
}
/** Wiki air Spin frame48 switches attributes, not the first powerless frame.
 * Caller supplies status ownership; ground Spin stays grounded/stationary. */
export function linkAirSpinAttributes(gameplayAge:number,status:'powered'|'helpless',pixelsPerUnit:number){
  const p=LINK_NATIVE_MOVEMENT,ending=gameplayAge>=47;
  return Object.freeze({initialVelocityY:gameplayAge===0?-2.4*pixelsPerUnit:null,
    // Helpless gravity status caller is not recovered; Scene must bind its
    // selected common fall policy rather than silently retain powered .55.
    gravity:status==='helpless'?null:p.gravity*.55*pixelsPerUnit,
    horizontalSpeedCap:(status==='helpless'?p.airSpeed*.909:ending?.8:p.airSpeed*.5)*pixelsPerUnit,
    // Ending primary caller sets control accel MUL, not generic air ADD.
    horizontalControlAccelMulOverride:status==='powered'&&ending?.01*pixelsPerUnit:null,
    risingAdditionalAccelSourceNative:status==='powered'&&!ending?.22:null,
    // Native exit stores this private field; exact common FallSpecial formula
    // is not promoted into a direct add/mul equation by the field name alone.
    helplessPrivateFallAccelMul:status==='helpless'?.025:null,
    landingLagFrames:30});
}
export function linkCarryRestrictions(){return Object.freeze({groundOnly:true,jump:false,dash:false,
  ordinaryAttack:false,special:false,shield:false,dodge:false,directionalHeavyThrow:true});}
