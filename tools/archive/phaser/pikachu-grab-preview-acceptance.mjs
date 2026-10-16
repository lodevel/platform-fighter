import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';

assert.ok(process.env.PF_PREVIEW_URL && process.env.PF_BUILD_RECORD && process.env.PF_REGISTRY_OUTPUT);
const build = JSON.parse(await readFile(process.env.PF_BUILD_RECORD, 'utf8'));
const output = process.env.PF_REGISTRY_OUTPUT;
await mkdir(output, {recursive: true});
const report = {build, cases: [], errors: [], failedResponses: [], scope: 'Actual dedicated app grab/throw viewer embeds the exact immutable main MatchScene bundle. Public viewer actions select real ordinary InputResolver edges, short normal dash/pivot run-up, and actual source CATCH capture; no forced grabbed status. Every selected move/facing is sampled through actual gameplay. UI pause/step/reset/facing/overlay and full whiff option are exercised; hardware human feel and exact native common physics remain separate.'};
const browser = await chromium.launch({headless: true, args: ['--no-sandbox', '--disable-gpu']});
const page = await browser.newPage({viewport: {width: 1280, height: 1000}});
page.on('pageerror', e => report.errors.push(e.message));
page.on('response', r => {if (r.status() >= 400) report.failedResponses.push({url: r.url(), status: r.status()});});
const state = () => page.evaluate(() => window.__pikachuGrabPreview.state());
const capture = async (row, label) => {
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const screenshot = `${row.action}-${row.facing}-${label}.png`;
  await page.screenshot({path: `${output}/${screenshot}`});
  const view = await page.evaluate(() => {const f = document.querySelector('#game'), g = f.contentWindow.__game, s = g.scene.getScene('MatchScene'), c = s.cameras.main, outer = f.getBoundingClientRect(), b = g.canvas.getBoundingClientRect(); return {camera: {worldView: {x: c.worldView.x, y: c.worldView.y, width: c.worldView.width, height: c.worldView.height}, x: c.x, y: c.y, zoom: c.zoom, width: c.width, height: c.height}, canvas: {left: outer.left + f.clientLeft + b.left, top: outer.top + f.clientTop + b.top, width: b.width, height: b.height, internalWidth: g.canvas.width, internalHeight: g.canvas.height}};});
  row.captures.push({screenshot, observation: await state(), ...view});
};
try {
  await page.goto(process.env.PF_PREVIEW_URL, {waitUntil: 'domcontentloaded', timeout: 60000});
  await page.waitForFunction(() => window.__pikachuGrabPreview?.ready, null, {timeout: 90000});
  report.previewBundle = await page.evaluate(() => [...document.scripts].map(s => s.src).find(s => /\/assets\/.*\.js/.test(s)));
  report.previewBundleSha256 = createHash('sha256').update(await (await page.request.get(report.previewBundle)).body()).digest('hex');
  report.previewBuildDir = process.env.PF_PREVIEW_BUILD_DIR ?? build.outDir;
  const previewBytes = await readFile(`${report.previewBuildDir}/assets/${new URL(report.previewBundle).pathname.split('/').at(-1)}`);
  assert.equal(report.previewBundleSha256, createHash('sha256').update(previewBytes).digest('hex'));
  await writeFile(`${output}/immutable-preview-bundle.js`, previewBytes);
  report.mainBundle = await page.evaluate(() => [...document.querySelector('#game').contentDocument.scripts].map(s => s.src).find(s => /\/assets\/index-.*\.js/.test(s)));
  report.bundleSha256 = createHash('sha256').update(await (await page.request.get(report.mainBundle)).body()).digest('hex'); assert.equal(report.bundleSha256, build.bundleSha256);
  for (const facing of [1, -1]) for (const action of ['standing', 'dash', 'pivot', 'pummel', 'forward', 'back', 'up', 'down']) {
    const row = {facing, action, captures: [], trace: []}; report.cases.push(row);
    row.ready = await page.evaluate(({facing, action}) => {const a = window.__pikachuGrabPreview; a.setFacing(facing); a.setAction(action); a.setOverlay(true); return a.state();}, row);
    assert.equal(row.ready.started, false); assert.equal(row.ready.elapsed, 0); assert.equal(row.ready.target.captured, false);
    row.entry = await page.evaluate(() => {window.__pikachuGrabPreview.start(); return window.__pikachuGrabPreview.state();}); row.trace.push(row.entry);
    await capture(row, 'entry');
    if (['standing', 'dash', 'pivot'].includes(action)) {assert.equal(row.entry.grab.variant, action); assert.equal(row.entry.grab.framesElapsed, 0);}
    else {assert.equal(row.entry.target.captured, true); if (action === 'pummel') assert.ok(row.entry.pummel > 0); else {assert.equal(row.entry.throw.direction, action); assert.equal(row.entry.throw.framesElapsed, 0);}}
    for (let n = 0; n < 110; n++) {
      const o = await page.evaluate(() => {window.__pikachuGrabPreview.step(); return window.__pikachuGrabPreview.state();}); row.trace.push(o);
      if (['standing', 'dash', 'pivot'].includes(action) && o.target.captured) {row.capture = o; await capture(row, 'captured'); break;}
      if (action === 'pummel' && o.pummel === 0 && o.elapsed > 2) {row.end = o; await capture(row, 'held-after-pummel'); break;}
      if (['forward', 'back', 'up', 'down'].includes(action) && !o.target.captured && !row.release) {row.release = o; await capture(row, 'release');}
      if (['forward', 'back', 'up', 'down'].includes(action) && !o.throw) {row.end = o; break;}
    }
    if (['standing', 'dash', 'pivot'].includes(action)) assert.ok(row.capture, `${action}/${facing} must actually capture real opponent`);
    else if (action === 'pummel') {assert.equal(row.end.target.captured, true); assert.equal(row.end.target.percent, 1);}
    else {assert.ok(row.release); assert.equal(row.end.throw, null); assert.equal(row.end.target.captured, false); assert.equal(row.release.target.percent, {forward: 10, back: 9, up: 8, down: 5}[action]);}
  }
  await page.selectOption('#action', 'standing'); await page.uncheck('#opponent-range'); await page.click('#start');
  report.whiff = await page.evaluate(() => {window.__pikachuGrabPreview.step(40); return window.__pikachuGrabPreview.state();}); assert.equal(report.whiff.target.captured, false); assert.equal(report.whiff.grabState, 'idle');
  await page.check('#opponent-range'); await page.click('#reset'); await page.click('#play'); await page.waitForTimeout(100); await page.click('#play');
  report.pause = {before: await state()}; await page.waitForTimeout(100); report.pause.after = await state(); assert.equal(report.pause.before.playing, false); assert.deepEqual(report.pause.after, report.pause.before);
  await page.click('#step'); report.stepped = await state(); assert.equal(report.stepped.elapsed, report.pause.after.elapsed + 1);
  await page.uncheck('#overlay'); assert.equal((await state()).collisionOverlay, false);
  await page.click('#mirror'); report.mirrored = await state(); assert.equal(report.mirrored.started, false); assert.equal(report.mirrored.elapsed, 0);
  await page.goto(new URL('pikachu-motion-preview.html', process.env.PF_PREVIEW_URL).href, {waitUntil: 'domcontentloaded', timeout: 60000});
  await page.getByRole('button', {name: 'Grabs + throws', exact: true}).click();
  await page.waitForFunction(() => [...document.querySelectorAll('iframe')].some(f => f.contentWindow?.__pikachuGrabPreview?.ready), null, {timeout: 90000});
  report.menuNavigation = await page.evaluate(() => {const f = [...document.querySelectorAll('iframe')].find(f => f.contentWindow?.__pikachuGrabPreview?.ready); return {iframeUrl: f.src, state: f.contentWindow.__pikachuGrabPreview.state(), buttonPressed: document.querySelector('[data-page="pikachu-grab-preview.html"]').getAttribute('aria-pressed')};});
  assert.equal(report.menuNavigation.buttonPressed, 'true'); assert.equal(report.menuNavigation.state.action, 'standing');
  await page.screenshot({path: `${output}/menu-grabs-throws-navigation.png`});
  assert.deepEqual(report.errors, []); assert.deepEqual(report.failedResponses, []); report.result = 'PASS';
  console.log(JSON.stringify({result: report.result, cases: report.cases.length, screenshots: report.cases.reduce((n, r) => n + r.captures.length, 0)}));
} catch (e) {report.result = 'FAIL'; report.failure = e.stack; throw e;}
finally {await writeFile(`${output}/observations.json`, JSON.stringify(report, null, 2) + '\n'); await browser.close();}
