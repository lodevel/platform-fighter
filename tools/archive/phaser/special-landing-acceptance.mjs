import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = process.env.PF_REWORK_OUTPUT ?? 'docs/review/2026-09-15/production';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { errors: [], loadErrors: [], notes: ['Actual MatchScene fixed steps with resolver input; no human controller, sound or balance acceptance.'] };
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
    let input = {};
    s.inputResolver.getMoveVector = player => ({ x: player === 1 ? input.moveX ?? 0 : 0, y: player === 1 ? input.moveY ?? 0 : 0 });
    s.inputResolver.isActionHeld = (player, action) => player === 1 && input[action] === true;
    const fighter = s.p1, floor = s.baseStage.bodies.platformBodies.find(body => body.label === 'platform.solid');
    const start = { x: floor.position.x, y: floor.bounds.min.y - fighter.getTuning().height / 2 };
    const read = () => ({ position: fighter.getPosition(), velocity: fighter.getVelocity(), grounded: fighter.isGrounded(),
      lag: fighter.getAnimationActionState().landingRecoveryRemaining, dodge: fighter.getDodgeState().name,
      iframes: fighter.getDodgeState().iframesRemaining, squat: fighter.getJumpsquatRemaining(),
      shield: fighter.isShielding(), helpless: fighter.isHelpless(), move: fighter.getActiveAttack()?.move.id ?? null,
      pose: s.playerSlots[0].spriteAnimSm.current().state });
    const step = (next = {}) => {
      input = next; const frame = s.physicsEngine.getFrame();
      s.physicsEngine.resume(); s.update(0, s.physicsEngine.fixedTimestepMs); s.physicsEngine.pause();
      if (s.physicsEngine.getFrame() !== frame + 1) throw new Error('Expected exactly one simulation step');
      return read();
    };
    for (let i = 0; i < 100; i++) step();
    const results = [];
    for (const kind of ['spin', 'neutralDodge', 'directionalDodge']) {
      fighter.resetForRound(start.x, start.y - (kind === 'spin' ? 140 : 6));
      s.p2.resetForRound(floor.bounds.max.x - 50, start.y);
      const approach = [step(kind === 'spin' ? { special: true, moveY: -1 }
        : kind === 'neutralDodge' ? { shield: true } : { dodge: true, moveY: 1 })];
      for (let i = 0; i < 240 && !approach.at(-1).grounded; i++) approach.push(step());
      if (!approach.at(-1).grounded) throw new Error(`${kind} did not land`);
      const recovery = [];
      const lag = kind === 'spin' ? 30 : kind === 'neutralDodge' ? 10 : 19;
      for (let i = 0; i <= lag; i++) recovery.push(step({ shield: true }));
      results.push({ kind, approach, recovery });
    }
    return results;
  });
  for (const { kind, approach, recovery } of report.scenarios) {
    const lag = kind === 'spin' ? 30 : kind === 'neutralDodge' ? 10 : 19;
    assert.ok(approach.at(-1).grounded);
    assert.deepEqual(recovery.map(sample => sample.lag), Array.from({ length: lag + 1 }, (_, i) => lag - i), `${kind}: exact landing duration`);
    assert.ok(recovery.slice(0, lag).every(sample => !sample.shield && sample.move === null && sample.iframes === 0 && sample.pose === 'landing'), `${kind}: vulnerable committed landing pose`);
    assert.equal(recovery[lag].shield, true, `${kind}: held shield on first free step`);
  }
  report.lab = [];
  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => {
      const game = window.__game;
      for (const scene of game.scene.getScenes(true)) game.scene.stop(scene.scene.key);
      game.scale.setGameSize(1920, 1080);
      game.scene.start('MainMenuScene');
    });
    await page.waitForFunction(() => window.__game.scene.isActive('MainMenuScene'));
    await page.keyboard.press('c');
    await page.waitForFunction(() => window.__game.scene.isActive('CharacterEditorScene'));
    const fields = [];
    for (let index = 0; index < 6; index++) {
      fields.push(...await page.evaluate(() => {
        const scene = window.__game.scene.getScene('CharacterEditorScene');
        return scene.getPageFields().map((field, row) => ({ path: field.path,
          labelRight: scene.fieldLabels[row].getBounds().right,
          valueLeft: scene.fieldValues[row].getBounds().left }));
      }));
      if (fields.some(field => field.path[0] === 'directionalAirDodgeLandingFrames')) break;
      await page.keyboard.press('PageDown');
    }
    for (const key of ['airDodgeLandingFrames', 'directionalAirDodgeLandingFrames']) {
      assert.ok(fields.some(field => field.path[0] === key), `${key} is reachable in Lab at ${viewport.width}px`);
    }
    assert.ok(fields.every(field => field.labelRight <= field.valueLeft), 'Lab labels fit beside their values');
    report.lab.push({ viewport, fields });
    await page.screenshot({ path: `${output}/landing-lab-${viewport.width}.png` });
  }
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify({ artifact: report.artifact, scenarios: report.scenarios.map(s => ({ kind: s.kind, lag: s.recovery[0].lag, firstFreeShield: s.recovery.at(-1).shield })), errors: report.errors }, null, 2));
} catch (error) { report.failure = error.stack; throw error; }
finally { await writeFile(`${output}/special-landing.json`, `${JSON.stringify(report, null, 2)}\n`); await browser.close(); }
