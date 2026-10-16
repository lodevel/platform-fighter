/** Complete-world reconstruction transport. Replays production history from
 * initial construction; this is not an instant serialized-state rewind. */
import {deserializeReplay,REPLAY_FORMAT_VERSION,type ReplayFile} from './ReplayFile';
import {deserializeBindingsSnapshot} from '../input/InputBindingsSerializer';
import {deserializeCustomStage} from '../builder/customStageSerializer';
import {parseCharacterDataFile} from '../characters/characterSerializer';
import type {CharacterDataSpec} from '../characters/characterSerializer';
import {parseInputResolverHistoryState,type InputResolverHistoryState} from '../input/InputResolver';

export interface MatchHistoryCheckpoint {
  readonly schema:'match-history-checkpoint/1';readonly buildIdentity:string;
  readonly frame:number;readonly viewport:{readonly width:number;readonly height:number};
  readonly replay:ReplayFile;readonly bindingsSnapshot:string;readonly customStage:string|null;
  readonly characterOverrides:readonly {readonly slotIndex:1|2|3|4;readonly spec:CharacterDataSpec}[];
  readonly constructionPositions:readonly {readonly playerIndex:number;readonly x:number;readonly y:number}[];
  readonly stageIdentity:string;readonly worldEvidence:string;readonly labMode:boolean;
  readonly clock:{readonly accumulatorMs:number;readonly paused:boolean;readonly pausedForMenu:boolean};
  readonly intro:{readonly frame:number;readonly accumulatorMs:number;readonly participants:readonly number[]}|null;
  readonly inputResolver:InputResolverHistoryState;
  readonly sceneInput:{readonly prevStartHeld:boolean};
}
const keys=['schema','buildIdentity','frame','viewport','replay','bindingsSnapshot','customStage','characterOverrides',
  'constructionPositions','stageIdentity','worldEvidence','labMode','intro','clock','inputResolver','sceneInput'];
const int=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
function closed(v:unknown,fields:readonly string[],path:string):Record<string,unknown>{
  if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==fields.length||fields.some(k=>!Object.hasOwn(v,k)))
    throw new TypeError(`Invalid closed match history checkpoint ${path}`);
  return v as Record<string,unknown>;
}
/** Reject nonfinite measurements before JSON can normalize them into null. */
export function matchHistoryJson(value:unknown):string {
  return JSON.stringify(value,(_key,v)=>{if(typeof v==='number'&&!Number.isFinite(v)||typeof v==='function'||
    typeof v==='symbol'||typeof v==='bigint'||v===undefined)throw new TypeError('Match history must contain finite explicit JSON values');return v;});
}
export function parseMatchHistoryCheckpoint(value:unknown,expectedBuildIdentity:string):MatchHistoryCheckpoint {
  const r=closed(value,keys,'root');
  if(r.schema!=='match-history-checkpoint/1'||!/^platform-fighter-sha256-[a-f0-9]{64}$/.test(expectedBuildIdentity)||
    r.buildIdentity!==expectedBuildIdentity||!int(r.frame)||r.frame>36000||typeof r.labMode!=='boolean'||typeof r.stageIdentity!=='string'||!r.stageIdentity||typeof r.worldEvidence!=='string'||!r.worldEvidence)
    throw new TypeError('Exact build and bounded real match history required');
  matchHistoryJson(value);
  const evidence=JSON.parse(r.worldEvidence as string) as {schema?:unknown;frame?:unknown};
  if(!evidence||evidence.schema!=='match-history-evidence/1'||evidence.frame!==r.frame)
    throw new TypeError('Independent actual world witness must match the checkpoint frame');
  const viewport=closed(r.viewport,['width','height'],'viewport');
  if(!finite(viewport.width)||!finite(viewport.height)||viewport.width<=0||viewport.height<=0)throw new TypeError('Exact construction viewport required');
  if(!r.replay||typeof r.replay!=='object'||(r.replay as {version?:unknown}).version!==REPLAY_FORMAT_VERSION)
    throw new TypeError('A new checkpoint requires complete current-format input history');
  const clock=closed(r.clock,['accumulatorMs','paused','pausedForMenu'],'clock');
  if(!finite(clock.accumulatorMs)||clock.accumulatorMs<0||clock.accumulatorMs>=1000/60||
    typeof clock.paused!=='boolean'||typeof clock.pausedForMenu!=='boolean')throw new TypeError('Exact fixed-step residue and pause state required');
  const replay=deserializeReplay(r.replay);
  const inputResolver=parseInputResolverHistoryState(r.inputResolver);
  const sceneInput=closed(r.sceneInput,['prevStartHeld'],'sceneInput');
  if(typeof sceneInput.prevStartHeld!=='boolean')throw new TypeError('Actual gamepad START edge cache required');
  if(inputResolver.lastFrame>=r.frame||inputResolver.slots.length!==replay.matchConfig.players.length)
    throw new TypeError('Actual input cache must belong to the checkpoint frame and participants');
  if(replay.metadata.engineVersion!==expectedBuildIdentity||replay.metadata.fixedTimestepMs!==1000/60||
    replay.inputTimeline.entries.length!==r.frame||replay.inputTimeline.entries.some((row,index)=>row.frame!==index))
    throw new TypeError('Reconstruction needs every actual frame from0 through checkpoint−1');
  if(typeof r.bindingsSnapshot!=='string')throw new TypeError('Exact saved physical binding profiles required');
  deserializeBindingsSnapshot(r.bindingsSnapshot);
  if(r.customStage!==null){if(typeof r.customStage!=='string')throw new TypeError('Inline custom stage required');deserializeCustomStage(r.customStage);}
  if(!Array.isArray(r.characterOverrides))throw new TypeError('Exact Lab overrides required');
  const overrides=r.characterOverrides.map((row,index)=>{const o=closed(row,['slotIndex','spec'],`overrides[${index}]`);
    if(![1,2,3,4].includes(o.slotIndex as number))throw new TypeError('Invalid override slot');
    return {slotIndex:o.slotIndex as 1|2|3|4,spec:parseCharacterDataFile(o.spec,'history checkpoint override')};});
  if(new Set(overrides.map(row=>row.slotIndex)).size!==overrides.length)throw new TypeError('Duplicate override slot');
  if(!Array.isArray(r.constructionPositions)||r.constructionPositions.length>64)throw new TypeError('Bounded genuine construction events required');
  const positions=r.constructionPositions.map((row,index)=>{const p=closed(row,['playerIndex','x','y'],`construction[${index}]`);
    if(!int(p.playerIndex)||p.playerIndex>=replay.matchConfig.players.length||!finite(p.x)||!finite(p.y))throw new TypeError('Invalid actual construction position');
    return {playerIndex:p.playerIndex,x:p.x,y:p.y};});
  let intro:MatchHistoryCheckpoint['intro']=null;
  if(r.intro!==null){const p=closed(r.intro,['frame','accumulatorMs','participants'],'intro');
    if(r.frame!==0||!int(p.frame)||p.frame>=121||!finite(p.accumulatorMs)||p.accumulatorMs<0||p.accumulatorMs>=1000/60||
      !Array.isArray(p.participants)||!p.participants.length||p.participants.some(v=>!int(v)||v>=replay.matchConfig.players.length)||
      new Set(p.participants).size!==p.participants.length)throw new TypeError('Exact initial intro-domain clock required');
    intro={frame:p.frame,accumulatorMs:p.accumulatorMs,participants:p.participants};
  }
  return Object.freeze({...r,replay,viewport,clock,characterOverrides:overrides,constructionPositions:positions,intro,inputResolver,sceneInput}) as unknown as MatchHistoryCheckpoint;
}
