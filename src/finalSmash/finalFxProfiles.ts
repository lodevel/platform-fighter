/** Noncombat source-guided Final effect art. Native particle assets and common
 * lifetime/parenting callers are not supplied by a fighter's body drawing. */
import type {FinalSmashActorControl} from './finalSmashActorControl';
import {transformPikachuFinalOrientationPoint} from './pikachuFinalOrientation';

/** A Final FX point in world px (x forward, y down); not tied to any fighter's presentation module. */
export interface FxPoint {readonly x:number;readonly y:number}
/** Fighters whose Final can carry source-guided FX. Link has no selected cue yet: its profile
 * registers once its Final effect art is installed (the Ancient Arrow itself is an article, linkArticles). */
export const FINAL_FX_FIGHTERS=['donkeykong','pikachu','link'] as const;
export type FinalFxFighter=typeof FINAL_FX_FIGHTERS[number];
export function isFinalFxFighter(fighter:string):fighter is FinalFxFighter{return (FINAL_FX_FIGHTERS as readonly string[]).includes(fighter);}

export interface FinalFxCueFact {
  readonly key:string;readonly fighter:FinalFxFighter;readonly motion:string;readonly phases:readonly string[];
  readonly clockDomain:'owner-motion'|'run-flight';
  readonly carryAdmission:{readonly motion:string;readonly phase:'startup';readonly startAge:number}|null;
  readonly source:{readonly function:string;readonly path:string;readonly sha256:string;readonly effectName:string;
    readonly line:number;readonly lexicalNativeFrame:number;readonly bone:'top'|'hip'};
  readonly selection:{readonly startAge:number;readonly endAgeExclusive:number|null;readonly repeatEveryFrames:number|null;
    readonly lifetimeFrames:number|null;readonly localOffset:FxPoint;readonly angleDegrees:number;readonly scale:number;
    readonly layer:'behind-body'|'in-front';readonly bodyAgeOffset:number};
  readonly precision:'SOURCE_GUIDED_AUTHORED_FINAL_FX_CLOCK';
}
export interface FinalFxPoint {readonly bone:'top'|'hip';readonly point:FxPoint;readonly reviewKey:string;
  readonly precision:'captured-bone'|'authored-virtual-top';}
interface FxAnimation {readonly frameWidth:number;readonly frameHeight:number;readonly frameCount:number;}
interface FxDrawing {readonly startAge:number;readonly endAgeExclusive:number;readonly frameIndex:number;
  readonly render?:{readonly sheet:string;readonly frameIndex:number};}
export interface FinalFxProfile {
  readonly cueKey:string;readonly sheet:string;readonly frameWidth:number;readonly frameHeight:number;
  readonly scaleToWorld:number;readonly originX:number;readonly originY:number;readonly endAgeExclusive:number;
  readonly loopFrames:number|null;readonly terminalHold:boolean;readonly drawings:readonly FxDrawing[];
  readonly authoredSourceIdentity:{readonly kind:'AUTHORED_SOURCE_GUIDED_FINAL_EFFECT';readonly recipeId:string;readonly sha256:string;readonly reviewKey:string};
}
export type FinalFxProfiles=ReadonlyMap<string,FinalFxProfile>;
function object(v:unknown,p:string,required:readonly string[],optional:readonly string[]=[]):Record<string,unknown>{
  if(!v||typeof v!=='object'||Array.isArray(v))throw new TypeError(`${p} must be object`);const r=v as Record<string,unknown>;
  if(required.some(k=>!Object.hasOwn(r,k))||Object.keys(r).some(k=>![...required,...optional].includes(k)))throw new TypeError(`${p} has unsupported fields`);return r;
}
function number(v:unknown,p:string,min=0):number{if(typeof v!=='number'||!Number.isFinite(v)||v<min)throw new TypeError(`${p} must be finite >=${min}`);return v;}
function integer(v:unknown,p:string,min=0):number{const n=number(v,p,min);if(!Number.isSafeInteger(n))throw new TypeError(`${p} must be integer`);return n;}
function string(v:unknown,p:string):string{if(typeof v!=='string'||!v.trim())throw new TypeError(`${p} must be nonempty`);return v;}
function hash(v:unknown,p:string):string{const s=string(v,p);if(!/^[a-f0-9]{64}$/.test(s))throw new TypeError(`${p} must be SHA256`);return s;}
function point(v:unknown,p:string):FxPoint{const r=object(v,p,['x','y']);return Object.freeze({x:number(r.x,p+'.x',-Infinity),y:number(r.y,p+'.y',-Infinity)});}
export function parseFinalFxPoints(value:unknown,path='finalFxPoints'):readonly FinalFxPoint[]{
  if(!Array.isArray(value))throw new TypeError(`${path} must be array`);const bones=new Set<string>();
  return Object.freeze(value.map((value,i)=>{const p=`${path}[${i}]`,r=object(value,p,['bone','point','reviewKey','precision']);
    if(!['top','hip'].includes(String(r.bone))||bones.has(String(r.bone))||!['captured-bone','authored-virtual-top'].includes(String(r.precision))||
      r.bone==='hip'&&r.precision!=='captured-bone')throw new TypeError(`${p} invalid anatomical/source anchor`);
    bones.add(String(r.bone));return Object.freeze({bone:r.bone as 'top'|'hip',point:point(r.point,p+'.point'),
      reviewKey:string(r.reviewKey,p+'.reviewKey'),precision:r.precision as FinalFxPoint['precision']});}));
}

export function parseFinalFxCueFacts(value:unknown):readonly FinalFxCueFact[]{
  const r=object(value,'finalFxCues',['schema','status','cues']);
  if(r.schema!=='source-guided-final-fx-cues/1'||!['PENDING_SOURCE_SELECTION','SOURCE_CUES_SELECTED'].includes(String(r.status))||!Array.isArray(r.cues)||
    r.status==='PENDING_SOURCE_SELECTION'&&r.cues.length)throw new TypeError('Unsupported Final FX cue facts');
  const keys=new Set<string>();
  return Object.freeze(r.cues.map((value,i)=>{const p=`finalFxCues[${i}]`,row=object(value,p,['key','fighter','motion','phases','source','selection','precision','clockDomain','carryAdmission']),
    key=string(row.key,p+'.key'),source=object(row.source,p+'.source',['function','path','sha256','effectName','line','lexicalNativeFrame','bone']),
    selection=object(row.selection,p+'.selection',['startAge','endAgeExclusive','repeatEveryFrames','lifetimeFrames','localOffset','angleDegrees','scale','layer','bodyAgeOffset']);
    if(keys.has(key)||!isFinalFxFighter(String(row.fighter))||!/^final[_a-z0-9]*$/.test(String(row.motion))||
      !Array.isArray(row.phases)||!row.phases.length||row.phases.some(v=>typeof v!=='string'||!v)||new Set(row.phases).size!==row.phases.length||
      row.precision!=='SOURCE_GUIDED_AUTHORED_FINAL_FX_CLOCK'||!['top','hip'].includes(String(source.bone))||
      !['behind-body','in-front'].includes(String(selection.layer))||!['owner-motion','run-flight'].includes(String(row.clockDomain)))throw new TypeError(`${p} invalid cue identity`);
    const carry=row.carryAdmission===null?null:object(row.carryAdmission,p+'.carryAdmission',['motion','phase','startAge']);
    if(row.clockDomain==='owner-motion'&&carry!==null||row.clockDomain==='run-flight'&&(!carry||carry.phase!=='startup'||row.fighter!=='pikachu'))throw new TypeError(`${p} invalid actual startup carry admission`);
    keys.add(key);const startAge=number(selection.startAge,p+'.startAge'),endAgeExclusive=selection.endAgeExclusive===null?null:number(selection.endAgeExclusive,p+'.endAgeExclusive');
    if(endAgeExclusive!==null&&endAgeExclusive<=startAge)throw new TypeError(`${p} invalid cue interval`);
    if(selection.lifetimeFrames===null&&(row.clockDomain!=='run-flight'||startAge!==0||endAgeExclusive!==null||selection.repeatEveryFrames!==null)||
      row.clockDomain==='run-flight'&&selection.lifetimeFrames!==null)throw new TypeError(`${p} run carry must end only at real flight-owner exit`);
    return Object.freeze({key,fighter:row.fighter as FinalFxCueFact['fighter'],motion:String(row.motion),phases:Object.freeze([...row.phases] as string[]),
      clockDomain:row.clockDomain as FinalFxCueFact['clockDomain'],carryAdmission:carry?Object.freeze({motion:string(carry.motion,p+'.carry.motion'),phase:'startup' as const,startAge:number(carry.startAge,p+'.carry.startAge')}):null,
      source:Object.freeze({function:string(source.function,p+'.function'),path:string(source.path,p+'.path'),sha256:hash(source.sha256,p+'.sha256'),
        effectName:string(source.effectName,p+'.effectName'),line:integer(source.line,p+'.line',1),lexicalNativeFrame:number(source.lexicalNativeFrame,p+'.lexicalNativeFrame'),bone:source.bone as 'top'|'hip'}),
      selection:Object.freeze({startAge,endAgeExclusive,repeatEveryFrames:selection.repeatEveryFrames===null?null:integer(selection.repeatEveryFrames,p+'.repeatEveryFrames',1),
        lifetimeFrames:selection.lifetimeFrames===null?null:integer(selection.lifetimeFrames,p+'.lifetimeFrames',1),localOffset:point(selection.localOffset,p+'.localOffset'),
        angleDegrees:number(selection.angleDegrees,p+'.angleDegrees',-Infinity),scale:number(selection.scale,p+'.scale',Number.MIN_VALUE),layer:selection.layer as 'behind-body'|'in-front',
        bodyAgeOffset:number(selection.bodyAgeOffset,p+'.bodyAgeOffset',-Infinity)}),
      precision:'SOURCE_GUIDED_AUTHORED_FINAL_FX_CLOCK' as const});}));
}

export function parseFinalFxProfiles(value:unknown,fighter:string,animations:Readonly<Record<string,FxAnimation>>,facts:readonly FinalFxCueFact[]):FinalFxProfiles{
  if(value===undefined)return new Map();const root=object(value,'finalFxProfiles',['schema','fighter','profiles']);
  if(root.schema!=='source-guided-final-fx-profiles/1'||root.fighter!==fighter)throw new TypeError('Final FX fighter/schema mismatch');
  if(!root.profiles||typeof root.profiles!=='object'||Array.isArray(root.profiles))throw new TypeError('Final FX profiles must be object');
  const profiles=new Map<string,FinalFxProfile>();
  for(const [key,value]of Object.entries(root.profiles)){const p=`finalFxProfiles.${key}`,r=object(value,p,
    ['cueKey','sheet','frameWidth','frameHeight','scaleToWorld','originX','originY','endAgeExclusive','loopFrames','terminalHold','drawings','authoredSourceIdentity']);
    if(r.cueKey!==key||!facts.some(f=>f.key===key&&f.fighter===fighter))throw new TypeError(`${p} requires exact selected source cue`);
    const sheet=string(r.sheet,p+'.sheet'),frameWidth=integer(r.frameWidth,p+'.frameWidth',1),frameHeight=integer(r.frameHeight,p+'.frameHeight',1),
      endAgeExclusive=integer(r.endAgeExclusive,p+'.endAgeExclusive',1),loopFrames=r.loopFrames===null?null:integer(r.loopFrames,p+'.loopFrames',1),
      source=object(r.authoredSourceIdentity,p+'.authoredSourceIdentity',['kind','recipeId','sha256','reviewKey']);
    if(source.kind!=='AUTHORED_SOURCE_GUIDED_FINAL_EFFECT'||typeof r.terminalHold!=='boolean'||!Array.isArray(r.drawings)||!r.drawings.length||
      loopFrames!==null&&(loopFrames>endAgeExclusive||r.terminalHold))throw new TypeError(`${p} invalid authored effect clock`);
    let priorEnd=0;const drawings=r.drawings.map((value,i):FxDrawing=>{const d=object(value,`${p}.drawings[${i}]`,['startAge','endAgeExclusive','frameIndex'],['render']),
      startAge=integer(d.startAge,p+'.startAge'),end=integer(d.endAgeExclusive,p+'.endAgeExclusive',1),frameIndex=integer(d.frameIndex,p+'.frameIndex');
      if(startAge!==priorEnd||end<=startAge||frameIndex!==i)throw new TypeError(`${p} noncontiguous authored drawing`);priorEnd=end;
      const a=d.render===undefined?null:object(d.render,p+'.render',['sheet','frameIndex']),render=a?{sheet:string(a.sheet,p+'.render.sheet'),frameIndex:integer(a.frameIndex,p+'.render.frameIndex')}:undefined,
        animation=animations[render?.sheet??sheet];
      if(!animation||animation.frameWidth!==frameWidth||animation.frameHeight!==frameHeight||!Number.isSafeInteger(animation.frameCount)||
        (render?.frameIndex??frameIndex)>=animation.frameCount)throw new TypeError(`${p} unmatched actual page/frame metrics`);
      return Object.freeze({startAge,endAgeExclusive:end,frameIndex,...(render?{render:Object.freeze(render)}:{})});});
    if(priorEnd!==endAgeExclusive)throw new TypeError(`${p} incomplete authored drawing coverage`);
    if(facts.find(f=>f.key===key)!.clockDomain==='run-flight'&&loopFrames===null&&!r.terminalHold)
      throw new TypeError(`${p} persistent carry needs explicit authored loop or terminal hold`);
    profiles.set(key,Object.freeze({cueKey:key,sheet,frameWidth,frameHeight,endAgeExclusive,loopFrames,terminalHold:r.terminalHold,
      originX:number(r.originX,p+'.originX',-Infinity),originY:number(r.originY,p+'.originY',-Infinity),scaleToWorld:number(r.scaleToWorld,p+'.scaleToWorld',Number.MIN_VALUE),drawings:Object.freeze(drawings),
      authoredSourceIdentity:Object.freeze({kind:'AUTHORED_SOURCE_GUIDED_FINAL_EFFECT',recipeId:string(source.recipeId,p+'.recipeId'),sha256:hash(source.sha256,p+'.recipeSha256'),reviewKey:string(source.reviewKey,p+'.reviewKey')})}));
  }
  return profiles;
}

/** The drawing an effect profile shows `age` ticks into one occurrence (looped, held on its last
 * drawing, or none past its end). Also the tick rule of the effect's package action (legacyClips.ts). */
export function finalFxDrawingAt(profile:FinalFxProfile,age:number):{readonly sheet:string;readonly frameIndex:number}|null{
  const artAge=profile.loopFrames===null?age:age%profile.loopFrames,
    selectedAge=profile.terminalHold?Math.min(artAge,profile.endAgeExclusive-1):artAge,
    drawing=profile.drawings.find(row=>row.startAge<=selectedAge&&selectedAge<row.endAgeExclusive);
  return drawing?{sheet:drawing.render?.sheet??profile.sheet,frameIndex:drawing.render?.frameIndex??drawing.frameIndex}:null;
}

export function selectFinalFxPresentation(facts:readonly FinalFxCueFact[],profiles:FinalFxProfiles,input:{fighter:string;ownerIndex:number;generation:number;
  control:FinalSmashActorControl;sourceRoot:FxPoint;points:readonly FinalFxPoint[];bodyAvailable:boolean;
  flightClock:{readonly elapsed:number;readonly armedKeys:readonly string[]}|null}){
  const {control}=input,dependencies:string[]=[],poses:Array<{key:string;cue:FinalFxCueFact;profile:FinalFxProfile;sheet:string;frameIndex:number;
    age:number;point:FxPoint;rotationDegrees:number;facing:1|-1;runId:number;ownerIndex:number;generation:number;occurrence:number}>=[];
  if(control.role!=='owner'||!isFinalFxFighter(input.fighter))return{poses,dependencies};
  if(!Number.isSafeInteger(input.ownerIndex)||input.ownerIndex<0||!Number.isSafeInteger(input.generation)||input.generation<0||
    !Number.isSafeInteger(control.runId)||control.runId<0||!Number.isFinite(control.age)||control.age<0||
    ![1,-1].includes(control.facing)||![input.sourceRoot.x,input.sourceRoot.y,control.rotationDegrees??0].every(Number.isFinite))
    throw new TypeError('Final FX requires finite actual owner/run/ROOT clock');
  if(!facts.some(f=>f.fighter===input.fighter)){dependencies.push(`Missing selected ${input.fighter} Final FX source cues`);return{poses,dependencies};}
  for(const cue of facts){const clockAge=cue.clockDomain==='run-flight'?input.flightClock?.armedKeys.includes(cue.key)?input.flightClock.elapsed:null:control.age+cue.selection.bodyAgeOffset;
    if(cue.fighter!==input.fighter||cue.clockDomain==='owner-motion'&&cue.motion!==control.sheet||!cue.phases.includes(control.phase)||clockAge===null||clockAge<cue.selection.startAge||
      cue.selection.endAgeExclusive!==null&&clockAge>=cue.selection.endAgeExclusive)continue;
    const elapsed=clockAge-cue.selection.startAge,period=cue.selection.repeatEveryFrames,
      last=period===null?0:Math.floor(elapsed/period),first=period===null?0:Math.max(0,Math.floor((elapsed-cue.selection.lifetimeFrames!)/period)+1);
    if(first>last||period===null&&cue.selection.lifetimeFrames!==null&&elapsed>=cue.selection.lifetimeFrames)continue;
    const profile=profiles.get(cue.key),anchor=input.points.find(point=>point.bone===cue.source.bone);
    if(!profile){dependencies.push(`Missing authored Final FX profile ${cue.key}`);continue;}
    if(!input.bodyAvailable||!anchor){dependencies.push(`Missing paired ${cue.source.bone} registration for Final FX ${cue.key}`);continue;}
    for(let occurrence=first;occurrence<=last;occurrence++){
      const age=elapsed-(period??0)*occurrence;if(cue.selection.lifetimeFrames!==null&&age>=cue.selection.lifetimeFrames)continue;
      const drawing=finalFxDrawingAt(profile,age);
      if(!drawing){dependencies.push(`Missing authored Final FX drawing ${cue.key}/${age}`);continue;}
      const operator={facing:control.facing,rotationDegrees:control.rotationDegrees??0},
        offset=transformPikachuFinalOrientationPoint({x:anchor.point.x+cue.selection.localOffset.x,y:anchor.point.y+cue.selection.localOffset.y},operator);
      poses.push({key:JSON.stringify([control.runId,input.ownerIndex,input.generation,cue.clockDomain==='run-flight'?'run-flight':control.phase,cue.key,occurrence]),cue,profile,
        sheet:drawing.sheet,frameIndex:drawing.frameIndex,age,
        point:{x:input.sourceRoot.x+offset.x,y:input.sourceRoot.y+offset.y},rotationDegrees:(control.rotationDegrees??0)+cue.selection.angleDegrees*control.facing,
        facing:control.facing,runId:control.runId,ownerIndex:input.ownerIndex,generation:input.generation,occurrence});
    }
  }
  return{poses,dependencies};
}
