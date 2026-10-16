// Audit-only actual DK match captures: preserve native game dimensions and map logical coordinates into browser CSS pixels.
// Usage: PF_REWORK_URL=http://127.0.0.1:4173/platform-fighter/ node dk-visual-shots.mjs <outDir>
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: dk-visual-shots.mjs <outDir>');
await mkdir(OUT, { recursive: true });
const report = { bundle: null, bundleSha256: null, engineVersion: null, pageErrors: [], shots: [], scope: '22 actual match captures; sampled pose/render audit, not complete action qualification. Native game dimensions retained.' };

const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('pageerror', (e) => report.pageErrors.push(e.message));
try {
  await page.goto(process.env.PF_REWORK_URL ?? 'http://127.0.0.1:4173/platform-fighter/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  report.bundle = await page.evaluate(() => [...document.scripts].map((s) => s.src).find((s) => /index-.*\.js/.test(s))?.split('/').pop() ?? null);
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  const bundleUrl = await page.evaluate(() => [...document.scripts].map(s => s.src).find(s => /\/assets\/index-.*\.js/.test(s)));
  report.bundleSha256 = createHash('sha256').update(await (await page.request.get(bundleUrl)).body()).digest('hex');
  report.engineVersion = await page.evaluate(() => {
    const game = window.__game;
    for (const scene of game.scene.getScenes(true)) game.scene.stop(scene.scene.key);
    // Preserve normal game/stage dimensions.
    game.scene.start('MatchScene', {
      matchConfig: {
        mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 819, itemFrequency: 'off',
        players: [
          { index: 1, characterId: 'donkeykong', paletteIndex: 0, inputType: 'keyboard_p1' },
          { index: 2, characterId: 'pikachu', paletteIndex: 0, inputType: 'keyboard_p2' },
        ],
      },
    });
    const s = game.scene.getScene('MatchScene');
    s.physicsEngine.pause();
    const input = { 1: {}, 2: {} };
    s.inputResolver.getMoveVector = (player) => ({ x: input[player]?.moveX ?? 0, y: input[player]?.moveY ?? 0 });
    s.inputResolver.isActionHeld = (player, action) => input[player]?.[action] === true;
    const floor = s.baseStage.bodies.platformBodies.find((b) => b.label === 'platform.solid');
    const start = { x: floor.position.x, y: floor.bounds.min.y - s.p1.getTuning().height / 2 };
    const p2StandY = floor.bounds.min.y - s.p2.getTuning().height / 2;
    window.__pf = {
      s, start,
      step(n1) {
        input[1] = n1 || {}; input[2] = {};
        s.physicsEngine.resume(); s.update(0, s.physicsEngine.fixedTimestepMs); s.physicsEngine.pause();
        const a = s.p1.getActiveAttack(); const p = s.p1.getPosition();
        return { x: p.x, y: p.y, grounded: s.p1.isGrounded(), active: a ? { id: a.move.id, elapsed: a.framesElapsed } : null };
      },
      reset(facing, p2dx) {
        s.p1.resetForRound(start.x, start.y); s.p1.setFacing(facing); s.p1.setDamagePercent(0);
        s.p2.resetForRound(start.x + (p2dx ?? 130) * facing, p2StandY); s.p2.setFacing(-facing); s.p2.setDamagePercent(0);
      },
      screenBox() {
        const cam = s.cameras.main; const p = s.p1.getPosition();
        const r = game.canvas.getBoundingClientRect();
        const sx = r.width / game.scale.gameSize.width, sy = r.height / game.scale.gameSize.height;
        const sp = s.playerSlots[0].sprite;
        return { x: r.left + (cam.x + (p.x - cam.worldView.x) * cam.zoom) * sx, y: r.top + (cam.y + (p.y - cam.worldView.y) * cam.zoom) * sy, zoom: cam.zoom, sx, sy, logicalSize: [game.scale.gameSize.width, game.scale.gameSize.height], texture: sp.texture.key, cell: Number(sp.frame.name), receiving: s.p1.getActiveHurtboxes(), actorPosition: p, floorY: floor.bounds.min.y, sprite: {x:sp.x,y:sp.y,scaleX:sp.scaleX,scaleY:sp.scaleY,originX:sp.originX,originY:sp.originY,flipX:sp.flipX} }; 
      },
    };
    return s.getMatchStartMetadata?.()?.engineVersion ?? null;
  });

  const step = (n1) => page.evaluate((n1) => window.__pf.step(n1), n1 || {});
  const reset = (facing, p2dx) => page.evaluate(({ facing, p2dx }) => window.__pf.reset(facing, p2dx), { facing, p2dx });
  // Render one frame of the scene (physics paused, sprite driver still updates on scene update).
  async function shot(name, meta) {
    await page.evaluate(() => { const s = window.__pf.s; s.update(0, 0); });
    await page.waitForTimeout(80);
    const box = await page.evaluate(() => window.__pf.screenBox());
    const R = 240;
    const viewport = page.viewportSize();
    const width = Math.min(2 * R, viewport.width), height = Math.min(2 * R + 40, viewport.height);
    const clip = { x: Math.min(Math.max(0, box.x - R), viewport.width - width), y: Math.min(Math.max(0, box.y - R - 40), viewport.height - height), width, height };
    const file = `${OUT}/${name}.png`;
    await page.screenshot({ path: file, clip });
    report.shots.push({ name, file, ...meta, observation: box });
  }

  for (const facing of [1, -1]) {
    const f = facing === 1 ? 'right' : 'left';
    await reset(facing); for (let i = 0; i < 12; i++) await step({});
    await shot(`idle-${f}`, { facing });
    for (let i = 0; i < 24; i++) await step({ moveX: facing });
    await shot(`run-${f}`, { facing });
    await reset(facing);
    for (let i = 0; i < 12; i++) await step({});
    await step({ jump: true }); for (let i = 0; i < 12; i++) await step({ jump: true });
    await shot(`jump-rise-${f}`, { facing });
    for (let i = 0; i < 26; i++) await step({});
    await shot(`jump-fall-${f}`, { facing });
    // jab contact (startup 4 → active from elapsed 4)
    await reset(facing, 60); for (let i = 0; i < 12; i++) await step({});
    let st = await step({ attack: true }); while (st.active && st.active.elapsed < 4) st = await step({});
    await shot(`jab-contact-${f}`, { facing, active: st.active });
    // forward smash contact (uncharged release → hit around elapsed 21)
    await reset(facing, 110); for (let i = 0; i < 12; i++) await step({});
    // This deterministic pose fixture uses attack + a stick flick; physical heavy-key routing is reviewed separately.
    st = await step({ attack: true, moveX: facing });
    // a charge smash reports no active attack until the charge releases
    for (let i = 0; i < 12 && !st.active; i++) st = await step({});
    while (st.active && st.active.elapsed < 21) st = await step({});
    await shot(`fsmash-contact-${f}`, { facing, active: st.active });
    // up special mid-rise
    await reset(facing); for (let i = 0; i < 12; i++) await step({});
    st = await step({ special: true, moveY: -1 }); for (let i = 0; i < 24; i++) st = await step({});
    await shot(`upspecial-${f}`, { facing, active: st.active });
    // hand slap first slap
    await reset(facing, 50); for (let i = 0; i < 12; i++) await step({});
    st = await step({ special: true, moveY: 1 }); while (st.active && st.active.elapsed < 11) st = await step({ moveY: 1 });
    await shot(`handslap-${f}`, { facing, active: st.active });
    // giant punch wind-up (charging)
    await reset(facing); for (let i = 0; i < 12; i++) await step({});
    st = await step({ special: true }); for (let i = 0; i < 30; i++) st = await step({ special: true });
    await shot(`giantpunch-charge-${f}`, { facing, active: st.active });
    // crouch and shield
    await reset(facing); for (let i = 0; i < 12; i++) await step({});
    for (let i = 0; i < 6; i++) await step({ moveY: 1 });
    await shot(`crouch-${f}`, { facing });
    await reset(facing); for (let i = 0; i < 12; i++) await step({});
    for (let i = 0; i < 6; i++) await step({ shield: true });
    await shot(`shield-${f}`, { facing });
  }
} finally {
  await writeFile(`${OUT}/index.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ bundle: report.bundle, engineVersion: report.engineVersion, shots: report.shots.length, pageErrors: report.pageErrors }));
