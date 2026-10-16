import type { AttackCollisionHit, HitboxPlugin } from '../characters/attacks';
import { HITBOX_LABEL } from '../characters/attacks';
import { capsulesIntersect, posedCapsule } from '../characters/capsuleGeometry';
import { capsuleIntersectsBounds, type CollisionHurtbox } from '../characters/attackCollisionShapes';
import { computeHitlag } from '../characters/combat';
import type { HitboxOrCharacterBody } from './HitboxDamageHandler';

/** Published Ultimate direct-melee priority. Article destruction and airborne
 * projectile clanks require their own entity/status consumers. */
export function referenceClankResult(aDamage: number, bDamage: number) {
  const strongest = Math.max(aDamage, bDamage);
  return { cancelA: aDamage <= bDamage + 9, cancelB: bDamage <= aDamage + 9,
    reboundFrames: Math.min(58, Math.floor((Math.floor(strongest) + 4) * 15 / 8)) };
}

interface Region { readonly data: AttackCollisionHit | undefined; readonly shape: CollisionHurtbox; }
function intersects(a: CollisionHurtbox, b: CollisionHurtbox): boolean {
  if ('radius' in a) return 'radius' in b ? capsulesIntersect(a, b)
    : capsuleIntersectsBounds(a, { x: 0, y: 0 }, 1, b);
  if ('radius' in b) return capsuleIntersectsBounds(b, { x: 0, y: 0 }, 1, a);
  return a.min.x <= b.max.x && a.max.x >= b.min.x && a.min.y <= b.max.y && a.max.y >= b.min.y;
}
function regions(body: HitboxOrCharacterBody, plugin: HitboxPlugin): readonly Region[] {
  if (!body.position || !plugin.hitbox) return [];
  const origin = { x: body.position.x - plugin.hitbox.offsetX * plugin.facing,
    y: body.position.y - plugin.hitbox.offsetY };
  if (plugin.collisionHits?.length) return [...plugin.collisionHits].sort((a, b) => a.id - b.id)
    .map(data => ({ data, shape: posedCapsule(data.capsule, origin, plugin.facing) }));
  return body.bounds ? [{ data: undefined, shape: body.bounds }] : [];
}

export class AttackClankHandler {
  private readonly clanked = new WeakMap<object, WeakSet<object>>();
  private readonly disabled = new WeakSet<object>();
  private readonly strikeBlocks = new WeakMap<object, Set<number>>();
  private readonly frameBlocks = new WeakMap<object, Map<number, number>>();
  constructor(private readonly options: {
    frame: () => number;
    damage: (plugin: HitboxPlugin, region: AttackCollisionHit | undefined) => number;
    rebound: (ownerBodyId: number, hitlagFrames: number, reboundFrames: number) => void;
    players: () => number;
    isCurrent?: (body: HitboxOrCharacterBody, plugin: HitboxPlugin) => boolean;
  }) {}
  private identity(body: HitboxOrCharacterBody, plugin: HitboxPlugin): object { return plugin.hitGroup ?? body; }
  private execution(body: HitboxOrCharacterBody, plugin: HitboxPlugin): object { return plugin.attackInstance ?? body; }
  canHit(body: HitboxOrCharacterBody, targetBodyId: number | undefined): boolean {
    const plugin = body.plugin as HitboxPlugin | undefined;
    if (!plugin) return true;
    if (this.disabled.has(this.execution(body, plugin))) return false;
    if (targetBodyId === undefined) return true;
    const identity = this.identity(body, plugin);
    return !this.strikeBlocks.get(identity)?.has(targetBodyId)
      && this.frameBlocks.get(identity)?.get(targetBodyId) !== this.options.frame();
  }
  sampleBodies(bodies: readonly HitboxOrCharacterBody[]): void {
    const sensors = bodies.filter(body => body.label === HITBOX_LABEL).sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
    for (let i = 0; i < sensors.length; i++) for (let j = i + 1; j < sensors.length; j++) {
      const a = sensors[i]!, b = sensors[j]!;
      const pa = a.plugin as HitboxPlugin | undefined, pb = b.plugin as HitboxPlugin | undefined;
      if (!pa || !pb || pa.ownerBodyId === undefined || pb.ownerBodyId === undefined || pa.ownerBodyId === pb.ownerBodyId ||
        pa.kind === 'grab' || pb.kind === 'grab' || pa.projectile || pb.projectile ||
        pa.attackKind === 'aerial' || pb.attackKind === 'aerial' ||
        (this.options.isCurrent && (!this.options.isCurrent(a, pa) || !this.options.isCurrent(b, pb))) ||
        this.disabled.has(this.execution(a, pa)) || this.disabled.has(this.execution(b, pb))) continue;
      const ia = this.identity(a, pa), ib = this.identity(b, pb);
      if (this.clanked.get(ia)?.has(ib) || this.clanked.get(ib)?.has(ia)) continue;
      const ra = regions(a, pa), rb = regions(b, pb);
      let selected: { a: Region; b: Region } | null = null;
      for (const ha of ra) { for (const hb of rb) {
        const sa = ha.data?.setoff ?? pa.setoff, sb = hb.data?.setoff ?? pb.setoff;
        // Both absent preserves existing legacy-only matches. OFF passes
        // through attacks. Ordinary legacy opponent rows default to ON only
        // when the other move explicitly opts into source priority.
        if ((sa === undefined && sb === undefined) || sa === 'off' || sb === 'off') continue;
        if (intersects(ha.shape, hb.shape)) { selected = { a: ha, b: hb }; break; }
      } if (selected) break; }
      if (!selected) continue;
      const pair = this.clanked.get(ia) ?? new WeakSet<object>(); pair.add(ib); this.clanked.set(ia, pair);
      const da = this.options.damage(pa, selected.a.data), db = this.options.damage(pb, selected.b.data);
      const result = referenceClankResult(da, db);
      const stronger = da >= db ? { plugin: pa, row: selected.a.data, damage: da } : { plugin: pb, row: selected.b.data, damage: db };
      const resolve = (body: HitboxOrCharacterBody, plugin: HitboxPlugin, row: AttackCollisionHit | undefined,
        identity: object, opponent: number, cancelled: boolean) => {
        const frames = this.frameBlocks.get(identity) ?? new Map<number, number>();
        frames.set(opponent, this.options.frame()); this.frameBlocks.set(identity, frames);
        if (!cancelled) return;
        if ((row?.setoff ?? plugin.setoff) === 'through') {
          const blocked = this.strikeBlocks.get(identity) ?? new Set<number>(); blocked.add(opponent); this.strikeBlocks.set(identity, blocked);
          return;
        }
        this.disabled.add(this.execution(body, plugin));
        const hitlag = computeHitlag({ damage: stronger.damage, targetPercent: 0,
          multiplier: stronger.row?.hitlagMultiplier ?? stronger.plugin.hitlagMultiplier,
          electricCollision: row?.electricCollision ?? plugin.electricCollision, players: this.options.players() });
        this.options.rebound(plugin.ownerBodyId!, hitlag, result.reboundFrames);
      };
      resolve(a, pa, selected.a.data, ia, pb.ownerBodyId, result.cancelA);
      resolve(b, pb, selected.b.data, ib, pa.ownerBodyId, result.cancelB);
    }
  }
}
