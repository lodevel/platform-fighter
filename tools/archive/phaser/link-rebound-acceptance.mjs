import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = process.env.PF_REWORK_OUTPUT ?? 'docs/review/2026-09-15/rebound/production';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { errors: [], loadErrors: [], notes: ['Actual MatchScene resolver input and fixed steps; bounce height is engine calibration.'] };
page.on('pageerror', error => report.errors.push(error.message));
page.on('requestfailed', request => report.loadErrors.push({ url: request.url(), error: request.failure()?.errorText }));
try {
  await page.goto(process.env.PF_REWORK_URL ?? 'http://127.0.0.1:4173/platform-fighter/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  report.artifact = await page.evaluate(() => [...document.scripts].map(script => script.src).filter(Boolean));
  report.scenarios = await page.evaluate(() => {
    const game = window.__game;
    for (const scene of game.scene.getScenes(true)) game.scene.stop(scene.scene.key);
    game.scale.setGameSize(1440, 1000);
    game.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 915,
      itemFrequency: 'off', players: [
        { index: 1, characterId: 'link', paletteIndex: 0, inputType: 'keyboard_p1' },
        { index: 2, characterId: 'link', paletteIndex: 1, inputType: 'keyboard_p2' },
      ] } });
    const s = game.scene.getScene('MatchScene'); s.physicsEngine.pause();
    let inputs = {};
    s.inputResolver.getMoveVector = player => ({ x: inputs[player]?.moveX ?? 0, y: inputs[player]?.moveY ?? 0 });
    s.inputResolver.isActionHeld = (player, action) => inputs[player]?.[action] === true;
    const a = s.p1, d = s.p2;
    const floor = s.baseStage.bodies.platformBodies.find(body => body.label === 'platform.solid');
    const origin = { x: floor.position.x, y: floor.bounds.min.y - d.getTuning().height / 2 };
    const read = () => ({ position: a.getPosition(), velocity: a.getVelocity(), grounded: a.isGrounded(),
      frame: a.getActiveAttack()?.framesElapsed ?? null, move: a.getActiveAttack()?.move.id ?? null,
      hitlag: a.getHitlagRemaining(), jumps: a.getJumpsUsed(),
      landing: a.getAnimationActionState().landingRecoveryRemaining,
      hitbox: a.getActiveAttack()?.hitboxBody != null,
      target: { damage: d.getDamagePercent(), shield: d.isShielding(), shieldHealth: d.getShieldState().health, hitlag: d.getHitlagRemaining() },
      pose: s.playerSlots[0].spriteAnimSm.current().state });
    const step = (attacker = {}, defender = {}) => {
      inputs = { 1: attacker, 2: defender }; const frame = s.physicsEngine.getFrame();
      s.physicsEngine.resume(); s.update(0, s.physicsEngine.fixedTimestepMs); s.physicsEngine.pause();
      if (s.physicsEngine.getFrame() !== frame + 1) throw new Error('Expected exactly one simulation step');
      return read();
    };
    for (let i = 0; i < 100; i++) step();
    const scenarios = [];
    for (const kind of ['hit', 'shield', 'whiff', 'fastfall']) {
      a.resetForRound(origin.x - 300, origin.y);
      d.resetForRound(origin.x + (kind === 'whiff' ? 350 : 0), origin.y);
      a.setDamagePercent(0); d.setDamagePercent(0);
      for (let i = 0; i < 25; i++) step({}, { shield: kind === 'shield' });
      a.resetForRound(origin.x, origin.y - (kind === 'fastfall' ? 250 : 145));
      // Down only latches fast fall while descending. Give this case one
      // gravity step before the same down+attack input used by the other cases.
      if (kind === 'fastfall') step();
      const trace = [read(), step({ attack: true, moveY: 1 }, { shield: kind === 'shield' })];
      for (let i = 0; i < 160; i++) trace.push(step({}, { shield: kind === 'shield' }));
      const bounce = trace.findIndex(sample => sample.velocity.y < -4);
      scenarios.push({ kind, trace, bounce, tuning: a.getAttack('link.dair').rebound });
    }
    return scenarios;
  });
  for (const scenario of report.scenarios) {
    const { kind, trace, bounce } = scenario;
    assert.equal(trace[1].move, 'link.dair');
    if (kind === 'fastfall') {
      assert.equal(bounce, -1, 'Fast-falling contact cannot bounce');
      const impact = trace.find(sample => sample.hitlag > 0);
      assert.ok(impact?.target.damage > 0, 'Fast-falling down air must actually connect');
      assert.equal(impact.hitbox, true, 'Suppressed rebound keeps the original hitbox');
    } else if (kind === 'whiff') {
      assert.equal(bounce, -1, 'Whiff cannot bounce');
      assert.ok(trace.every(sample => sample.target.damage === 0));
    } else {
      assert.ok(bounce > 1, `${kind}: contact must cause an upward rebound`);
      assert.equal(trace[bounce].move, 'link.dair', 'Rebound keeps the original move timeline');
      assert.equal(trace[bounce].jumps, trace[1].jumps, 'Rebound does not refresh or consume jumps');
      if (kind === 'hit') {
        assert.ok(trace[bounce].target.damage > 0);
        const frozen = trace.slice(0, bounce).filter(sample => sample.hitlag > 0);
        assert.ok(frozen.length > 0);
        assert.ok(frozen.every(sample => sample.frame === frozen[0].frame && Math.abs(sample.position.y - frozen[0].position.y) < 1e-6), 'Impact freezes body and action before rebound');
        const firstFrame = frozen[0].frame;
        assert.ok(trace.filter(sample => sample.frame !== null && sample.frame >= firstFrame && sample.frame < firstFrame + 30)
          .every(sample => !sample.hitbox), 'Rebound removes the hitbox for the full return interval');
      } else {
        assert.ok(trace.every(sample => sample.target.damage === 0), 'Shielded contact deals no percent damage');
        assert.ok(trace[bounce].target.shield, 'Normal shield remains raised during bounce');
        assert.ok(Math.abs(trace[bounce].velocity.y + scenario.tuning.upwardSpeed) < 1e-6,
          'Shield rebound retains the authored speed after collision resolution');
      }
    }
  }
  report.lab = [];
  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => {
      const game = window.__game;
      for (const scene of game.scene.getScenes(true)) game.scene.stop(scene.scene.key);
      game.scale.setGameSize(1920, 1080); game.scene.start('CharacterEditorScene');
      const scene = game.scene.getScene('CharacterEditorScene');
      scene.section = 'move'; scene.moveIndex = scene.getMoveKeys().indexOf('dair');
      scene.fieldPage = 0; scene.refreshAll();
    });
    const fields = [];
    for (let pageIndex = 0; pageIndex < 12; pageIndex++) {
      fields.push(...await page.evaluate(() => {
        const scene = window.__game.scene.getScene('CharacterEditorScene');
        return scene.getPageFields().map((field, row) => ({ id: field.id, value: field.value,
          labelRight: scene.fieldLabels[row].getBounds().right, valueLeft: scene.fieldValues[row].getBounds().left }));
      }));
      if (fields.some(field => field.id === 'rebound.rehitFrames')) break;
      await page.keyboard.press('PageDown');
    }
    assert.equal(fields.find(field => field.id === 'rebound.upwardSpeed')?.value, 6.65);
    assert.equal(fields.find(field => field.id === 'rebound.rehitFrames')?.value, 30);
    assert.ok(fields.every(field => field.labelRight <= field.valueLeft));
    report.lab.push({ viewport, fields });
    await page.screenshot({ path: `${output}/rebound-lab-${viewport.width}.png` });
  }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.loadErrors, []);
  console.log(JSON.stringify({ artifact: report.artifact, scenarios: report.scenarios.map(s => ({ kind: s.kind,
    bounceStep: s.bounce, velocity: s.trace[s.bounce]?.velocity, targetDamage: s.trace.at(-1).target.damage })), errors: report.errors }, null, 2));
} catch (error) { report.failure = error.stack; throw error; }
finally { await writeFile(`${output}/link-rebound.json`, `${JSON.stringify(report, null, 2)}\n`); await browser.close(); }
