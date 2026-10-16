import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { DonkeyKong, DONKEYKONG_NEUTRAL_SPECIAL, DONKEYKONG_UP_SPECIAL } from './DonkeyKong';
import { getAuthorableCharacterSpec } from './authorableCharacterRegistry';
import { applyCharacterMoveOverrides } from './characterFactory';
import { parseCharacterDataFile, serializeCharacterDataSpec } from './characterSerializer';
import { HitboxDamageHandler } from '../match/HitboxDamageHandler';
import { stepCharacterPhysics } from './stepCharacterPhysics';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import { PLATFORM_LABELS } from '../stages/stageBodies';
import { TRIP_OPTION_LOCK_FRAMES, type CharacterInput } from './Character';
import { STALE_FRESH_MULTIPLIER, type HitInfo } from './combat';
import { computeChargedDamageFromSpec } from './chargeSchema';
import { auditDkAttackData } from '../../tools/dk-attack-data-audit';
import { coordinateCaptureAttachments } from './captureAttachmentCoordinator';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');
const neutral: CharacterInput = { moveX: 0, moveY: 0, jump: false };
function world(saved = false) {
  const engine = Engine.create();
  const events: Record<string, string> = { collisionstart: 'collisionStart', collisionactive: 'collisionActive', collisionend: 'collisionEnd' };
  const scene: any = { matter: { body: Body, add: { rectangle(x: number,y: number,w: number,h: number,s: object) {
    const b = Bodies.rectangle(x,y,w,h,s); Composite.add(engine.world,b); return b;
  } }, world: { on(e: string,fn: any) { Events.on(engine,events[e]??e,fn); }, off(e: string,fn: any) { Events.off(engine,events[e]??e,fn); },
    remove(b: any) { Composite.remove(engine.world,b); } } } };
  const a = new DonkeyKong(scene,{ spawnX: 0, spawnY: 0 });
  const b = new DonkeyKong(scene,{ spawnX: 80, spawnY: 0 });
  if (saved) applyCharacterMoveOverrides(a,parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec(getAuthorableCharacterSpec('donkeykong'))))));
  const floor = Bodies.rectangle(0,52,20000,20,{isStatic: true,label: PLATFORM_LABELS.solid,collisionFilter: {category: COLLISION_CATEGORIES.PLATFORM_SOLID}});
  Composite.add(engine.world,floor);
  const contacts: {hit: HitInfo; region?: number}[] = [];
  const handler = new HitboxDamageHandler((i,hit,ctx) => {
    if (ctx.kind === 'grab') { a.resolveGrabConnect(b); return {confirmed:true}; }
    if (i !== 1) return {confirmed:false};
    contacts.push({hit,region:ctx.collisionHitId}); const result=b.applyHit(hit); a.armAttackerHitlag(b.getHitlagRemaining());
    return {confirmed: result.magnitude > 0 || b.isShielding()};
  });
  handler.registerPlayer(0,a.body);handler.registerPlayer(1,b.body);
  handler.setGroundedLookup(i => (i===0?a:b).isGrounded());
  handler.setFacingLookup(i => (i===0?a:b).getFacing());
  handler.setHurtboxLookup(i => (i===0?a:b).getActiveHurtboxes());
  Events.on(engine,'collisionStart',(e: any)=>handler.handleCollisionStart(e));
  Events.on(engine,'collisionActive',(e: any)=>handler.handleCollisionStart(e));
  const step=(input: CharacterInput=neutral,defender: CharacterInput=neutral) => {
    a.applyInput(input);b.applyInput(defender);stepCharacterPhysics({ characters: [a,b], bodies: Composite.allBodies(engine.world), gravity: engine.gravity, body: Body, deltaMs: 1000/60, stepWorld: dt => Engine.update(engine,dt),
      // Same afterSubstep order as MatchScene: the posed DK CATCH sensor is
      // postPhysicsContactOnly, so captures connect only through the completed-physics sampler.
      afterSubstep: () => { coordinateCaptureAttachments([a,b]); handler.sampleHurtboxContacts(Composite.allBodies(engine.world)); } });
  };
  for(let i=0;i<12;i++)step();
  return {a,b,step,contacts};
}

describe('DK complete sourced numeric inventory and runtime',()=>{
  it('compares every per-hit numeric record and all seven release throws against independent raw captures',()=>{
    const r=auditDkAttackData();expect(r.motions).toBe(42);expect(r.comparisons).toBe(138);expect(r.mismatches).toBe(0);
  });
  it.each([-0.4,0.4])('selects 9% angled forward tilt with vertical input %s, including a saved fighter',y=>{
    const {a,step}=world(true);step({...neutral,moveX:0.5,moveY:y});step({...neutral,moveX:0.5,moveY:y,attack:true});
    expect(a.getActiveAttack()?.move.damage).toBe(9);expect(a.getActiveAttack()?.move.collisionHits?.every(h=>h.damage===9)).toBe(true);
  });
  it('incomplete punch uses integer 10–27 damage and never the full launch record',()=>{
    const c=DONKEYKONG_NEUTRAL_SPECIAL.charge;const values=Array.from({length:110},(_,i)=>computeChargedDamageFromSpec(c,i));
    expect(new Set(values)).toEqual(new Set(Array.from({length:18},(_,i)=>i+10)));expect(computeChargedDamageFromSpec(c,110)).toBe(28);
  });
  it('selects aerial full punch at release with 25 damage, 40/72 launch, 27 recovery and aerial armour',()=>{
    const {a,step}=world(true);for(let i=0;i<120;i++)step({...neutral,special:true});
    step({...neutral,shield:true});for(let i=0;i<20;i++)step();
    for(let i=0;i<7;i++)step({...neutral,jump:true});expect(a.isGrounded()).toBe(false);
    step({...neutral,special:true});const m=a.getActiveAttack()!.move;
    expect(m.damage).toBe(25);expect(m.recoveryFrames).toBe(27);expect(m.knockback.reference).toMatchObject({base:40,growth:72});
    expect(m.armorWindows).toEqual([{startFrame:14,endFrame:20}]);expect(m.collisionHits).toHaveLength(4);
  });
  it('Headbutt adds 25 shield damage without increasing defender percent',()=>{
    const {a,b,step,contacts}=world();step({...neutral,moveX:1,special:true},{...neutral,shield:true});
    for(let i=0;i<28;i++)step(neutral,{...neutral,shield:true});
    expect(contacts.some(c=>c.hit.shieldDamage===25)).toBe(true);expect(b.getDamagePercent()).toBe(0);
    expect(b.getShieldState().health).toBeLessThan(20);expect(a.getActiveAttack()?.move.id).toBe('donkeykong.side_special');
  });
  it('grounded spin includes ground/air opening masks and every 3.5 rear hit; aerial rungs carry all source regions',()=>{
    const ground=DONKEYKONG_UP_SPECIAL.groundedVariant!;
    expect(ground.hitWindows![0]!.collisionHits).toHaveLength(6);
    for(const w of ground.hitWindows!.slice(1,6))expect(w.collisionHits?.find(h=>h.id===2)).toMatchObject({damage:3.5,launchDirection:'back',knockback:{reference:{base:35,growth:100,angle:60}}});
    const {a,step}=world(true);for(let i=0;i<7;i++)step({...neutral,jump:true});step({...neutral,special:true,moveY:-1});
    for(let i=0;i<12;i++)step();
    const ladder=(a as any).transientHitboxes;expect(ladder.some((t:any)=>t.body.plugin.collisionHits?.length===4)).toBe(true);
  });
  it.each(['back','up','down'] as const)('normal %s throw releases with native recovery',dir=>{
    const {a,b,step}=world(true);step({...neutral,grab:true});for(let i=0;i<12;i++)step();expect(b.isGrabbed()).toBe(true);
    step({...neutral,moveX:dir==='back'?-1:0,moveY:dir==='up'?-1:dir==='down'?1:0});
    const spec=getAuthorableCharacterSpec('donkeykong').moves!.grab!.throws[dir];
    for(let i=0;i<spec.animationFrames;i++)step();expect(b.getDamagePercent()).toBeCloseTo(spec.damage*STALE_FRESH_MULTIPLIER,10);
    expect(a.getGrabState().cooldownRemaining).toBe(spec.recoveryFrames);
  });
  it.each(['forward','back','up','down'] as const)('cargo %s throw enters carry without damage, then releases its own native record',dir=>{
    const {a,b,step}=world(true);step({...neutral,grab:true});for(let i=0;i<12;i++)step();expect(b.isGrabbed()).toBe(true);
    step({...neutral,moveX:1});for(let i=0;i<16;i++)step();expect(a.getGrabState().active?.cargo).toBe(true);expect(b.getDamagePercent()).toBe(0);
    step({...neutral,attack:true,moveX:dir==='back'?-1:dir==='forward'?1:0,moveY:dir==='up'?-1:dir==='down'?1:0});
    const spec=getAuthorableCharacterSpec('donkeykong').moves!.grab!.cargo!.throws[dir];
    for(let i=0;i<spec.animationFrames;i++)step();expect(b.getDamagePercent()).toBeCloseTo(spec.damage*STALE_FRESH_MULTIPLIER,10);expect(b.isGrabbed()).toBe(false);
    expect(a.getGrabState().cooldownRemaining).toBe(spec.recoveryFrames);
  });
  it('pummel connects on frame 2, preserves capture, and uses UFD 15-frame hitstop',()=>{
    const {a,b,step}=world();step({...neutral,grab:true});for(let i=0;i<12;i++)step();step({...neutral,attack:true});expect(b.getDamagePercent()).toBe(0);
    step();expect(b.getDamagePercent()).toBeCloseTo(1.6*STALE_FRESH_MULTIPLIER,10);expect(b.isGrabbed()).toBe(true);expect((a as any).hitlagRemaining).toBe(15);
  });
  it('trip recovery waits for native startup and uses both separate source windows',()=>{
    const {a,step}=world(true);a.applyTrip();
    // SmashWiki Lucario (SSBU)/Floor getups (trip): getup options only "right after 39 frames" of a hard trip.
    for(let i=1;i<TRIP_OPTION_LOCK_FRAMES;i++)step();step({...neutral,attack:true});const m=a.getActiveAttack()!.move;
    expect(m.id).toBe('donkeykong.tripAttack');expect(m.startupFrames).toBe(18);expect(m.hitWindows?.map(w=>[w.startFrame,w.endFrame])).toEqual([[18,20],[23,25]]);
  });
});
