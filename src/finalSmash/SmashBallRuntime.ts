import { createSmashBall, hitSmashBall, stepSmashBall, smashBallSpawnEligibility,
  smashBallSpawnChance, admitSmashBallSpawn, type SmashBallState } from './smashBall';
import type { ItemSpawnInterval } from '../items/itemSpawnSettings';
export interface BallPoint { readonly x: number; readonly y: number; }
export interface BallRankedFighter { readonly playerIndex: number; readonly score: number; readonly position: BallPoint; }
export interface BallRoamingPolicy {
  readonly acceleration: number; readonly speedCap: number; readonly waypointFrames: number;
  readonly gravity: number; readonly terminalSpeed: number; readonly radius: number;
  readonly terrainRadius: number; readonly visualRadius: number;
  readonly trailingHoverRadius: number; readonly leaderAvoidRadius: number;
}
/** Numeric roaming fields are explicit current-engine authoring. Public
 * trailing-hover/leader-avoidance and heavy falling semantics are sourced;
 * inaccessible native motion/knockback consumers are not numeric parity.
 * Heavy gravity/cap consume retained common-item-heavy.074/2.2 fields at5;
 * receiving hitsize6.5 and terrain mapcoll3.96 are separate field roles.
 * Common scale1.25 is NOT multiplied without a recovered scale consumer. */
export const BALL_ROAMING_ADAPTER: BallRoamingPolicy = Object.freeze({ acceleration: .18,
  speedCap: 3, waypointFrames: 90, gravity: .074 * 5, terminalSpeed: 2.2 * 5, radius: 6.5 * 5,
  terrainRadius: 3.96 * 5, visualRadius: 3.96 * 5,
  trailingHoverRadius: 140, leaderAvoidRadius: 180 });
export interface RoamingSmashBall { readonly resource: SmashBallState; readonly position: BallPoint;
  readonly velocity: BallPoint; readonly waypoint: BallPoint; readonly waypointAge: number; }
export interface SmashBallRuntimeSnapshot { readonly sequence: number; readonly matchStartFrame: number;
  readonly lastRemovalFrame: number | null; readonly roaming: RoamingSmashBall | null;
  readonly standby: readonly { readonly playerIndex: number; readonly resource: SmashBallState }[];
  readonly strikeReceipts: readonly string[]; }
export interface BallBounds { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number; }
export interface BallRuntimeInput { readonly frame: number; readonly bounds: BallBounds;
  readonly fighters: readonly BallRankedFighter[]; readonly heavyBottomBlastY: number; readonly floorY: (x: number, previousY: number, nextY: number) => number | null; }
function copyResource(resource: SmashBallState): SmashBallState { return Object.freeze({ ...resource }); }
function copyRoaming(ball: RoamingSmashBall): RoamingSmashBall { return Object.freeze({ ...ball,
  resource: copyResource(ball.resource), position: Object.freeze({ ...ball.position }),
  velocity: Object.freeze({ ...ball.velocity }), waypoint: Object.freeze({ ...ball.waypoint }) }); }
export class SmashBallRuntime {
  private sequence = 0;
  private lastRemovalFrame: number | null = null;
  private roaming: RoamingSmashBall | null = null;
  private standby = new Map<number, SmashBallState>();
  private strikeReceipts = new Set<string>();
  constructor(readonly matchStartFrame: number, readonly training: boolean,
    readonly policy: BallRoamingPolicy = BALL_ROAMING_ADAPTER) {}
  getRoaming(): RoamingSmashBall | null { return this.roaming; }
  hasAcceptedStrike(receipt:string):boolean{return this.strikeReceipts.has(receipt);}
  hasStandby(): boolean { return this.standby.size > 0; }
  /** Called only at the existing item timer proposal. Independent Final
   * stream supplied by Scene; disabled/ineligible proposals consume no draws. */
  propose(input: { readonly frame: number; readonly enabled: boolean; readonly finalActive: boolean;
    readonly interval: ItemSpawnInterval; readonly origin: BallPoint;
    readonly chanceRoll: () => number; readonly heavyRoll: () => number }): boolean {
    if (input.finalActive || !smashBallSpawnEligibility({ firstAttemptFrame: this.matchStartFrame,
      lastRemovalFrame: this.lastRemovalFrame }, { frame: input.frame, enabled: input.enabled,
      ballPresent: this.roaming !== null, ballStandby: this.hasStandby() })) return false;
    const chance = smashBallSpawnChance(input.frame - this.matchStartFrame - 900, input.interval);
    if (!admitSmashBallSpawn(chance, input.chanceRoll())) return false;
    const resource = createSmashBall(++this.sequence, input.heavyRoll(), this.training);
    this.roaming = copyRoaming({ resource, position: input.origin, velocity: { x: 0, y: 0 },
      waypoint: input.origin, waypointAge: this.policy.waypointFrames });
    return true;
  }
  hit(input: { readonly receipt: string; readonly attacker: number; readonly damageAfterStaleFresh: number;
    readonly scoreDifference: number }): number | null {
    if (!this.roaming || this.strikeReceipts.has(input.receipt)) return null;
    this.strikeReceipts.add(input.receipt);
    const result = hitSmashBall(this.roaming.resource, input);
    if (result.grantedPlayer !== null) {
      this.standby.set(result.grantedPlayer, copyResource(result.state));
      this.roaming = null; // valid standby retains resource; no removal lockout
    } else this.roaming = copyRoaming({ ...this.roaming, resource: result.state });
    return result.grantedPlayer;
  }
  /** Selected engine loss adapter: actual accepted hitstun contact only. The
   * caller supplies ceil(baseDamage)/70 roll once on a private Final stream.
   * Same identity/variant; source freshHP timer reset is explicitly authored. */
  dropStandby(playerIndex: number, position: BallPoint): boolean {
    const prior = this.standby.get(playerIndex); if (!prior || this.roaming) return false;
    this.standby.delete(playerIndex);
    const fresh = Object.freeze({ ...prior, hp: this.training ? 10 : 40, age: 0, decayAge: 0,
      attributedAttacker: null, retired: false });
    this.roaming = copyRoaming({ resource: fresh, position, velocity: { x: 0, y: 0 },
      waypoint: position, waypointAge: this.policy.waypointFrames });
    return true;
  }
  consumeOrRetireStandby(playerIndex: number, frame: number): void {
    if (this.standby.delete(playerIndex)) this.lastRemovalFrame = frame;
  }
  retireRoaming(frame: number): void {
    if (!this.roaming) return;
    this.roaming = null; this.lastRemovalFrame = frame;
  }
  step(input: BallRuntimeInput, waypointRoll: () => number): void {
    const prior = this.roaming; if (!prior) return;
    const resource = stepSmashBall(prior.resource, true);
    if (resource.retired) { this.retireRoaming(input.frame); return; }
    const p = this.policy, b = input.bounds;
    const clampPoint = (point: BallPoint): BallPoint => ({
      x: Math.max(b.left + p.radius, Math.min(b.right - p.radius, point.x)),
      y: Math.max(b.top + p.radius, Math.min(b.bottom - p.radius, point.y)) });
    let waypoint = prior.waypoint, waypointAge = prior.waypointAge + 1;
    let velocity = { ...prior.velocity };
    if (resource.heavy) velocity.y = Math.min(p.terminalSpeed, velocity.y + p.gravity);
    else {
      if (waypointAge >= p.waypointFrames) {
        const ranked = [...input.fighters].sort((a, c) => a.score - c.score || a.playerIndex - c.playerIndex);
        const low = ranked[0]?.score, high = ranked[ranked.length - 1]?.score;
        const ties = ranked.filter(f => f.score === low);
        const trailer = low !== high && ties.length ? ties[Math.floor(waypointRoll() * ties.length)] : undefined;
        const angle = waypointRoll() * Math.PI * 2;
        waypoint = clampPoint(trailer ? { x: trailer.position.x + Math.cos(angle) * p.trailingHoverRadius,
          y: trailer.position.y - p.trailingHoverRadius / 2 + Math.sin(angle) * p.trailingHoverRadius / 2 }
          : { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 });
        waypointAge = 0;
      }
      let dx = waypoint.x - prior.position.x, dy = waypoint.y - prior.position.y;
      const highest = Math.max(...input.fighters.map(f => f.score));
      const lowest = Math.min(...input.fighters.map(f => f.score));
      if (highest > lowest) for (const leader of input.fighters.filter(f => f.score === highest)) {
        const away = { x: prior.position.x - leader.position.x, y: prior.position.y - leader.position.y };
        const distance = Math.hypot(away.x, away.y);
        if (distance > 0 && distance < p.leaderAvoidRadius) {
          dx += away.x / distance * (p.leaderAvoidRadius - distance);
          dy += away.y / distance * (p.leaderAvoidRadius - distance);
        }
      }
      const distance = Math.hypot(dx, dy);
      if (distance > 0) { velocity.x += dx / distance * p.acceleration; velocity.y += dy / distance * p.acceleration; }
      const speed = Math.hypot(velocity.x, velocity.y);
      if (speed > p.speedCap) velocity = { x: velocity.x / speed * p.speedCap, y: velocity.y / speed * p.speedCap };
    }
    let position = { x: prior.position.x + velocity.x, y: prior.position.y + velocity.y };
    if (resource.heavy) {
      const floor = input.floorY(position.x, prior.position.y + p.terrainRadius, position.y + p.terrainRadius);
      if (floor !== null && velocity.y >= 0) { position.y = floor - p.terrainRadius; velocity.y = 0; velocity.x *= .98; }
      if (position.y > input.heavyBottomBlastY + p.radius) { position = clampPoint({ x: (b.left + b.right) / 2, y: b.top + p.radius }); velocity = { x: 0, y: 0 }; }
    } else {
      const clamped = clampPoint(position);
      if (clamped.x !== position.x) velocity.x = -velocity.x;
      if (clamped.y !== position.y) velocity.y = -velocity.y;
      position = clamped;
    }
    this.roaming = copyRoaming({ resource, position, velocity, waypoint, waypointAge });
  }
  snapshot(): SmashBallRuntimeSnapshot { return { sequence: this.sequence, matchStartFrame: this.matchStartFrame,
    lastRemovalFrame: this.lastRemovalFrame, roaming: this.roaming ? copyRoaming(this.roaming) : null,
    standby: [...this.standby.entries()].sort((a, b) => a[0] - b[0]).map(([playerIndex, resource]) => ({ playerIndex, resource: { ...resource } })),
    strikeReceipts: [...this.strikeReceipts].sort() }; }
  restore(snapshot: SmashBallRuntimeSnapshot): void {
    if (snapshot.matchStartFrame !== this.matchStartFrame) throw new Error('Ball snapshot match clock mismatch');
    this.sequence = snapshot.sequence; this.lastRemovalFrame = snapshot.lastRemovalFrame;
    this.roaming = snapshot.roaming ? copyRoaming(snapshot.roaming) : null;
    this.standby = new Map(snapshot.standby.map(p => [p.playerIndex, copyResource(p.resource)]));
    this.strikeReceipts = new Set(snapshot.strikeReceipts);
  }
}
