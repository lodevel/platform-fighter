/** Explicit source ATTACK_HEIGHT override, separate from target contact part. */
export interface AttackHeightSourceReceipt {readonly sourceScript:string;readonly sourceLine:number;}
export function parseAttackHeightMetadata(value:{nativeAttackHeight?:unknown;nativeAttackHeightSource?:unknown},path:string){
  const height=value.nativeAttackHeight;
  if(height!==undefined&&height!=='low'&&height!=='high')throw new TypeError(`${path}.nativeAttackHeight must be explicit low/high`);
  let receipt:AttackHeightSourceReceipt|undefined;
  if(value.nativeAttackHeightSource!==undefined){const r=value.nativeAttackHeightSource as AttackHeightSourceReceipt;
    if(!r||typeof r!=='object'||Array.isArray(r)||typeof r.sourceScript!=='string'||!r.sourceScript.trim()||
      !Number.isSafeInteger(r.sourceLine)||r.sourceLine<1||Object.keys(r).some(k=>k!=='sourceScript'&&k!=='sourceLine')||height===undefined)
      throw new TypeError(`${path}.nativeAttackHeightSource requires an explicit override and actual source script/line`);
    receipt=Object.freeze({sourceScript:r.sourceScript,sourceLine:r.sourceLine});}
  return{...(height===undefined?{}:{nativeAttackHeight:height as 'low'|'high'}),...(receipt?{nativeAttackHeightSource:receipt}:{})};
}
