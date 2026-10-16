/** Link's articles (Bow arrow, Boomerang, Remote Bomb, forward smash's Sword Beam) without Phaser.
 * They ride MatchScene's generic paths: the arrow and the boomerang are
 * ordinary projectiles (contacts, reflection, drawing, checkpoints), the bomb
 * is an ordinary item (carry, throw, flight) that blows up through the generic
 * item explosion. This module owns only what is Link's own: spawning from
 * FreshLink's runtime events at the data release points (linkReleasePoint),
 * boomerang flight / return / catch, arrow terrain sticking, and the bomb's
 * remote detonation and 30 s fuse (SmashWiki: it never explodes on contact), and the Final Smash's
 * Ancient Arrow (see its section below). Values: SmashWiki Link (SSBU) — arrow 4%..12%,
 * boomerang 8/6/3% (smash 9.6/7.2/3%), bomb 1% thrown and 7% blast, Sword Beam 5%..13% (linkSwordBeam.ts). */
import type { Character } from '../characters/Character';
import type { KnockbackSpec } from '../characters/moveSchema';
import type { LinkArrowLaunchPlan } from '../characters/linkBow';
import { linkReleasePoint, type LinkArticleKind } from '../characters/linkAttackData';
import { LINK_BOOMERANG_SOURCE, linkBoomerangContact, type LinkBoomerangThrowKind } from '../characters/linkBoomerang';
import { applyLinkBoomerangTerrainContact, beginLinkBoomerangFlight, markLinkBoomerangInfliction, parseLinkBoomerangFlightState,
  redirectLinkBoomerangFlight, reflectLinkBoomerangFlight, stepLinkBoomerangFlight, type LinkBoomerangFlightState } from '../characters/linkBoomerangFlight';
import { createLinkRemoteBomb, detonateLinkRemoteBombNow, setRemoteBombHolder, stepLinkRemoteBomb,
  type LinkRemoteBombState } from '../characters/linkRemoteBomb';
import { parseLinkRemoteBombState } from '../characters/linkIntrinsicStateValidation';
import { sweptHurtboxEntry, sweptProjectileEntry } from '../characters/projectileMotion';
import type { FinalRun } from '../finalSmash/finalSmashSchema';
import { finalPacketBinding } from '../finalSmash/finalPacketBinding';
import { ancientArrowSweep, beginAncientArrow, firstAncientArrowContact, parseAncientArrowState, stepAncientArrow,
  type AncientArrowContact, type AncientArrowState } from '../finalSmash/linkAncientBow';
import { LINK_SWORD_BEAM_HIT, type LinkSwordBeamPlan } from '../characters/linkSwordBeam';

/** World px per native unit. */
const PX = 5;
interface Point { readonly x: number; readonly y: number }

export interface LinkArticleFighter {
  readonly playerIndex: number;
  readonly character: Character;
  /** Neither eliminated nor respawning. */
  readonly live: boolean;
}

export type LinkProjectileMotion =
  | { readonly kind: 'arrow'; readonly stuckLifetimeFrames: number }
  | { readonly kind: 'boomerang'; readonly state: LinkBoomerangFlightState; readonly damageScale: number;
      /** Victims of the current pass; the return pass starts a fresh list. */
      readonly returning: boolean; readonly hitTargets: readonly number[] }
  /** Straight shot, no gravity (source: initial speed and friction only); `brake` is world px per frame². */
  | { readonly kind: 'sword-beam'; readonly brake: number };

/** The generic projectile fields an article reads and writes. */
export interface LinkProjectileBody {
  x: number; y: number; vx: number; vy: number; facing: 1 | -1;
  width: number; height: number; damage: number; knockback: KnockbackSpec;
  hitlagMultiplier?: number; reflectable?: boolean; absorbable?: boolean;
  link?: LinkProjectileMotion;
}

/** A new projectile row for the generic path (its own field names). */
export interface LinkProjectileSpawn {
  readonly ownerSlotIndex: number; readonly moveId: string;
  readonly x: number; readonly y: number; readonly vx: number; readonly vy: number;
  /** World px per frame², added to vy before each move (the arrow's drop). */
  readonly gravity: number;
  readonly facing: 1 | -1; readonly width: number; readonly height: number;
  readonly damage: number; readonly knockback: KnockbackSpec;
  readonly hitlagMultiplier: number; readonly sdiMultiplier: number;
  readonly reflectable: boolean; readonly absorbable: boolean;
  readonly framesRemaining: number;
  readonly visual: 'link-arrow' | 'link-boomerang' | 'sword-beam';
  readonly link: LinkProjectileMotion;
}

/** A terrain box in world px. */
export interface LinkTerrainBox {
  readonly solid: boolean;
  readonly min: Point; readonly max: Point;
}

export interface LinkArticleHost {
  spawnProjectile(spawn: LinkProjectileSpawn): void;
  /** A new Remote Bomb item in the owner's hand at `centre`; its item id, or null when it cannot be held. */
  spawnBomb(owner: number, centre: Point): number | null;
  /** Holder of a bomb item; undefined once it has left play. */
  bombHolder(itemId: number): number | null | undefined;
  explodeBomb(itemId: number, owner: number): void;
  /** Drops the picked-up arrow a double shot fired. */
  removeHeldItem(owner: number): void;
}

const reference = (k: { angle: number; base: number; growth: number; fixed: number }): KnockbackSpec =>
  ({ x: 0, y: 0, scaling: 0, reference: { angle: k.angle, base: k.base, growth: k.growth, fixed: k.fixed } });

function releaseOrigin(actor: Character, article: LinkArticleKind, facing: 1 | -1, airborne = !actor.isGrounded()): Point {
  const body = actor.getPosition(), point = linkReleasePoint(article, airborne);
  return { x: body.x + point.x * facing, y: body.y + point.y };
}

export function linkArrowSpawn(owner: number, moveId: string, origin: Point, facing: 1 | -1, plan: LinkArrowLaunchPlan): LinkProjectileSpawn {
  const radians = plan.firingAngleDegrees * Math.PI / 180, speed = plan.speedNative * PX, size = plan.radiusNative * 2 * PX;
  return { ownerSlotIndex: owner, moveId, x: origin.x, y: origin.y, vx: Math.cos(radians) * speed * facing, vy: -Math.sin(radians) * speed,
    gravity: plan.gravityNative * PX, facing, width: size, height: size, damage: plan.damage, knockback: reference(plan.referenceKnockback),
    hitlagMultiplier: plan.hitlagMultiplier, sdiMultiplier: plan.sdiMultiplier, reflectable: plan.reflectable, absorbable: plan.absorbable,
    framesRemaining: plan.lifetimeFrames, visual: 'link-arrow', link: { kind: 'arrow', stuckLifetimeFrames: plan.stuckLifetimeFrames } };
}

/** The Sword Beam from forward smash's first swing (fired at 0%), leaving `root` (Link's model root)
 * at the source offset. Its damage box is the source capsule, scaled with the beam. */
export function linkSwordBeamSpawn(owner: number, moveId: string, root: Point, facing: 1 | -1, plan: LinkSwordBeamPlan): LinkProjectileSpawn {
  const c = plan.capsule, hit = LINK_SWORD_BEAM_HIT;
  return { ownerSlotIndex: owner, moveId, x: root.x + plan.rootOffset.x * facing, y: root.y + plan.rootOffset.y + c.start.y * plan.scale,
    vx: plan.speedNative * PX * facing, vy: 0, gravity: 0, facing,
    width: (Math.abs(c.end.x - c.start.x) + 2 * c.radius) * plan.scale, height: 2 * c.radius * plan.scale,
    damage: plan.damage, knockback: reference(hit), hitlagMultiplier: hit.hitlag, sdiMultiplier: hit.sdi,
    reflectable: hit.reflectable, absorbable: hit.absorbable, framesRemaining: plan.life,
    visual: 'sword-beam', link: { kind: 'sword-beam', brake: plan.brakeNative * PX } };
}

/** Velocity change of a Link article on the generic straight-line path, before it moves: the beam's friction. */
export function brakeLinkProjectile(p: LinkProjectileBody): void {
  if (p.link?.kind !== 'sword-beam') return;
  const speed = Math.hypot(p.vx, p.vy);
  if (speed === 0) return;
  const scale = Math.max(0, speed - p.link.brake) / speed;
  p.vx *= scale; p.vy *= scale;
}

function boomerangPacket(phase: 'clean' | 'late' | 'return', throwKind: LinkBoomerangThrowKind, damageScale: number) {
  const packet = linkBoomerangContact(phase, throwKind);
  return { damage: packet.damage * damageScale, knockback: reference(packet.referenceKnockback),
    hitlagMultiplier: packet.hitlagMultiplier, size: packet.radiusNative * 2 * PX };
}

export function linkBoomerangSpawn(state: LinkBoomerangFlightState, moveId: string, facing: 1 | -1): LinkProjectileSpawn {
  const packet = boomerangPacket('clean', state.throwKind, 1), clean = linkBoomerangContact('clean', state.throwKind);
  return { ownerSlotIndex: state.originalOwnerIndex, moveId, x: state.position.x, y: state.position.y, vx: state.velocity.x, vy: state.velocity.y,
    gravity: 0, facing, width: packet.size, height: packet.size, damage: packet.damage, knockback: packet.knockback,
    hitlagMultiplier: packet.hitlagMultiplier, sdiMultiplier: clean.sdiMultiplier, reflectable: clean.reflectable, absorbable: clean.absorbable,
    // The flight state owns the lifetime (it retires itself).
    framesRemaining: Number.POSITIVE_INFINITY, visual: 'link-boomerang', link: { kind: 'boomerang', state, damageScale: 1, returning: false, hitTargets: [] } };
}

/** One fixed step of a boomerang riding the generic projectile path: its own
 * flight, return toward the owner and catch. False once it has left play. */
export function advanceLinkBoomerang(p: LinkProjectileBody, owner: LinkArticleFighter | undefined, frame: number): boolean {
  const motion = p.link;
  if (motion?.kind !== 'boomerang') throw new Error('advanceLinkBoomerang requires a Link boomerang');
  const before = motion.state, actor = owner?.character;
  const linked = !!actor && owner!.live && actor.getPositionResetGeneration() === before.originalOwnerGeneration;
  // The return homes on and is caught at the owner's body centre (data, not a drawn socket).
  const step = stepLinkBoomerangFlight(before, { frame, clockAdvances: true, teardown: !linked,
    owner: linked ? { linked: true, sameTeamOwner: true, waist: actor!.getPosition(), sourceRootY: actor!.getSourceRootPosition().y,
      eventAccepted: true, mayPlayCatch: actor!.canAttack() && actor!.getActiveAttack() === null } : null });
  for (const event of step.events) if (event.kind === 'catch' && event.playPresentation) actor?.notifyLinkBoomerangCatch();
  if (step.state.phase === 'retired' || !step.sweep?.contactPhase) return false;
  const returning = step.sweep.contactPhase === 'return';
  const packet = boomerangPacket(step.sweep.contactPhase, before.throwKind, motion.damageScale);
  p.link = { ...motion, state: step.state, returning, hitTargets: returning !== motion.returning ? [] : motion.hitTargets };
  p.x = step.state.position.x; p.y = step.state.position.y;
  p.vx = step.state.velocity.x; p.vy = step.state.velocity.y;
  if (p.vx !== 0) p.facing = p.vx < 0 ? -1 : 1;
  p.damage = packet.damage; p.knockback = packet.knockback; p.hitlagMultiplier = packet.hitlagMultiplier;
  p.width = p.height = packet.size;
  return true;
}

/** A confirmed hit: the boomerang turns back and spares this victim for the
 * rest of the pass; an arrow leaves play (generic). */
export function linkProjectileHit(p: LinkProjectileBody, victim: number): boolean {
  const motion = p.link;
  if (motion?.kind !== 'boomerang') return false;
  p.link = { ...motion, state: markLinkBoomerangInfliction(motion.state), hitTargets: [...motion.hitTargets, victim] };
  return true;
}

export function linkProjectileSpares(p: LinkProjectileBody, victim: number): boolean {
  return p.link?.kind === 'boomerang' && p.link.hitTargets.includes(victim);
}

/** After the generic reflection flipped velocity and owner. */
export function reflectLinkProjectile(p: LinkProjectileBody, ownerIndex: number, damageScale: number): void {
  const motion = p.link;
  if (motion?.kind !== 'boomerang') return;
  p.link = { ...motion, damageScale: motion.damageScale * damageScale, hitTargets: [],
    state: reflectLinkBoomerangFlight(motion.state, ownerIndex, { x: p.vx, y: p.vy }) };
}

/** Link's article sheets in assets/characters/link/frames.json, by projectile visual. */
export const LINK_ARTICLE_SHEETS = { 'link-arrow': 'fx__link_bowarrow', 'link-boomerang': 'fx__link_boomerang' } as const;
/** Rotation of an article drawing, degrees: an arrow points along its flight; the boomerang's spin is its drawing. */
export function linkProjectileAngle(p: LinkProjectileBody): number {
  return p.link?.kind === 'boomerang' ? 0 : Math.atan2(p.vy, p.vx) * 180 / Math.PI;
}
/** The article sheet drawing to show. The boomerang sheet's drawing k is the model spun 360k/count degrees
 * (clockwise facing right; the renderer mirrors a left throw), at the source spin speed (22 or 26 degrees per frame
 * since release); other articles have one drawing. */
export function linkArticleDrawing(p: LinkProjectileBody, count: number): number {
  const motion = p.link;
  if (motion?.kind !== 'boomerang' || count < 1) return 0;
  const spin = motion.state.releaseAge * LINK_BOOMERANG_SOURCE.rotationDegrees[motion.state.throwKind];
  return Math.floor((((spin % 360) + 360) % 360) * count / 360) % count;
}

export type LinkTerrainSurface = 'floor' | 'ceiling' | 'wall';
/** First terrain contact along this step's travel (fraction of it), for Link articles only. */
export function linkProjectileTerrainContact(p: LinkProjectileBody, from: Point, terrain: readonly LinkTerrainBox[]):
  { readonly fraction: number; readonly surface: LinkTerrainSurface } | null {
  const motion = p.link;
  if (!motion) return null;
  if (motion.kind === 'boomerang' && motion.state.phase !== 'fly' && !(motion.state.phase === 'turn' && motion.state.terrainCorrection === 'air'))
    return null;
  // The boomerang probes terrain with a point (native map offset); the arrow and the beam with their attack box.
  const size = motion.kind !== 'boomerang' ? { width: p.width, height: p.height } : { width: 0, height: 0 };
  let first: { fraction: number; surface: LinkTerrainSurface } | null = null;
  for (const box of terrain) {
    const descendsOnto = from.y <= box.min.y + .5 && p.y > from.y, risesInto = from.y >= box.max.y - .5 && p.y < from.y;
    let fraction: number | null;
    if (!box.solid) {
      // Pass-through floors only catch the boomerang descending onto them; arrows and beams fly through.
      if (motion.kind !== 'boomerang' || !descendsOnto || p.y < box.min.y) continue;
      fraction = (box.min.y - from.y) / (p.y - from.y);
      const x = from.x + (p.x - from.x) * fraction;
      if (x < box.min.x || x > box.max.x) continue;
    } else {
      // Travel leaving a surface it already touches is not a new contact.
      if (from.y <= box.min.y + .5 && p.y < from.y || from.y >= box.max.y - .5 && p.y > from.y ||
        from.x <= box.min.x + .5 && p.x < from.x || from.x >= box.max.x - .5 && p.x > from.x) continue;
      fraction = sweptProjectileEntry(from, p, { x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2,
        width: box.max.x - box.min.x, height: box.max.y - box.min.y }, size);
    }
    if (fraction !== null && (first === null || fraction < first.fraction))
      first = { fraction, surface: descendsOnto ? 'floor' : risesInto ? 'ceiling' : 'wall' };
  }
  return first;
}

/** Terrain response at `at`: an arrow sticks (it leaves flight and becomes a
 * pickup arrow item for `stuckLifetimeFrames`), a boomerang bounces, the
 * Sword Beam collides like any world object and vanishes. */
export function linkProjectileTerrain(p: LinkProjectileBody, at: Point, surface: LinkTerrainSurface):
  { readonly retire: boolean; readonly arrowItem?: { readonly at: Point; readonly lifetimeFrames: number } } {
  const motion = p.link;
  if (motion?.kind === 'arrow') return { retire: true, arrowItem: { at, lifetimeFrames: motion.stuckLifetimeFrames } };
  if (motion?.kind === 'sword-beam') return { retire: true };
  if (motion?.kind !== 'boomerang') return { retire: false };
  const side = surface === 'wall';
  const control = applyLinkBoomerangTerrainContact(motion.state, { side, vertical: !side, statusChanging: false });
  let state = control.state;
  if (control.notifyTerrain) {
    const v = state.velocity, speed = Math.hypot(v.x, v.y), angle = Math.max(16 * Math.PI / 180, Math.atan2(Math.abs(v.y), Math.abs(v.x)));
    const velocity = surface === 'floor' ? { x: Math.sign(v.x) * Math.cos(angle) * speed, y: -Math.sin(angle) * speed }
      : surface === 'ceiling' ? { x: v.x, y: Math.abs(v.y) } : { x: -v.x, y: v.y };
    state = redirectLinkBoomerangFlight({ ...state, position: at }, velocity);
    p.x = at.x; p.y = at.y; p.vx = velocity.x; p.vy = velocity.y;
  }
  p.link = { ...motion, state };
  return { retire: false };
}

// ---- Final Smash: the Ancient Arrow (SmashWiki "Ancient Bow and Arrow", "Link (SSBU)/Final Smash") ----

/** One Final run's arrow. `bornFrame`: it leaves the bow on that step and starts flying on the next. */
export interface LinkAncientArrow {
  readonly run: FinalRun;
  readonly bornFrame: number;
  readonly state: AncientArrowState;
}
export type LinkAncientArrowLabel = 'ancient-flight' | 'ancient-fighter' | 'ancient-terrain';
/** Applies an Ancient Arrow explosion to `target` through the Final hit path; true when it landed. */
export type LinkAncientArrowHit = (run: FinalRun, target: number, label: 'ancient-fighter' | 'ancient-terrain', damageMultiplier: number) => boolean;

const ancientPackets = new Map<LinkAncientArrowLabel, { readonly offset: Point; readonly radius: number }>();
/** World damage circle of an Ancient Arrow packet: the source `top` bone (the arrow's model origin),
 * native z forward and y up, at the article scale. SmashWiki: Flying r 5 at z 4; Explosions r 25 at 0. */
export function linkAncientArrowPacket(label: LinkAncientArrowLabel): { readonly offset: Point; readonly radius: number } {
  let packet = ancientPackets.get(label);
  if (!packet) {
    const bound = finalPacketBinding('link', 'final', label, 0);
    if (!bound || bound.native.bone !== 'top') throw new Error(`Missing Ancient Arrow packet ${label}`);
    const g = bound.native.geometry;
    packet = Object.freeze({ offset: { x: g.start.z * PX, y: -g.start.y * PX }, radius: g.radius * PX });
    ancientPackets.set(label, packet);
  }
  return packet;
}

/** Where the arrow's damage circle is now (flying hitbox, or the explosion once it has struck), facing applied. */
export function linkAncientArrowDamageArea(state: AncientArrowState): { readonly x: number; readonly y: number; readonly radius: number } {
  const packet = linkAncientArrowPacket(state.phase === 'fly' ? 'ancient-flight' : state.phase === 'fighter-blast' ? 'ancient-fighter' : 'ancient-terrain');
  return { x: state.x + packet.offset.x * state.facing, y: state.y + packet.offset.y, radius: packet.radius };
}

export interface LinkArticlesSnapshot {
  readonly nextBoomerangId: number;
  readonly bombs: readonly LinkRemoteBombState[];
  readonly ancientArrows: readonly LinkAncientArrow[];
}

/** Spawning from runtime events, the Remote Bombs' own lifecycle and the Final Smash's Ancient Arrow. */
export class LinkArticles {
  private bombs = new Map<number, LinkRemoteBombState>();
  private nextBoomerangId = 0;
  private ancient: LinkAncientArrow[] = [];

  reset(): void { this.bombs.clear(); this.nextBoomerangId = 0; this.ancient = []; }

  /** Live Ancient Arrows, for drawing. */
  ancientArrows(): readonly LinkAncientArrow[] { return this.ancient; }

  /** The Final's shoot callback (native frame 60): the arrow leaves the bow hand (data release point of
   * `link.final` / `link.final_air`, not a drawn socket), so it fires whether or not a pose is drawn. */
  shootAncientArrow(run: FinalRun, owner: LinkArticleFighter, frame: number): void {
    const actor = owner.character, control = actor.getFinalSmashControl();
    if (!owner.live || actor.getPositionResetGeneration() !== run.owner.generation || control?.runId !== run.id ||
      control.role !== 'owner' || this.ancient.some(arrow => arrow.run.id === run.id)) return;
    const origin = releaseOrigin(actor, 'ancientArrow', control.facing, control.sheet === 'final_air');
    this.ancient.push({ run: structuredClone(run), bornFrame: frame, state: beginAncientArrow(origin, control.facing) });
  }

  /** A Final that did not complete takes its arrow with it. */
  cancelAncientArrow(runId: number): void { this.ancient = this.ancient.filter(arrow => arrow.run.id !== runId); }

  /** One fixed step, after physics: the arrow flies straight (no gravity: native Fly sets only speed_x), its
   * flying hitbox stops at the first fighter (fighters only, unblockable) or solid terrain, and the explosion
   * strikes every fighter it overlaps once, on the frame it appears. */
  stepAncientArrows(fighters: readonly LinkArticleFighter[], terrain: readonly LinkTerrainBox[], hit: LinkAncientArrowHit, frame: number): void {
    const next: LinkAncientArrow[] = [];
    for (const arrow of this.ancient) {
      const owner = fighters.find(f => f.playerIndex === arrow.run.owner.playerIndex);
      if (!owner?.live || owner.character.getPositionResetGeneration() !== arrow.run.owner.generation) continue;
      if (frame === arrow.bornFrame) { next.push(arrow); continue; }
      const contact = this.ancientArrowContact(arrow, fighters, terrain);
      const state = stepAncientArrow(arrow.state, contact, PX);
      if (!state) continue;
      next.push({ ...arrow, state });
      if (state.phase === 'fly' || arrow.state.phase !== 'fly') continue;
      const label = state.phase === 'fighter-blast' ? 'ancient-fighter' : 'ancient-terrain', blast = linkAncientArrowDamageArea(state);
      for (const target of fighters) {
        if (target.playerIndex === arrow.run.owner.playerIndex || !target.live) continue;
        const c = target.character, overlap = sweptHurtboxEntry(c.getActiveHurtboxes(), c.getPosition(), c.getFacing(), blast, blast, blast.radius);
        if (overlap) hit(arrow.run, target.playerIndex, label, overlap.damageMultiplier);
      }
    }
    this.ancient = next;
  }

  private ancientArrowContact(arrow: LinkAncientArrow, fighters: readonly LinkArticleFighter[], terrain: readonly LinkTerrainBox[]): AncientArrowContact | null {
    const sweep = ancientArrowSweep(arrow.state, PX);
    if (!sweep) return null;
    const flight = linkAncientArrowPacket('ancient-flight'), facing = arrow.state.facing;
    const from = { x: sweep.from.x + flight.offset.x * facing, y: sweep.from.y + flight.offset.y };
    const to = { x: sweep.to.x + flight.offset.x * facing, y: sweep.to.y + flight.offset.y };
    const contacts: AncientArrowContact[] = [];
    for (const target of fighters) {
      if (target.playerIndex === arrow.run.owner.playerIndex || !target.live) continue;
      const c = target.character, entry = sweptHurtboxEntry(c.getActiveHurtboxes(), c.getPosition(), c.getFacing(), from, to, flight.radius);
      if (entry) contacts.push({ kind: 'fighter', fraction: entry.fraction });
    }
    // Pass-through floors are not walls: the arrow flies over and under them.
    for (const box of terrain) {
      if (!box.solid) continue;
      const fraction = sweptProjectileEntry(from, to, { x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2,
        width: box.max.x - box.min.x, height: box.max.y - box.min.y }, { width: 2 * flight.radius, height: 2 * flight.radius });
      if (fraction !== null) contacts.push({ kind: 'terrain', fraction });
    }
    return firstAncientArrowContact(contacts);
  }

  /** Drains every fighter's queued special callbacks once, after physics. */
  commit(fighters: readonly LinkArticleFighter[], host: LinkArticleHost): void {
    for (const fighter of fighters) for (const callback of fighter.character.consumeLinkRuntimeEvents()) {
      const actor = fighter.character, event = callback.event, owner = fighter.playerIndex;
      if (!fighter.live || callback.generation !== actor.getPositionResetGeneration()) continue;
      if (event.kind === 'arrow') {
        host.spawnProjectile(linkArrowSpawn(owner, callback.moveId, releaseOrigin(actor, 'arrow', callback.facing), callback.facing, event.plan));
      } else if (event.kind === 'sword-beam') {
        host.spawnProjectile(linkSwordBeamSpawn(owner, callback.moveId, actor.getSourceRootPosition(), callback.facing, event.plan));
      } else if (event.kind === 'consume-picked-arrow') {
        host.removeHeldItem(owner);
      } else if (event.kind === 'boomerang') {
        const state = beginLinkBoomerangFlight({ id: this.nextBoomerangId++, originalOwnerIndex: owner, originalOwnerGeneration: callback.generation,
          origin: releaseOrigin(actor, 'boomerang', callback.facing), facing: callback.facing, angleDegrees: event.angleDegrees ?? 0,
          throwKind: event.throwKind, pixelsPerNativeUnit: PX });
        host.spawnProjectile(linkBoomerangSpawn(state, callback.moveId, callback.facing));
      } else if (event.kind === 'generate-bomb') {
        if (this.ownedBomb(owner)) continue;
        const id = host.spawnBomb(owner, releaseOrigin(actor, 'bomb', callback.facing));
        if (id !== null) this.bombs.set(id, createLinkRemoteBomb(id, owner));
      } else if (event.kind === 'detonate-bomb') {
        const bomb = this.ownedBomb(owner), holder = bomb ? host.bombHolder(bomb.itemId) : undefined;
        if (!bomb || holder === undefined) continue;
        if (detonateLinkRemoteBombNow(setRemoteBombHolder(bomb, holder), owner).explode) this.explode(bomb, host);
      }
    }
  }

  /** Bomb fuse and holder, once per fixed step. */
  step(host: LinkArticleHost): void {
    for (const bomb of [...this.bombs.values()]) {
      const holder = host.bombHolder(bomb.itemId);
      if (holder === undefined) { this.bombs.delete(bomb.itemId); continue; }
      const stepped = stepLinkRemoteBomb(setRemoteBombHolder(bomb, holder), true);
      if (stepped.explode) this.explode(bomb, host); else this.bombs.set(bomb.itemId, stepped.state);
    }
  }

  /** Each fighter learns whether its bomb (Down Special then detonates it) and
   * its boomerang (Side Special then fails) are out. */
  syncOwners(fighters: readonly LinkArticleFighter[], projectiles: readonly { readonly link?: LinkProjectileMotion }[]): void {
    for (const fighter of fighters) {
      fighter.character.setLinkRemoteBombState(this.ownedBomb(fighter.playerIndex) ?? null);
      fighter.character.setLinkBoomerangPresent(projectiles.some(p =>
        p.link?.kind === 'boomerang' && p.link.state.originalOwnerIndex === fighter.playerIndex));
    }
  }

  snapshot(): LinkArticlesSnapshot {
    return { nextBoomerangId: this.nextBoomerangId, bombs: [...this.bombs.values()].map(bomb => ({ ...bomb })),
      ancientArrows: structuredClone(this.ancient) };
  }

  restore(snapshot: LinkArticlesSnapshot): void {
    if (!Number.isSafeInteger(snapshot.nextBoomerangId) || snapshot.nextBoomerangId < 0 || !Array.isArray(snapshot.bombs) ||
      !Array.isArray(snapshot.ancientArrows))
      throw new TypeError('Malformed Link article checkpoint');
    const bombs = snapshot.bombs.map(row => parseLinkRemoteBombState(row)!);
    if (bombs.some(bomb => !bomb) || new Set(bombs.map(bomb => bomb.itemId)).size !== bombs.length)
      throw new TypeError('Malformed Link bomb checkpoint');
    const ancient = snapshot.ancientArrows.map(row => {
      if (!row || row.run?.owner?.fighter !== 'link' || !Number.isSafeInteger(row.run.id) || !Number.isSafeInteger(row.bornFrame) || row.bornFrame < 0)
        throw new TypeError('Malformed Ancient Arrow checkpoint');
      return { run: structuredClone(row.run), bornFrame: row.bornFrame, state: parseAncientArrowState(row.state) };
    });
    if (new Set(ancient.map(arrow => arrow.run.id)).size !== ancient.length) throw new TypeError('Duplicate Ancient Arrow checkpoint');
    this.bombs = new Map(bombs.map(bomb => [bomb.itemId, bomb]));
    this.nextBoomerangId = snapshot.nextBoomerangId;
    this.ancient = ancient;
  }

  private ownedBomb(owner: number): LinkRemoteBombState | undefined {
    return [...this.bombs.values()].find(bomb => bomb.ownerIndex === owner);
  }

  private explode(bomb: LinkRemoteBombState, host: LinkArticleHost): void {
    this.bombs.delete(bomb.itemId);
    host.explodeBomb(bomb.itemId, bomb.ownerIndex);
  }
}

/** Generic projectile checkpoint field for a Link article. */
export function parseLinkProjectileMotion(value: unknown, path: string): LinkProjectileMotion {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${path} must be object`);
  const row = value as Record<string, unknown>;
  if (row.kind === 'arrow') {
    if (Object.keys(row).length !== 2 || !Number.isSafeInteger(row.stuckLifetimeFrames) || (row.stuckLifetimeFrames as number) < 1)
      throw new TypeError(`${path} malformed arrow`);
    return { kind: 'arrow', stuckLifetimeFrames: row.stuckLifetimeFrames as number };
  }
  if (row.kind === 'sword-beam') {
    if (Object.keys(row).length !== 2 || typeof row.brake !== 'number' || !Number.isFinite(row.brake) || row.brake < 0)
      throw new TypeError(`${path} malformed sword beam`);
    return { kind: 'sword-beam', brake: row.brake };
  }
  if (row.kind !== 'boomerang' || Object.keys(row).length !== 5 || typeof row.returning !== 'boolean' || typeof row.damageScale !== 'number' || !Number.isFinite(row.damageScale) ||
    row.damageScale < 0 || !Array.isArray(row.hitTargets) || row.hitTargets.some(i => !Number.isSafeInteger(i) || i < 0))
    throw new TypeError(`${path} malformed boomerang`);
  return { kind: 'boomerang', state: parseLinkBoomerangFlightState(row.state), damageScale: row.damageScale, returning: row.returning,
    hitTargets: [...row.hitTargets as number[]] };
}
