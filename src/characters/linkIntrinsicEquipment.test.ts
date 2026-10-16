import { describe, expect, it } from 'vitest';
import { parseLinkIntrinsicEquipmentInput, selectLinkIntrinsicEquipment } from './linkIntrinsicEquipment';
const entry={sword:'normal',shield:'back',bow:'have',heldItemVisible:true,ancientBowVisible:false} as const;
describe('captured intrinsic gear source clocks',()=>{
  it('Bow end keeps held hidden and restores separate Sword/Bow22 and Shield23 callbacks',()=>{
    const at=(rawAge:number,bowArticlePresent=true)=>selectLinkIntrinsicEquipment({motion:'special_n_end',rawAge,equipmentAtEntry:entry,bowArticlePresent});
    expect(at(21.5).equipment).toMatchObject({sword:'back',shield:'back',bow:'have',heldItemVisible:false});
    expect(at(22).equipment).toMatchObject({sword:'normal',shield:'back',bow:'back',heldItemVisible:false});
    expect(at(23).equipment).toMatchObject({sword:'normal',shield:'normal',bow:'back',heldItemVisible:false});
    expect(at(22,false).equipment.bow).toBe('have');
  });
  it('catch Sword callback18 remains later than metadata cancel10, without a gameplay lock from this selector',()=>{
    const at=(rawAge:number)=>selectLinkIntrinsicEquipment({motion:'special_s2',rawAge,equipmentAtEntry:entry,bowArticlePresent:true});
    expect(at(10).equipment.sword).toBe('back');
    expect(at(17.99).equipment.sword).toBe('back');
    expect(at(18).equipment.sword).toBe('normal');
    expect(at(31).equipment.sword).toBe('normal');
    expect(Object.keys(at(31))).not.toContain('controls');
  });
  it('no Spin command means no invented blanket equipment stow, while Bomb blast retains exact held hide',()=>{
    const spin=selectLinkIntrinsicEquipment({motion:'special_hi',rawAge:40,equipmentAtEntry:entry,bowArticlePresent:false});
    expect(spin.equipment).toEqual(entry);expect(spin.delta).toEqual({});expect(spin.hasCapturedGearCommands).toBe(false);
    const bomb=selectLinkIntrinsicEquipment({motion:'special_lw_blast',rawAge:34,equipmentAtEntry:entry,bowArticlePresent:false});
    expect(bomb.equipment).toMatchObject({sword:'normal',shield:'normal',heldItemVisible:false});
  });
  it('requires actual closed source motion/gear/source age, preserving fractional evaluated time',()=>{
    const v={motion:'special_s1',rawAge:3.25,equipmentAtEntry:entry,bowArticlePresent:true};
    expect(parseLinkIntrinsicEquipmentInput(v).rawAge).toBe(3.25);
    for(const bad of [{...v,motion:'arbitrary'},{...v,rawAge:Infinity},{...v,rawAge:-1},{...v,legacyRate:1},
      {...v,equipmentAtEntry:{...entry,heldItemVisible:1}}])expect(()=>parseLinkIntrinsicEquipmentInput(bad)).toThrow();
  });
});
