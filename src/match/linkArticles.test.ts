import { describe, expect, it } from 'vitest';
import type { Character } from '../characters/Character';
import type { LinkRuntimeEvent } from '../characters/FreshLink';
import { linkReleasePoint } from '../characters/linkAttackData';
import { selectLinkBowVolley } from '../characters/linkBow';
import type { LinkRemoteBombState } from '../characters/linkRemoteBomb';
import { linkSwordBeamPlan } from '../characters/linkSwordBeam';
import { LinkArticles, advanceLinkBoomerang, brakeLinkProjectile, linkArticleDrawing, linkProjectileAngle, linkProjectileHit, linkProjectileSpares, linkProjectileTerrain, linkProjectileTerrainContact,
  parseLinkProjectileMotion, type LinkArticleHost, type LinkProjectileBody, type LinkProjectileSpawn } from './linkArticles';

/** A fighter double with only what the article runtime reads. */
function fighter(over: { grounded?: boolean; x?: number; y?: number } = {}) {
  const events: LinkRuntimeEvent[] = [];
  const state = { bomb: null as LinkRemoteBombState | null, boomerang: false, caught: 0, x: over.x ?? 0, y: over.y ?? 0 };
  const character = {
    consumeLinkRuntimeEvents: () => events.splice(0), getPositionResetGeneration: () => 0,
    getPosition: () => ({ x: state.x, y: state.y }), getSourceRootPosition: () => ({ x: state.x, y: state.y + 36 }),
    isGrounded: () => over.grounded ?? true, canAttack: () => true, getActiveAttack: () => null,
    notifyLinkBoomerangCatch: () => { state.caught++; return true; },
    setLinkRemoteBombState: (bomb: LinkRemoteBombState | null) => { state.bomb = bomb; },
    setLinkBoomerangPresent: (present: boolean) => { state.boomerang = present; },
  } as unknown as Character;
  const push = (event: LinkRuntimeEvent['event'], facing: 1 | -1 = 1) =>
    events.push({ frame: 0, generation: 0, facing, actionId: 'a', moveId: 'link.special', event });
  return { entry: { playerIndex: 0, character, live: true }, push, state };
}
function host() {
  const log = { projectiles: [] as LinkProjectileSpawn[], bombs: [] as { owner: number; centre: { x: number; y: number } }[],
    exploded: [] as number[], holder: new Map<number, number | null>(), removed: 0 };
  const h: LinkArticleHost = {
    spawnProjectile: spawn => { log.projectiles.push(spawn); },
    spawnBomb: (owner, centre) => { log.bombs.push({ owner, centre }); log.holder.set(7, owner); return 7; },
    bombHolder: id => log.holder.has(id) ? log.holder.get(id)! : undefined,
    explodeBomb: id => { log.exploded.push(id); log.holder.delete(id); },
    removeHeldItem: () => { log.removed++; },
  };
  return { h, log };
}
const body = (spawn: LinkProjectileSpawn): LinkProjectileBody => ({ ...spawn });

describe('Link articles spawn at their data release points', () => {
  it('fires the arrow from the Bow pull point with SmashWiki damage by charge (4% to 12%)', () => {
    for (const grounded of [true, false]) {
      const f = fighter({ grounded, x: 100, y: 200 }), { h, log } = host(), articles = new LinkArticles();
      f.push({ kind: 'arrow', plan: selectLinkBowVolley(0, false)[0]! }, -1);
      f.push({ kind: 'arrow', plan: selectLinkBowVolley(36, false)[0]! }, -1);
      articles.commit([f.entry], h);
      const point = linkReleasePoint('arrow', !grounded);
      expect(log.projectiles.map(p => [p.x, p.y])).toEqual([[100 - point.x, 200 + point.y], [100 - point.x, 200 + point.y]]);
      expect(log.projectiles.map(p => p.damage)).toEqual([4, 12]);
      expect(log.projectiles[0]!.vx).toBeCloseTo(-2.6 * 5 * Math.cos(2.5 * Math.PI / 180));
      expect(log.projectiles[1]!.vx).toBeCloseTo(-10 * 5 * Math.cos(2.5 * Math.PI / 180));
      expect(log.projectiles[0]!.gravity).toBeCloseTo(.054 * 5);
    }
  });
  it('a picked-up arrow fires a double volley (two 3% arrows uncharged) and is used up', () => {
    const f = fighter(), { h, log } = host(), articles = new LinkArticles();
    for (const plan of selectLinkBowVolley(0, true)) f.push({ kind: 'arrow', plan });
    f.push({ kind: 'consume-picked-arrow' });
    articles.commit([f.entry], h);
    expect(log.projectiles.map(p => p.damage)).toEqual([3, 3]);
    expect(log.removed).toBe(1);
  });
});

describe('Link boomerang flight on the generic projectile path', () => {
  it('flies out, turns, returns 8% -> 6% -> 3% and is caught by Link', () => {
    const f = fighter(), { h, log } = host(), articles = new LinkArticles();
    f.push({ kind: 'boomerang', throwKind: 'tilt', angleDegrees: 0 });
    articles.commit([f.entry], h);
    const spawn = log.projectiles[0]!, point = linkReleasePoint('boomerang', false);
    expect([spawn.x, spawn.y, spawn.damage]).toEqual([point.x, point.y, 8]);
    articles.syncOwners([f.entry], [spawn]);
    expect(f.state.boomerang).toBe(true);
    const p = body(spawn), damage: number[] = [];
    let maxX = 0, frame = 1;
    while (advanceLinkBoomerang(p, f.entry, frame++)) { damage.push(p.damage); maxX = Math.max(maxX, p.x); if (frame > 400) break; }
    expect(f.state.caught).toBe(1);
    expect([...new Set(damage)]).toEqual([8, 6, 3]);
    expect(damage.indexOf(6)).toBe(10);
    expect(maxX).toBeGreaterThan(200);
  });
  it('spins through its 16 sheet drawings at 22 degrees per frame (not a rotated drawing); an arrow turns with its flight', () => {
    const f = fighter(), { h, log } = host(), articles = new LinkArticles();
    f.push({ kind: 'boomerang', throwKind: 'tilt', angleDegrees: 0 });
    f.push({ kind: 'arrow', plan: selectLinkBowVolley(0, false)[0]! });
    articles.commit([f.entry], h);
    const boomerang = body(log.projectiles.find(p => p.visual === 'link-boomerang')!);
    const arrow = body(log.projectiles.find(p => p.visual === 'link-arrow')!);
    expect(linkArticleDrawing(boomerang, 16)).toBe(0);
    const drawings: number[] = [];
    for (let frame = 1; frame <= 3; frame++) { advanceLinkBoomerang(boomerang, f.entry, frame); drawings.push(linkArticleDrawing(boomerang, 16)); }
    // Release ages 1..3 → 22°, 44°, 66° → drawings 0, 1, 2 of 22.5° each.
    expect(drawings).toEqual([0, 1, 2]);
    expect(linkProjectileAngle(boomerang)).toBe(0);
    expect(linkArticleDrawing(arrow, 1)).toBe(0);
    expect(linkProjectileAngle(arrow)).toBeCloseTo(Math.atan2(arrow.vy, arrow.vx) * 180 / Math.PI);
  });
  it('a hit turns it back and spares that victim until the return pass', () => {
    const f = fighter(), { h, log } = host(), articles = new LinkArticles();
    f.push({ kind: 'boomerang', throwKind: 'smash', angleDegrees: 0 });
    articles.commit([f.entry], h);
    const p = body(log.projectiles[0]!);
    expect(p.damage).toBeCloseTo(9.6);
    advanceLinkBoomerang(p, f.entry, 1);
    expect(linkProjectileHit(p, 1)).toBe(true);
    expect(linkProjectileSpares(p, 1)).toBe(true);
    advanceLinkBoomerang(p, f.entry, 2);
    expect(p.damage).toBe(3);
    expect(linkProjectileSpares(p, 1)).toBe(false);
    expect(p.vx).toBeLessThan(0);
  });
  it('bounces off a wall instead of passing through', () => {
    const f = fighter(), { h, log } = host(), articles = new LinkArticles();
    f.push({ kind: 'boomerang', throwKind: 'tilt', angleDegrees: 0 });
    articles.commit([f.entry], h);
    const p = body(log.projectiles[0]!), from = { x: p.x, y: p.y };
    advanceLinkBoomerang(p, f.entry, 1);
    const wall = [{ solid: true, min: { x: from.x + 5, y: -500 }, max: { x: from.x + 100, y: 500 } }];
    const contact = linkProjectileTerrainContact(p, from, wall)!;
    expect(contact.surface).toBe('wall');
    expect(linkProjectileTerrain(p, { x: from.x + 5, y: p.y }, contact.surface).retire).toBe(false);
    expect(p.vx).toBeLessThan(0);
  });
});

describe('Link Sword Beam on the generic projectile path', () => {
  // SmashWiki Link_(SSBU)/Forward_smash/Hit_1: offsets 11, 6; lifetime 32-40; damage 5 + 8*charge/60;
  // size 0.8-1.1; speed 2.4-3.4; friction 0.01; 361 deg, BKB 45, KBS 15; capsule r1.8 from -7 to 7.
  it('fires from the model root offset with the SmashWiki values, uncharged and fully charged', () => {
    for (const facing of [1, -1] as const) {
      const f = fighter({ x: 100, y: 200 }), { h, log } = host(), articles = new LinkArticles();
      f.push({ kind: 'sword-beam', plan: linkSwordBeamPlan(0) }, facing);
      f.push({ kind: 'sword-beam', plan: linkSwordBeamPlan(60) }, facing);
      articles.commit([f.entry], h);
      const [low, full] = log.projectiles;
      expect([low!.x, low!.y]).toEqual([100 + 55 * facing, 236 - 30 - 2.5 * .8]);
      expect([low!.damage, full!.damage]).toEqual([5, 13]);
      expect([low!.framesRemaining, full!.framesRemaining]).toEqual([32, 40]);
      expect(low!.vx).toBeCloseTo(2.4 * 5 * facing);
      expect(full!.vx).toBeCloseTo(3.4 * 5 * facing);
      expect([low!.vy, low!.gravity]).toEqual([0, 0]);
      expect(low!.width).toBeCloseTo((14 + 3.6) * 5 * .8);
      expect(full!.height).toBeCloseTo(3.6 * 5 * 1.1);
      expect(low!.knockback.reference).toEqual({ angle: 361, base: 45, growth: 15, fixed: 0 });
      expect([low!.hitlagMultiplier, low!.sdiMultiplier, low!.reflectable, low!.absorbable]).toEqual([1, 1, true, true]);
      expect(low!.visual).toBe('sword-beam');
    }
  });
  it('slows by its friction each step, leaves play on a hit and vanishes against solid terrain', () => {
    const f = fighter(), { h, log } = host(), articles = new LinkArticles();
    f.push({ kind: 'sword-beam', plan: linkSwordBeamPlan(0) });
    articles.commit([f.entry], h);
    const p = body(log.projectiles[0]!);
    brakeLinkProjectile(p);
    expect(p.vx).toBeCloseTo((2.4 - .01) * 5);
    expect(linkProjectileHit(p, 1)).toBe(false);
    const from = { x: p.x, y: p.y };
    p.x += p.vx;
    const wall = { solid: true, min: { x: from.x + p.width / 2 + 2, y: -500 }, max: { x: from.x + 400, y: 500 } };
    expect(linkProjectileTerrainContact(p, from, [{ ...wall, solid: false }])).toBeNull();
    const contact = linkProjectileTerrainContact(p, from, [wall])!;
    expect(contact.surface).toBe('wall');
    expect(linkProjectileTerrain(p, from, contact.surface)).toEqual({ retire: true });
  });
  it('round-trips its projectile checkpoint field', () => {
    const f = fighter(), { h, log } = host(), articles = new LinkArticles();
    f.push({ kind: 'sword-beam', plan: linkSwordBeamPlan(30) });
    articles.commit([f.entry], h);
    const motion = JSON.parse(JSON.stringify(log.projectiles[0]!.link));
    expect(parseLinkProjectileMotion(motion, 'link')).toEqual(motion);
    expect(() => parseLinkProjectileMotion({ ...motion, brake: -1 }, 'link')).toThrow();
  });
});

describe('Link arrows stick in solid ground as pickup arrows', () => {
  it('sticks on a floor but flies through a pass-through platform', () => {
    const f = fighter(), { h, log } = host(), articles = new LinkArticles();
    f.push({ kind: 'arrow', plan: selectLinkBowVolley(0, false)[0]! });
    articles.commit([f.entry], h);
    const p = body(log.projectiles[0]!), from = { x: p.x, y: p.y };
    p.x += 10; p.y += 20;
    const floor = { solid: true, min: { x: -500, y: from.y + 10 }, max: { x: 500, y: from.y + 100 } };
    expect(linkProjectileTerrainContact(p, from, [{ ...floor, solid: false }])).toBeNull();
    const contact = linkProjectileTerrainContact(p, from, [floor])!;
    expect(contact.surface).toBe('floor');
    const outcome = linkProjectileTerrain(p, from, contact.surface);
    expect(outcome).toMatchObject({ retire: true, arrowItem: { lifetimeFrames: 180 } });
  });
});

describe('Link Remote Bomb lifecycle', () => {
  it('pulls one bomb at the hand release point; a second Down Special detonates it once it is out of hand', () => {
    const f = fighter({ x: 50, y: 60 }), { h, log } = host(), articles = new LinkArticles();
    f.push({ kind: 'generate-bomb' });
    articles.commit([f.entry], h);
    const point = linkReleasePoint('bomb', false);
    expect(log.bombs).toEqual([{ owner: 0, centre: { x: 50 + point.x, y: 60 + point.y } }]);
    articles.syncOwners([f.entry], []);
    expect(f.state.bomb).toMatchObject({ itemId: 7, ownerIndex: 0 });
    f.push({ kind: 'generate-bomb' });
    f.push({ kind: 'detonate-bomb' });
    articles.commit([f.entry], h);
    expect(log.bombs).toHaveLength(1);
    expect(log.exploded).toEqual([]); // still in Link's hand
    log.holder.set(7, null);
    f.push({ kind: 'detonate-bomb' });
    articles.commit([f.entry], h);
    expect(log.exploded).toEqual([7]);
    articles.syncOwners([f.entry], []);
    expect(f.state.bomb).toBeNull();
  });
  it('blows up by itself after its 30 second fuse', () => {
    const f = fighter(), { h, log } = host(), articles = new LinkArticles();
    f.push({ kind: 'generate-bomb' });
    articles.commit([f.entry], h);
    for (let i = 0; i < 1799; i++) articles.step(h);
    expect(log.exploded).toEqual([]);
    articles.step(h);
    expect(log.exploded).toEqual([7]);
  });
  it('round-trips its checkpoint', () => {
    const f = fighter(), { h, log } = host(), articles = new LinkArticles();
    f.push({ kind: 'generate-bomb' });
    f.push({ kind: 'boomerang', throwKind: 'tilt', angleDegrees: 0 });
    articles.commit([f.entry], h);
    const copy = new LinkArticles();
    copy.restore(JSON.parse(JSON.stringify(articles.snapshot())));
    expect(copy.snapshot()).toEqual(articles.snapshot());
    const motion = JSON.parse(JSON.stringify(log.projectiles[0]!.link));
    expect(parseLinkProjectileMotion(motion, 'link')).toEqual(motion);
  });
});
