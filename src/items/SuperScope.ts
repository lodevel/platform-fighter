/**
 * Super Scope — Super Smash Bros. Ultimate shooting item.
 *
 * Every value is listed with its source and label in docs/review/2026-10-11/ultimate-items/phase-4/sources.json:
 *   • sourced (SmashWiki Super_Scope / Item, wins): 72 ammo; a tap fires five small shots; holding charges; the
 *     Ultimate stages 1, 4, 5, 6, 7, 8, 9, 10 cost 1/4/6/8/10/12/14/16 ammo for 1/7/10/13/16/20/24/28% ("The damage
 *     and costs are the same in every Smash game"; stages 2 and 3 unused in Ultimate); the tapped shots are stage 1
 *     (inferred: "little damage"); fire on neutral attack / neutral aerial while running and jumping; shots
 *     reflectable; uncharged shots do not pierce; the empty scope is thrown on the fire press; light shooting item;
 *   • native-derived (SmashWiki silent on any timing; ultimate-13.0.1 item sheet super_scope_charge_frame_max 100,
 *     super_scope_rapid_add_bullet 5; WuBoytH ScopeRapid / ScopeFire scripts: the bullet on frame 2 / 3; motion
 *     lengths item_scope_start 15, item_scope_rapid 9, item_scope_fire cancel 31, item_scope_end cancel 21;
 *     superscopeshot gravity_accel 0; item_common superscope thrown kinetics): the raise, burst, charge and fire
 *     clocks, the 100-frame full charge;
 *   • authored: how the 100 charge frames select the eight stages (evenly, the last only at full charge), a stage too
 *     costly for the ammo left falls to the strongest affordable one, shot speeds / sizes / launch, thrown base damage,
 *     idle TTL.
 */
import type { ItemShot } from '../characters/attacks';
import { ASSET_KEYS } from '../assets/manifest';
import type { ItemDefinition } from './ItemDefinition';
import type { ScopeSpec, ScopeStage, ShootingClips } from './itemShooting';
import { ultimateItemThrowProfile } from './nativeItemThrow';

const clips = (phase: string, air = `item_scope_air_${phase}`): ShootingClips =>
  Object.freeze({ ground: `item_scope_${phase}`, upper: `item_scope_${phase}_upper`, air });

/** A tapped shot: stage 1 (1%, cost 1). */
export const SUPER_SCOPE_RAPID_SHOT: ItemShot = Object.freeze({
  id: 'item.superScope.rapid',
  damage: 1,
  knockback: Object.freeze({ x: .4, y: -.2, scaling: .02, reference: Object.freeze({ base: 4, growth: 20, angle: 361 }) }),
  speed: 14,
  lifetimeFrames: 90,
  width: 14,
  height: 14,
  spawnOffsetX: 44,
  spawnOffsetY: -8,
  visual: 'scope',
  // Fresh source flag binding: ordinary-item-projectile-flags.json.
  reflectable:true,absorbable:true,
});

/** SmashWiki Super_Scope#Stages, the Ultimate stages: [stage, cost, damage]. */
const STAGES: readonly (readonly [number, number, number])[] = [[1, 1, 1], [4, 4, 7], [5, 6, 10], [6, 8, 13], [7, 10, 16],
  [8, 12, 20], [9, 14, 24], [10, 16, 28]];

export const SUPER_SCOPE_STAGES: readonly ScopeStage[] = Object.freeze(STAGES.map(([stage, cost, damage], i) => Object.freeze({
  stage, cost,
  shot: Object.freeze({
    id: `item.superScope.charge${stage}`,
    damage,
    // Authored: larger and stronger by stage ("stronger and larger shots", "decent KO potential at full charge").
    knockback: Object.freeze({ x: 1 + i * .3, y: -.5 - i * .15, scaling: .05 + i * .02,
      reference: Object.freeze({ base: 20 + i * 4, growth: 50 + i * 6, angle: 361 }) }),
    speed: 12,
    lifetimeFrames: 120,
    width: 18 + i * 8,
    height: 18 + i * 8,
    spawnOffsetX: 44 + i * 4,
    spawnOffsetY: -8,
    visual: 'scope' as const,
    reflectable:true,absorbable:true,
  }),
})));

export const SUPER_SCOPE_SHOOTING: ScopeSpec = Object.freeze({
  kind: 'scope',
  start: Object.freeze({ clips: clips('start'), frames: 14 }),
  // Charging in the air holds item_scope_fall (the airborne wait loop).
  wait: Object.freeze({ clips: clips('wait', 'item_scope_fall') }),
  rapid: Object.freeze({ clips: clips('rapid'), frames: 8, shotFrame: 1, shots: 5, shot: SUPER_SCOPE_RAPID_SHOT }),
  fire: Object.freeze({ clips: clips('fire'), frames: 30, shotFrame: 2 }),
  end: Object.freeze({ clips: clips('end'), frames: 20 }),
  chargeFrames: 100,
  stages: SUPER_SCOPE_STAGES,
});

export const SUPER_SCOPE_DEFINITION: ItemDefinition = Object.freeze({
  type: 'superScope',
  itemClass: 'shooting',
  ammo: 72,
  ammoSpentOnShot: true,
  shooting: SUPER_SCOPE_SHOOTING,
  ttlFrames: 1200,
  brokenDespawnFrames: 30,
  // Thrown base damage authored (SmashWiki's throw table stops at SSB4); kinetics item_common superscope.
  throwProfile: ultimateItemThrowProfile({ damage: 8, mapBottom: 4,
    kinetics: Object.freeze({ gravity: .08, terminalFallSpeed: 2.3, airBrakeX: .0025, maxSpeedX: Number.POSITIVE_INFINITY,
      throwRebound: Object.freeze({ mul: .04, addX: .2, addY: 1.8 }) }) }),
  // The scope rests on the shoulder along the socket's +Y (forward at every aiming drawing: h12itemscopewait / rapid
  // HaveR +Y 89-91°, unlike the Ray Gun / Fire Flower barrel on +Z): phase-4/sockets/axes.json.
  visual: Object.freeze({ spriteKey: ASSET_KEYS.itemSuperScope, width: 16, height: 48, restAngle: 90, socketAxis: 'y' as const }),
});
