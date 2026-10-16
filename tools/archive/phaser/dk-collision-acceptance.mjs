import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const out = process.argv[3] ?? process.env.PF_PROBE_OUT ?? 'docs/review/2026-10-06/dk-collision/browser';
const url = process.argv[2] ?? process.env.PF_REWORK_URL ?? 'http://127.0.0.1:4176/platform-fighter/';
const diagnostic = process.argv[4] === 'diagnostic' || process.env.PF_DIAGNOSTIC === '1';
await mkdir(out, { recursive: true });
const report = { url, diagnostic, bundle: null, bundleSha256: null, errors: [], scenarios: [], checks: [] };
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', e => report.errors.push(e.message));
const definitions = [
  { name: 'tilt-up-fist', move: 'tilt', angle: -0.4, frame: 7, x: 125, y: -30, region: 0 },
  { name: 'tilt-down-fist', move: 'tilt', angle: 0.4, frame: 7, x: 125, y: 15, region: 0 },
  { name: 'tilt-up-outside', move: 'tilt', angle: -0.4, frame: 7, x: 134, y: -30 },
  { name: 'tilt-down-outside', move: 'tilt', angle: 0.4, frame: 7, x: 134, y: 15 },
  { name: 'nair-first-forward', move: 'nair', air: true, frame: 10, x: 82, y: 2, region: 3 },
  { name: 'nair-continuing-front', move: 'nair', air: true, frame: 11, x: 40, y: -20, region: 0 },
  { name: 'nair-continuing-rear', move: 'nair', air: true, frame: 11, x: -45, y: 0, region: 1 },
  { name: 'nair-continuing-empty', move: 'nair', air: true, frame: 11, x: 82, y: -20 },
  { name: 'nair-late-front', move: 'nair', air: true, frame: 14, x: 40, y: -20, region: 0 },
  { name: 'nair-late-empty', move: 'nair', air: true, frame: 14, x: 82, y: -20 },
  { name: 'spin-front-outer', move: 'up_special', air: true, frame: 10, x: 100, y: -18, region: 0 },
  { name: 'spin-rear-outer', move: 'up_special', air: true, frame: 10, x: -100, y: -18, region: 1 },
  { name: 'spin-front-inner', move: 'up_special', air: true, frame: 10, x: 20, y: -18, region: 2 },
  { name: 'spin-rear-inner', move: 'up_special', air: true, frame: 10, x: -20, y: -18, region: 3 },
  { name: 'spin-outside', move: 'up_special', air: true, frame: 10, x: 111, y: -18 },
  { name: 'mirrored-defender-limb', move: 'tilt', frame: 7, x: 125, y: -12, region: 0, defenderFacing: -1, limbOffset: 20 },
  { name: 'right-defender-limb', move: 'tilt', frame: 7, x: 125, y: -12, region: 0, defenderFacing: 1, limbOffset: 20 },
  { name: 'extended-limb-outside-body', move: 'tilt', frame: 7, x: 125, y: -12, region: 0, defenderFacing: 1, limbOffset: 200 },
  { name: 'extended-mirrored-limb-outside-body', move: 'tilt', frame: 7, x: 125, y: -12, region: 0, defenderFacing: -1, limbOffset: 200 },
  { name: 'extended-limb-intangible', move: 'tilt', frame: 7, x: 125, y: -12, defenderFacing: 1, limbOffset: 200, intangible: true },
  { name: 'extended-limb-corner-miss', move: 'tilt', frame: 7, x: 132, y: 15, defenderFacing: 1, limbOffset: 200 },
];

try {
  await page.goto(url);
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 90000 });
  report.bundle = await page.evaluate(() => [...document.scripts].map(s => s.src).find(s => /\/assets\/index-.*\.js/.test(s)));
  report.bundleSha256 = createHash('sha256').update(await (await page.request.get(report.bundle)).body()).digest('hex');
  for (const facing of [1, -1]) for (const def of definitions) {
    await page.evaluate(() => {
      const g = window.__game;
      for (const s of g.scene.getScenes(true)) g.scene.stop(s.scene.key);
      g.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 1010,
        itemFrequency: 'off', players: [
          { index: 1, characterId: 'donkeykong', paletteIndex: 0, inputType: 'keyboard_p1' },
          { index: 2, characterId: 'donkeykong', paletteIndex: 1, inputType: 'keyboard_p2' },
        ] } });
    });
    await page.waitForFunction(() => window.__game.scene.getScene('MatchScene').p1?.body);
    const row = await page.evaluate(({ def, facing }) => {
      const s = window.__game.scene.getScene('MatchScene');
      s.physicsEngine.pause();
      let input = {};
      s.inputResolver.getMoveVector = p => p === 1 ? { x: input.moveX ?? 0, y: input.moveY ?? 0 } : { x: 0, y: 0 };
      s.inputResolver.isActionHeld = (p, action) => p === 1 && input[action] === true;
      s.inputResolver.getSmash = () => ({ buttonHeld: false, stickJustPressed: false, x: 0, y: 0 });
      const step = (next = {}) => {
        input = next; s.physicsEngine.resume(); s.update(0, s.physicsEngine.fixedTimestepMs); s.physicsEngine.pause();
      };
      for (let n = 0; n < 120; n++) step();
      const floor = s.baseStage.bodies.platformBodies.find(b => b.label === 'platform.solid');
      const x = floor.position.x, y = floor.bounds.min.y - 42;
      s.p1.resetForRound(x, y); s.p2.resetForRound(x + 450 * facing, y); s.p1.setFacing(facing);
      for (let n = 0; n < 12; n++) step();
      if (def.air) { s.p1.resetForRound(x + 250, y - 450); s.p1.setFacing(facing); step(); }
      if (def.angle !== undefined) {
        step({ moveX: 0.5 * facing, moveY: def.angle });
        step({ moveX: 0.5 * facing, moveY: def.angle, attack: true });
      } else if (def.move === 'up_special') s.p1.executeUpSpecial(0, -1);
      else s.p1.attemptAttack(`donkeykong.${def.move}`);
      for (let n = 0; n < 90; n++) {
        const a = s.p1.getActiveAttack();
        if (a?.framesElapsed >= def.frame - 2) break;
        step();
      }
      const active = s.p1.getActiveAttack();
      if (!active || active.move.id !== `donkeykong.${def.move}`) throw new Error(`Missing route ${def.name}`);
      // Controlled one-pixel hurtboxes isolate region edges. Pinning the
      // fighters at this contact boundary avoids movement obscuring geometry;
      // real MatchScene/Matter sensors still determine and deliver the hit.
      s.matter.body.setStatic(s.p1.body, true);
      const anchor = { ...s.p1.getPosition() };
      const point = { x: anchor.x + def.x * facing, y: anchor.y + def.y };
      const defenderFacing = (def.defenderFacing ?? 1) * facing;
      const offset = def.limbOffset ?? 0;
      s.p2.resetForRound(point.x - offset * defenderFacing, point.y);
      s.p2.setFacing(defenderFacing);
      s.matter.body.setStatic(s.p2.body, true);
      s.p2.getActiveHurtboxes = () => [{ id: 'controlled-contact', offsetX: offset, offsetY: 0, width: 1, height: 1,
        ...(def.intangible ? { intangible: true } : {}) }];
      const hits = [];
      const deliver = s.hitboxDamageHandler.callback;
      s.hitboxDamageHandler.callback = (target, hit, context) => {
        hits.push({ target, region: context.collisionHitId, move: context.moveId, damage: hit.damage });
        return deliver(target, hit, context);
      };
      const before = { elapsed: active.framesElapsed, point, attacker: anchor, defenderFacing };
      step();
      const after = s.p1.getActiveAttack();
      return { def, facing, before, elapsed: after?.framesElapsed, hits, engineIdentity: s.getMatchStartMetadata().engineVersion,
        sensors: [after?.hitboxBody, ...s.p1.transientHitboxes.map(t => t.body)].filter(Boolean).map(b => ({
          bounds: b.bounds, move: b.plugin.moveId, regions: b.plugin.collisionHits,
        })) };
    }, { def, facing });
    report.scenarios.push(row);
    const pass = def.region === undefined ? row.hits.length === 0
      : row.hits.length === 1 && row.hits[0].region === def.region;
    report.checks.push({ name: `${def.name} facing ${facing}`, passed: pass });
    console.log(JSON.stringify({ name: def.name, facing, expected: def.region ?? 'miss', hits: row.hits, passed: pass }));
  }
  await page.screenshot({ path: `${out}/match.png` });
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
const failed = report.checks.filter(c => !c.passed);
console.log(JSON.stringify({ scenarios: report.scenarios.length, failed: failed.length, errors: report.errors }));
assert.equal(report.errors.length, 0);
if (!diagnostic) assert.equal(failed.length, 0, JSON.stringify(failed));
