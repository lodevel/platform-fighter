/** Source-guided current-engine shield placement. This is a parametric pose
 * angle, never a time loop. Native input/bubble-parent/bodyblend callers are
 * unrecovered; Root selected magnitude placement and5WORLD/native units. */
import rawFacts from './linkShieldTiltFacts.json';
export interface LinkShieldTiltPoint { readonly x:number; readonly y:number; }
export interface LinkShieldTiltInput {
  /** Existing dispatcher deadzone already resolved; no new deadzone here. */
  readonly moveX:number; readonly moveY:number; readonly facing:1|-1;
  readonly currentHP:number; readonly actorSourceRoot:LinkShieldTiltPoint;
}
export interface LinkShieldTiltFacts {
  readonly resource:{readonly path:string;readonly sha256:string};
  readonly points:readonly LinkShieldTiltPoint[];
}
const fail=(path:string):never=>{throw new TypeError(`Invalid Link shield tilt ${path}`);};
const finite=(v:unknown,p:string):number=>typeof v==='number'&&Number.isFinite(v)?v:fail(p);
const object=(v:unknown,p:string,keys:readonly string[]):Record<string,unknown>=>{
  if(!v||typeof v!=='object'||Array.isArray(v))return fail(p);
  const r=v as Record<string,unknown>;
  if(Object.keys(r).length!==keys.length||keys.some(k=>!Object.hasOwn(r,k)))return fail(p);
  return r;
};
export function parseLinkShieldTiltFacts(value:unknown):LinkShieldTiltFacts {
  const r=object(value,'facts',['schema','resource','sourceSampleBasis','coordinateOrigin','worldUnitsPerNativeUnit',
    'points','selectedAngleMapping','angularClosure','linearBetweenCapturedSamples','checksRun']);
  if(r.schema!=='link-guard-source-throw-points/1'||r.sourceSampleBasis!=='native-animation-index'||
    r.coordinateOrigin!=='actorSourceRoot'||r.worldUnitsPerNativeUnit!==5||
    JSON.stringify(r.angularClosure)!=='[0,360]'||!Array.isArray(r.checksRun)||r.checksRun.length!==0||
    typeof r.selectedAngleMapping!=='string'||typeof r.linearBetweenCapturedSamples!=='string')return fail('facts precision');
  const source=object(r.resource,'resource',['path','sha256']);
  if(source.path!=='assets/gen/link-native-reference/extracted/fighter/link/motion/body/c00/b00guard.nuanmb'||
    source.sha256!=='396f3972a717f6887fec2ca277eaa26948c0199fb5367b4e49be7622827acc8a')return fail('source identity');
  if(!Array.isArray(r.points)||r.points.length!==361)return fail('361 source points');
  const points=r.points.map((raw,index)=>{
    const p=object(raw,`points[${index}]`,['rawNativeSample','x','y']);
    if(p.rawNativeSample!==index)return fail(`points[${index}] index`);
    return Object.freeze({x:finite(p.x,`points[${index}].x`),y:finite(p.y,`points[${index}].y`)});
  });
  if(Math.hypot(points[0]!.x-points[360]!.x,points[0]!.y-points[360]!.y)>1e-4)return fail('captured angular closure');
  return Object.freeze({resource:Object.freeze(source) as unknown as LinkShieldTiltFacts['resource'],points:Object.freeze(points)});
}
const facts=parseLinkShieldTiltFacts(rawFacts);
/** Fractional source angles use selected linear interpolation between exact
 * adjacent captured joint points. This is not native skeletal interpolation. */
export function selectLinkShieldTilt(input:LinkShieldTiltInput) {
  const r=object(input,'input',['moveX','moveY','facing','currentHP','actorSourceRoot']);
  const x=finite(r.moveX,'moveX'),y=finite(r.moveY,'moveY'),hp=finite(r.currentHP,'currentHP');
  if(r.facing!==1&&r.facing!==-1)return fail('facing');
  const root=object(r.actorSourceRoot,'actorSourceRoot',['x','y']);
  const rx=finite(root.x,'actorSourceRoot.x'),ry=finite(root.y,'actorSourceRoot.y');
  const magnitude=Math.min(1,Math.hypot(x,y));
  const degrees=magnitude===0?0:Math.atan2(-y,x*r.facing)*180/Math.PI;
  const rawAngle=(degrees%360+360)%360;
  const lower=Math.floor(rawAngle),upper=lower+1,t=rawAngle-lower;
  const a=facts.points[lower]!,b=facts.points[upper]!,neutral=facts.points[0]!;
  const anglePoint={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
  const local={x:(neutral.x+(anglePoint.x-neutral.x)*magnitude)*r.facing,
    y:neutral.y+(anglePoint.y-neutral.y)*magnitude};
  const radius=10.9*5*(Math.max(0,Math.min(50,hp))/50*.85+.15);
  const centre=Object.freeze({x:rx+local.x,y:ry+local.y});
  if(!Number.isFinite(centre.x)||!Number.isFinite(centre.y)||!Number.isFinite(radius))return fail('world transform overflow');
  return Object.freeze({rawAngle,magnitude,centre,radius,sourceRootOffset:Object.freeze(local),
    sourceIdentity:facts.resource,precision:'SOURCE_GUIDED_AUTHORED_MECHANICAL_PLACEMENT' as const,
    nativeBodyBlendProven:false as const,nativeBubbleParentProven:false as const});
}
