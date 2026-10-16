/** User-requested footage: one actual compositor image per fixed tick, encoded
 * at 60 FPS. Recording throughput is not a measurement of game performance. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { openMatchHost, launchMatch } from './browser-match-host.mjs';
import { launchWindowsEdgeCdp } from './windows-edge-cdp.mjs';

const arg = (name, fallback) => {
  const index = process.argv.indexOf('--' + name);
  return index < 0 ? fallback : process.argv[index + 1];
};
const out = resolve(arg('out', 'artifacts/final-smash-previews'));
const url = arg('url', 'http://127.0.0.1:4173/platform-fighter/');
const ffmpeg = arg('ffmpeg', process.env.FFMPEG_BINARY ?? 'ffmpeg');
const width = 1280, height = 800, fps = 60;
const owners = ['link', 'pikachu', 'donkeykong'].filter(owner => !arg('only', '') || owner === arg('only', ''));
assert.ok(owners.length);
await mkdir(out, { recursive: true });
const report = { url, fps, width, height, method: 'Actual Windows Edge match rendering, one fixed simulation tick per video frame. Saved DOM special binding activates the move. Final resources and initial target placement are demonstration fixtures. No game code or animation timing is changed. Capture throughput is not a performance measurement. Silent footage.', cases: [], errors: [] };
const edge = await launchWindowsEdgeCdp({ windowsPort: 9253, bridgePort: 9254 });
const browser = await chromium.connectOverCDP(edge.endpoint);
let context;
const save = () => writeFile(out + '/recording.json', JSON.stringify(report, null, 2) + '\n');
try {
  report.browser = browser.version();
  for (const owner of owners) {
    context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.stack ?? error.message));
    const script = await openMatchHost(page, url);
    await page.addStyleTag({ content: '.frame-rate-meter,.match-pause{visibility:hidden!important}' });
    await launchMatch(page, {
      mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 161016,
      itemFrequency: 'off', linkIntroPolicy: 'none',
      finalSmashRules: { schemaVersion: 1, meterEnabled: false, smashBallEnabled: true },
      players: [{ index: 1, characterId: owner, paletteIndex: 0, inputType: 'keyboard_p1' },
        { index: 2, characterId: 'donkeykong', paletteIndex: 1, inputType: 'keyboard_p2' }],
    });
    const setup = await page.evaluate(owner => {
      const host = window.__sim, sim = host.match;
      for (let tick = 0; tick < 240; tick++) host.step();
      const floor = sim.baseStage.bodies.platformBodies.find(body => body.label === 'platform.solid');
      const distance = owner === 'link' ? 500 : owner === 'pikachu' ? 120 : 100;
      for (const [index, actor] of [sim.p1, sim.p2].entries()) {
        actor.resetForRound(floor.position.x + (index ? distance : 0), floor.bounds.min.y - actor.getTuning().height / 2);
        actor.setFacing(index ? -1 : 1); actor.setDamagePercent(0);
      }
      for (let tick = 0; tick < 15; tick++) host.step();
      const frame = host.frame;
      for (const slot of sim.playerSlots) sim.consumeFinalEvents(sim.finalSmashController.resetParticipant(slot.playerIndex,
        slot.character.getPositionResetGeneration(), 'owner-reset', 0), frame);
      sim.consumeFinalEvents(sim.finalSmashController.grantBall(sim.playerSlots[0].playerIndex, frame), frame);
      const binding = host.inputResolver.dispatcher.bindings.get(sim.playerSlots[0].bindingsSlot).bindings.special.find(binding => binding.kind === 'keyboard');
      let arranged = false;
      window.__previewStep = async () => {
        const run = sim.finalSmashController.getActive();
        if (!arranged && owner === 'donkeykong' && run?.phase === 'start' && run.phaseAge === 27) {
          const root = sim.p1.getSourceRootPosition();
          sim.matter.body.setPosition(sim.p2.body, { x: root.x + 100, y: root.y - sim.p2.getTuning().height / 2 });
          sim.matter.body.setVelocity(sim.p2.body, { x: 0, y: 0 }); arranged = true;
        }
        if (!arranged && owner === 'link' && run?.phaseAge >= 59) {
          const p = sim.p1.getPosition();
          sim.matter.body.setPosition(sim.p2.body, { x: p.x + 500, y: p.y - 12 });
          sim.matter.body.setVelocity(sim.p2.body, { x: 0, y: 0 }); arranged = true;
        }
        host.step(); host.draw();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const active = sim.finalSmashController.getActive(), presentation = sim.p1.getFinalSmashPresentation();
        return { frame: host.frame, phase: active?.phase ?? null, age: active?.phaseAge ?? null,
          poseAge: presentation?.age ?? null, presenting: presentation !== null,
          captures: active?.captures.length ?? 0, damage: sim.p2.getDamagePercent(),
          arrows: sim.linkArticles.ancientArrows().length,
          ownerVisible: host.presentation(0)?.visible === true, fault: host.fault };
      };
      host.draw();
      return { binding, buildIdentity: sim.buildIdentity };
    }, owner);
    const row = { owner, script, setup, frames: 0, phases: [], maxDamage: 0, maxCaptures: 0, poster: null };
    report.cases.push(row);
    const encoder = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe',
      '-framerate', String(fps), '-c:v', 'mjpeg', '-i', 'pipe:0', '-an', '-c:v', 'libx264',
      '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-threads', '2',
      '-movflags', '+faststart', out + '/' + owner + '.mp4'], { stdio: ['pipe', 'ignore', 'pipe'] });
    let encoderError = '';
    encoder.stderr.on('data', bytes => { encoderError += bytes.toString(); });
    const encoded = new Promise((resolve, reject) => {
      encoder.on('error', reject);
      encoder.on('exit', code => code === 0 ? resolve() : reject(new Error('Encoder: ' + encoderError)));
    });
    encoded.catch(() => {});
    const cdp = await context.newCDPSession(page);
    const binding = String.fromCharCode(setup.binding.keyCode);
    let started = false, endedAt = null;
    try {
      for (let tick = 0; tick < 800; tick++) {
        if (tick === 30) await page.keyboard.down(binding);
        const state = await page.evaluate(() => window.__previewStep());
        if (tick === 30) await page.keyboard.up(binding);
        assert.equal(state.fault, null, owner + ' runtime fault');
        if (state.phase) started = true;
        if (state.presenting) assert.ok(state.ownerVisible, owner + ' Final drawing missing');
        if (state.phase && !row.phases.includes(state.phase)) row.phases.push(state.phase);
        row.maxDamage = Math.max(row.maxDamage, state.damage);
        row.maxCaptures = Math.max(row.maxCaptures, state.captures);
        const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 92,
          fromSurface: true, captureBeyondViewport: false,
          clip: { x: 0, y: 0, width, height, scale: 1 } });
        const bytes = Buffer.from(data, 'base64');
        if (!encoder.stdin.write(bytes)) await once(encoder.stdin, 'drain');
        row.frames++;
        const poster = owner === 'link' ? state.poseAge >= 55 && state.poseAge < 60
          : owner === 'pikachu' ? state.phase === 'startup' && state.age >= 35
            : state.phase === 'success' && state.age >= 8;
        if (poster && !row.poster) { row.poster = owner + '.jpg'; await writeFile(out + '/' + row.poster, bytes); }
        if (started && !state.phase && !state.presenting && !state.arrows && endedAt === null) endedAt = tick;
        if (endedAt !== null && tick - endedAt >= 75) break;
        if (tick % 120 === 0) console.log(JSON.stringify({ owner, capturedFrames: row.frames, phase: state.phase }));
      }
      assert.ok(started && endedAt !== null, owner + ' Final completes');
      assert.ok(row.maxDamage > 0, owner + ' successful hit');
      assert.ok(row.poster, owner + ' action poster captured');
      encoder.stdin.end(); await encoded;
    } catch (error) { encoder.stdin.destroy(); encoder.kill('SIGTERM'); throw error; }
    row.seconds = row.frames / fps;
    row.sha256 = createHash('sha256').update(await readFile(out + '/' + owner + '.mp4')).digest('hex');
    console.log(JSON.stringify({ owner, seconds: row.seconds, frames: row.frames, phases: row.phases, damage: row.maxDamage }));
    await save(); await context.close(); context = null;
  }
  assert.deepEqual(report.errors, []); report.result = 'PASS';
} catch (error) { report.result = 'FAIL'; report.failure = error.stack ?? String(error); throw error; }
finally { await context?.close(); await browser.close(); report.cleanup = await edge.close(); await save(); }
