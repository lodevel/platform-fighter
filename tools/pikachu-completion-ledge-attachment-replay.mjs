import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tsImport } from 'tsx/esm/api';
const output='docs/review/2026-10-06/pikachu-character/integration/completion-ledge-attachment-corrected-reviewed';
const report=JSON.parse(await readFile(`${output}/ledge-match-observations.json`,'utf8'));
const {selectPikachuLedgeAttachment:selectAttachment}=await tsImport(new URL('../src/characters/pikachuLedgeAttachment.ts',import.meta.url).pathname,import.meta.url);
const {PIKACHU_STATE_AUTHORED_HURTBOX_POSES:poses}=await tsImport(new URL('../.tmp/pikachu-context-corrected-production-pikachuStateHurtboxes.ts',import.meta.url).pathname,import.meta.url);
const expectRoot=false;
  assert.equal(report.rows.length, 6);
  for (const row of report.rows) {
    for(const c of row.captures){const o=c.observation;assert.equal(o.receiving.length,12,`${o.sheet}: paired12caps`);assert.equal(o.origin[0],.5);assert.equal(o.origin[1],416/640);if(o.sheet!=='ledge_attack'){const expected=poses.find(p=>p.sheet===o.sheet&&p.artFrameIndex===o.textureFrame);assert.ok(expected,`${o.sheet}/${o.textureFrame} accepted receiving`);assert.deepEqual(o.receiving,expected.hurtboxes);}}
    assert.equal(row.tuning.catchFrames, 19);
    assert.ok(row.catchTrace.every(frame => frame.ledge.name === 'hanging'), 'catch19 gate must suppress up option');
    for(const x of [...row.catchTrace,...row.trace]){const a=x.attachment;if(!a)continue;const expected=selectAttachment(a.sheet,a.localFrame);assert.ok(expected);assert.equal(a.artFrameIndex,expected.artFrameIndex);assert.ok(Math.abs(x.position.x-a.position.x)<.15,`physicalX ${row.side}/${row.option}/${a.localFrame}`);assert.ok(Math.abs(x.position.y-a.position.y)<.15,`physicalY ${row.side}/${row.option}/${a.localFrame}`);if(a.mode==='pin-hand'){assert.ok(Math.abs(x.position.x+a.handX*a.facing-a.corner.x)<.02,'HandL X pinned');assert.ok(Math.abs(x.position.y+a.handY-a.corner.y)<.02,'HandL Y pinned');}}
    if (row.option === 'climb' || row.option === 'roll') {
      const state = row.option === 'climb' ? 'climbing' : 'rolling';
      const active = row.trace.filter(frame => frame.ledge.name === state);
      assert.equal(active.length, row.option === 'climb' ? 32 : 49);
      assert.equal(active.filter(frame => frame.invincible).length, row.option === 'climb' ? 31 : 26);
      assert.ok(active.some(x=>x.attachment&&!x.attachment.attached),'attachment releases at actual platform clearance');assert.equal(row.trace.at(-1).attachment,null);assert.ok(row.trace.at(-1).position.x>row.floor.minX+25&&row.trace.at(-1).position.x<row.floor.maxX-25,'source root ends inside platform');
    } else if(row.option==='hang'){
      const {camera:beforeCamera,...before}=row.freeze.before;const {camera:afterCamera,...after}=row.freeze.after;assert.deepEqual(before,after);assert.equal(row.trace.length,125);assert.ok(row.trace.every(x=>x.ledge.name==='hanging'));assert.equal(new Set(row.captures.filter(c=>c.observation.sheet==='ledge').map(c=>c.observation.textureFrame)).size,4);
    } else if (row.option === 'attack') {
      const active = row.trace.filter(frame => frame.attack);
      assert.equal(active[0].attack.id, 'pikachu.ledgeAttack');
      assert.equal(active[0].attack.frame, 0);
      if(expectRoot){
        assert.deepEqual(active.map(x=>x.attack.frame),Array.from({length:55},(_,i)=>i));
        const facing=row.side==='left'?1:-1,corner=row.side==='left'?row.floor.minX:row.floor.maxX;
        for(const x of active){const point=rootPoints[x.attack.frame];assert.ok(Math.abs(x.position.x-(corner+point.x*facing))<.15,`source root X ${row.side}/${x.attack.frame}`);assert.ok(Math.abs(x.position.y-(row.floor.top-25+point.y))<.15,`source root Y ${row.side}/${x.attack.frame}`);}
        assert.ok(active.at(-1).grounded,'ledge attack must return to actual solid platform');
        assert.ok(active.at(-1).position.x>row.floor.minX+25 && active.at(-1).position.x<row.floor.maxX-25,'ledge attack ends safely inside stage');
      }
      assert.equal(active.filter(frame => frame.receiving.some(h => h.intangible)).length, 25);
    } else {
      assert.equal(row.trace[0].grounded, false);
      assert.equal(row.trace.filter(frame => frame.invincible).length, 12);
    }
  }
  assert.deepEqual(report.errors, []); const audit={result:'PASS',scope:'Independent complete actual saved traces; original failure was camera interpolation in pause checker. Only camera telemetry excluded; all physical positions, action clocks,receiving,attachment remain compared.',observationsSha256:createHash('sha256').update(await readFile(`${output}/ledge-match-observations.json`)).digest('hex'),bundleSha256:report.bundleSha256,cases:report.rows.length,captures:report.rows.reduce((n,r)=>n+r.captures.length,0)};
await writeFile(`${output}/attachment-independent-audit.json`,JSON.stringify(audit,null,2)+'\n');console.log(JSON.stringify(audit));
