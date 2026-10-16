#!/usr/bin/env -S npx tsx
/** Run the production match in Node, with no browser or renderer.
 * npx tsx tools/sim-replay.ts <golden.json|replay.json> [--warmup 600] [--hz 144] [--frames 1800]
 */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import './node-libm-trig';
import type { MatchConfig } from '../src/types';
import type { CapturedFrame } from '../src/replay/InputCaptureBuffer';
import { deserializeReplay } from '../src/replay/ReplayFile';
import { readBuildIdentity } from '../scripts/buildIdentity';
const buildIdentity = readBuildIdentity(path.resolve(import.meta.dirname, '..'));
// Module initializers precompute attack vectors, so load gameplay only after
// the explicit Node host adapter has selected Chromium-compatible math.
const { MatchSim } = await import('../src/sim/MatchSim');

interface Golden {
  readonly scenario: string;
  readonly config: MatchConfig;
  readonly inputs: readonly CapturedFrame[];
  readonly hashes: readonly (readonly [number,string])[];
  readonly dumps?: Readonly<Record<number,string>>;
}
export function firstDifferences(expected: unknown, actual: unknown, prefix = '$', limit = 20): string[] {
  if (Object.is(expected, actual)) return [];
  if (expected === null || actual === null || typeof expected !== 'object' || typeof actual !== 'object') {
    return [`${prefix}: ${JSON.stringify(expected)} → ${JSON.stringify(actual)}`];
  }
  const a = expected as Record<string,unknown>, b = actual as Record<string,unknown>;
  const result: string[] = [];
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    result.push(...firstDifferences(a[key],b[key],`${prefix}.${key}`,limit-result.length));
    if (result.length >= limit) break;
  }
  return result;
}

export function verifyGolden(golden: Golden, options: {warmup?:number; hz?:number; frames?:number; dumpDirectory?:string} = {}) {
  if (options.warmup) {
    const warmup = new MatchSim({matchConfig:{...golden.config,rngSeed:7},buildIdentity});
    for (let index=0;index<options.warmup;index++) warmup.step();
    warmup.dispose();
  }
  const sim = new MatchSim({matchConfig:golden.config,buildIdentity});
  sim.setRecordedInputs(golden.inputs);
  const hz=options.hz??60, count=Math.min(options.frames??golden.hashes.length,golden.hashes.length);
  const started = performance.now();
  let mismatch: {frame:number;expected:string;actual:string}|null=null;
  try {
    for (let index=0;index<count;index++) {
      const target=golden.hashes[index]!;
      let guard=0;
      while (sim.physicsEngine.getFrame()<target[0]&&!sim.isFinished) {
        if (++guard>240) throw new Error('Simulation failed to reach the next recorded frame');
        if (hz===60)sim.step();else sim.advance(1000/hz);
      }
      if(sim.physicsEngine.getFrame()!==target[0])throw new Error(`Cannot capture every target frame at ${hz} Hz; use 60 Hz or higher`);
      const actual=sim.getSimDigest();
      if (!mismatch&&actual.hash!==target[1]) {
        mismatch={frame:target[0],expected:target[1],actual:actual.hash};
        if(options.dumpDirectory){fs.mkdirSync(options.dumpDirectory,{recursive:true});fs.writeFileSync(path.join(options.dumpDirectory,`${golden.scenario}-first-actual.json`),actual.text);}
      }
      if (mismatch&&golden.dumps?.[target[0]]) {
        const expectedText=golden.dumps[target[0]]!;
        if(options.dumpDirectory){fs.mkdirSync(options.dumpDirectory,{recursive:true});fs.writeFileSync(path.join(options.dumpDirectory,`${golden.scenario}-expected.json`),expectedText);fs.writeFileSync(path.join(options.dumpDirectory,`${golden.scenario}-actual.json`),actual.text);}
        return {scenario:golden.scenario,status:'DIVERGED' as const,...mismatch,comparedAtFrame:target[0],differences:firstDifferences(JSON.parse(expectedText),JSON.parse(actual.text))};
      }
      if(mismatch&&(!golden.dumps||!Object.keys(golden.dumps).some(frame=>Number(frame)>target[0])))break;
    }
    const elapsedMs=performance.now()-started;
    return mismatch?{scenario:golden.scenario,status:'DIVERGED' as const,...mismatch}:{scenario:golden.scenario,status:'IDENTICAL' as const,frames:count,hz,warmup:options.warmup??0,elapsedMs,stepsPerSecond:count/(elapsedMs/1000)};
  } finally {sim.dispose();}
}

function numericOption(args:readonly string[],name:string):number|undefined {
  const i=args.indexOf(`--${name}`);if(i<0)return undefined;
  const value=Number(args[i+1]);if(!Number.isFinite(value)||value<=0)throw new Error(`Invalid --${name}`);return value;
}
async function main() {
  const [file,...args]=process.argv.slice(2);if(!file)throw new Error('Usage: npx tsx tools/sim-replay.ts <golden.json|replay.json> [--warmup N] [--hz H] [--frames N]');
  const parsed=JSON.parse(fs.readFileSync(file,'utf8')) as unknown;
  if(Array.isArray(parsed)){
    for(const golden of parsed as Golden[]){const result=verifyGolden(golden,{warmup:numericOption(args,'warmup'),hz:numericOption(args,'hz'),frames:numericOption(args,'frames')});
      console.log(JSON.stringify(result));if(result.status!=='IDENTICAL')process.exitCode=1;}
    return;
  }
  if(parsed&&typeof parsed==='object'&&'hashes' in parsed){
    const result=verifyGolden(parsed as Golden,{warmup:numericOption(args,'warmup'),hz:numericOption(args,'hz'),frames:numericOption(args,'frames'),dumpDirectory:process.env.PF_SIM_DIFF_DIR??'.tmp/sim-diff'});
    console.log(JSON.stringify(result));if(result.status!=='IDENTICAL')process.exitCode=1;
    return;
  }
  const replay=deserializeReplay(parsed);
  const sim=new MatchSim({matchConfig:replay.matchConfig,buildIdentity});sim.setRecordedInputs(replay.inputTimeline.entries);
  const count=Math.min(numericOption(args,'frames')??replay.inputTimeline.entries.length,replay.inputTimeline.entries.length),started=performance.now();
  try{for(let frame=0;frame<count;frame++)while(sim.physicsEngine.getFrame()<=frame&&!sim.isFinished)sim.step();
    console.log(JSON.stringify({frames:sim.physicsEngine.getFrame(),hash:sim.getSimDigest().hash,elapsedMs:performance.now()-started,finished:sim.isFinished}));
  }finally{sim.dispose();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(import.meta.filename))await main();
