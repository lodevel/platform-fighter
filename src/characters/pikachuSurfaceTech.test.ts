import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {selectPikachuSurfaceTechBody,pikachuSurfaceTechPresentation} from './pikachuSurfaceTech';
import {SURFACE_TECH_PROFILES} from './surfaceTechProfiles';
import {beginSurfaceTech,tickSurfaceTech,surfaceTechProtected,surfaceTechCeilingDisplacement,type SurfaceTechState} from './surfaceTech';

const P=SURFACE_TECH_PROFILES.pikachu;
const begin=(kind:'wall'|'ceiling',facing:1|-1,outward:1|-1)=>beginSurfaceTech(kind,facing,outward,P);
const drawing=(state:SurfaceTechState)=>selectPikachuSurfaceTechBody(pikachuSurfaceTechPresentation(state)!);

const base='docs/review/2026-10-06/pikachu-character/';
const receiving=JSON.parse(readFileSync(base+'sources/full-body-native-review/tiled-receiving/ledge-getup-candidates.json','utf8')).rows;
const motion=JSON.parse(readFileSync(base+'integration/completion-gap-audit/surface-tech-primary-motion-measurements.json','utf8'));
const list=readFileSync(base+'sources/motion-list.yml','utf8');
const field=(entry:string,key:string)=>{
 const block=list.match(new RegExp('^  '+entry+':\\n([\\s\\S]*?)(?=^  [a-z0-9_]+:|(?![\\s\\S]))','m'))?.[1];
 if(block===undefined)throw new Error(`Missing primary motion entry ${entry}`);
 const value=block.match(new RegExp('^\\s+'+key+': ([0-9]+)$','m'))?.[1];
 if(value===undefined)throw new Error(`Missing primary motion field ${entry}/${key}`);
 return Number(value);
};

describe('Pikachu pure surface-tech source consumers',()=>{
 it.each(['wall','ceiling'] as const)('keeps every %s age paired to independently retained source receiving and protection',kind=>{
  let state=begin(kind,-1,1);
  const sourceEntry=kind==='wall'?'passive_wall':'passive_ceil';
  const rows=receiving.filter((row:{sheet:string})=>row.sheet===pikachuSurfaceTechPresentation(state)!.sheet).sort((a:{nativeSample:number},b:{nativeSample:number})=>a.nativeSample-b.nativeSample);
  const duration=kind==='wall'?25:field(sourceEntry,'cancel_frame');
  expect(state.durationFrames).toBe(duration);
  for(let age=0;age<duration;age++){
   expect(state.framesElapsed).toBe(age);
   const expected=[...rows].reverse().find((row:{nativeSample:number})=>row.nativeSample<=age);
   const pose=drawing(state)!;
   expect(pose.nativeSample).toBe(expected.nativeSample);expect(pose.artFrameIndex).toBe(expected.artFrameIndex);
   const protectedNow=age+1>=field(sourceEntry,'xlu_start')&&age+1<field(sourceEntry,'xlu_end');
   expect(surfaceTechProtected(state)).toBe(protectedNow);
   expect(pose.hurtboxes).toEqual(protectedNow?expected.hurtboxes.map((h:object)=>({...h,intangible:true})):expected.hurtboxes);
   expect(pose.hurtboxes).toHaveLength(12);
   const next=tickSurfaceTech(state);
   if(age===duration-1)expect(next).toBeNull();else state=next!;
  }
 });
 it('consumes independently extracted ceiling Trans exactly and contributes no wall Trans travel',()=>{
  let ceil=begin('ceiling',1,1),wall=begin('wall',-1,-1);
  let displacementY=0;
  for(let age=1;age<27;age++){
   const next=tickSurfaceTech(ceil)!;
   const delta=surfaceTechCeilingDisplacement(ceil,next,P)!;
   const raw=motion.nativeTrans[age],previous=motion.nativeTrans[age-1];
   expect(delta.x).toBeCloseTo((raw[2]-previous[2])*5,10);
   expect(delta.y).toBeCloseTo(-(raw[1]-previous[1])*5,10);
   displacementY+=delta.y;ceil=next;
   if(age<25){const n=tickSurfaceTech(wall)!;expect(surfaceTechCeilingDisplacement(wall,n,P)).toBeNull();wall=n;}
  }
  expect(displacementY).toBeCloseTo(22.24249839782715,10);
 });
});
