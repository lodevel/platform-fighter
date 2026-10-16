import {MATCH_URL,openMatchHost,launchMatch} from './browser-match-host.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = MATCH_URL;
const out = process.env.PF_PROBE_OUT ?? 'docs/review/2026-09-25/donkeykong-character/completion-2026-10-08/runtime/jostle-regression';
await mkdir(out, { recursive: true });
const report = {
  url, errors: [], cases: [],
  scope: 'Actual Three.js MatchSim host, normal movement resolver and fixed Matter steps. Initial overlapping grounded positions and deterministic input sampling are fixtures. Covers horizontal separation and movement for DK/Wolf and Pikachu/Wolf; native jostle force parity and physical keyboard feel are not claimed.',
};
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', error => report.errors.push(error.message));
try {
  const bundle = await openMatchHost(page,url);
  report.bundle = bundle;
  report.bundleSha256 = createHash('sha256').update(await (await page.request.get(bundle)).body()).digest('hex');
  for (const fighter of ['donkeykong', 'pikachu']) {
    for (const facing of [1, -1]) {
      await launchMatch(page,{mode:'stocks',stockCount:5,stageId:'flat',rngSeed:81008,itemFrequency:'off',players:[{index:1,characterId:fighter,paletteIndex:0,inputType:'keyboard_p1'},{index:2,characterId:'pikachu',paletteIndex:0,inputType:'keyboard_p2'}]});
      const result = await page.evaluate(({ fighter, facing }) => {
        const scene = window.__sim.match;
        scene.physicsEngine.pause(); scene.roundStartCountdown = 0; scene.cpuControllers.clear();
        let movement = 0;
        scene.inputResolver.getMoveVector = player => ({ x: movement * facing * (player === 1 ? 1 : -1), y: 0 });
        scene.inputResolver.isActionHeld = () => false;
        scene.inputResolver.getSmash = () => ({ buttonHeld: false, stickJustPressed: false, x: 0, y: 0 });
        const floor = scene.baseStage.bodies.platformBodies.find(body => body.label === 'platform.solid');
        const fighters = [scene.p1, scene.p2];
        for (const [index, actor] of fighters.entries()) {
          actor.resetForRound(floor.position.x + index * 500 * facing, floor.bounds.min.y - actor.getTuning().height / 2);
          actor.setFacing(index ? -facing : facing); actor.setInvincibility(0);
        }
        const read = () => fighters.map(actor => ({ position: actor.getPosition(), velocity: actor.getVelocity(), grounded: actor.isGrounded() }));
        const tick = () => {
          scene.physicsEngine.resume(); scene.update(0, scene.physicsEngine.fixedTimestepMs); scene.physicsEngine.pause();
          return read();
        };
        for (let step = 0; step < 12; step++) tick();
        const separation = [];
        const original = scene.updateFighterSeparation.bind(scene);
        scene.updateFighterSeparation = () => {
          const before = read(); original(); const after = read();
          separation.push({ frame: scene.physicsEngine.getFrame(), before, after });
        };
        const resetOverlap = () => {
          for (const [index, actor] of fighters.entries()) {
            actor.resetForRound(floor.position.x + index * 30 * facing, floor.bounds.min.y - actor.getTuning().height / 2);
            actor.setFacing(index ? -facing : facing); actor.setInvincibility(0);
          }
        };
        resetOverlap(); const neutral = [];
        for (let step = 0; step < 60; step++) neutral.push(tick());
        const neutralEnd = neutral.at(-1), expectedGap = fighters.reduce((sum, actor) => sum + actor.getTuning().width / 2, 0);
        resetOverlap(); movement = 1; const running = [];
        for (let step = 0; step < 60; step++) running.push(tick());
        const pushes = separation.filter(row => row.after.some((actor, index) => Math.abs(actor.velocity.x - row.before[index].velocity.x) > .00001));
        return { fighter, facing, expectedGap, neutral, running, separation, checks: [
          { label: 'ordinary grounded bodies separate horizontally', pass: Math.abs(neutralEnd[1].position.x - neutralEnd[0].position.x) >= expectedGap - 1 },
          { label: 'actual jostle produces outward horizontal pushes', pass: pushes.length > 0 && pushes.every(row => {
            const towardOpponent = Math.sign(row.before[1].position.x - row.before[0].position.x) || -1;
            return (row.after[0].velocity.x - row.before[0].velocity.x) * towardOpponent < 0 &&
              (row.after[1].velocity.x - row.before[1].velocity.x) * towardOpponent > 0;
          }) },
          { label: 'jostle preserves actual vertical velocity throughout neutral and running contact', pass: separation.every(row => row.after.every((actor, index) => Math.abs(actor.velocity.y - row.before[index].velocity.y) < .00001)) },
          { label: 'ordinary run into opponent retains floor contact', pass: running.every(row => row.every(actor => actor.grounded)) },
        ] };
      }, { fighter, facing });
      report.cases.push(result);
      await page.screenshot({ path: `${out}/${fighter}-facing-${facing}.png` });
    }
  }
  report.checks = report.cases.flatMap(result => result.checks);
  assert.deepEqual(report.errors, []);
  assert.ok(report.checks.every(check => check.pass), JSON.stringify(report.checks.filter(check => !check.pass)));
  report.result = 'PASS_GROUNDED_JOSTLE_AND_MOVEMENT';
  console.log(JSON.stringify({ result: report.result, cases: report.cases.length, checks: report.checks.length }));
} catch (error) {
  report.failure = error.stack; report.result = 'FAIL'; throw error;
} finally {
  await writeFile(`${out}/observations.json`, JSON.stringify(report, null, 2) + '\n');
  await browser.close();
}
