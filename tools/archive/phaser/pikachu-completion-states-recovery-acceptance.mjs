import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tsImport } from 'tsx/esm/api';
import { chromium } from 'playwright';

const output = process.env.PF_REGISTRY_OUTPUT ?? 'docs/review/2026-10-06/pikachu-character/integration/completion-states-recovery';
const metadata = JSON.parse(await readFile(process.env.PF_PIKACHU_METADATA ?? 'assets/characters/pikachu/frames.json', 'utf8'));
const { PIKACHU_STATE_AUTHORED_HURTBOX_POSES: poses } = await tsImport(process.env.PF_PIKACHU_STATE_LEAF ?? new URL('../src/characters/pikachuStateHurtboxes.ts', import.meta.url).pathname, import.meta.url);
const contracts = [
  { kind: 'face-up', suffix: 'getupAttack', sheet: 'getup_attack', total: 45, protection: 22, contact: [[15, 17], [20, 22]], damage: 7 },
  { kind: 'face-down', suffix: 'getupAttackFaceDown', sheet: 'getup_attack_face_down', total: 45, protection: 22, contact: [[15, 17], [20, 22]], damage: 7 },
  { kind: 'trip', suffix: 'tripAttack', sheet: 'trip_attack', total: 49, protection: 7, contact: [[17, 19], [21, 23]], damage: 5 },
];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { errors: [], scope: 'Actual production MatchScene fixed-step normal InputResolver attack edge from real-Matter missed-tech prone or public grounded applyTrip replay; all accepted recovery drawings, paired receiving and source damage/protection/gaps. Replay origins use explicit authored beta selectors. Physical hardware controls and native common prone selector/transport parity remain separate.' };
page.on('pageerror', e => report.errors.push(e.message));
await page.exposeFunction('__captureCompletionRecovery', name => page.screenshot({ path: `${output}/${name}` }));
try {
  await page.goto(process.env.PF_REGISTRY_URL ?? 'http://127.0.0.1:4238/platform-fighter/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  report.bundle = await page.evaluate(() => [...document.scripts].map(s => s.src).find(src => /\/assets\/index-.*\.js/.test(src)));
  report.bundleSha256 = createHash('sha256').update(await (await page.request.get(report.bundle)).body()).digest('hex');
  report.rows = await page.evaluate(async ({ metadata, contracts }) => {
    const game = window.__game;
    for (const s of game.scene.getScenes(true)) game.scene.stop(s.scene.key);
    game.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 858, itemFrequency: 'off',
      players: [{ index: 1, characterId: 'pikachu', paletteIndex: 0, inputType: 'keyboard_p1' }, { index: 2, characterId: 'donkeykong', paletteIndex: 0, inputType: 'keyboard_p2' }] } });
    const scene = game.scene.getScene('MatchScene'); scene.physicsEngine.pause(); scene.roundStartCountdown = 0;
    let input = {};
    scene.inputResolver.getMoveVector = slot => ({ x: slot === 1 ? input.moveX ?? 0 : 0, y: 0 });
    scene.inputResolver.isActionHeld = (slot, action) => slot === 1 && input[action] === true;
    const step = (next = {}) => { input = next; scene.physicsEngine.resume(); scene.update(0, scene.physicsEngine.fixedTimestepMs); scene.physicsEngine.pause(); };
    const floor = scene.baseStage.bodies.platformBodies.find(b => b.label === 'platform.solid'), actor = scene.p1, rows = [];
    // Isolate the actual solid-floor contact. An upper one-way platform can
    // receive a launch before the documented floor fixture and then release
    // contact while the newly entered wake-up is still falling.
    for (const platform of scene.baseStage.bodies.platformBodies) if (platform !== floor) {
      platform.collisionFilter.mask = 0;
      scene.matter.world.remove(platform);
    }
    const read = () => {
      const sprite = scene.playerSlots[0].sprite, attack = actor.getActiveAttack();
      return { reaction: actor.getReactionPresentationState(), attack: attack ? { id: attack.move.id, age: attack.framesElapsed,
        windows: attack.move.hitWindows, sensor: attack.hitboxBody ? { position: { ...attack.hitboxBody.position } } : null } : null,
        position: actor.getPosition(), facing: actor.getFacing(), grounded: actor.isGrounded(), canAttack: actor.canAttack(),
        hitlag: actor.getHitlagRemaining(), receiving: actor.getActiveHurtboxes(), texture: sprite.texture.key,
        textureFrame: Number(sprite.frame.name), origin: [sprite.originX, sprite.originY],
        mirror: Math.sign(sprite.scaleX) * (sprite.flipX ? -1 : 1), targetPercent: scene.p2.getDamagePercent(),
        stocks: scene.stockTracker.getStocks(1), camera: { x: scene.cameras.main.scrollX, y: scene.cameras.main.scrollY, zoom: scene.cameras.main.zoom } };
    };
    for (const facing of [1, -1]) for (const contract of contracts) for (const probe of ['miss', 'front', 'back']) {
      actor.resetForRound(floor.position.x, floor.bounds.min.y - 25);
      scene.p2.resetForRound(floor.position.x - 250, floor.bounds.min.y - scene.p2.getTuning().height / 2);
      actor.setDamagePercent(0); scene.p2.setDamagePercent(0);
      for (let n = 0; n < 12; n++) step(); actor.setFacing(facing);
      let hit = null, flight = [];
      if (contract.kind === 'trip') { actor.applyTrip(); step(); }
      else {
        hit = { damage: 1, knockback: { x: 8, y: -8, scaling: 0 }, facing: contract.kind === 'face-up' ? -facing : facing, hitlagMultiplier: 1 };
        actor.applyHit(hit);
        for (let n = 0; n < 160 && !actor.isKnockedDown(); n++) { step(); flight.push(read()); }
      }
      const entry = read();
      if (!actor.isKnockedDown() || entry.reaction?.origin !== contract.kind) throw new Error(`Wrong observed prone origin ${facing}/${contract.kind}: ${JSON.stringify({ entry, last: flight.slice(-3), floor: floor.bounds })}`);
      const pos = actor.getPosition(), gap = probe === 'miss' ? 170 : probe === 'front' ? 55 * facing : -55 * facing;
      scene.p2.resetForRound(pos.x + gap, floor.bounds.min.y - scene.p2.getTuning().height / 2);
      scene.p2.setFacing(-facing); scene.p2.setDamagePercent(0);
      step({ attack: true });
      const trace = [], captures = [], seen = new Set();
      for (let n = 0; n < 110; n++) {
        const o = read(); trace.push(o);
        if (!o.attack) break;
        if (probe === 'miss' && !seen.has(o.textureFrame)) {
          seen.add(o.textureFrame); const screenshot = `${contract.sheet}-${facing}-${o.attack.age}.png`;
          await window.__captureCompletionRecovery(screenshot); captures.push({ screenshot, observation: o });
        }
        step();
      }
      rows.push({ facing, contract, probe, hit, flight, entry, trace, captures, floorY: floor.bounds.min.y });
    }
    return rows;
  }, { metadata, contracts });
  for (const row of report.rows) {
    const c = row.contract, active = row.trace.filter(o => o.attack);
    assert.equal(active[0]?.attack.id, `pikachu.${c.suffix}`);
    assert.deepEqual([...new Set(active.map(o => o.attack.age))], Array.from({ length: c.total }, (_, n) => n));
    assert.equal(row.trace.at(-1).attack, null); assert.equal(row.trace.at(-1).canAttack, true);
    assert.equal(new Set(active.filter(o => o.receiving.some(h => h.intangible)).map(o => o.attack.age)).size, c.protection);
    for (const o of active) {
      const clip = metadata.animations[c.sheet], w = clip.frameWindows.find(w => w.startFrame <= o.attack.age && o.attack.age < w.endFrame);
      assert.equal(o.texture, `char.pikachu.${c.sheet}`); assert.equal(o.textureFrame, w?.artFrameIndex);
      assert.equal(o.mirror, row.facing); assert.equal(o.canAttack, false); assert.equal(o.grounded, true);
      assert.deepEqual(o.origin, [clip.root[0] / clip.frameWidth, clip.root[1] / clip.frameHeight]);
      const expected = poses.find(p => p.sheet === c.sheet && p.artFrameIndex === w.artFrameIndex).hurtboxes;
      assert.deepEqual(o.receiving, expected.map(h => o.attack.age < c.protection ? { ...h, intangible: true } : h));
      assert.equal(!!o.attack.sensor, c.contact.some(([a, b]) => a <= o.attack.age && o.attack.age < b), `${c.kind} source contact/gap at${o.attack.age}`);
      assert.equal(o.stocks, row.entry.stocks);
    }
    const damage = row.trace.at(-1).targetPercent;
    assert.ok(Math.abs(damage - (row.probe === 'miss' ? 0 : c.damage * 1.05)) < 1e-8, `${c.kind}/${row.probe}: expected source damage ${c.damage}, measured${damage}`);
    if (row.probe === 'miss') assert.equal(row.captures.length, new Set(metadata.animations[c.sheet].frameWindows.map(w => w.artFrameIndex)).size,
      'All playable drawings; retained source endpoint cells are not an extra action interval');
    else assert.ok(active.some(o => o.hitlag > 0), 'real recovery contact freezes attacker');
  }
  assert.deepEqual(report.errors, []); report.result = 'PASS';
  console.log(JSON.stringify({ result: report.result, cases: report.rows.length, captures: report.rows.flatMap(r => r.captures).length }));
} catch (error) { report.result = 'FAIL'; report.assertionFailure = error.stack; throw error; }
finally { await writeFile(`${output}/observations.json`, JSON.stringify(report, null, 2) + '\n'); await browser.close(); }
