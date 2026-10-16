import {describe,expect,it} from 'vitest';
import {projectPikachuFinalCliffVelocity} from './pikachuFinalCliffStop';
describe('named2D Pika Final grounded cliff projection',()=>{
 it.each([1,-1]as const)('admits full interior travel and clips the approaching hull at either edge facing%s',facing=>{
  const support={left:-100,right:100};
  expect(projectPikachuFinalCliffVelocity({root:{x:0,y:10},velocity:{x:40*facing,y:3},hullWidth:40,support})).toEqual({x:40*facing,y:3});
  expect(projectPikachuFinalCliffVelocity({root:{x:70*facing,y:10},velocity:{x:40*facing,y:3},hullWidth:40,support})).toEqual({x:10*facing,y:3});
 });
 it('does not teleport a partly overhanging grounded hull back onto the platform',()=>{
  expect(projectPikachuFinalCliffVelocity({root:{x:95,y:10},velocity:{x:15,y:2},hullWidth:40,support:{left:-100,right:100}})).toEqual({x:0,y:2});
  expect(projectPikachuFinalCliffVelocity({root:{x:95,y:10},velocity:{x:-15,y:2},hullWidth:40,support:{left:-100,right:100}})).toEqual({x:-15,y:2});
 });
});
