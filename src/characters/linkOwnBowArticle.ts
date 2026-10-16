/** Persistent own Bow identity. Link's first-use native generation/common
 * parent caller is absent; the actual accepted action creates this explicitly
 * authored first-use lease. Captured HAVE/BACK commands remain separate. */
export interface LinkOwnBowArticleLease {readonly id:string;readonly ownerIndex:number;readonly generation:number;readonly admittedFrame:number;
  readonly admissionPolicy:'AUTHORED_LINK_BOW_FIRST_USE';}
function integer(v:unknown,p:string):number {if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0)throw new TypeError(`${p} must be safe integer`);return v;}
export function beginLinkOwnBowArticle(input:{ownerIndex:number;generation:number;frame:number;acceptedBow:boolean}):LinkOwnBowArticleLease|null {
  if(!input.acceptedBow)return null;
  const ownerIndex=integer(input.ownerIndex,'ownerIndex'),generation=integer(input.generation,'generation'),admittedFrame=integer(input.frame,'frame');
  return Object.freeze({id:JSON.stringify(['own-bow',ownerIndex,generation,admittedFrame]),ownerIndex,generation,admittedFrame,admissionPolicy:'AUTHORED_LINK_BOW_FIRST_USE'});
}
export function parseLinkOwnBowArticleLease(value:unknown):LinkOwnBowArticleLease|null {
  if(value===null)return null;
  if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError('Invalid persistent Bow lease');
  const r=value as Record<string,unknown>,keys=['id','ownerIndex','generation','admittedFrame','admissionPolicy'];
  if(Object.keys(r).length!==keys.length||keys.some(k=>!Object.hasOwn(r,k))||r.admissionPolicy!=='AUTHORED_LINK_BOW_FIRST_USE')throw new TypeError('Invalid Bow admission policy/fields');
  const result=beginLinkOwnBowArticle({ownerIndex:integer(r.ownerIndex,'ownerIndex'),generation:integer(r.generation,'generation'),frame:integer(r.admittedFrame,'frame'),acceptedBow:true})!;
  if(r.id!==result.id)throw new TypeError('Persistent Bow identity disagrees with accepted first-use lease');return result;
}
