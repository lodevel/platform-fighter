/** Reproduce the Node/Chromium math compatibility gate independently of gameplay.
 * npx tsx tools/sim-math-parity.ts [output.json]
 */
import './node-libm-trig';
import fs from 'node:fs';
import { chromium } from 'playwright';

const samples=[-Infinity,Infinity,NaN,-0,0,Number.MIN_VALUE,-Number.MIN_VALUE,Number.EPSILON,
  ...Array.from({length:721},(_,i)=>(i-360)*Math.PI/180),
  ...Array.from({length:4096},(_,i)=>(i-2048)/2048*Math.PI*2),
  ...Array.from({length:4000},(_,i)=>Math.sin(i*13.17)*10000),
  3823.672270971661,1e100,-1e100,1e300,-1e300];
const browser=await chromium.launch();
try{
  const page=await browser.newPage(),expected=await page.evaluate(xs=>xs.map(x=>[Math.sin(x),Math.cos(x)]),samples);
  const differences=expected.flatMap((row,index)=>row.flatMap((value,functionIndex)=>{
    const actual=functionIndex===0?Math.sin(samples[index]!):Math.cos(samples[index]!);
    return Object.is(value,actual)?[]:[{name:functionIndex===0?'sin':'cos',input:samples[index],expected:value,actual}];
  }));
  const report={browser:browser.version(),node:process.version,v8:process.versions.v8,samples:samples.length,
    comparisons:samples.length*2,differences,vendorRevision:'ddc9a95905de5268332a8f0216dc2bc67d26e829'};
  const output=process.argv[2];if(output)fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({...report,differences:differences.length}));
  if(differences.length)process.exitCode=1;
}finally{await browser.close();}
