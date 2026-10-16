import { spawnHitbox, despawnHitbox, updateHitboxPosition, type AttackMove, type HitboxPlugin } from './attacks';
import type { PhysicsHost } from '../physics/PhysicsWorld';
import { pikachuSpecialKnockback, type PikachuSpecialKind } from './pikachuSpecialMoves';
import { PIKACHU_JOLT_ORBIT } from './pikachuJoltCurve';
import { sweptProjectileEntry, sweptProjectileCapsuleEntry } from './projectileMotion';
import type { CollisionCapsule } from './capsuleGeometry';
import { rotatePikachuSpecialPoint, PIKACHU_QUICK_ROT_PIVOT } from './pikachuSpecialTransforms';
import { PIKACHU_UFD_STATS, PIKACHU_REFERENCE_PIXELS_PER_UNIT } from './pikachuUfdStats';
import { PIKACHU_MOVEMENT_PROFILE } from './pikachuMovement';

export interface PikachuSpecialAction {
  move: AttackMove; facing: 1 | -1; framesElapsed: number; hitboxBody: MatterJS.BodyType | null;
  chargeHeldFrames: number | null;
}
export interface PikachuSpecialHost {
  readonly id: string;
  readonly body: MatterJS.BodyType;
  readonly scene: PhysicsHost;
  setVelocity(vector: Point): void;
  grounded(): boolean;
  finish(helpless: boolean, landingFrames?: number): void;
  replace(move: AttackMove, frame: number): PikachuSpecialAction | null;
  facing(value: 1 | -1): void;
}
export interface SpecialSurface { readonly vertices: readonly { x: number; y: number }[]; readonly oneWay?: boolean }
export interface SpecialProjectileTarget {
  readonly ownerId: string; readonly bodyId: number;
  readonly hurtboxes: readonly ({ x: number; y: number; width: number; height: number } | CollisionCapsule)[];
  readonly reflector?: { x: number; y: number; width: number; height: number; damageScale: number; velocityScale: number;
    /** The reflecting fighter's hook (e.g. the Home-Run Bat swings at once on a reflect). */
    onReflect?: () => void };
}
type Point = { x: number; y: number };
interface Entity {
  kind: 'joltAir' | 'joltGround' | 'cloud' | 'bolt'; id: number; age: number; x: number; y: number;
  origin: Point; facing: 1 | -1; token: object; sensor: MatterJS.BodyType | null; born: boolean;
  frame?: number; basis?: Point; normal?: Point; fired?: number; consumed?: boolean; hit?: boolean;
  groundEntryY?: number;
  ownerId: string; ownerBodyId: number; damageScale: number; velocityScale: number;
}
export interface PikachuSpecialVisual {
  readonly kind: Entity['kind'] | 'burst' | 'quickAttackTrail'; readonly id: number;
  readonly x: number; readonly y: number; readonly age: number; readonly facing: 1 | -1;
}
interface ActionState {
  kind: PikachuSpecialKind; token: object; frame: number; charge: number; holding: boolean;
  skullStopAccelerationEnabled: boolean;
  originalMove: AttackMove;
  delay: number; extra: number; second: boolean; decision: boolean; previous: Point | null;
  velocity: Point; gravity: number | null; hit: boolean; branchFrame: number | null;
  bornGrounded: boolean;
  firstBurstEnd: number;
  secondBurstEnd: number;
  quickEndGrounded: boolean | null;
  releaseSpeedX: number | null;
  groundSlope: number | null; rotationDegrees: number; rotationTarget: number; rotationStep: number;
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const towardZero = (x: number, n: number) => Math.sign(x) * Math.max(0, Math.abs(x) - n);
function baseContact(move: AttackMove, damage: number, angle: number, base: number, growth: number,
  radius: number, start: Point, end = start, shieldDamage = 0, hitlagMultiplier = 1, situation?: 'ground' | 'air'): AttackMove {
  const electricCollision = move.pikachuSpecial?.kind !== 'skullBash';
  // Pinned ordinary special ATTACK packets, independent of the hitlag flag.
  const kind = move.pikachuSpecial?.kind;
  const nativeCollisionAttribute = kind === 'skullBash' ? 'collision_attr_normal'
    : kind === 'quickAttack' || kind === 'thunderJolt' || kind === 'thunder' ? 'collision_attr_elec' : undefined;
  const nativeForceReaction = nativeCollisionAttribute === undefined ? undefined : false;
  return { ...move, damage, shieldDamage, hitlagMultiplier, electricCollision, nativeCollisionAttribute, nativeForceReaction, knockback: pikachuSpecialKnockback(angle, base, growth),
    hitbox: { offsetX: start.x, offsetY: start.y, width: radius * 2, height: radius * 2 },
    collisionHits: [{ id: 0, capsule: { start, end, radius }, damage, shieldDamage, hitlagMultiplier, electricCollision, nativeCollisionAttribute, nativeForceReaction,
      ...(move.launchDirection ? { launchDirection: move.launchDirection } : {}),
      knockback: pikachuSpecialKnockback(angle, base, growth), ...(situation ? { situation } : {}) }] };
}
/** Ray/segment entry against stage polygons. Ordinary platforms use every edge;
 * one-way platforms expose their upward-facing edge only to descending shots. */
function firstSurface(from: Point, to: Point, surfaces: readonly SpecialSurface[]) {
  let found: { fraction: number; point: Point; tangent: Point; normal: Point; surface: SpecialSurface } | null = null;
  for (const surface of surfaces) for (let i = 0; i < surface.vertices.length; i++) {
    const a = surface.vertices[i]!, b = surface.vertices[(i + 1) % surface.vertices.length]!;
    const sx = b.x - a.x, sy = b.y - a.y, dx = to.x - from.x, dy = to.y - from.y;
    if (surface.oneWay && (Math.abs(sy) > Math.abs(sx) || (a.y + b.y) / 2 > Math.min(...surface.vertices.map(v => v.y)) + 1 || dy <= 0)) continue;
    const denominator = dx * sy - dy * sx;
    if (Math.abs(denominator) < 1e-8) continue;
    const qx = a.x - from.x, qy = a.y - from.y;
    const t = (qx * sy - qy * sx) / denominator, u = (qx * dy - qy * dx) / denominator;
    if (t < 1e-6 || t > 1 || u < 0 || u > 1 || found && t >= found.fraction) continue;
    const length = Math.hypot(sx, sy);
    // Orient the tangent in the existing travel direction.
    const sign = sx * dx + sy * dy >= 0 ? 1 : -1;
    const winding = surface.vertices.reduce((sum, v, index) => { const next = surface.vertices[(index + 1) % surface.vertices.length]!;
      return sum + v.x * next.y - next.x * v.y; }, 0) >= 0 ? 1 : -1;
    found = { fraction: t, point: { x: from.x + dx * t, y: from.y + dy * t },
      tangent: { x: sx / length * sign, y: sy / length * sign },
      normal: { x: sy / length * winding, y: -sx / length * winding }, surface };
  }
  return found;
}

/** Owns source-specific statuses and detached objects. Input/action clocks freeze
 * with the actor; entities are ticked independently by MatchScene before physics. */
export class PikachuSpecialRuntime {
  private action: ActionState | null = null;
  private entities: Entity[] = [];
  private nextId = 0;
  private contactSensor: MatterJS.BodyType | null = null;
  private contactKey = '';
  private contactShape = '';
  private contactMove: AttackMove | null = null;
  private contactFacing: 1 | -1 = 1;
  private quickContactSample: { key: string; frame: number;
    point: NonNullable<HitboxPlugin['previousPointContact']> } | null = null;
  private contactGroup: object = {};
  private trails: PikachuSpecialVisual[] = [];
  private burst: PikachuSpecialVisual | null = null;
  private actionFacing: 1 | -1 = 1;
  constructor(private readonly host: PikachuSpecialHost) {}

  begin(move: AttackMove, token: object, smashInput = false): void {
    this.interruptAction();
    const kind = move.pikachuSpecial!.kind;
    const velocity = { ...this.host.body.velocity };
    if (kind === 'skullBash') {
      // SpecialS/init resets every ground energy; its air branch resets
      // gravity Y and retains SUM X through the sourced STOP multiplier.
      velocity.x = this.host.grounded() ? 0 : velocity.x * 0.8;
      velocity.y = 0;
    }
    if (kind === 'thunder') velocity.x *= this.host.grounded() ? 1 : 0.85;
    this.action = { kind, token, originalMove: move, frame: 0, charge: smashInput ? 20 : 0, holding: true, delay: 0, extra: 0,
      skullStopAccelerationEnabled: kind === 'skullBash' && !this.host.grounded(),
      second: false, decision: false, previous: null, velocity, gravity: null, hit: false,
      branchFrame: null, bornGrounded: this.host.grounded(), firstBurstEnd: 19, secondBurstEnd: 33, releaseSpeedX: null,
      quickEndGrounded: null, groundSlope: null, rotationDegrees: 0, rotationTarget: 0, rotationStep: 0 };
    if (kind === 'quickAttack') {
      // SpecialHi/init disables motion, gravity, control and stop energies.
      this.action.velocity = { x: 0, y: 0 }; this.action.gravity = 0;
      this.setVelocity(this.action.velocity);
    } else if (kind === 'skullBash') {
      this.action.gravity = this.host.grounded() ? 0 : 0.04 * 5;
      this.setVelocity(velocity);
    } else if (kind === 'thunder') {
      // Apply the STOP reset to the actual physics body before its first
      // observation can replace the internal copy with unscaled velocity.
      this.setVelocity(velocity);
    }
  }
  gravity(): number | null { return this.action?.gravity ?? null; }
  private quickEndingStart(frame: number): number | null {
    const a = this.action;
    if (!a || a.kind !== 'quickAttack' || frame < a.firstBurstEnd) return null;
    const secondStart = a.firstBurstEnd + 9;
    if (a.second && frame >= secondStart && frame < a.secondBurstEnd) return null;
    return a.second && frame >= a.secondBurstEnd ? a.secondBurstEnd : a.firstBurstEnd;
  }
  /** Source END phase9 restores gravity/control limit. Input prepares the next
   * action frame before tick() advances it; this getter uses that same frame. */
  airControlSpeedLimitForNextInput(): number | null {
    const frame = (this.action?.frame ?? -1) + 1;
    const end = this.quickEndingStart(frame);
    return !this.host.grounded() && end !== null && frame - end >= 8
      ? PIKACHU_UFD_STATS.airSpeed * PIKACHU_REFERENCE_PIXELS_PER_UNIT * 0.6 : null;
  }
  fallSpeedLimit(): number | null {
    return !this.host.grounded() && this.quickEndingStart(this.action?.frame ?? -1) !== null
      ? PIKACHU_UFD_STATS.fallSpeed * PIKACHU_REFERENCE_PIXELS_PER_UNIT : null;
  }
  /** Explicit SpecialSAttack/exec gravity limit, before the brake trigger.
   * This does not assign an unknown common AIR_STOP cap to other phases. */
  authoredVerticalSpeedLimit(): number | null {
    const a = this.action;
    if (!a || a.kind !== 'skullBash' || a.hit || a.releaseSpeedX === null) return null;
    const frame = a.frame - a.extra;
    return frame >= 13 && frame <= 51 ? 1.1 * 5 : null;
  }
  observePhysics(normals: readonly Point[] = []): void {
    const a = this.action;
    if (!a) return;
    if (a.kind === 'skullBash' && a.hit && a.branchFrame === a.frame) return;
    if (a.kind === 'skullBash' || a.kind === 'quickAttack') {
      const ground = normals.find(n => n.y < -0.5);
      a.groundSlope = ground ? Math.atan2(-ground.x, -ground.y) * 180 / Math.PI : null;
    }
    if (a.kind === 'skullBash' && !a.hit && a.releaseSpeedX !== null && a.frame - a.extra <= 51) {
      const ground = normals.find(n => n.y < -0.5);
      if (ground) {
        const slope = Math.atan2(-ground.x, -ground.y) * 180 / Math.PI;
        if (slope * this.actionFacing >= 0 && Math.abs(slope) > 10.01) {
          // Captured FUN_7100021f30 applies min+(max-min)*(1-sin(abs(slope)))
          // to authored initial release speed; the0.4/1 values are PRC/table crossmatched.
          const scale = 0.4 + (1 - 0.4) * (1 - Math.sin(Math.abs(slope) * Math.PI / 180));
          this.host.setVelocity({ x: a.releaseSpeedX * scale, y: this.host.body.velocity.y });
        }
      }
    }
    if (a.kind === 'quickAttack') {
      const first = a.frame >= 14 && a.frame < a.firstBurstEnd;
      const secondStart = a.firstBurstEnd + 9;
      const second = a.second && a.frame >= secondStart && a.frame < a.secondBurstEnd;
      if (first || second) {
        const speed = Math.hypot(a.velocity.x, a.velocity.y);
        // Captured Warp main exits to END when impact angle exceeds90+57.
        // Matter supplies the stage normal and retains tangential slide velocity.
        if (speed > 0 && normals.some(n => (a.velocity.x * n.x + a.velocity.y * n.y) / speed < Math.cos(147 * Math.PI / 180))) {
          if (first) { a.firstBurstEnd = a.frame + 1; a.secondBurstEnd = a.firstBurstEnd + 14; }
          else a.secondBurstEnd = a.frame + 1;
        }
      }
    }
    a.velocity = { ...this.host.body.velocity };
  }
  intangible(): boolean {
    const a = this.action;
    return a?.kind === 'thunder' && a.branchFrame !== null
      && a.frame - a.branchFrame < (a.bornGrounded ? 10 : 8);
  }
  charge(): { frames: number; startupElapsed: number } | null {
    const a = this.action;
    return a?.kind === 'skullBash' && a.holding ? { frames: a.charge, startupElapsed: Math.min(a.frame, 13) } : null;
  }
  snapshot() { const a = this.action; return a ? { kind: a.kind, frame: a.frame, charge: a.charge,
    holding: a.holding, heldFrames: a.extra - (a.holding ? 0 : a.delay), releaseDelay: a.delay,
    normalizedFrame: a.frame - a.extra, hit: a.hit,
    second: a.second, decision: a.decision, branchFrame: a.branchFrame, gravity: a.gravity, velocity: { ...a.velocity },
    bornGrounded: a.bornGrounded, grounded: this.host.grounded(), bodyRotation: a.rotationDegrees * Math.PI / 180,
    firstBurstEnd: a.firstBurstEnd, secondBurstStart: a.firstBurstEnd + 9, secondBurstEnd: a.secondBurstEnd,
    quickEndGrounded: a.quickEndGrounded } : null; }
  interruptAction(): void {
    if (this.contactSensor) despawnHitbox(this.host.scene, this.contactSensor);
    this.contactSensor = null; this.contactKey = ''; this.contactMove = null; this.action = null;
    this.quickContactSample = null;
  }
  clear(): void {
    this.interruptAction();
    for (const e of this.entities) if (e.sensor) despawnHitbox(this.host.scene, e.sensor);
    this.entities = []; this.trails = []; this.burst = null;
  }
  private setVelocity(v: Point): void { this.host.setVelocity(v); }
  /** A body-attached attack shares the completed physical root, including
   * collision correction/hitlag pinning; autonomous article sensors do not. */
  refreshContactAfterPhysics(frozen = false): void {
    if (!this.contactSensor || !this.contactMove) return;
    updateHitboxPosition(this.host.scene,
      this.contactSensor, this.host.body.position, this.contactMove, this.contactFacing);
    const row = this.contactMove.collisionHits?.[0];
    const a = this.action;
    if (a?.kind !== 'quickAttack' || !row) return;
    // A first collision still shares this frame's interpolation with other
    // receivers. Later pinned physics steps retire the obsolete moving path.
    if (frozen && this.quickContactSample?.frame === a.frame)
      this.contactSensor.plugin.previousPointContact = undefined;
    this.quickContactSample = { key: this.contactKey, frame: a.frame, point: {
      hitId: row.id, radius: row.capsule.radius,
      position: { x: this.host.body.position.x + row.capsule.start.x * this.contactFacing,
        y: this.host.body.position.y + row.capsule.start.y },
    } };
  }
  private contact(move: AttackMove | null, key: string, action: PikachuSpecialAction): void {
    if (!move) {
      if (this.contactSensor) despawnHitbox(this.host.scene, this.contactSensor);
      this.quickContactSample = null;
      this.contactSensor = null; this.contactKey = ''; this.contactMove = null; action.hitboxBody = null; return;
    }
    const shape = JSON.stringify([move.collisionHits, move.damage]);
    if (!this.contactSensor || key !== this.contactKey || shape !== this.contactShape) {
      if (key !== this.contactKey) this.contactGroup = {};
      if (this.contactSensor) despawnHitbox(this.host.scene, this.contactSensor);
      this.contactSensor = spawnHitbox(this.host.scene,
        { id: this.host.id, bodyId: this.host.body.id, position: this.host.body.position }, move, action.facing);
      this.contactSensor.plugin.attackInstance = this.action!.token;
      this.contactSensor.plugin.hitGroup = this.contactGroup;
      this.contactSensor.plugin.ownerAnchoredContact = true;
      this.contactKey = key;
      this.contactShape = shape;
    }
    updateHitboxPosition(this.host.scene, this.contactSensor, this.host.body.position, move, action.facing);
    this.contactSensor.plugin.previousPointContact = this.action?.kind === 'quickAttack'
      && this.quickContactSample?.key === key ? this.quickContactSample.point : undefined;
    this.contactMove = move; this.contactFacing = action.facing;
    action.hitboxBody = this.contactSensor;
  }
  /** Returns false only after the action has ended. */
  tick(active: PikachuSpecialAction, stick: Point, specialHeld: boolean,
    contactProjection: (kind: 'quickAttackFirst' | 'quickAttackSecond' | 'skullBash', frame: number) => { start: Point; end: Point }): boolean {
    const a = this.action;
    if (!a) return false;
    a.frame += 1; active.framesElapsed = a.frame;
    this.actionFacing = active.facing;
    let live: AttackMove | null = null;
    let key = '';
    if (a.kind === 'thunderJolt') {
      if (a.frame === 18) this.newEntity('joltAir', this.host.body.position.x + 6.5 * 5 * active.facing,
        this.host.body.position.y + 25 - 1 * 5, active.facing, a.token);
      if (a.frame >= 51) return this.end(false);
    } else if (a.kind === 'quickAttack') {
      const secondStart = a.firstBurstEnd + 9;
      const secondOffset = a.second ? secondStart - 14 : 0;
      const inBurst = a.frame >= 14 + secondOffset && a.frame < (a.second ? a.secondBurstEnd : a.firstBurstEnd);
      if (a.frame === 14 || a.second && a.frame === secondStart) {
        const magnitude = Math.hypot(stick.x, stick.y);
        const dir = magnitude < 0.5 ? { x: 0, y: -1 } : { x: stick.x / magnitude, y: stick.y / magnitude };
        if (a.frame === 14) a.previous = dir;
        a.velocity = { x: dir.x * 55 * (a.second ? 0.9 : 1), y: dir.y * 55 * (a.second ? 0.9 : 1) };
        // Warp/init tests authored speed, not normalized stick X: native
        // ±0.001 becomes ±0.005 world pixels under the source unit contract.
        if (Math.abs(a.velocity.x) >= 0.001 * PIKACHU_REFERENCE_PIXELS_PER_UNIT) {
          active.facing = a.velocity.x > 0 ? 1 : -1; this.host.facing(active.facing);
        }
      }
      if (a.frame === a.firstBurstEnd + 8 && !a.decision) {
        a.decision = true;
        const magnitude = Math.hypot(stick.x, stick.y), previous = a.previous!;
        const cosine = magnitude === 0 ? 1 : Math.max(-1, Math.min(1, (stick.x * previous.x + stick.y * previous.y) / magnitude));
        a.second = magnitude >= 0.5 && Math.fround(Math.acos(cosine)) > Math.fround(35 * Math.PI / 180);
      }
      if (inBurst) {
        active.move = { ...active.move, sheetVariant: a.second ? 'second' : 'first' };
        const local = a.frame - 14 - secondOffset;
        const p = contactProjection(a.second ? 'quickAttackSecond' : 'quickAttackFirst', local);
        // FUN_710000d470 applies atan(abs(SUMx), SUMy)-90 to native RotX.
        // Static math ABI and screen-Y/facing projection reduce its air
        // branch to this angle; grounded branch follows the touch normal.
        // Warp/pre explicitly sets AIR before init invokes the helper;
        // previous-step floor contact must not select its ground branch.
        const warpEntry = local === 0;
        a.rotationDegrees = !warpEntry && this.host.grounded()
          ? -(a.groundSlope ?? 0)
          : Math.atan2(a.velocity.y, Math.abs(a.velocity.x)) * active.facing * 180 / Math.PI;
        const rotation = a.rotationDegrees * Math.PI / 180;
        live = baseContact(active.move, a.second ? 3 : 2, 70, 20, a.second ? 150 : 50, 1.6 * 5,
          rotatePikachuSpecialPoint(p.start, rotation, active.facing, PIKACHU_QUICK_ROT_PIVOT),
          rotatePikachuSpecialPoint(p.end, rotation, active.facing, PIKACHU_QUICK_ROT_PIVOT), 5);
        key = a.second ? 'quick-second' : 'quick-first'; a.gravity = 0;
        this.trails.push({ kind: 'quickAttackTrail', id: this.nextId++, ...this.host.body.position, age: 0, facing: active.facing });
      } else if (a.frame < 14) {
        a.rotationDegrees = 0;
        // Native exec restores positive native-Y accel after stopcounter10;
        // stage screen-Y is inverted. This is a tiny upward acceleration.
        a.gravity = a.frame < 10 || this.host.grounded() ? 0
          : -0.002666667 * PIKACHU_REFERENCE_PIXELS_PER_UNIT;
      }
      else { active.move = { ...active.move, sheetVariant: 'end' };
        a.rotationDegrees = 0;
        const endingStart = this.quickEndingStart(a.frame)!;
        const entering = a.frame === endingStart;
        // SpecialHiEnd/main_loop branches on the entered motion kind. A
        // physical touchdown does not graft its aerial clock onto the shorter
        // ground motion before Character commits LANDING_FALL_SPECIAL.
        if (entering) a.quickEndGrounded = this.host.grounded();
        if (!this.host.grounded()) {
          // Pinned SpecialHiEnd/init resets airborne STOP/GRAVITY speed to0.
          // .6 in exec limits CONTROL speed; it is not retained dash momentum.
          a.velocity.x = entering ? 0 : this.host.body.velocity.x;
          if (entering) a.velocity.y = 0;
          a.gravity = a.frame - endingStart < 8 ? 0
            : PIKACHU_UFD_STATS.gravity * PIKACHU_REFERENCE_PIXELS_PER_UNIT;
          if (a.frame - endingStart >= 8) {
            const limit = PIKACHU_UFD_STATS.airSpeed * PIKACHU_REFERENCE_PIXELS_PER_UNIT * 0.6;
            a.velocity.x = Math.max(-limit, Math.min(limit, a.velocity.x));
          }
        } else {
          // The ground END/init branch retains SUM speed into STOP/GRAVITY.
          // The source .6 is an airborne CONTROL limit, never a multiplier
          // on this retained ground momentum. Preserve completed physical
          // speed already captured by observePhysics. The input builder may
          // have damped the public body before this status tick; reading it
          // here would incorrectly import ordinary ground damping into reset.
          // Subsequent grounded STOP uses the reviewed beta2D damping.
          // Native AIR_X_NORMAL_MAX common cap/brake remains unavailable;
          // this authored brake is not claimed as native kinetic parity.
          // Apply after entry so init still preserves the completed SUM.
          if (!entering) a.velocity.x *= PIKACHU_MOVEMENT_PROFILE.groundDamping;
          a.gravity = null;
        }
      }
      this.setVelocity(a.velocity);
      // Wiki50-frame ending motion / captured native motion-end transition;
      // UFD52/66 describe actionable grounded endings, not airborne totals.
      const total = (a.second ? a.secondBurstEnd : a.firstBurstEnd) + ((a.quickEndGrounded ?? this.host.grounded()) ? 33 : 50);
      if (a.frame >= total) return this.end(!this.host.grounded(), 24);
    } else if (a.kind === 'skullBash') {
      const t = a.charge / 80;
      if (a.holding && a.frame >= 13) {
        if (specialHeld && a.charge < 80) { a.charge += 1; a.extra += 1; active.framesElapsed = 13; }
        else { a.holding = false; a.delay = a.extra > 0 ? Math.floor(12 * a.charge / 80) : 0; a.extra += a.delay; }
      }
      const f = a.frame - a.extra;
      active.framesElapsed = Math.min(a.frame, a.holding ? 13 : f);
      active.chargeHeldFrames = a.charge;
      if (a.holding || f < 13) {
        active.move = { ...active.move, sheetVariant: a.frame >= 13 ? 'hold' : 'start' };
        a.gravity = this.host.grounded() ? 0 : 0.04 * 5;
        if (a.holding) {
          // SpecialS/init installs signed STOP acceleration -accel_x*LR.
          // The hold loop explicitly disables both speed and acceleration
          // once SUM X points opposite LR; startup has no such clamp.
          if (a.frame >= 13 && a.velocity.x * active.facing < 0) {
            a.velocity.x = 0; a.skullStopAccelerationEnabled = false;
          }
          if (!this.host.grounded() && a.skullStopAccelerationEnabled)
            a.velocity.x -= active.facing * 0.02 * 5;
        } else {
          // Weak/ready common AIR_STOP initialization is still a separate
          // source gap; retain that existing adapter without upgrading it.
          a.velocity.x = towardZero(a.velocity.x, 0.02 * 5);
        }
      } else if (a.hit) {
        active.move = { ...active.move, sheetVariant: 'hit' };
        active.framesElapsed = a.frame - a.branchFrame!;
        a.gravity = 0.1 * 5;
        if (a.branchFrame !== null && a.frame - a.branchFrame >= 22) return this.end(false);
      } else if (f >= 13 && f <= 51) {
        active.move = { ...active.move, sheetVariant: 'release' };
        if (a.groundSlope !== null && a.groundSlope * active.facing >= 0) {
          // FUN_7100021f30 replaces RotX with -degree. Facing inversion
          // makes its projected world angle -slope*0.3 for either facing.
          const target = -a.groundSlope * 0.3;
          if (Math.abs(target - a.rotationTarget) > 1e-6) {
            a.rotationTarget = target; a.rotationStep = Math.abs(target - a.rotationDegrees) / 3;
          }
          a.rotationDegrees += Math.sign(a.rotationTarget - a.rotationDegrees)
            * Math.min(a.rotationStep, Math.abs(a.rotationTarget - a.rotationDegrees));
        }
        // Release movement begins when charging ends. The native attack
        // motion has its own five-frame windup before its first hitbox.
        if (a.releaseSpeedX === null) { a.velocity = { x: active.facing * lerp(1.6, 3.2, t) * 5, y: -lerp(0.185, 0.23, t) * 5 }; a.releaseSpeedX = a.velocity.x; }
        a.gravity = 0.01 * 5;
        a.velocity.y = Math.min(a.velocity.y, 1.1 * 5);
        if (f >= 17) {
          // The acquired Rot contact transform is constant across every
          // retained sample. Use that verified point; contact age is not
          // a proven mapping to the separately sampled body-motion clock.
          const p = contactProjection('skullBash', 0);
          const rotation = a.rotationDegrees * Math.PI / 180;
          live = baseContact(active.move, 6.2 + 15.2 * t, 361, 40, 78, (f < 25 ? 4 : 3) * 5,
            rotatePikachuSpecialPoint(p.start, rotation, active.facing),
            rotatePikachuSpecialPoint(p.end, rotation, active.facing));
          key = 'skull';
        }
      } else {
        active.move = { ...active.move, sheetVariant: 'end' };
        if (f === 52) { a.velocity.x *= 0.7; a.rotationDegrees = 0; }
        a.velocity.x = towardZero(a.velocity.x, lerp(0.032, 0.063, t) * 5); a.gravity = 0.075 * 5;
      }
      this.setVelocity(a.velocity);
      // SpecialSEnd switches its motion when the actual situation changes;
      // the original launch situation does not lock the ending to one clip.
      if (!a.holding && f >= (this.host.grounded() ? 96 : 74)) return this.end(false);
    } else if (a.kind === 'thunder') {
      if (a.frame === 1) this.newEntity('cloud', this.host.body.position.x, this.host.body.position.y + 25 - 105 * 5, active.facing, a.token);
      if (a.branchFrame !== null) {
        const local = a.frame - a.branchFrame;
        active.framesElapsed = local;
        if (local < 3) { live = baseContact(active.move, 15, 361, 70, 77, 13 * 5, { x: 0, y: 25 - 10.2 * 5 }, undefined, 2); key = 'thunder-burst'; }
        a.gravity = 0.016 * 5; this.setVelocity(a.velocity);
        if (local >= (a.bornGrounded ? 41 : 35)) return this.end(false);
      } else if (a.frame >= 86) return this.end(false);
    }
    this.contact(live, key, active);
    return true;
  }
  private end(helpless: boolean, landing?: number): false {
    this.interruptAction(); this.host.finish(helpless, landing); return false;
  }
  private newEntity(kind: Entity['kind'], x: number, y: number, facing: 1 | -1, token: object): Entity {
    const e: Entity = { kind, id: this.nextId++, age: 0, x, y, origin: { x, y }, facing, token, sensor: null, born: true,
      ownerId: this.host.id, ownerBodyId: this.host.body.id, damageScale: 1, velocityScale: 1,
      ...(kind === 'cloud' ? { fired: 0 } : {}) };
    this.entities.push(e); return e;
  }
  private entitySensor(e: Entity, move: AttackMove, phase: string) {
    if (e.damageScale !== 1) move = { ...move, damage: move.damage * e.damageScale,
      collisionHits: move.collisionHits?.map(h => ({ ...h, damage: h.damage === undefined ? undefined : h.damage * e.damageScale })) };
    if (e.sensor && e.sensor.plugin.pikachuPhase !== phase) { despawnHitbox(this.host.scene, e.sensor); e.sensor = null; }
    if (!e.sensor) {
      e.sensor = spawnHitbox(this.host.scene, { id: e.ownerId, bodyId: e.ownerBodyId, position: e }, move, e.facing);
      e.sensor.plugin.projectile = true; e.sensor.plugin.attackInstance = e.token; e.sensor.plugin.hitGroup = e.token;
      e.sensor.plugin.pikachuEntityId = e.id; e.sensor.plugin.pikachuPhase = phase;
    }
    updateHitboxPosition(this.host.scene, e.sensor, e, move, e.facing);
  }
  private reflect(e: Entity, previous: Point, targets: readonly SpecialProjectileTarget[]): void {
    const radius = e.kind === 'bolt' ? (e.age < 3 ? 30 : 20) : 15;
    const dimensions = { width: radius * 2, height: radius * 2 };
    let closest: { fraction: number; target: SpecialProjectileTarget; reflected: boolean } | null = null;
    for (const target of targets) {
      if (target.bodyId === e.ownerBodyId) continue;
      for (const h of target.hurtboxes) {
        const fraction = 'start' in h ? sweptProjectileCapsuleEntry(previous, e, h, dimensions)
          : sweptProjectileEntry(previous, e, h, dimensions);
        if (fraction !== null && (!closest || fraction < closest.fraction)) closest = { fraction, target, reflected: false };
      }
      if (target.reflector) {
        const fraction = sweptProjectileEntry(previous, e, target.reflector, dimensions);
        if (fraction !== null && (!closest || fraction <= closest.fraction)) closest = { fraction, target, reflected: true };
      }
    }
    if (!closest?.reflected) return;
    const r = closest.target.reflector!;
    r.onReflect?.();
    e.x = lerp(previous.x, e.x, closest.fraction); e.y = lerp(previous.y, e.y, closest.fraction);
    e.facing = e.facing === 1 ? -1 : 1; e.damageScale *= r.damageScale; e.velocityScale *= r.velocityScale;
    e.ownerId = closest.target.ownerId; e.ownerBodyId = closest.target.bodyId; e.token = {};
    if (e.sensor) despawnHitbox(this.host.scene, e.sensor); e.sensor = null;
    if (e.kind === 'joltGround') { e.origin = { x: e.x, y: e.y }; e.frame = 0;
      const b = e.basis ?? { x: -e.facing, y: 0 }; e.basis = { x: -b.x, y: -b.y }; }
  }
  tickEntities(moveLookup: (kind: 'thunder' | 'thunderJolt') => AttackMove, surfaces: readonly SpecialSurface[], targets: readonly SpecialProjectileTarget[] = []): void {
    this.trails = this.trails.map(t => ({ ...t, age: t.age + 1 })).filter(t => t.age < 6);
    if (this.burst) { this.burst = { ...this.burst, age: this.burst.age + 1 }; if (this.burst.age > 10) this.burst = null; }
    const queue = [...this.entities];
    for (const e of queue) {
      if (e.consumed) continue;
      if (e.born) e.born = false; else e.age += 1;
      if (e.hit) { e.consumed = true; continue; }
      if (e.kind === 'cloud') {
        if ([11, 15, 19, 23].includes(e.age)) { this.newEntity('bolt', e.x, e.y, e.facing, e.token); e.fired = (e.fired ?? 0) + 1; }
        if (e.age >= 25) e.consumed = true;
        continue;
      }
      const previous = { x: e.x, y: e.y };
      if (e.kind === 'joltAir') {
        e.x += Math.cos(-1.01229) * 2 * 5 * e.facing * e.velocityScale; e.y -= Math.sin(-1.01229) * 2 * 5 * e.velocityScale;
        const collision = firstSurface(previous, e, surfaces);
        if (collision) { e.kind = 'joltGround'; e.age = 0; e.frame = 0; e.x = collision.point.x; e.y = collision.point.y;
          e.origin = { x: e.x, y: e.y }; e.basis = collision.tangent; e.normal = collision.normal; }
        if (e.age >= 98) e.consumed = true;
      } else if (e.kind === 'joltGround') {
        e.frame = (e.frame ?? 0) + 0.9 * e.velocityScale;
        const i = Math.min(35, Math.floor(e.frame)), f = e.frame - i;
        const orbit = { x: lerp(PIKACHU_JOLT_ORBIT[i]!.x, PIKACHU_JOLT_ORBIT[i + 1]!.x, f),
          y: lerp(PIKACHU_JOLT_ORBIT[i]!.y, PIKACHU_JOLT_ORBIT[i + 1]!.y, f) };
        const b = e.basis ?? { x: e.facing, y: 0 };
        const n = e.normal ?? { x: 0, y: -1 };
        e.x = e.origin.x + orbit.x * b.x - orbit.y * n.x;
        e.y = e.origin.y + orbit.x * b.y - orbit.y * n.y;
        const collision = firstSurface(previous, e, surfaces);
        if (collision && e.frame > 1 && e.frame < 24) {
          e.origin = collision.point; e.x = collision.point.x; e.y = collision.point.y;
          // The orbit turns inward after its apex. That local turn must not
          // reverse the article's persistent direction on a flat surface.
          const flip = collision.tangent.x * b.x + collision.tangent.y * b.y < 0 ? -1 : 1;
          e.frame = 0; e.basis = { x: collision.tangent.x * flip, y: collision.tangent.y * flip }; e.normal = collision.normal;
        }
        if (e.age >= 96 || e.frame >= 36) e.consumed = true;
      } else {
        e.y += 4 * 5 * e.velocityScale;
        const action = this.action;
        // The owner's special flag is required: an interrupted summon cannot become a self-hit status.
        const owner = this.host.body.position;
        if (action?.kind === 'thunder' && action.token === e.token && action.branchFrame === null
          && Math.abs(owner.x - e.x) <= 17 * 5 && e.y >= owner.y + 25 - 17 * 5 && previous.y <= owner.y + 25 + 17 * 5) {
          action.branchFrame = action.frame; action.bornGrounded = this.host.grounded();
          action.velocity = { x: this.host.body.velocity.x, y: -0.66 * 5 }; action.gravity = 0.016 * 5;
          this.burst = { kind: 'burst', id: e.id, x: owner.x, y: owner.y, age: 0, facing: e.facing };
          const branch = this.host.replace({ ...moveLookup('thunder'), startupFrames: 0, activeFrames: 3,
            recoveryFrames: action.bornGrounded ? 38 : 32, sheetVariant: action.bornGrounded ? 'ground-hit' : 'air-hit' }, 0);
          if (branch) this.contact(baseContact(branch.move, 15, 361, 70, 77, 13 * 5,
            { x: 0, y: 25 - 10.2 * 5 }, undefined, 2), 'thunder-burst', branch);
          for (const part of this.entities) if (part.token === e.token && (part.kind === 'bolt' || part.kind === 'cloud')) part.consumed = true;
        }
        if (e.y - e.origin.y >= 300 * 5 || e.age >= 74) e.consumed = true;
        const collision = firstSurface(previous, e, surfaces);
        if (collision && e.groundEntryY === undefined) e.groundEntryY = collision.point.y;
        if (e.groundEntryY !== undefined && e.y - e.groundEntryY >= 80 * 5) e.consumed = true;
      }
      if (e.consumed) continue;
      this.reflect(e, previous, targets);
      if (e.kind === 'joltAir') {
        this.entitySensor(e, baseContact(moveLookup('thunderJolt'), 4.8, 361, 35, 30, 3 * 5, { x: 0, y: 0 }, undefined, -1.9, 0.3), 'air');
      } else if (e.kind === 'joltGround') {
        const phase = e.age < 34 ? 0 : e.age < 67 ? 1 : 2;
        let m = baseContact(moveLookup('thunderJolt'), 6 - phase, 361, 18, 20, 3 * 5, { x: 0, y: 0 }, undefined, -2.5 + phase * 0.5, 0.3, 'ground');
        m = { ...m, collisionHits: [...m.collisionHits!, { ...m.collisionHits![0]!, id: 1, situation: 'air', damage: 5 - phase,
          shieldDamage: -2 + phase * 0.5, knockback: pikachuSpecialKnockback(361, 13, 20),
          capsule: { start: { x: 0, y: 0 }, end: { x: 0, y: 0 }, radius: 1.8 * 5 } }] };
        this.entitySensor(e, m, `ground-${phase}`);
      } else if (e.kind === 'bolt') {
        const early = e.age < 3;
        let m = baseContact(moveLookup('thunder'), early ? 6 : 8, early ? 270 : 70, early ? 55 : 74, 60,
          (early ? 6 : 4) * 5, { x: 0, y: -(early ? 2 : 4) * 5 }, early ? undefined : { x: 0, y: -14 * 5 }, 1, early ? 0 : 1);
        if (early) { const knockback = pikachuSpecialKnockback(270, 55, 60, 125);
          m = { ...m, knockback, collisionHits: m.collisionHits!.map(h => ({ ...h, knockback })) }; }
        this.entitySensor(e, m, early ? 'early' : 'clean');
      }
    }
    for (const e of this.entities) if (e.consumed && e.sensor) despawnHitbox(this.host.scene, e.sensor);
    this.entities = this.entities.filter(e => !e.consumed);
  }
  notifyContact(token: object | undefined, outcome: string, sensor?: MatterJS.BodyType): void {
    if (outcome !== 'landed' && outcome !== 'shielded' && outcome !== 'parried') return;
    if (sensor?.plugin.pikachuEntityId !== undefined) {
      const e = this.entities.find(x => x.id === sensor.plugin.pikachuEntityId);
      if (e) e.hit = true;
    }
    const a = this.action;
    for (const e of this.entities) if (e.token === token && (e.kind === 'joltAir' || e.kind === 'joltGround')) e.hit = true;
    if (a?.kind === 'skullBash' && a.token === token && outcome === 'landed') {
      a.hit = true; a.branchFrame = a.frame; a.rotationDegrees = 0;
      a.velocity = { x: -0.3 * 5 * this.actionFacing, y: -1.3 * 5 };
      this.host.replace({ ...a.originalMove, startupFrames: 0, activeFrames: 0,
        recoveryFrames: 22, sheetVariant: 'hit' }, 0);
    }
  }
  visuals(): readonly PikachuSpecialVisual[] {
    return [...this.entities.map(e => ({ kind: e.kind, id: e.id, x: e.x, y: e.y, age: e.age, facing: e.facing })),
      ...this.trails, ...(this.burst ? [this.burst] : [])];
  }
}
