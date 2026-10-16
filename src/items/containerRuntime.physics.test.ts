import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { itemPhysicsFixture, NEUTRAL_INPUT } from './itemPhysicsFixture';
import { DonkeyKong } from '../characters/DonkeyKong';
import { Pikachu } from '../characters/Pikachu';
import { CRATE_DEFINITION } from './Crate';
import { BARREL_DEFINITION } from './Barrel';
import { CAPSULE_DEFINITION } from './Capsule';
import { ItemEntity } from './ItemEntity';
import { ItemRegistry } from './ItemRegistry';
import { MatchRng } from '../match/MatchRng';
import { ITEM_CONTAINER_RNG_STREAM, eligibleContainerContents, stepContainerRoll } from './itemContainer';
import { ITEM_SPAWN_TABLE, enabledSpawnItems, pickSpawnItem } from './itemCatalog';
import { foodDefinition, FOOD_VARIANTS } from './Food';
import { itemExplosionHit } from './BobOmb';
import { itemAttackLaunchVelocity, thrownItemHit } from './nativeItemThrow';
import { hitLaunchFacing } from '../characters/attacks';
import { posedCapsule } from '../characters/capsuleGeometry';
import { sweptHurtboxEntry, sweptProjectileCapsuleEntry } from '../characters/projectileMotion';
import { PLATFORM_LABELS } from '../stages/stageBodies';
import { LINK_REMOTE_BOMB_ITEM_DEFINITION } from './LinkRemoteBombItem';
import { SimEventQueue } from '../sim/simEvents';

// Run the actual production container methods, as existing MatchScene physics
// regressions do. Only presentation/audio and the global combat modifier layer
// are omitted; receiving geometry and real Matter actors/attacks are retained.
const source=ts.createSourceFile('MatchSim.ts',readFileSync(new URL('../sim/MatchSim.ts',import.meta.url),'utf8'),ts.ScriptTarget.ES2022,true);
const sceneClass=source.statements.find((node):node is ts.ClassDeclaration=>ts.isClassDeclaration(node)&&node.name?.text==='MatchSim')!;
const names=['removeItem','openContainer','tickContainer','itemStrikes','tickAttackLaunch','sweptHurtboxContact','tickItemExplosions'];
const methods=names.map(name=>sceneClass.members.find((node):node is ts.MethodDeclaration=>ts.isMethodDeclaration(node)&&ts.isIdentifier(node.name)&&node.name.text===name)!.getText(source));
const compiled=ts.transpileModule(`class ContainerHost { ${methods.join('\n')} }`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const dependencies={ITEM_CONTAINER_RNG_STREAM,eligibleContainerContents,stepContainerRoll,enabledSpawnItems,pickSpawnItem,
  foodDefinition,FOOD_VARIANTS,ItemEntity,itemExplosionHit,thrownItemHit,itemAttackLaunchVelocity,hitLaunchFacing,posedCapsule,sweptHurtboxEntry,sweptProjectileCapsuleEntry,PLATFORM_LABELS,
  Phaser:{GameObjects:{Image:class{}}}};
const ContainerHost=new Function(...Object.keys(dependencies),`${compiled}\nreturn ContainerHost;`)(...Object.values(dependencies));
function visual():any {
  return {list:[],destroyed:false,destroy(){this.destroyed=true;},setPosition(){return this;},setVisible(){return this;},setScale(){return this;},
    setAngle(){return this;},setDepth(){return this;},setStrokeStyle(){return this;},setName(){return this;}};
}
function seedFor(explosion:boolean,three=false):number {
  for(let seed=1;seed<1000;seed++){
    const rng=new MatchRng(seed).stream(ITEM_CONTAINER_RNG_STREAM),roll=rng.next(),count=rng.next();
    if((roll<1/8)===explosion&&(!three||count>=2/3))return seed;
  }
  throw new Error('deterministic seed search failed');
}
function fixture(Fighter:typeof DonkeyKong|typeof Pikachu,explosion=false,three=false){
  const world=itemPhysicsFixture(Fighter,CRATE_DEFINITION);world.inventory.detachWithoutDrop();
  const host:any=new ContainerHost(),registry=new ItemRegistry();
  Object.assign(host,{simEvents:new SimEventQueue(),itemRegistry:registry,matchRng:new MatchRng(seedFor(explosion,three)),
    activeMatchConfig:{itemSwitch:Object.fromEntries(ITEM_SPAWN_TABLE.map(def=>[def.type,def.type==='food']))},
    playerSlots:[{playerIndex:1,character:world.actor}],inventoriesByPlayerIndex:new Map([[1,world.inventory]]),
    itemVisuals:new Map(),hammerAreasVisual:new Map(),itemSurfaceY:new Map(),itemFallingY:new Map(),containerStrikeFrames:new Map(),
    donkeykongHeavyItemRequests:new Map(),itemPickupRequests:new Map(),thrownItems:[],itemExplosions:[],
    baseStage:{bodies:{platformBodies:[world.floor]}},stockTracker:{isEliminated:()=>false},
    hitboxDebugLayer:{isEnabled:()=>false},spawnExplosionArt(){},itemVisualSprite:visual,crateVisualParts:()=>[],
    add:{container:visual,circle:visual},resolveCombatHit(_player:number,hit:any){
      const result=world.actor.applyHitDetailed(hit);return {confirmed:result.outcome==='landed'||result.outcome==='invulnerable'};
    }});
  const spawn=(definition:typeof CRATE_DEFINITION,x:number,y:number)=>{
    const item=registry.spawn(definition,{x,y},0,ItemEntity);host.itemVisuals.set(item.id,visual());return item;
  };
  return {...world,host,spawn,registry};
}

describe.each([DonkeyKong,Pikachu])('%s: actual container methods with settled real Matter actors',Fighter=>{
  it('real native fighter attacks damage/open a falling Crate once per strike body',()=>{
    const f=fixture(Fighter),item=f.spawn(CRATE_DEFINITION,100,100);
    let lastHp=15,changes=0;
    const changesPerStrike=new Map<number,number>();
    for(let frame=21;frame<1200&&!item.isDespawned();frame++){
      f.step({...NEUTRAL_INPUT,attack:frame%60===21});
      const attack=f.actor.getActiveAttack();
      if(attack?.phase==='active'&&attack.hitboxBody){
        item.updateFreePosition({x:attack.hitboxBody.position.x,y:attack.hitboxBody.position.y+37.5});
        f.host.tickContainer(item,frame,true);
        const hp=item.getContainerState()!.hp;
        if(hp!==lastHp){changes++;lastHp=hp;const id=attack.hitboxBody.id;changesPerStrike.set(id,(changesPerStrike.get(id)??0)+1);}
      }
    }
    expect(changes).toBeGreaterThan(0);expect(item.isDespawned()).toBe(true);
    expect(item.getContainerState()?.resolved).toBe(true);
    expect([...changesPerStrike.values()].every(count=>count===1)).toBe(true);
    expect(f.registry.getActive().every(child=>child.definition.type==='food')).toBe(true);
  });
  it("a real attack launches a free Remote Bomb along its own packet as the striker's thrown item, once per strike body",()=>{
    // SmashWiki Link (SSBU), Remote Bomb: "can be launched around by attacks (including Link's)".
    const f=fixture(Fighter),item=f.spawn(LINK_REMOTE_BOMB_ITEM_DEFINITION as typeof CRATE_DEFINITION,-500,100);
    item.markGrounded(1,item.getPosition());
    for(let frame=21;frame<200&&!f.host.thrownItems.length;frame++){
      f.step({...NEUTRAL_INPUT,attack:frame===21});
      const attack=f.actor.getActiveAttack(),body=attack?.phase==='active'?attack.hitboxBody:null;
      if(!body)continue;
      item.updateFreePosition({x:body.position.x,y:body.position.y+10});
      f.host.tickAttackLaunch(item,frame);
      if(!f.host.thrownItems.length)continue;
      const flight=f.host.thrownItems[0],expected=itemAttackLaunchVelocity({damage:body.plugin.damage,knockback:body.plugin.knockback,
        facing:hitLaunchFacing(body.plugin,body.position.x-f.actor.getPosition().x)});
      expect(flight).toMatchObject({entity:item,ownerSlotIndex:1,vx:expected.vx,vy:expected.vy});
      expect(Math.hypot(flight.vx,flight.vy)).toBeGreaterThan(0);
      expect(item.getSnapshot().state).toBe('falling');
      flight.vx=flight.vy=0;
      f.host.tickAttackLaunch(item,frame+1);
      expect([flight.vx,flight.vy]).toEqual([0,0]);
    }
    expect(f.host.thrownItems).toHaveLength(1);
  });
  it('rolling Barrel physically contacts posed receiving geometry, opens once and launches the actor',()=>{
    const f=fixture(Fighter),item=f.spawn(BARREL_DEFINITION,-200,f.floor.bounds.min.y);
    item.markGrounded(1,item.getPosition());item.startContainerRoll(10);
    for(let frame=1;frame<35&&!item.isDespawned();frame++)f.host.tickContainer(item,frame,false);
    expect(item.isDespawned()).toBe(true);
    expect(f.actor.getDamagePercent()).toBeGreaterThan(12);
    expect(f.actor.getDamagePercent()).toBeLessThan(14);
    const percent=f.actor.getDamagePercent();f.host.tickContainer(item,40,false);
    expect(f.actor.getDamagePercent()).toBe(percent);
    const x=f.actor.getPosition().x;
    for(let n=0;n<20;n++)f.step();
    expect(f.actor.getPosition().x).toBeGreaterThan(x);
  });
  it('rolling off the actual platform edge enters a single falling trajectory',()=>{
    const f=fixture(Fighter),item=f.spawn(BARREL_DEFINITION,f.floor.bounds.max.x-1,f.floor.bounds.min.y);
    item.markGrounded(1,item.getPosition());item.startContainerRoll(10);f.host.tickContainer(item,2,false);
    expect(item.getSnapshot().state).toBe('falling');expect(item.getContainerState()?.rolling).toBeNull();
    expect(f.host.thrownItems).toHaveLength(1);expect(f.host.thrownItems[0].vx).toBeCloseTo(9.99,10);
    f.host.tickContainer(item,3,true);expect(f.host.thrownItems).toHaveLength(1);
  });
  it('production opening duplicates the same seeded Food definition and preserves added trajectories',()=>{
    const f=fixture(Fighter,false,true),item=f.spawn(CRATE_DEFINITION,200,200);
    f.host.thrownItems.push({entity:item});
    f.host.openContainer(item,8,null);
    const children=f.registry.getActive();expect(children).toHaveLength(3);
    expect(children.every(child=>child.definition===children[0]!.definition)).toBe(true);
    expect(children[0]!.definition.foodVariant).toBeDefined();
    expect(f.host.thrownItems).toHaveLength(3);
    expect(new Set(f.host.thrownItems.map((t:any)=>t.entity.id)).size).toBe(3);
    f.host.openContainer(item,9,null);expect(f.host.thrownItems).toHaveLength(3);
  });
  it.each(['throw-ground-down-ordinary','throw-ground-forward-strong'] as const)
  ('Capsule %s blast uses one packet with its sourced owner-immunity context',action=>{
    const f=fixture(Fighter,true),p=f.actor.getPosition(),item=f.spawn(CAPSULE_DEFINITION,p.x,p.y+12);
    f.host.openContainer(item,1,1,action);expect(f.host.itemExplosions).toHaveLength(1);
    f.host.tickItemExplosions(1);
    expect(f.actor.getDamagePercent()).toBe(action.includes('-down-')?0:53);
    f.host.tickItemExplosions(2);expect(f.actor.getDamagePercent()).toBe(action.includes('-down-')?0:53);
  });
});
