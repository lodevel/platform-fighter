import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

it('matches frozen Chromium frame hashes for all nine scenario openings in a real Node process',()=>{
  const root=fileURLToPath(new URL('../../',import.meta.url));
  const output=execFileSync(process.execPath,['--import','tsx','tools/sim-replay.ts','src/sim/fixtures/golden-openings.json'],{
    cwd:root,encoding:'utf8',timeout:60000,
  });
  const results=output.trim().split('\n').map(line=>JSON.parse(line) as {status:string;frames:number});
  expect(results).toHaveLength(9);
  for(const result of results){expect(result.status).toBe('IDENTICAL');expect(result.frames).toBe(64);}
},65000);
