import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {tsImport} from 'tsx/esm/api';
import {chromium} from 'playwright';

const prefix = process.env.PF_STAGED_PREFIX, output = process.env.PF_REGISTRY_OUTPUT;
assert.ok(prefix && output && process.env.PF_REGISTRY_URL);
const build = JSON.parse(await readFile(`${prefix}-assets-staged.json`, 'utf8'));
const metadata = JSON.parse(await readFile(`${prefix}-pikachu-frames.json`, 'utf8'));
assert.equal(createHash('sha256').update(await readFile(`${prefix}-pikachu-frames.json`)).digest('hex'), build.pikachuFramesSha256);
const hashes = JSON.parse(await readFile(build.sourceHashes, 'utf8'));
for (const path of ['src/builder/customStageSerializer.ts', 'src/stages/customStageLoader.ts', 'src/match/RespawnHandler.ts']) assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'), hashes[path], `public stage/respawn helper matches immutable build: ${path}`);
const leaf = `${build.sourceLeafDirectory}/pikachuAuxiliaryBody.ts`;
assert.equal(createHash('sha256').update(await readFile(leaf)).digest('hex'), hashes['src/characters/pikachuAuxiliaryBody.ts']);
const {selectPikachuAuxiliaryBody} = await tsImport(new URL(`../${leaf}`, import.meta.url).pathname, import.meta.url);
const receivingLeaf = `${build.sourceLeafDirectory}/pikachuStateHurtboxes.ts`;
assert.equal(createHash('sha256').update(await readFile(receivingLeaf)).digest('hex'), hashes['src/characters/pikachuStateHurtboxes.ts']);
const {selectPikachuStateHurtboxes} = await tsImport(new URL(`../${receivingLeaf}`, import.meta.url).pathname, import.meta.url);
const {serializeCustomStage, deserializeCustomStage} = await tsImport(new URL('../src/builder/customStageSerializer.ts', import.meta.url).pathname, import.meta.url);
const piece = (type, canvasX, canvasY, width, height) => ({type, canvasX, canvasY, width, height, col: canvasX / 40, row: canvasY / 40});
const customStage = deserializeCustomStage(serializeCustomStage({name: 'Entry dynamic fall qualification', gridSpec: {cellPx: 40, width: 1920, height: 2160}, pieces: [piece('flat-platform', 0, 2080, 1920, 40), piece('spawn-point', 600, 40, 40, 40), piece('spawn-point', 1280, 40, 40, 40)]}));
await mkdir(output, {recursive: true});
const report = {build, customStage, rows: [], errors: [], failedResponses: [], scope: 'Separate legal public CustomStageData fixture: maximum supported builder canvas height, low solid floor and high authored spawn markers. Actual blast-zone KO and normal RespawnHandler registerSlot from stage spawn configuration; unmodified dynamic Matter bodies, native existing gravity and terminal fall cap, no static body or private grounding/status edits. Verifies conditional consumption of all six authored Entry drawings and 129 beta cue ages, then normal fall and actual landing. Does not replace default flat-stage lifecycle evidence or establish missing native Rebirth selector, common kinetics or effects.'};
const browser = await chromium.launch({headless: true, args: ['--no-sandbox', '--disable-gpu']});
const page = await browser.newPage({viewport: {width: 1280, height: 720}});
page.on('pageerror', e => report.errors.push(e.message));
page.on('response', r => {if (r.status() >= 400) report.failedResponses.push({url: r.url(), status: r.status()});});
const capture = async (row, label) => {
  if (process.env.PF_ENTRY_BOUNDARY_ONLY === '1' && label !== 'ordinary-land') return;
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const observation = await page.evaluate(() => window.__entryDynamicRead());
  const view = await page.evaluate(() => {const g = window.__game, c = g.scene.getScene('MatchScene').cameras.main, b = g.canvas.getBoundingClientRect(); return {camera: {worldView: {x: c.worldView.x, y: c.worldView.y, width: c.worldView.width, height: c.worldView.height}, x: c.x, y: c.y, zoom: c.zoom, width: c.width, height: c.height}, canvas: {left: b.left, top: b.top, width: b.width, height: b.height, internalWidth: g.canvas.width, internalHeight: g.canvas.height}};});
  const screenshot = `dynamic-entry-${row.index}-${label}.png`;
  await page.screenshot({path: `${output}/${screenshot}`}); row.captures.push({screenshot, observation, ...view});
};
try {
  await page.goto(process.env.PF_REGISTRY_URL, {waitUntil: 'domcontentloaded', timeout: 60000});
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, {timeout: 60000});
  report.bundle = await page.evaluate(() => [...document.scripts].map(s => s.src).find(s => /\/assets\/index-.*\.js/.test(s)));
  report.bundleSha256 = createHash('sha256').update(await (await page.request.get(report.bundle)).body()).digest('hex'); assert.equal(report.bundleSha256, build.bundleSha256);
  for (const index of [0, 1]) {
    const row = {index, captures: [], trace: []}; report.rows.push(row);
    row.fixture = await page.evaluate(({customStage, index}) => {
      const g = window.__game; for (const old of g.scene.getScenes(true)) g.scene.stop(old.scene.key);
      g.scene.start('MatchScene', {customStage, matchConfig: {mode: 'stocks', stockCount: 5, stageId: 'custom:entry-dynamic-fall', rngSeed: 4156, itemFrequency: 'off', players: [{index: 1, characterId: 'pikachu', paletteIndex: 0, inputType: 'keyboard_p1'}, {index: 2, characterId: 'pikachu', paletteIndex: 0, inputType: 'keyboard_p2'}]}});
      const s = g.scene.getScene('MatchScene'); s.physicsEngine.pause(); s.roundStartCountdown = 0; s.hitboxDebugLayer.setEnabled(true);
      const slot = s.playerSlots[index], a = slot.character, sp = slot.sprite, floor = s.baseStage.bodies.platformBodies.find(b => b.label === 'platform.solid'), blast = s.baseStage.getViewportBlastZone();
      const read = () => ({presentation: a.getPikachuRespawnPresentationState(), locomotion: a.getLocomotionState(), ordinary: a.getOrdinaryPresentationState(), landing: a.getLandingPresentationState(), item: a.getPikachuItemPresentationState(), jumpsUsed: a.getJumpsUsed(), position: a.getPosition(), velocity: a.getVelocity(), grounded: a.isGrounded(), isStatic: a.body.isStatic, facing: a.getFacing(), percent: a.getDamagePercent(), stocks: s.stockTracker.getStocks(slot.playerIndex), invincible: a.isInvincible(), receiving: a.getActiveHurtboxes(), texture: sp.texture.key, textureFrame: Number(sp.frame.name), origin: [sp.originX, sp.originY], scale: [sp.scaleX, sp.scaleY], rotation: sp.rotation, mirror: Math.sign(sp.scaleX) * (sp.flipX ? -1 : 1), spritePosition: {x: sp.x, y: sp.y}, floorY: floor.bounds.min.y});
      window.__entryDynamicRead = read; window.__entryDynamicStep = () => {s.physicsEngine.resume(); s.update(0, s.physicsEngine.fixedTimestepMs); s.physicsEngine.pause(); return read();};
      const other = s.playerSlots[1 - index].character; other.resetForRound(floor.position.x + 450 * (index === 0 ? 1 : -1), floor.bounds.min.y - 25);
      const before = read(); a.setDamagePercent(85); a.setPosition(blast.x - 200, blast.y + blast.height / 2);
      for (let n = 0; n < 180; n++) {const o = window.__entryDynamicStep(); if (o.presentation) return {before, entry: o, blast, spawn: {x: slot.spawnX, y: slot.spawnY}, floor: {x: floor.position.x, y: floor.bounds.min.y}, tuning: a.getTuning()};}
      throw Error('Actual KO did not produce Entry cue');
    }, {customStage, index});
    assert.equal(row.fixture.entry.stocks, row.fixture.before.stocks - 1); assert.equal(row.fixture.entry.percent, 0);
    assert.ok(row.fixture.spawn.y > row.fixture.blast.y && row.fixture.spawn.y < row.fixture.blast.y + row.fixture.blast.height);
    row.trace.push(row.fixture.entry); await capture(row, 0);
    for (let age = 1; age <= 129; age++) {row.trace.push(await page.evaluate(() => window.__entryDynamicStep())); if ([25, 26, 50, 75, 89, 90, 100, 128, 129].includes(age)) await capture(row, age);}
    for (let age = 0; age < 129; age++) {
      const o = row.trace[age], pose = selectPikachuAuxiliaryBody('entry', age), clip = metadata.animations.entry;
      assert.equal(o.presentation?.framesElapsed, age); assert.equal(o.isStatic, false); assert.equal(o.grounded, false); assert.equal(o.stocks, row.fixture.entry.stocks);
      assert.equal(o.texture, 'char.pikachu.entry'); assert.equal(o.textureFrame, pose.artFrameIndex); assert.deepEqual(o.receiving, pose.hurtboxes); assert.equal(o.receiving.length, 12);
      assert.deepEqual(o.origin, [clip.root[0] / clip.frameWidth, clip.root[1] / clip.frameHeight]); assert.deepEqual(o.scale, [clip.scaleToWorld, clip.scaleToWorld]); assert.equal(o.rotation, 0); assert.equal(o.mirror, index === 0 ? 1 : -1);
      assert.deepEqual(o.spritePosition, {x: o.position.x, y: o.position.y + 25}); assert.ok(o.position.y < o.floorY - 25);
      if (age > 0) assert.ok(o.position.y > row.trace[age - 1].position.y, 'ordinary gravity continues during cue');
    }
    assert.equal(row.trace[89].invincible, true); assert.equal(row.trace[90].invincible, false); assert.equal(row.trace[129].presentation, null); assert.equal(row.trace[129].grounded, false);
    row.after = []; for (let n = 0; n < 350; n++) {const o = await page.evaluate(() => window.__entryDynamicStep()); row.after.push(o); if (o.grounded) {await capture(row, 'ordinary-land'); break;}}
    assert.equal(row.after.at(-1).grounded, true); assert.equal(row.after.at(-1).isStatic, false); assert.equal(row.after.at(-1).stocks, row.fixture.entry.stocks);
    assert.equal(row.after.at(-1).texture, 'char.pikachu.idle'); assert.equal(row.after.at(-1).textureFrame, 0);
    assert.equal(row.after.at(-1).receiving.length, 12, 'first real grounded contact pairs reviewed idle0 drawing with source receiving');
    assert.deepEqual(row.after.at(-1).receiving, selectPikachuStateHurtboxes('idle', 0));
    console.log(JSON.stringify({index, result: 'PASS', cells: [...new Set(row.trace.slice(0, 129).map(o => o.textureFrame))], landingStepsAfterCue: row.after.length}));
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.failedResponses, []); report.result = 'PASS';
} catch (e) {report.result = 'FAIL'; report.failure = e.stack; throw e;}
finally {await writeFile(`${output}/observations.json`, JSON.stringify(report, null, 2) + '\n'); await browser.close();}
