/** Canonical read-only evidence. No state is restored from this projection. */
export function canonicalMatchHistoryEvidence(value:unknown,bodyIdBase:number):string {
  const path=new Set<object>();const groups=new Map<number,number>();
  const bodyFields=new Set(['bodyId','ownerId','ownerBodyId','targetBodyId','supportBodyId','surfaceId','platformBodyId','captorBodyId','recipientBodyId','liveCaptorBodyId','liveRecipientBodyId']);
  const visit=(v:unknown,key:string):unknown=>{
    if(v===undefined)return {$missing:true};
    if(typeof v==='number'){
      if(!Number.isFinite(v)){
        if(v===Infinity&&['mass','inertia','lifetimeFrames','framesRemaining','maxSpeedX','maxSpeedY'].includes(key))return {$unbounded:key};
        throw new Error(`Nonfinite match evidence ${key}`);
      }
      if(key==='group'&&v!==0){if(!groups.has(v))groups.set(v,groups.size+1);return {$collisionGroup:groups.get(v)};}
      // This pre-existing contextual field used a numeric construction id in
      // schema /1. Keep its original first-world representation (base 1),
      // while making later matches independent of Matter's absolute counter.
      if(key==='previousSupportBodyId')return v-bodyIdBase+1;
      return bodyFields.has(key)?{$bodyId:v-bodyIdBase}:v;
    }
    if(v===null||typeof v==='boolean')return v;
    if(typeof v==='string'&&key==='surfaceGeometryIdentity'){const parsed=JSON.parse(v) as unknown;
      if(!Array.isArray(parsed)||!Number.isSafeInteger(parsed[0]))throw new Error('Unknown retained support identity');
      return {$supportGeometry:[{$bodyId:(parsed[0] as number)-bodyIdBase},...parsed.slice(1)]};}
    if(typeof v==='string')return /^strike\.\d+$/.test(v)?`strike.${Number(v.slice(7))-bodyIdBase}`:v;
    if(typeof v!=='object')throw new Error(`Unsupported match evidence ${key}`);
    if(path.has(v))throw new Error(`Cyclic match evidence ${key}`);
    path.add(v);let out:unknown;
    if(Array.isArray(v))out=v.map(entry=>visit(entry,key));
    else if(v instanceof Set)out={$set:[...v].map(entry=>visit(entry,key)).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))};
    else if(v instanceof Map)out={$map:[...v].map(([k,val])=>[visit(k,key),visit(val,key)]).sort((a,b)=>JSON.stringify(a[0]).localeCompare(JSON.stringify(b[0])))};
    else {
      if(Object.getPrototypeOf(v)!==Object.prototype&&Object.getPrototypeOf(v)!==null)
        throw new Error(`Opaque engine object in match evidence ${key}`);
      out=Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,val])=>[k,visit(val,k)]));
    }
    path.delete(v);return out;
  };
  if(!Number.isSafeInteger(bodyIdBase))throw new Error('Actual construction body identity required');
  return JSON.stringify(visit(value,'world'));
}
