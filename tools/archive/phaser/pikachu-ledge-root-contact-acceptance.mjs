import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { tsImport } from 'tsx/esm/api';
import { chromium } from 'playwright';
const output = process.env.PF_REGISTRY_OUTPUT ?? 'docs/review/2026-10-06/pikachu-character/integration/ledge-root-contacts';
const metadata=JSON.parse(await readFile(process.env.PF_PIKACHU_METADATA ?? 'assets/characters/pikachu/frames.json','utf8'));
const {PIKACHU_STATE_AUTHORED_HURTBOX_POSES:poses}=await tsImport(process.env.PF_PIKACHU_STATE_LEAF ?? new URL('../src/characters/pikachuStateHurtboxes.ts',import.meta.url).pathname,import.meta.url);
const { STALE_FRESH_MULTIPLIER } = await tsImport(new URL('../src/characters/combat.ts',import.meta.url).pathname,import.meta.url);
const expectRoot=false;
const rootRecord=JSON.parse(await readFile('docs/review/2026-10-06/pikachu-character/sources/ledge-attack-exact-root-trajectory.json','utf8'));
const rootPoints=rootRecord.frames.filter(r=>r.nativeSample<55).map(r=>r.sourceProjectedTrans);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { scope: 'Actual stage-corner detection and InputResolver ledge attack from both corners against ordinary Wolf receiving: onstage source9damage and farther miss, dedicated7bodywindows/12caps, source25 protection counted on unique action ages across real hitlag. Source-guided beta corner-root adapter; native common cliff attachment/rate parity remains separate.', errors: [], rows: [] };
page.on('pageerror', error => report.errors.push(error.message));
try {
  await page.goto(process.env.PF_REGISTRY_URL ?? 'http://127.0.0.1:4216/platform-fighter/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'));
  report.bundle = await page.evaluate(() => [...document.scripts].map(script => script.src).find(src => /\/assets\/index-.*\.js/.test(src)));
  report.bundleSha256 = createHash('sha256').update(await (await page.request.get(report.bundle)).body()).digest('hex');
  await page.exposeFunction('__captureLedge',async name=>page.screenshot({path:`${output}/${name}`}));
  report.rows = await page.evaluate(async ({metadata}) => {
    const game = window.__game;
    for (const s of game.scene.getScenes(true)) game.scene.stop(s.scene.key);
    game.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 328,
      itemFrequency: 'off', players: [{ index: 1, characterId: 'pikachu', paletteIndex: 0, inputType: 'keyboard_p1' },
        { index: 2, characterId: 'donkeykong', paletteIndex: 0, inputType: 'keyboard_p2' }] } });
    const scene = game.scene.getScene('MatchScene'); scene.physicsEngine.pause(); scene.roundStartCountdown = 0;
    let input = {};
    scene.inputResolver.getMoveVector = slot => ({ x: slot === 1 ? input.moveX ?? 0 : 0, y: slot === 1 ? input.moveY ?? 0 : 0 });
    scene.inputResolver.isActionHeld = (slot, action) => slot === 1 && input[action] === true;
    const step = (next = {}) => { input = next; scene.physicsEngine.resume(); scene.update(0, scene.physicsEngine.fixedTimestepMs); scene.physicsEngine.pause(); };
    const floor = scene.baseStage.bodies.platformBodies.find(b => b.label === 'platform.solid');
    const observe = () => ({ ledge: scene.p1.getLedgeHangState(), attack: scene.p1.getActiveAttack() ? {
      id: scene.p1.getActiveAttack().move.id, frame: scene.p1.getActiveAttack().framesElapsed } : null,
      invincible: scene.p1.isInvincible(), receiving: scene.p1.getActiveHurtboxes().map(h => ({ id: h.id, intangible: h.intangible === true })),
      sensor: (()=>{const a=scene.p1.getActiveAttack(),b=a?.hitboxBody;if(!b)return null;return {position:{...b.position},authoredOffset:{x:a.move.hitbox.offsetX,y:a.move.hitbox.offsetY},facing:a.facing,ownerBodyId:b.plugin.ownerBodyId,actorBodyId:scene.p1.body.id,ownerAnchoredContact:b.plugin.ownerAnchoredContact,postPhysicsContactOnly:b.plugin.postPhysicsContactOnly};})(),position: scene.p1.getPosition(), grounded: scene.p1.isGrounded(), rootMotion:scene.p1.getLedgeAttackRootMotionState?.() ?? null });
    const rows = [];
    let captures=[],seen=new Set(),currentProbe='';
    const capture=async(side,option)=>{
      const o=observe(), sprite=scene.playerSlots[0].sprite;
      const age=o.ledge.active?.framesElapsed ?? o.attack?.frame;
      const sheet=sprite.texture.key.replace('char.pikachu.','');
      if(!['ledge_catch','ledge','ledge_getup','ledge_roll','ledge_attack'].includes(sheet))return;
      if (option !== 'climb' && (sheet === 'ledge_catch' || sheet === 'ledge')) return;
      const clip=metadata.animations[sheet], index=Number(sprite.frame.name);
      const key=sheet+':'+index;if(seen.has(key))return;seen.add(key);
      const screenshot=`${side}-${currentProbe}-${option}-${sheet}-${index}.png`;
      await window.__captureLedge(screenshot);
      captures.push({screenshot,observation:{...o,receiving:scene.p1.getActiveHurtboxes(),age,sheet,texture:sprite.texture.key,textureFrame:index,flipX:sprite.flipX,origin:[sprite.originX,sprite.originY],bounds:sprite.getBounds()}});
    };
    for (const side of ['left', 'right']) for (const probe of ['onstage-contact','far-miss']) {
      const option='attack';
      captures=[];seen=new Set();currentProbe=probe;
      const facing = side === 'left' ? 1 : -1;
      const edgeX = side === 'left' ? floor.bounds.min.x : floor.bounds.max.x;
      scene.p1.resetForRound(edgeX - facing * 18, floor.bounds.min.y + 6);
      scene.p2.resetForRound(edgeX+facing*(probe==='onstage-contact'?120:170), floor.bounds.min.y-scene.p2.getTuning().height/2);
      scene.p1.setFacing(facing); scene.p1.setDamagePercent(0); scene.p2.setDamagePercent(0);
      scene.matter.body.setVelocity(scene.p1.body, { x: 0, y: 1 });
      let caught = null;
      for (let frame = 0; frame < 15; frame++) { step(); if (scene.p1.isHangingOnLedge()) { caught = observe(); break; } }
      if (!caught) throw new Error(`Actual ${side} platform ledge did not catch`);
      // Holding up before native catch19 must leave the fighter latched.
      const catchTrace = [caught];await capture(side,option);
      for (let frame = 0; frame < 18; frame++) { step({ moveY: -1 }); catchTrace.push(observe());await capture(side,option); }
      if (!scene.p1.isHangingOnLedge()) throw new Error(`Source catch gate released early ${side}/${option}`);
      step();await capture(side,option);
      const intent = option === 'climb' ? { moveY: -1 } : option === 'roll' ? { moveX: facing }
        : option === 'jump' ? { jump: true } : { attack: true };
      step(intent);
      const trace = [observe()];await capture(side,option);
      for (let frame = 0; frame < 100; frame++) {
        if (option === 'climb' && trace.at(-1).ledge.name !== 'climbing'
          || option === 'roll' && trace.at(-1).ledge.name !== 'rolling'
          || option === 'attack' && !trace.at(-1).attack
          || option === 'jump' && trace.length >= 14) break;
        step(); trace.push(observe());await capture(side,option);
      }
      rows.push({ side, option, probe, damage:scene.p2.getDamagePercent(), floor:{top:floor.bounds.min.y,minX:floor.bounds.min.x,maxX:floor.bounds.max.x}, tuning: scene.p1.getTuning().ledge, catchTrace, trace,captures });
    }
    return rows;
  },{metadata});
  assert.equal(report.rows.length, 4);
  for (const row of report.rows) {
    const expectedDamage=row.probe==='onstage-contact'?9*STALE_FRESH_MULTIPLIER:0;
    assert.ok(Math.abs(row.damage-expectedDamage)<1e-10,'source9 × shared freshness vs far miss');
    row.damageContract={sourceDamage:9,freshnessMultiplier:STALE_FRESH_MULTIPLIER,expectedDamage};
    for(const c of row.captures){const o=c.observation;assert.equal(o.receiving.length,12,`${o.sheet}: paired12caps`);assert.equal(o.origin[0],.5);assert.equal(o.origin[1],416/640);if(o.sheet!=='ledge_attack'){const expected=poses.find(p=>p.sheet===o.sheet&&p.artFrameIndex===o.textureFrame);assert.ok(expected,`${o.sheet}/${o.textureFrame} accepted receiving`);assert.deepEqual(o.receiving,expected.hurtboxes);}}
    assert.equal(row.tuning.catchFrames, 19);
    assert.ok(row.catchTrace.every(frame => frame.ledge.name === 'hanging'), 'catch19 gate must suppress up option');
    if (row.option === 'climb' || row.option === 'roll') {
      const state = row.option === 'climb' ? 'climbing' : 'rolling';
      const active = row.trace.filter(frame => frame.ledge.name === state);
      assert.equal(active.length, row.option === 'climb' ? 32 : 49);
      assert.equal(active.filter(frame => frame.invincible).length, row.option === 'climb' ? 31 : 26);
    } else if (row.option === 'attack') {
      const active = row.trace.filter(frame => frame.attack);
      const contactSteps=active.filter(x=>x.sensor);assert.ok(contactSteps.length>0);
      for(const x of contactSteps){assert.equal(x.sensor.ownerBodyId,x.sensor.actorBodyId);assert.equal(x.sensor.ownerAnchoredContact,true);assert.equal(x.sensor.postPhysicsContactOnly,true);assert.ok(Math.abs(x.sensor.position.x-(x.position.x+x.sensor.authoredOffset.x*x.sensor.facing))<1e-8,'completed root sensorX parity');assert.ok(Math.abs(x.sensor.position.y-(x.position.y+x.sensor.authoredOffset.y))<1e-8,'completed root sensorY parity');}
      assert.equal(active[0].attack.id, 'pikachu.ledgeAttack');
      assert.equal(active[0].attack.frame, 0);
      if(expectRoot){
        assert.deepEqual(active.map(x=>x.attack.frame),Array.from({length:55},(_,i)=>i));
        const facing=row.side==='left'?1:-1,corner=row.side==='left'?row.floor.minX:row.floor.maxX;
        for(const x of active){const point=rootPoints[x.attack.frame];assert.ok(Math.abs(x.position.x-(corner+point.x*facing))<.15,`source root X ${row.side}/${x.attack.frame}`);assert.ok(Math.abs(x.position.y-(row.floor.top-25+point.y))<.15,`source root Y ${row.side}/${x.attack.frame}`);}
        assert.ok(active.at(-1).grounded,'ledge attack must return to actual solid platform');
        assert.ok(active.at(-1).position.x>row.floor.minX+25 && active.at(-1).position.x<row.floor.maxX-25,'ledge attack ends safely inside stage');
      }
      assert.equal(new Set(active.filter(frame => frame.receiving.some(h=>h.intangible)).map(frame=>frame.attack.frame)).size, 25);
    } else {
      assert.equal(row.trace[0].grounded, false);
      assert.equal(row.trace.filter(frame => frame.invincible).length, 12);
    }
  }
  assert.deepEqual(report.errors, []); report.result = 'PASS';
  await page.screenshot({ path: `${output}/actual-ledge-option.png` });
  console.log(JSON.stringify({ rows: report.rows.length, errors: report.errors }));
} catch (error) {
  report.result = 'FAIL'; report.assertionFailure = error.message; throw error;
} finally {
  await writeFile(`${output}/ledge-contact-observations.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
