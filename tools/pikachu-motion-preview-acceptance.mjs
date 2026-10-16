import { chromium } from 'playwright';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
if (process.argv.includes('--prototype')) throw new Error('Old prototype acceptance is preserved; this tool verifies the eight-pose candidate only.');
const output = path.join(root, 'docs/review/2026-10-06/pikachu-character/motion-eight-pose');
mkdirSync(output, { recursive: true });
const build = JSON.parse(readFileSync(path.join(root, 'docs/review/2026-10-06/pikachu-character/motion-eight-pose-build.json'), 'utf8'));
const previousAcceptance = JSON.parse(readFileSync(path.join(root,
  'docs/review/2026-10-06/pikachu-character/motion-three-pose-idle-corrected-checkpoint/browser/acceptance.json'), 'utf8'));
const previousTimeline = previousAcceptance.cases.find(row => row.facing === 1 && row.probe === 'near').timeline;
const report = { scope: 'isolated rough eight-pose forward tilt with three actual active-source drawings; authored 2D source projections, stationary fixture and one-pixel damage probe; no full fighter/native bone/posed hurtbox acceptance',
  url: 'http://127.0.0.1:4185/pikachu-motion-preview.html', build: build.buildIdentity,
  input: 'simulated browser keyboard T/N and pointer controls', cases: [], freeze: [], errors: [] };
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 980 }, deviceScaleFactor: 1 });
page.on('pageerror', error => report.errors.push(error.message));
const state = () => page.evaluate(() => window.__pikachuMotionPreview.state());
const assert = (value, message) => { if (!value) throw new Error(message); };
const hasNeutral = Object.hasOwn(build.art, 'reference-registered.png');
const readyPose = 'neutral';
const expectedDrawing = elapsed => elapsed < 2 ? ['startup', 0] : elapsed < 5 ? ['turn-low', 4]
  : elapsed === 5 ? ['contact-6', 5] : elapsed === 6 ? ['contact-7', 6] : elapsed === 7 ? ['contact-8', 7]
  : elapsed < 16 ? ['extended-recovery', 10] : elapsed < 22 ? ['recovery', 21] : ['ready-return', 28];
const assertReady = (s, facing) => {
  assert(s.elapsed === null && s.pose === readyPose && s.texture === `pikachu-${readyPose}`, 'Waiting state displays attack drawing');
  assert(s.regions.length === 0 && s.flipped === (facing === -1), 'Waiting state has attack regions or wrong facing');
  if (hasNeutral) {
    assert(s.drawingSourceIndex === null, 'Neutral drawing incorrectly assigned an attack source frame');
    assert(s.artScale === 70 / 600 && Math.abs(s.artWidth - 119.46666666666667) < 1e-8
      && Math.abs(s.artHeight - 119.46666666666667) < 1e-8, 'Neutral sprite has wrong display scale');
    assert(s.artOrigin.x === .5 && s.artOrigin.y === 880 / 1024, 'Neutral sprite has wrong registered root');
  }
};
try {
  await page.goto(report.url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__pikachuMotionPreview?.ready === true);
  const entry = await page.content();
  const bundle = entry.match(/src="([^\"]*\/assets\/pikachu-motion-preview-[^\"]+\.js)"/)?.[1];
  assert(bundle, 'Missing motion preview bundle');
  const bytes = new Uint8Array(await (await fetch(new URL(bundle, report.url))).arrayBuffer());
  report.bundle = bundle;
  report.bundleSha256 = createHash('sha256').update(bytes).digest('hex');
  assert(report.bundleSha256 === build.files[bundle.replace(/^\//, '')], 'Served bundle hash differs from recorded build');
  report.servedArt = {};
  report.floorAlignment = [];
  for (const [file, expectedHash] of Object.entries(build.files).filter(([file]) => file.endsWith('.png'))) {
    const response = await fetch(new URL(file, report.url));
    assert(response.ok, `Missing served drawing: ${file}`);
    const sha256 = createHash('sha256').update(new Uint8Array(await response.arrayBuffer())).digest('hex');
    assert(sha256 === expectedHash, `Served drawing differs from recorded build: ${file}`);
    report.servedArt[file] = sha256;
  }
  assert(hasNeutral, 'Candidate preview is missing its side-facing neutral drawing');
  assert(Object.keys(build.art).length === 9, 'Candidate must contain neutral plus eight attack drawings');
  assert(Object.keys(report.servedArt).length === Object.keys(build.art).length, 'Served pose count differs from build record');
  for (const facing of [1, -1]) for (const probe of ['near', 'edge', 'miss']) {
    await page.evaluate(({ facing, probe }) => {
      window.__pikachuMotionPreview.setFacing(facing); window.__pikachuMotionPreview.setProbe(probe);
    }, { facing, probe });
    const ready = await state();
    assertReady(ready, facing);
    await page.keyboard.press('t');
    const timeline = [await state()];
    for (let i = 1; i < 29; i++) { await page.keyboard.press('n'); timeline.push(await state()); }
    const expectedDamage = probe === 'miss' ? 0 : 9;
    for (const s of timeline) {
      assert(s.build === build.buildIdentity, 'Engine build identity mismatch');
      assert(s.moveId === 'pikachu.forward-tilt', `Wrong move ID: ${s.moveId}`);
      assert(s.artScale === 70 / 600 && Math.abs(s.artWidth - 179.2) < 1e-8 && Math.abs(s.artHeight - 119.46666666666667) < 1e-8, 'Nonuniform art scale');
      assert(s.artOrigin.x === .5 && s.artOrigin.y === 880 / 1024 && s.flipped === (facing === -1), 'Root/facing registration mismatch');
      assert(Math.abs(s.root.x - ready.root.x) < .3 && Math.abs(s.root.y - ready.root.y) < .3, 'Stationary preview root drift');
      const [expectedPose, sourceIndex] = expectedDrawing(s.elapsed);
      assert(s.pose === expectedPose && s.texture === `pikachu-${expectedPose}`, 'Drawing/clock mapping mismatch');
      assert(s.drawingSourceIndex === sourceIndex, 'Source-index mapping mismatch');
      assert(s.regions.length === (s.elapsed >= 5 && s.elapsed < 8 ? 3 : 0), `Active region boundary mismatch at ${s.elapsed}`);
      assert(JSON.stringify(s.regions) === JSON.stringify(previousTimeline.find(previous => previous.elapsed === s.elapsed).regions),
        `Accepted collision geometry changed while adding drawings at${s.elapsed}`);
      assert(s.damage === (s.elapsed >= 5 ? expectedDamage : 0), `Hit/miss or dedup mismatch: ${JSON.stringify(s)}`);
    }
    assert(timeline[0].elapsed === 0 && timeline.at(-1).elapsed === 28, '29-frame timeline mismatch');
    assert(timeline.at(-1).contacts.length === (probe === 'miss' ? 0 : 1), 'Strike replacement reset target dedup');
    await page.keyboard.press('n');
    const ended = await state();
    assertReady(ended, facing);
    report.cases.push({ facing, probe, expectedDamage, ready, timeline, ended });
  }
  for (const facing of [1, -1]) {
    await page.evaluate(facing => {
      window.__pikachuMotionPreview.setFacing(facing); window.__pikachuMotionPreview.setProbe('near');
    }, facing);
    assertReady(await state(), facing);
    await page.screenshot({ path: path.join(output, `neutral-${facing === 1 ? 'right' : 'left'}.png`), fullPage: true });
    await page.locator('#attack').click();
    const poseTimeline = [await state()];
    for (let elapsed = 0; elapsed < 29; elapsed++) {
      if (elapsed > 0) { await page.keyboard.press('n'); poseTimeline.push(await state()); }
      const [pose] = expectedDrawing(elapsed);
      if ([0, 2, 5, 6, 7, 8, 16, 22].includes(elapsed)) await page.screenshot({
        path: path.join(output, `${pose}-${facing === 1 ? 'right' : 'left'}.png`), fullPage: true });
      if ([0, 2, 5, 6, 7, 8, 16, 22].includes(elapsed)) {
        const current = poseTimeline.at(-1);
        const metric = build.renderMetrics[current.drawingFile];
        report.floorAlignment.push({ facing, pose, elapsed, drawingFile: current.drawingFile,
          rootY: current.root.y, floorTopY: current.floorTopY,
          artworkBottomWorldY: current.root.y + metric.foregroundBottomFromRootWorld,
          artworkBelowFloorWorld: current.root.y + metric.foregroundBottomFromRootWorld - current.floorTopY,
          scope: 'Nonzero alpha outline bound, not native foot/hurtbox; no sprite recenter or collision change' });
      }
    }
    report.poseScreenshots ??= [];
    report.poseScreenshots.push({ facing, timeline: poseTimeline });
    await page.locator('#reset').click(); await page.locator('#attack').click();
    for (let i = 0; i < 5; i++) await page.keyboard.press('n');
    const contact = await state();
    await page.screenshot({ path: path.join(output, `contact-${facing === 1 ? 'right' : 'left'}.png`), fullPage: true });
    await page.locator('#freeze').click();
    const frozen = [];
    for (let i = 0; i < 3; i++) { await page.keyboard.press('n'); frozen.push(await state()); }
    assert(frozen.every(s => s.elapsed === contact.elapsed && s.pose === 'contact-6' && s.damage === 9 && s.contacts.length === 1), 'Manual hitlag changed drawing/attack clock or repeated damage');
    await page.keyboard.press('n');
    const resumed = await state();
    assert(resumed.elapsed === contact.elapsed + 1, 'Attack did not resume after manual freeze');
    assert(resumed.pose === 'contact-7', 'Resume did not advance to the next active-source drawing');
    for (let i = 0; i < 2; i++) await page.keyboard.press('n');
    const recovery = await state();
    assert(recovery.pose === 'extended-recovery' && recovery.regions.length === 0, 'Recovery drawing retained contacts');
    report.freeze.push({ facing, contact, frozen, resumed, recovery });
  }
  await page.locator('#reset').click();
  await page.locator('#attack').click();
  await page.locator('#play').click();
  await page.waitForTimeout(120);
  await page.locator('#play').click();
  const paused = await state();
  await page.waitForTimeout(80);
  const stillPaused = await state();
  assert(paused.elapsed === stillPaused.elapsed && !stillPaused.playing, 'Pause advanced the fixed-step timeline');
  report.pause = { paused, stillPaused };
  assert(report.errors.length === 0, `Browser errors: ${report.errors.join(', ')}`);
  report.result = 'passed';
  console.log('Eight-pose candidate passed6 both-facing contact/edge/miss cases, neutral waiting/return,29-frame art/region boundaries,2freeze cases,play/pause and exact nine served drawing/bundle hashes.');
} catch (error) {
  report.result = 'failed'; report.failure = String(error); throw error;
} finally {
  writeFileSync(path.join(output, 'acceptance.json'), JSON.stringify(report, null, 2) + '\n');
  await browser.close();
}
