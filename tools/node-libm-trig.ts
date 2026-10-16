/** Chromium 148 enables V8's libm-trig mode; Node builds omit that flag.
 * Install its pinned libm functions before loading the match's modules so
 * precomputed move vectors and runtime physics use the browser's exact math.
 * This adapter belongs to the Node runner, never the simulation/browser graph.
 */
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const source=fileURLToPath(new URL('./node-libm-trig.c',import.meta.url));
const binary=fileURLToPath(new URL('../.tmp/build/node-libm-trig.node',import.meta.url));
const vendor=fileURLToPath(new URL('./vendor/chromium-libm/',import.meta.url));
// The V8 flag changes sin/cos only. tan and the inverse trig functions retain
// V8's own implementation in both hosts and must not be replaced with libm.
const names=['sin','cos'] as const;
type Libm={ [K in typeof names[number]]: typeof Math[K] };

export function installChromiumLibmTrig():void {
  const changed=Math.max(fs.statSync(source).mtimeMs,...fs.readdirSync(vendor).map(file=>fs.statSync(path.join(vendor,file)).mtimeMs));
  if(!fs.existsSync(binary)||changed>fs.statSync(binary).mtimeMs){
    fs.mkdirSync(path.dirname(binary),{recursive:true});
    const include=process.env.PF_NODE_HEADERS??'/usr/include/node';
    const candidate=`${binary}.${process.pid}.tmp`;
    const result=spawnSync(process.env.CC??'cc',['-shared','-fPIC','-O3','-ffp-contract=off',`-I${include}`,source,
      ...['s_sin.c','sincostab.c','branred.c'].map(file=>path.join(vendor,file)),'-o',candidate,'-lm'],{encoding:'utf8'});
    if(result.status!==0){fs.rmSync(candidate,{force:true});throw new Error(`Cannot build Chromium libm adapter. Install a C compiler and Node N-API headers, or set CC/PF_NODE_HEADERS. ${result.error?.message??result.stderr}`);}
    fs.renameSync(candidate,binary);
  }
  const libm=createRequire(import.meta.url)(binary) as Libm;
  for(const name of names)Object.defineProperty(Math,name,{value:libm[name],configurable:true,writable:true});
}
installChromiumLibmTrig();
