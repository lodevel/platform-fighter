/** STAGED for src/characters/linkNativeAttackPacket.ts.
 * Reader for source-selected ATTACK packets transcribed by native-events.json.
 * Lexical branch/wait/loop clocks and posed bone transforms are not resolved
 * here. Nothing projects native bone-local axes onto guessed world geometry.
 */
export type LinkNativeScalar = number | boolean | string | null;
export interface LinkNativePacketProvenance {
  readonly sourcePath: string;
  readonly function: string;
  readonly line: number;
  readonly selection: 'wiki-selected' | 'native-source-silent';
}
export interface LinkNativePoint {readonly x: number; readonly y: number; readonly z: number}
export interface LinkNativeAttackPacket {
  readonly source: LinkNativePacketProvenance;
  readonly id: number;
  readonly part: number;
  readonly bone: string;
  readonly geometry: {readonly radius: number; readonly start: LinkNativePoint; readonly end: LinkNativePoint | null};
  readonly damage: number;
  readonly launch: {readonly angle: number; readonly growth: number; readonly fixed: number; readonly base: number};
  readonly hitlag: number;
  readonly sdi: number;
  readonly setoff: string;
  readonly directionCheck: string;
  readonly setWeight: boolean;
  readonly shieldDamage: number;
  readonly trip: number;
  readonly rehit: number;
  readonly reflectable: boolean;
  readonly absorbable: boolean;
  readonly flinchless: boolean;
  readonly disableHitlag: boolean;
  readonly direct: boolean;
  readonly situationMask: string;
  readonly categoryMask: string;
  readonly partMask: string;
  readonly friendlyFire: boolean;
  readonly attribute: string;
  readonly soundLevel: string;
  readonly soundAttribute: string;
  readonly region: string;
}
export type LinkNativePacketRead =
  | {readonly kind:'resolved'; readonly packet:LinkNativeAttackPacket}
  | {readonly kind:'unresolved'; readonly source:LinkNativePacketProvenance; readonly fields:readonly string[]};

/** Source priority is a caller-owned explicit selection. Symbolic parameters
 * cannot silently turn into zero, false, a rectangle or a generic collision flag.
 */
export function readLinkNativeAttackPacket(raw: Readonly<Record<string,LinkNativeScalar>>,
  source:LinkNativePacketProvenance):LinkNativePacketRead {
  const unresolved:string[]=[];
  const number=(key:string):number=>{
    const value=raw[key];
    if(typeof value==='number'&&Number.isFinite(value))return value;
    unresolved.push(key);return NaN;
  };
  const boolean=(key:string):boolean=>{
    const value=raw[key];if(typeof value==='boolean')return value;
    unresolved.push(key);return false;
  };
  const symbol=(key:string):string=>{
    const value=raw[key];if(typeof value==='string'&&value.length>0)return value;
    unresolved.push(key);return '';
  };
  const optional=(key:string):number|null=>{
    const value=raw[key];if(value===null||value==='None')return null;
    if(typeof value==='number'&&Number.isFinite(value))return value;
    if(typeof value==='string'){
      const match=/^Some\((-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\)$/i.exec(value);
      if(match){const parsed=Number(match[1]);if(Number.isFinite(parsed))return parsed;}
    }
    unresolved.push(key);return null;
  };
  const point=Object.freeze({x:number('x'),y:number('y'),z:number('z')});
  const x2=optional('x2'),y2=optional('y2'),z2=optional('z2');
  const absent=x2===null&&y2===null&&z2===null;
  if(!absent&&(x2===null||y2===null||z2===null))unresolved.push('capsuleEnd');
  const boneExpression=symbol('bone'),bone=/^Hash40::new\("([^"]+)"\)$/.exec(boneExpression)?.[1];
  if(!bone)unresolved.push('boneTransformIdentity');
  const packet:LinkNativeAttackPacket={source,id:number('id'),part:number('part'),bone:bone??'',
    geometry:Object.freeze({radius:number('radius'),start:point,
      end:absent?null:Object.freeze({x:x2!,y:y2!,z:z2!})}),
    damage:number('damage'),launch:Object.freeze({angle:number('angle'),growth:number('growth'),fixed:number('fixed'),base:number('base')}),
    hitlag:number('hitlag'),sdi:number('sdi'),setoff:symbol('setoff'),directionCheck:symbol('directionCheck'),
    setWeight:boolean('setWeight'),shieldDamage:number('shieldDamage'),trip:number('trip'),rehit:number('rehit'),
    reflectable:boolean('reflectable'),absorbable:boolean('absorbable'),flinchless:boolean('flinchless'),
    disableHitlag:boolean('disableHitlag'),direct:boolean('direct'),situationMask:symbol('situationMask'),
    categoryMask:symbol('categoryMask'),partMask:symbol('partMask'),friendlyFire:boolean('friendlyFire'),
    attribute:symbol('attribute'),soundLevel:symbol('soundLevel'),soundAttribute:symbol('soundAttribute'),region:symbol('region')};
  if(unresolved.length)return{kind:'unresolved',source,fields:Object.freeze([...new Set(unresolved)])};
  return{kind:'resolved',packet:Object.freeze(packet)};
}
