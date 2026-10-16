/** Fresh native parameter bindings at5worldpx/unit. The discrete hop impulse,
 * Matter damping/mass and terrain proxy are explicit engine calibrations;
 * they do not stand in for the unavailable native common kinetic consumer. */
import type { FighterMovementProfile } from './movesetContract';
import { LINK_NATIVE_MOVEMENT as p } from './linkMovement';
import { LINK_ATTACK_DATA } from './linkAttackData';
import { LINK_UFD_STATS as ufd } from './linkUfdStats';
import { ULTIMATE_LEDGE_REGRAB_PENALTIES, ULTIMATE_LEDGE_OPTION_INTANGIBILITY_SCALE_BY_GRAB } from './ledgeHangState';
export const FRESH_LINK_MOVEMENT_PROFILE:FighterMovementProfile=Object.freeze({
  // Ledge options. UFD Ledge Stats (sources/ufd/stats.html#ledgestats), Link row:
  // Neutral Getup "1-33 intangible / 34 total", Roll "1-26 intangible / 45 total",
  // Jump "1-12 intangible / 14 total". catchFrames: native cliff_catch cancel frame 20
  // (sources/native/motion_list.yml) -> 19 steps, the DK/Pikachu convention.
  // Ledge attack (SmashWiki Link (SSBU)/Edge attack): intangible 1-22 / 1-18 / 1-11, none
  // from the 4th grab; the sourced move carries that whole-body window (attackIframes 0)
  // and linkAttackData.json holds it as exclusive ends, hence the -1.
  // Regrab penalties and option scaling: SmashWiki Edge (universal Ultimate rules).
  ledge:Object.freeze({catchFrames:19,climbFrames:34,getupIframes:33,rollFrames:45,
    rollIframes:26,attackIframes:0,jumpIframes:12,...ULTIMATE_LEDGE_REGRAB_PENALTIES,
    optionIntangibilityScaleByGrab:ULTIMATE_LEDGE_OPTION_INTANGIBILITY_SCALE_BY_GRAB,
    attackProtectionFramesByGrab:Object.freeze(LINK_ATTACK_DATA.recovery['link.ledgeAttack']!.intangibleUntilByGrab.map(end=>end-1))}),
  locomotion:Object.freeze({walkMaxSpeed:p.walkSpeed*5,initialDashSpeed:p.dashSpeed*5,
    initialDashInstantStart:true,dashDanceWindowFrames:ufd.dashFrames}),
  maxRunSpeed:p.runSpeed*5,maxAirSpeed:p.airSpeed*5,
  groundAccel:p.runAccelMul*5,airAccel:(p.airAccelMul+p.airAccelAdd)*5,
  groundDamping:.8,airDamping:.96,
  // Existing discrete Matter hop calibration targets independently sourced
  // FH139 / SH66.9 / AJ145px. Native jump-speed/status parity is not claimed.
  jumpImpulse:13.414603174603174,shortHopImpulse:8.25529411764706,
  riseAccel:.34,shortHopRiseAccel:.2022222222222222,
  airJumpImpulse:12.04,airJumpRiseAccel:.2022222222222222,
  // UFD stats; SmashWiki Link (SSBU) lists "empty landing lag 5".
  softLandingFrames:ufd.softLandingFrames,hardLandingFrames:ufd.hardLandingFrames,hardLandingSpeedFrames:4,
  airDodgeLandingFrames:10,directionalAirDodgeLandingFrames:19,
  maxJumps:p.jumpCount,mass:12,referenceWeight:p.weight,
  referenceLaunch:Object.freeze({gravity:p.gravity,fallSpeed:p.terminalFallSpeed,
    verticalGravity:.076944,verticalFallSpeed:1.8}),
  fallAccel:.34,maxFallSpeed:p.terminalFallSpeed*5,fastFallSpeed:ufd.fastFallSpeed*5, // SmashWiki and UFD: 3.04
  jumpCutFactor:8.25529411764706/13.414603174603174,
  dodge:Object.freeze({
    spot:Object.freeze({activeFrames:17,iframeStartFrame:2,iframeFrames:15,recoveryFrames:9,cooldownFrames:0,slideSpeed:0}),
    roll:Object.freeze({activeFrames:15,iframeStartFrame:3,iframeFrames:12,recoveryFrames:15,cooldownFrames:0,slideSpeed:10,reverseFacingFrame:19}),
    backwardRoll:Object.freeze({activeFrames:16,iframeStartFrame:4,iframeFrames:12,recoveryFrames:19,cooldownFrames:0,slideSpeed:10}),
    air:Object.freeze({activeFrames:30,iframeStartFrame:2,iframeFrames:28,recoveryFrames:19,cooldownFrames:0,slideSpeed:0}),
    directionalAir:Object.freeze({activeFrames:21,iframeStartFrame:2,iframeFrames:19,recoveryFrames:61,cooldownFrames:0,slideSpeed:0}),
    directionalAirUpRecoveryFrames:87,directionalAirDownRecoveryFrames:48,
    directionalAirUpDiagonalRecoveryFrames:74,directionalAirDownDiagonalRecoveryFrames:53,
  }),
});
