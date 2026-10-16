/** Compare a preserved production build with a candidate on the same input
 * trace. Browser DOM input is checked separately from deterministic fixtures. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { openMatchHost, launchMatch } from './browser-match-host.mjs';
import { launchWindowsEdgeCdp } from './windows-edge-cdp.mjs';

const value = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i < 0 ? fallback : process.argv[i + 1]; };
const out = value('out', '.tmp/character-rendering-acceptance');
const url = value('url', 'http://127.0.0.1:4173/platform-fighter/');
await mkdir(out, { recursive: true });
const edge = process.argv.includes('--edge') ? await launchWindowsEdgeCdp({ windowsPort: 9233, bridgePort: 9234 }) : null;
const browser = edge ? await chromium.connectOverCDP(edge.endpoint) : await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const report = process.argv.includes('--menus-only') ? JSON.parse(await readFile(`${out}/report.json`, 'utf8'))
  : { url, browser: browser.version(), errors: [], rows: [], menus: [] };
page.on('pageerror', error => report.errors.push(error.message));
try {
  report.script = await openMatchHost(page, url);
  report.gpu = await page.evaluate(() => {
    const gl = document.querySelector('canvas').getContext('webgl2'), info = gl.getExtension('WEBGL_debug_renderer_info');
    return { renderer: gl.getParameter(info?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER), parallelShaderCompile: Boolean(gl.getExtension('KHR_parallel_shader_compile')) };
  });
  for (const characterId of process.argv.includes('--menus-only') ? [] : ['donkeykong', 'pikachu', 'link']) {
    await launchMatch(page, { mode: 'stocks', stockCount: 9, stageId: 'flat', rngSeed: 161026, itemFrequency: 'off', linkIntroPolicy: 'none',
      finalSmashRules: { schemaVersion: 1, meterEnabled: false, smashBallEnabled: false },
      players: [{ index: 1, characterId, paletteIndex: 2, inputType: 'keyboard_p1' }, { index: 2, characterId: 'pikachu', paletteIndex: 1, inputType: 'keyboard_p2' }] });
    const trace = await page.evaluate(async () => {
      const host = window.__sim, sim = host.match;
      const neutral = { moveX: 0, moveY: 0, jump: false, attack: false, attackHeavy: false, special: false, shield: false, dodge: false, grab: false, dropThrough: false };
      const rows = [];
      for (let tick = 0; tick < 360; tick++) {
        const input = { ...neutral };
        if (tick >= 30 && tick < 42) input.moveX = 1;
        if (tick >= 70 && tick < 82) input.moveX = -1;
        if ([48, 88, 145].includes(tick)) input.attack = true;
        if (tick === 120) input.jump = true;
        if (tick >= 190 && tick < 205) input.shield = true;
        if (tick === 230) input.special = true;
        if (tick === 300) input.grab = true;
        // Capture exactly one drained view through the real host; reading digest
        // and the submitted appearance does not drain another SimView.
        const view = host.step([input, neutral]);
        host.draw();
        const appearances = [0, 1].map(index => {
          const p = host.presentation(index);
          if (!p) return null;
          const { key, frame, x, y, originX, originY, scaleX, scaleY, flipX, rotation, alpha, layers, art } = p;
          return { key, frame, x, y, originX, originY, scaleX, scaleY, flipX, rotation, alpha, layers, art };
        });
        rows.push({ tick, hash: sim.getSimDigest().hash, appearances,
          fighters: view.fighters.map(f => ({ position: f.position, facing: f.facing, damage: f.damage, hurtboxes: f.hurtboxes })) });
      }
      const before = host.presentation(0), hash = sim.getSimDigest().hash;
      host.draw(); host.draw(); host.draw();
      const repeated = host.presentation(0);
      return { rows, repeatedStable: JSON.stringify(before) === JSON.stringify(repeated), hashStable: hash === sim.getSimDigest().hash,
        diagnostics: host.renderDiagnostics(), buildIdentity: sim.buildIdentity };
    });
    assert.ok(trace.repeatedStable && trace.hashStable, characterId + ' repeated render is inert');
    assert.equal(trace.rows.length, 360);
    assert.ok(trace.rows.every(row => row.appearances.every(Boolean)), characterId + ' complete appearance selection');
    report.rows.push({ characterId, ...trace });
    await page.screenshot({ path: `${out}/${characterId}.png` });
    // A real key goes through the saved binding and the normal input resolver.
    const keyboard = await page.evaluate(() => {
      const s = window.__sim.match;
      const floor = s.baseStage.bodies.platformBodies.find(body => body.label === 'platform.solid');
      s.p1.resetForRound(floor.position.x, floor.bounds.min.y - s.p1.getTuning().height / 2);
      for (let i = 0; i < 40; i++) window.__sim.step([{ moveX: 0, moveY: 0, jump: false }, { moveX: 0, moveY: 0, jump: false }]);
      const key = window.__sim.inputResolver.dispatcher.bindings.get(s.playerSlots[0].bindingsSlot).bindings.jump.find(b => b.kind === 'keyboard');
      return { code: key.keyCode, y: s.p1.getPosition().y };
    });
    await page.keyboard.down(keyboard.code === 32 ? 'Space' : String.fromCharCode(keyboard.code));
    await page.evaluate(() => { for (let i = 0; i < 12; i++) window.__sim.step(); });
    await page.keyboard.up(keyboard.code === 32 ? 'Space' : String.fromCharCode(keyboard.code));
    const jumped = await page.evaluate(y => window.__sim.match.p1.getPosition().y < y - 1, keyboard.y);
    assert.ok(jumped, characterId + ' real DOM jump');
    report.rows.at(-1).domJump = jumped;
  }
  await page.evaluate(() => window.__menu.go('fighters'));
  await page.waitForFunction(() => [...document.querySelectorAll('.portrait .art')].every(node => getComputedStyle(node).backgroundImage !== 'none') && document.querySelectorAll('.portrait .art').length === 3);
  await page.screenshot({ path: `${out}/cards.png` });
  report.menus.push({ name: 'fighter cards', loaded: true });
  for (const entry of ['viewer', 'costumes']) {
    await page.goto(new URL(`${entry}.html`, url).href, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/${entry}.png` });
    report.menus.push({ name: entry, canvas: await page.locator('canvas').count() });
  }
  const baselinePath = value('compare', null);
  if (baselinePath) {
    const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
    // Saved JSON omits undefined keys and represents -0 as 0. Apply exactly
    // that serialization to both sides; all numeric/string observations remain.
    for (let i = 0; i < report.rows.length; i++) assert.deepEqual(JSON.parse(JSON.stringify(report.rows[i].rows)), baseline.rows[i].rows, report.rows[i].characterId + ' exact production trace');
    report.comparison = { matchedTicks: report.rows.length * 360, baseline: baselinePath };
  }
  assert.deepEqual(report.errors, []);
  delete report.failure;
  report.result = 'PASS';
} catch (error) { report.result = 'FAIL'; report.failure = error.stack; throw error; }
finally { await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n'); await context.close(); await browser.close(); await edge?.close(); }
