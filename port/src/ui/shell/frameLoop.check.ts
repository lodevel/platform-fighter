import {describe,expect,it} from 'vitest';
import {startFrameLoop,type FrameFault} from './frameLoop';

describe('browser animation-loop failure isolation',()=>{
 it('keeps scheduling after a one-off screen failure while the owner suspends the damaged match',()=>{
  const queued=new Map<number,(now:number)=>void>();let sequence=0,screenFaulted=false,updates=0,renders=0;
  const faults:FrameFault[]=[];
  const stop=startFrameLoop({requestFrame:callback=>{queued.set(++sequence,callback);return sequence;},cancelFrame:id=>{queued.delete(id);},
   stages:[{phase:'screen',run:()=>{if(screenFaulted)return;updates++;throw new Error('actual fixed-step failure');}},
    {phase:'renderer',run:()=>{renders++;}}],onFault:fault=>{faults.push(fault);screenFaulted=true;}});
  const advance=(now:number)=>{const[id,callback]=queued.entries().next().value!;queued.delete(id);callback(now);};
  advance(0);expect(queued.size).toBe(1);expect(faults).toHaveLength(1);expect(renders).toBe(0);
  advance(16);advance(32);expect(updates).toBe(1);expect(renders).toBe(2);expect(queued.size).toBe(1);
  expect(faults[0]).toMatchObject({phase:'screen',message:'actual fixed-step failure'});expect(faults[0]!.stack).toContain('Error: actual fixed-step failure');
  stop();expect(queued.size).toBe(0);
 });
 it('retains the next browser frame even if the fault UI callback itself fails',()=>{
  const callbacks:Array<(now:number)=>void>=[];
  startFrameLoop({requestFrame:callback=>{callbacks.push(callback);return callbacks.length;},cancelFrame:()=>{},
   stages:[{phase:'renderer',run:()=>{throw new Error('renderer fault');}}],onFault:()=>{throw new Error('fault dialog fault');}});
  expect(()=>callbacks.shift()!(0)).toThrow('fault dialog fault');expect(callbacks).toHaveLength(1);
 });
});
