import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = 'docs/review/2026-10-06/pikachu-character/integration/completion-live-thunder-overlay';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const report = { errors: [], failedResponses: [], cases: [], scope: 'Real preview checkbox and production MatchScene overlay. Thunder ground/air/both facings: independently expected early radius30 circle, late radius20 capsule50 tall and burst radius65 circle, exact live positions, red Graphics paths, pause/step/toggle and disappearance. Gameplay and action completion unchanged.' };
page.on('pageerror', e => report.errors.push(e.message));
page.on('response', r => { if (r.status() >= 400) report.failedResponses.push({ url: r.url(), status: r.status() }); });
try {
  await page.goto('http://localhost:4195/pikachu-special-preview.html?action=thunder');
  await page.waitForFunction(() => window.__pikachuSpecialPreview?.ready, null, { timeout: 60000 });
  const game = await (await page.locator('#game').elementHandle()).contentFrame();
  report.bundle = await game.evaluate(() => [...document.scripts].map(s => s.src).find(src => /\/assets\/index-.*\.js/.test(src)));
  report.bundleSha256 = createHash('sha256').update(await (await page.request.get(report.bundle)).body()).digest('hex');
  await game.evaluate(() => {
    const scene = window.__game.scene.getScene('MatchScene'), layer = scene.hitboxDebugLayer, gfx = layer.gfx;
    let boxes = [], arcs = [], color = 0;
    const render = layer.render.bind(layer), clear = gfx.clear.bind(gfx), arc = gfx.arc.bind(gfx), style = gfx.lineStyle.bind(gfx);
    layer.render = (snapshots, attacks = []) => { boxes = structuredClone(attacks); return render(snapshots, attacks); };
    gfx.clear = () => { arcs = []; return clear(); };
    gfx.lineStyle = (width, nextColor, alpha) => { color = nextColor; return style(width, nextColor, alpha); };
    gfx.arc = (...args) => { if (color === 0xff3030) arcs.push(args); return arc(...args); };
    window.__thunderOverlay = () => ({ enabled: layer.isEnabled(), visible: gfx.visible, boxes, arcs,
      sensors: scene.matter.world.getAllBodies().filter(b => b.label === 'hitbox.attack').map(b => ({
        position: b.position, phase: b.plugin.pikachuPhase ?? null, entity: b.plugin.pikachuEntityId ?? null,
        damage: b.plugin.damage, hitbox: b.plugin.hitbox, facing: b.plugin.facing,
        attached: b.plugin.ownerAnchoredContact, rows: b.plugin.collisionHits,
      })), owner: scene.p1.getPosition() });
  });
  assert.equal((await game.evaluate(() => window.__thunderOverlay())).enabled, false);
  for (const context of ['ground', 'air']) for (const facing of [1, -1]) {
    await page.locator('#context').selectOption(context);
    await page.evaluate(facing => window.__pikachuSpecialPreview.setFacing(facing), facing);
    await page.locator('#overlay').check();
    await page.locator('#attack').click();
    const captures = {}, trace = [];
    for (let i = 0; i < 85; i++) {
      const state = await page.evaluate(() => window.__pikachuSpecialPreview.state());
      const overlay = await game.evaluate(() => window.__thunderOverlay());
      trace.push({ elapsed: state.elapsed, ...overlay });
      for (const [phase, sensor] of [['early', overlay.sensors.find(s => s.phase === 'early')],
        ['late', overlay.sensors.find(s => s.phase === 'clean')],
        ['burst', overlay.sensors.find(s => s.damage === 15)]]) {
        if (!sensor || captures[phase]) continue;
        const origin = sensor.attached ? overlay.owner : {
          x: sensor.position.x - sensor.hitbox.offsetX * sensor.facing,
          y: sensor.position.y - sensor.hitbox.offsetY };
        const offsets = phase === 'early' ? [-10, -10, 30] : phase === 'late' ? [-20, -70, 20] : [-26, -26, 65];
        const capsule = { start: { x: origin.x, y: origin.y + offsets[0] },
          end: { x: origin.x, y: origin.y + offsets[1] }, radius: offsets[2] };
        const drawn = overlay.boxes.find(b => JSON.stringify(b.capsule) === JSON.stringify(capsule));
        assert.ok(drawn, `${context}/${facing}/${phase}: exact live damage capsule is missing`);
        assert.equal(drawn.strokeColor, 0xff3030);
        assert.ok(overlay.arcs.some(a => a[2] === capsule.radius), 'Actual red Graphics path must render');
        const name = `thunder-${context}-${facing}-${phase}.png`;
        await game.locator('canvas').screenshot({ path: `${output}/${name}` });
        captures[phase] = { elapsed: state.elapsed, capsule, name, overlay };
      }
      if (Object.keys(captures).length === 3) break;
      await page.locator('#step').click();
    }
    assert.deepEqual(Object.keys(captures).sort(), ['burst', 'early', 'late']);
    const paused = await page.evaluate(() => window.__pikachuSpecialPreview.state().elapsed);
    await page.locator('#overlay').uncheck();
    const disabled = await game.evaluate(() => window.__thunderOverlay());
    assert.equal(disabled.enabled, false); assert.equal(disabled.visible, false); assert.equal(disabled.arcs.length, 0);
    assert.equal(await page.evaluate(() => window.__pikachuSpecialPreview.state().elapsed), paused);
    await page.locator('#overlay').check();
    await page.evaluate(() => { for (let i = 0; i < 100; i++) window.__pikachuSpecialPreview.step(); });
    assert.deepEqual((await game.evaluate(() => window.__thunderOverlay())).boxes, [], 'No ghost damage shapes after recovery');
    report.cases.push({ context, facing, captures, trace, disabled });
    await page.locator('#overlay').uncheck();
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.failedResponses, []);
  report.result = 'PASS';
  console.log(JSON.stringify({ result: report.result, cases: report.cases.length, screenshots: report.cases.length * 3, errors: report.errors }));
} catch (e) { report.result = 'FAIL'; report.failure = e.message; throw e; }
finally { await writeFile(`${output}/observations.json`, JSON.stringify(report, null, 2)); await browser.close(); }
