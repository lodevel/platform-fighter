import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {FIGHTER_HEAVY_ITEM_PROFILES,heavyItemPlan,tickDonkeyKongHeavyItemAction,selectDonkeyKongHeavyWalkGait,type DonkeyKongHeavyItemAction} from './donkeykongHeavyItems';

const directory='docs/review/2026-10-06/pikachu-character/sources';
const actions:DonkeyKongHeavyItemAction[]=['pickup'];
for(const direction of ['forward','back','up','down'] as const)for(const strength of ['ordinary','strong'] as const)actions.push(`throw-${direction}-${strength}`);

describe('native primary heavy callbacks; rate and common status adapters remain explicit',()=>{
  it.each(actions)('%s preserves Pikachu command frame/offset/reverse chronology in both facings',action=>{
    const plan=heavyItemPlan('pikachu',action),raw=readFileSync(`${directory}/scripts/pikachu/${plan.nativeScript}.txt`,'utf8');
    const game=raw.split('unsafe extern "C" fn')[1]!.split('unsafe extern "C" fn')[0]!;
    let frame=0,pickup:number|undefined,release:number|undefined,reverse:number|undefined;
    for(const line of game.split('\n')){
      const match=/frame\(agent.lua_state_agent, ([\d.]+)\)/.exec(line);if(match)frame=Number(match[1]);
      if(line.includes('pickup_item('))pickup=frame;
      if(line.includes('THROW_ITEM_OFFSET('))release=frame;
      if(line.includes('REVERSE_LR('))reverse=frame;
    }
    expect(plan.sourceEventFrame).toBe(pickup??release);
    expect(plan.sourceReverseBeforeReleaseFrame).toBe(reverse);
    const offset=/THROW_ITEM_OFFSET\(agent, (-?[\d.]+), (-?[\d.]+)/.exec(game);
    expect(plan.sourceOffset).toEqual(offset?{x:Number(offset[1]),y:Number(offset[2])}:undefined);
    const yaml=readFileSync(`${directory}/motion-list.yml`,'utf8');
    const block=new RegExp(`^  ${plan.motion}:\\n([\\s\\S]*?)(?=^  \\w+:)`,'m').exec(yaml)?.[1];
    expect(block).toBeDefined();expect(plan.nativeCancelFrame).toBe(Number(/cancel_frame: (\d+)/.exec(block!)![1]));
    for(const facing of [1,-1] as const){
      let state={plan,framesElapsed:0,nativeFrame:1,entryFacing:facing,facing,eventEmitted:false};
      const observed:{kind:string;frame:number;facing:number}[]=[];
      for(let age=1;age<plan.durationFrames;age++){
        const result=tickDonkeyKongHeavyItemAction(state);state=result.state!;
        observed.push(...result.events.map(event=>({kind:event.kind,frame:age+1,facing:event.facing})));
      }
      const expected=[];
      if(reverse!==undefined)expected.push({kind:'reverse-facing',frame:reverse,facing:-facing});
      expected.push({kind:pickup!==undefined?'pickup':'release',frame:pickup??release,facing:reverse!==undefined?-facing:facing});
      expect(observed).toEqual(expected);
    }
  });
  it('records native Pikachu lift candidates independently and consumes no invented acceleration formula',()=>{
    const parameters=JSON.parse(readFileSync('docs/review/2026-09-22/combat-parity/defense/sources/native-fighter-param.json','utf8'));
    const pika=parameters.struct.list.struct.find((row:any)=>row.hash40.some((field:any)=>field['@hash']==='fighter_kind'&&field['#text']==='fighter_kind_pikachu'));
    const value=(name:string)=>Number(pika.float.find((field:any)=>field['@hash']===name)['#text']);
    expect(FIGHTER_HEAVY_ITEM_PROFILES.pikachu!.lift).toEqual({accelerationMultiplierNative:value('item_lift_accel_mul'),
      accelerationAddNative:value('item_lift_accel_add'),maximumSpeedNative:value('item_lift_speed_max')});
  });
  it('DK gait boundary adapter uses independently retained ratios, including negative velocity',()=>{
    const parameters=JSON.parse(readFileSync('docs/review/2026-09-22/combat-parity/defense/sources/native-fighter-param.json','utf8'));
    const dk=parameters.struct.list.struct.find((row:any)=>row.hash40.some((field:any)=>field['@hash']==='fighter_kind'&&field['#text']==='fighter_kind_donkey'));
    const value=(name:string)=>Number(dk.float.find((field:any)=>field['@hash']===name)['#text']);
    for(const sign of [1,-1]){
      const maximum=1.365*5*1.1,middle=value('walk_middle_ratio')*maximum,fast=value('walk_fast_ratio')*maximum;
      expect(selectDonkeyKongHeavyWalkGait(sign*(middle-.0001),maximum)).toBe('walk-slow');
      expect(selectDonkeyKongHeavyWalkGait(sign*middle,maximum)).toBe('walk-middle');
      expect(selectDonkeyKongHeavyWalkGait(sign*(fast-.0001),maximum)).toBe('walk-middle');
      expect(selectDonkeyKongHeavyWalkGait(sign*fast,maximum)).toBe('walk-fast');
    }
  });
});
