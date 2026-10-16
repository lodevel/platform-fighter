/** Playback acceptance for retained, user-requested Final Smash previews. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { launchWindowsEdgeCdp } from './windows-edge-cdp.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i < 0 ? fallback : process.argv[i + 1]; };
const url = arg('url', 'http://127.0.0.1:4173/platform-fighter/final-smash-previews/index.html');
const out = arg('out', 'artifacts/final-smash-previews/gallery-qualification.json');
const recordingPath = arg('recording', 'artifacts/final-smash-previews/recording.json');
const recording = JSON.parse(await readFile(recordingPath, 'utf8'));
const report = { url, method: 'Real Windows Edge HTML video decoding and controls. Actual playback cadence, displayed decoded frame timestamps, loop and network range checks. No game or footage modifications.',
  harnessSha256: createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'),
  recordingSha256: createHash('sha256').update(await readFile(recordingPath)).digest('hex'), errors: [], cases: [] };
let edge, browser, context;

async function seek(page, owner, target) {
  return page.evaluate(async ({ owner, target }) => {
    const video = document.querySelector('#' + owner + ' video'); video.pause();
    if (Math.abs(video.currentTime - target) > 1e-8) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Seek timed out')), 5000);
        video.addEventListener('seeked', () => { clearTimeout(timer); resolve(); }, { once: true });
        video.currentTime = target;
      });
    }
    return { time: video.currentTime, paused: video.paused, readyState: video.readyState };
  }, { owner, target });
}

async function playback(page, owner, rate, milliseconds) {
  await page.locator(`#${owner} [data-speed="${rate}"]`).click();
  return page.evaluate(async ({ owner, milliseconds }) => {
    const video = document.querySelector('#' + owner + ' video');
    await video.play();
    const started = performance.now(), time = video.currentTime, before = video.getVideoPlaybackQuality();
    await new Promise(resolve => {
      const tick = now => now - started >= milliseconds ? resolve() : requestAnimationFrame(tick);
      requestAnimationFrame(tick);
    });
    const wallMs = performance.now() - started, elapsed = video.currentTime - time;
    video.pause(); const after = video.getVideoPlaybackQuality();
    return { rate: video.playbackRate, wallMs, elapsed, ratio: elapsed / (wallMs / 1000),
      decodedFrames: after.totalVideoFrames - before.totalVideoFrames,
      droppedFrames: after.droppedVideoFrames - before.droppedVideoFrames,
      pressed: document.querySelector(`#${owner} [data-speed="${video.playbackRate}"]`).getAttribute('aria-pressed'),
      error: video.error?.message ?? null };
  }, { owner, milliseconds });
}

async function frameStep(page, owner, direction) {
  const before = await page.evaluate(owner => {
    const video = document.querySelector('#' + owner + ' video');
    window.__previewPresented = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Decoded frame callback timed out')), 5000);
      video.requestVideoFrameCallback((_now, metadata) => { clearTimeout(timer); resolve({ mediaTime: metadata.mediaTime, presentedFrames: metadata.presentedFrames }); });
    });
    // Observe rejection immediately; the awaiting read follows the DOM click.
    window.__previewPresented.catch(() => {});
    return video.currentTime;
  }, owner);
  await page.locator(`#${owner} [data-step="${direction}"]`).click();
  return page.evaluate(async ({ owner, before }) => {
    const displayed = await window.__previewPresented, video = document.querySelector('#' + owner + ' video');
    return { before, after: video.currentTime, paused: video.paused, displayed };
  }, { owner, before });
}

try {
  edge = await launchWindowsEdgeCdp({ windowsPort: 9257, bridgePort: 9258 });
  browser = await chromium.connectOverCDP(edge.endpoint);
  context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.stack ?? error.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  report.browser = browser.version();
  report.viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, devicePixelRatio,
    visual: { width: visualViewport.width, height: visualViewport.height } }));
  assert.equal(await page.locator('video').count(), 3);
  for (const expected of recording.cases) {
    const owner = expected.owner;
    await page.waitForFunction(owner => {
      const video = document.querySelector('#' + owner + ' video');
      return video?.readyState >= 1 && Number.isFinite(video.duration);
    }, owner);
    const metadata = await page.locator(`#${owner} video`).evaluate(video => ({ width: video.videoWidth, height: video.videoHeight,
      duration: video.duration, controls: video.controls, muted: video.muted, loop: video.loop, source: video.currentSrc,
      canPlay: video.canPlayType('video/mp4'), error: video.error?.message ?? null }));
    assert.equal(metadata.width, recording.deliveryCrop.width);
    assert.equal(metadata.height, recording.deliveryCrop.height);
    assert.ok(Math.abs(metadata.duration - expected.frames / recording.fps) < 1 / recording.fps);
    assert.ok(metadata.controls && metadata.muted && metadata.loop && metadata.canPlay);
    assert.equal(metadata.error, null);
    const ranged = await fetch(metadata.source, { headers: { Range: 'bytes=0-1023' } });
    const range = { status: ranged.status, type: ranged.headers.get('content-type'), contentRange: ranged.headers.get('content-range'), bytes: (await ranged.arrayBuffer()).byteLength };
    assert.equal(range.status, 206); assert.match(range.type, /^video\/mp4/); assert.equal(range.bytes, 1024);
    const row = { owner, metadata, range }; report.cases.push(row);
    await seek(page, owner, 0.2);
    row.normal = await playback(page, owner, 1, 1000);
    assert.ok(Math.abs(row.normal.ratio - 1) < 0.18, owner + ' normal playback');
    assert.ok(row.normal.decodedFrames > 0); assert.equal(row.normal.error, null);
    await seek(page, owner, 0.2);
    row.slow = await playback(page, owner, 0.5, 1200);
    assert.equal(row.slow.rate, 0.5); assert.equal(row.slow.pressed, 'true');
    assert.ok(Math.abs(row.slow.ratio - 0.5) < 0.12, owner + ' half-speed playback');
    await seek(page, owner, 1);
    row.next = await frameStep(page, owner, 1);
    row.previous = await frameStep(page, owner, -1);
    assert.ok(row.next.paused && row.previous.paused);
    assert.ok(Math.abs(row.next.after - row.next.before - 1 / 60) < 1e-5);
    assert.ok(Math.abs(row.previous.after - row.previous.before + 1 / 60) < 1e-5);
    assert.ok(Math.abs(row.next.displayed.mediaTime - row.previous.displayed.mediaTime - 1 / 60) < 0.001, owner + ' actual decoded adjacent frames');
    row.repeatedSteps = [];
    let lastPresented = row.previous.displayed.mediaTime;
    for (const direction of [1, 1, 1, 1, 1, 1, -1, -1]) {
      const step = await frameStep(page, owner, direction);
      row.repeatedSteps.push({ direction, ...step, decodedDelta: step.displayed.mediaTime - lastPresented });
      lastPresented = step.displayed.mediaTime;
    }
    assert.ok(row.repeatedSteps.every(step => Math.abs(step.decodedDelta - step.direction / 60) < 0.001), owner + ' repeated controls advance exactly one decoded frame');
    await page.locator(`#${owner} [data-speed="1"]`).click();
    await seek(page, owner, metadata.duration - 0.12);
    row.loop = await page.evaluate(async owner => {
      const video = document.querySelector('#' + owner + ' video'); await video.play();
      await new Promise(resolve => setTimeout(resolve, 500));
      video.pause(); return { time: video.currentTime, ended: video.ended, error: video.error?.message ?? null };
    }, owner);
    assert.ok(row.loop.time < 1 && !row.loop.ended); assert.equal(row.loop.error, null);
    await seek(page, owner, owner === 'link' ? 1.42 : owner === 'pikachu' ? 1.6 : 1.25);
    console.log(JSON.stringify({ owner, duration: metadata.duration, normalRate: row.normal.ratio, slowRate: row.slow.ratio,
      nextMediaTime: row.next.displayed.mediaTime, previousMediaTime: row.previous.displayed.mediaTime, loop: row.loop.time }));
  }
  await page.evaluate(() => scrollTo(0, 0));
  await mkdir('.tmp/final-preview-gallery', { recursive: true });
  await page.screenshot({ path: '.tmp/final-preview-gallery/gallery.png' });
  report.reviewScreenshot = '.tmp/final-preview-gallery/gallery.png';
  assert.deepEqual(report.errors, []); report.result = 'PASS_PLAYBACK_CONTROLS';
} catch (error) { report.result = 'FAIL'; report.failure = error.stack ?? String(error); throw error; }
finally {
  await context?.close(); await browser?.close(); if (edge) report.browserCleanup = await edge.close();
  await writeFile(out, JSON.stringify(report, null, 2) + '\n');
}
