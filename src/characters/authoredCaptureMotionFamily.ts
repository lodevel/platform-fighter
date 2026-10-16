/** Named rare-status authoring bridge. LOW is never inferred from a hand,
 * attack height, body size, or captor fighter. Native fresh Link defaults HIGH. */
export interface CaptureMotionFamilyProvenance {
  readonly selection:'AUTHORED_CAPTURE_MOTION_FAMILY_RESOLVER';
  readonly producerId:string;
  readonly sourceFamily:'UltimateLinkNORMAL receiving templates';
  readonly sourceReceipt:string;
  readonly nativeCallerRecovered:false;
}
export interface AuthoredCaptureMotionFamily {
  readonly authoredCaptureMotionFamily:'low'|'high';
  readonly captureMotionFamilyProvenance:CaptureMotionFamilyProvenance;
}
export function parseAuthoredCaptureMotionFamily(value:unknown,path='capture'):AuthoredCaptureMotionFamily|null {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError(`${path} must be an object`);
  const row=value as Record<string,unknown>,family=row.authoredCaptureMotionFamily,p=row.captureMotionFamilyProvenance;
  if(family===undefined&&p===undefined)return null;
  if((family!=='low'&&family!=='high')||!p||typeof p!=='object'||Array.isArray(p))
    throw new TypeError(`${path} requires an explicit capture family and provenance together`);
  const source=p as Record<string,unknown>,keys=['selection','producerId','sourceFamily','sourceReceipt','nativeCallerRecovered'];
  if(Object.keys(source).length!==keys.length||keys.some(k=>!Object.hasOwn(source,k))||
    source.selection!=='AUTHORED_CAPTURE_MOTION_FAMILY_RESOLVER'||source.sourceFamily!=='UltimateLinkNORMAL receiving templates'||
    source.nativeCallerRecovered!==false||typeof source.producerId!=='string'||!source.producerId.trim()||
    typeof source.sourceReceipt!=='string'||!source.sourceReceipt.trim())throw new TypeError(`${path} invalid capture motion provenance`);
  return Object.freeze({authoredCaptureMotionFamily:family,captureMotionFamilyProvenance:Object.freeze({...source}) as unknown as CaptureMotionFamilyProvenance});
}
