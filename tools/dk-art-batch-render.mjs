/** One durable, bounded reviewed DK batch; no automatic acceptance or retries. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {PNG} from 'pngjs';

const base=path.resolve('docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art');
const server='http://127.0.0.1:8188';
if(!process.argv.includes('--gpu-window-released'))throw Error('Parent explicit GPU checkpoint release required');
const prepPath=path.resolve(process.argv[2]);
if(path.dirname(prepPath)!==base)throw Error('Expected art preparation receipt');
const prep=JSON.parse(fs.readFileSync(prepPath));
if(prep.state!=='actual_inputs_visually_reviewed')throw Error('Actual adapted input inspection required');
if(!Number.isInteger(prep.attempt)||prep.attempt<1||prep.attempt>3)throw Error('Bounded attempts1–3 only');
if(!/^dk-(?:firstclips|grabpilot)-batch\d\d$/.test(prep.jobFamily))throw Error('Expected distinct agreed DK batch');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const live=fs.readFileSync(prep.pilotLiveAcceptanceReceipt);
if(sha(live)!==prep.pilotLiveAcceptanceSha256||JSON.parse(live).full_actions_promoted!==false)throw Error('Pilot qualification receipt drift');
const graphBytes=fs.readFileSync(path.join(base,prep.workflow));
if(sha(graphBytes)!==prep.workflow_sha256)throw Error('Reviewed graph drift');
const graph=JSON.parse(graphBytes);
const job=prep.jobFamily+'-attempt'+prep.attempt;
const ledgerPath=path.join(base,'generation-ledger.json');
const ledger=JSON.parse(fs.readFileSync(ledgerPath));let row=ledger.find(r=>r.job===job);
if(row&&['accepted','rejected'].includes(row.state))throw Error('Reviewed generation immutable');
const save=(suffix,data)=>fs.writeFileSync(path.join(base,job+suffix),JSON.stringify(data,null,2)+'\n');
const persist=()=>{
  const latest=JSON.parse(fs.readFileSync(ledgerPath));
  const at=latest.findIndex(r=>r.job===job);
  if(at<0)latest.push(row);else latest[at]=row;
  fs.writeFileSync(ledgerPath+'.tmp',JSON.stringify(latest,null,2)+'\n');fs.renameSync(ledgerPath+'.tmp',ledgerPath);
};
const req=async(route,options={})=>{const response=await fetch(server+route,{...options,signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error(route+' HTTP'+response.status+' '+await response.text());return response;};
const queue=await(await req('/queue')).json();save('.queue-before.json',queue);
if(!row){
  if(queue.queue_running.length||queue.queue_pending.length)throw Error('Queue occupied');
  if(prep.attempt>1&&!ledger.some(r=>r.job===prep.jobFamily+'-attempt'+(prep.attempt-1)&&r.state==='rejected'))throw Error('Previous attempt must have inspected rejection');
  row={job,state:'prepared',attempt:prep.attempt,graph_sha256:sha(graphBytes),preparationSha256:sha(fs.readFileSync(prepPath)),canvas:prep.canvas,identity_mechanism:prep.identity_mechanism,poseCells:prep.records.map(r=>({clip:r.clip,nativeSample:r.nativeSample,gameplayAge:r.gameplayAge})),created:new Date().toISOString()};ledger.push(row);persist();
}
if(row.graph_sha256!==sha(graphBytes))throw Error('Stored graph drift');
if(!row.prompt_id){
  if(['submitting','unresolved'].includes(row.state))throw Error('Ambiguous prior submission; reconcile history first');
  for(const [kind,input] of Object.entries(prep.inputs)){
    const bytes=fs.readFileSync(path.join(base,input.file));if(sha(bytes)!==input.sha256)throw Error('Reviewed input drift '+kind);
    const remote=graph[input.graphNode].inputs.image;const receipt=path.join(base,job+'.upload-'+kind+'.json');let uploaded;
    if(fs.existsSync(receipt))uploaded=JSON.parse(fs.readFileSync(receipt));
    else{const form=new FormData();form.set('image',new Blob([bytes],{type:'image/png'}),remote);form.set('type','input');form.set('overwrite','false');uploaded=await(await req('/upload/image',{method:'POST',body:form})).json();fs.writeFileSync(receipt,JSON.stringify(uploaded,null,2)+'\n');}
    if(uploaded.name!==remote||uploaded.subfolder)throw Error('Unexpected uploaded asset identity');
    const readback=Buffer.from(await(await req('/view?'+new URLSearchParams({type:'input',filename:remote}))).arrayBuffer());
    const readbackSha=sha(readback);
    save('.readback-'+kind+'.json',{filename:remote,type:'input',localSha256:input.sha256,serverSha256:readbackSha,byteLength:readback.length,verifiedAt:new Date().toISOString()});
    if(readbackSha!==input.sha256)throw Error('Uploaded server input differs from reviewed bytes '+kind);
  }
  row.state='submitting';persist();
  try{const result=await(await req('/prompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:graph,client_id:'pf-'+job})})).json();save('.submission.json',result);if(!result.prompt_id)throw Error('Missing durable prompt id');row.prompt_id=result.prompt_id;row.state='submitted';row.submitted=new Date().toISOString();persist();console.log(JSON.stringify({job,prompt_id:row.prompt_id,canvas:prep.canvas,cells:prep.records.length}));}
  catch(error){row.state='unresolved';row.error=String(error);persist();throw error;}
}
const deadline=Date.now()+900000;let last=0;
while(Date.now()<deadline){
  const history=await(await req('/history/'+row.prompt_id)).json();const output=history[row.prompt_id];
  if(output?.status?.completed){
    save('.history.json',history);
    if(output.status.status_str!=='success'){row.state='failed';row.failure=output.status;persist();throw Error('Generation failed; no automatic resubmission');}
    row.outputs={};
    for(const [node,kind]of Object.entries(prep.outputNodes)){
      const images=output.outputs[node]?.images;if(images?.length!==1)throw Error('Unexpected output cardinality');
      const bytes=Buffer.from(await(await req('/view?'+new URLSearchParams(images[0]))).arrayBuffer());const decoded=PNG.sync.read(bytes);
      if(decoded.width!==prep.canvas[0]||decoded.height!==prep.canvas[1])throw Error('Generated canvas differs');
      const file=job+'-'+kind+'.png';fs.writeFileSync(path.join(base,file),bytes);row.outputs[kind]={file,sha256:sha(bytes),server_reference:images[0]};
    }
    row.state='succeeded_visual_review_pending';row.completed=new Date().toISOString();persist();
    const after=await(await req('/queue')).json();save('.queue-after.json',after);
    if(!after.queue_running.length&&!after.queue_pending.length){await req('/free',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({unload_models:true,free_memory:true})});row.unloadRequested=new Date().toISOString();persist();}
    console.log(JSON.stringify({job,state:row.state,outputs:row.outputs,unloadRequested:row.unloadRequested}));process.exit(0);
  }
  if(Date.now()-last>30000){console.log(job+' render pending '+row.prompt_id);last=Date.now();}
  await new Promise(resolve=>setTimeout(resolve,5000));
}
row.state='unresolved';row.error='15-minute observation deadline; inspect queue/history before any retry';persist();throw Error(row.error);
