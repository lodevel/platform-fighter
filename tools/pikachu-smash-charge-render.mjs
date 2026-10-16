/** Serial follow-on to the already authorized body batch. The renderer owns
 * durable prompt IDs; this coordinator never clears queues or accepts images. */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const base=path.join(root,'docs/review/2026-10-06/pikachu-character/art');
const plan=JSON.parse(readFileSync(path.join(base,'smash-charge-render-plan.json')));
if(plan.keys.length!==15 || plan.bodyBatchKeys.length!==57) throw new Error('Unexpected reviewed smash batch coverage');
const readLedger=()=>JSON.parse(readFileSync(path.join(base,'normal-generation-ledger.json')));
const finished=(ledger,key)=>ledger.some(entry=>entry.pose_key===key && ['succeeded','accepted'].includes(entry.state));
const deadline=Date.now()+2*60*60*1000;
let previousCount=-1;
while(true) {
  const ledger=readLedger(),count=plan.bodyBatchKeys.filter(key=>finished(ledger,key)).length;
  if(count!==previousCount) { console.log(`Waiting for existing body renders: ${count}/57; charge queue untouched`);previousCount=count; }
  if(count===57)break;
  const failed=ledger.find(entry=>plan.bodyBatchKeys.includes(entry.pose_key)&&entry.state==='failed'&&!finished(ledger,entry.pose_key));
  if(failed)throw new Error(`Body batch failed at ${failed.pose_key}; inspect before further generation`);
  if(Date.now()>deadline)throw new Error('Body batch did not complete within two hours; charge jobs were not submitted');
  await new Promise(resolve=>setTimeout(resolve,5000));
}
for(const key of plan.keys) {
  if(finished(readLedger(),key))continue;
  console.log(`Submitting reviewed charge pose ${key}`);
  const result=spawnSync(process.execPath,['tools/pikachu-art-render.mjs',key,'--attempt=1'],{cwd:root,stdio:'inherit'});
  if(result.error || result.status!==0)throw result.error??new Error(`Charge pose failed at ${key}; stopped without accepting or clearing anything`);
}
console.log('Fifteen charge renders acquired. Actual visual, receiving, packing and runtime reviews remain pending.');
