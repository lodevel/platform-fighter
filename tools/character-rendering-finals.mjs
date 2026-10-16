/** Bounded production-build comparison, not a complete fighter audit.
 * Resource grants, positions and the item spawn schedule are explicit fixtures.
 * Final activation uses saved DOM keyboard bindings; other actions use the
 * public deterministic step API. Never modifies collision or drawing results. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { openMatchHost, launchMatch } from './browser-match-host.mjs';
import { launchWindowsEdgeCdp } from './windows-edge-cdp.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i < 0 ? fallback : process.argv[i + 1]; };
const url = arg('url', 'http://127.0.0.1:4173/platform-fighter/');
const out = arg('out', '.tmp/character-rendering-finals');
await mkdir(out, { recursive: true });
const report = { url, input: 'Final activation: real saved DOM special binding. Other inputs: host.step fixtures. Positions, Final resource and one item spawn schedule are injected setup.',
  scope: 'One ground/right hit per Final; one Link ray-gun pickup/moving shooting; one Link grab/pummel/forward throw. Excludes opposite facings, air/miss variants, all items and a full fighter audit.',
  errors: [], rows: [] };
report.harnessSha256 = createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex');
const edge = process.argv.includes('--edge') ? await launchWindowsEdgeCdp({ windowsPort: 9235, bridgePort: 9236 }) : null;
const browser = edge ? await chromium.connectOverCDP(edge.endpoint)
  : await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const page = await context.newPage();
page.on('pageerror', error => report.errors.push(error.message));
const save = () => writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');

function config(characterId, victim, items = false) {
  const itemSwitch = Object.fromEntries(['homeRunBat', 'beamSword', 'hammer', 'rayGun', 'bobOmb', 'crate', 'starRod', 'superScope', 'fireFlower',
    'bananaPeel', 'goldenHammer', 'food', 'heartContainer', 'maximTomato', 'barrel', 'capsule', 'smashBall'].map(id => [id, id === 'rayGun']));
  return { mode: 'stocks', stockCount: 9, stageId: 'flat', rngSeed: 161026, itemFrequency: items ? 'low' : 'off',
    ...(items ? { itemSwitch } : {}), linkIntroPolicy: 'none',
    finalSmashRules: { schemaVersion: 1, meterEnabled: false, smashBallEnabled: true },
    players: [{ index: 1, characterId, paletteIndex: 0, inputType: 'keyboard_p1' },
      { index: 2, characterId: victim, paletteIndex: 1, inputType: 'keyboard_p2' }] };
}

async function setup(characterId, victim, distance, items = false) {
  await launchMatch(page, config(characterId, victim, items));
  return page.evaluate(({ distance }) => {
    const host = window.__sim, sim = host.match;
    const neutral = { moveX: 0, moveY: 0, jump: false, attack: false, attackHeavy: false, special: false, shield: false, dodge: false, grab: false, dropThrough: false };
    for (let n = 0; n < 240; n++) host.step([neutral, neutral]);
    const floor = sim.baseStage.bodies.platformBodies.find(body => body.label === 'platform.solid');
    const x = floor.position.x, top = floor.bounds.min.y;
    for (const [index, fighter] of [sim.p1, sim.p2].entries()) {
      fighter.resetForRound(x + index * distance, top - fighter.getTuning().height / 2);
      fighter.setFacing(index ? -1 : 1);
    }
    for (let n = 0; n < 10; n++) host.step([neutral, neutral]);
    let lastView = null, arranged = false;
    const read = view => {
      const run = sim.finalSmashController.getActive();
      return { frame: sim.physicsEngine.getFrame(), hash: sim.getSimDigest().hash,
        phase: run?.phase ?? null, age: run?.phaseAge ?? null, captures: run?.captures ?? [],
        arrows: sim.linkArticles.ancientArrows().map(arrow => ({ ...arrow.state })),
        fighters: [sim.p1, sim.p2].map(fighter => ({ position: fighter.getPosition(), root: fighter.getSourceRootPosition(),
          velocity: fighter.getVelocity(), facing: fighter.getFacing(), damage: fighter.getDamagePercent(),
          grounded: fighter.isGrounded(), hitlag: fighter.getHitlagRemaining(), hurtboxes: fighter.getActiveHurtboxes(),
          socket: fighter.getHeldItemSocket(), grabbed: fighter.isGrabbed(), grab: fighter.getGrabState(),
          final: fighter.getFinalSmashControl(), victimSelection: fighter.getFinalVictimPresentationSelection(),
          receiving: fighter.getFinalVictimBodyPose()?.receiving ?? null, held: fighter.getEquippedItem()?.definition.type ?? null })),
        events: view.events, items: view.items, projectiles: view.projectiles };
    };
    window.__renderingInteractions = {
      step(input, finalPlacement = false) {
        const active = sim.finalSmashController.getActive();
        if (finalPlacement && !arranged && ((sim.p1.id === 'donkeykong' && active?.phase === 'start' && active.phaseAge === 27)
          || (sim.p1.id === 'link' && active && active.phaseAge >= 59))) {
          const position = sim.p1.id === 'donkeykong' ? sim.p1.getSourceRootPosition() : sim.p1.getPosition();
          sim.matter.body.setPosition(sim.p2.body, { x: position.x + (sim.p1.id === 'link' ? 500 : 100),
            y: position.y - (sim.p1.id === 'link' ? 12 : sim.p2.getTuning().height / 2) });
          sim.matter.body.setVelocity(sim.p2.body, { x: 0, y: 0 }); arranged = true;
        }
        // The step result is the one drained SimView used for this tick's evidence.
        lastView = input === null ? host.step() : host.step([{ ...neutral, ...input }, neutral]);
        return read(lastView);
      },
      capture() {
        const hash = sim.getSimDigest().hash;
        // The existing production draw probe redraws this same tick. No extra
        // explicit sim.view() calls or simulation advances occur at captures.
        host.draw();
        const appearance = index => {
          const p = host.presentation(index);
          if (!p) return null;
          const { key, frame, x, y, originX, originY, scaleX, scaleY, flipX, rotation, alpha, layers, art,
            submitted, visible, submittedAlpha, frameWidth, frameHeight } = p;
          return { key, frame, x, y, originX, originY, scaleX, scaleY, flipX, rotation, alpha, layers, art,
            submitted, visible, submittedAlpha, frameWidth, frameHeight };
        };
        return { hash, hashAfterDraw: sim.getSimDigest().hash, appearances: [appearance(0), appearance(1)],
          fx: host.presentationSprites?.() ?? [], frame: lastView?.frame ?? null };
      },
    };
    return { buildIdentity: sim.buildIdentity, grounded: sim.p1.isGrounded(), positions: [sim.p1.getPosition(), sim.p2.getPosition()] };
  }, { distance });
}

async function capture(row, name) {
  const receipt = await page.evaluate(() => window.__renderingInteractions.capture());
  assert.equal(receipt.hash, receipt.hashAfterDraw, `${row.key}/${name} redraw does not change authority`);
  assert.ok(receipt.appearances.every(p => p?.submitted && p?.visible), `${row.key}/${name} both fighter appearances submitted`);
  const path = `${out}/${row.key}-${name}.png`;
  await page.screenshot({ path });
  row.samples.push({ name, ...receipt }); row.screenshots.push(path);
}

try {
  report.browser = browser.version();
  report.script = await openMatchHost(page, url);
  report.graphics = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
    if (!gl) return null;
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return { vendor: gl.getParameter(gl.VENDOR), renderer: gl.getParameter(gl.RENDERER),
      unmaskedVendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null,
      unmaskedRenderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
      parallelShaderCompile: Boolean(gl.getExtension('KHR_parallel_shader_compile')) };
  });
  for (const [characterId, victim] of [['donkeykong', 'link'], ['pikachu', 'donkeykong'], ['link', 'pikachu']]) {
    const row = { key: `final-${characterId}`, setup: await setup(characterId, victim, characterId === 'pikachu' ? 120 : 100), trace: [], samples: [], screenshots: [] };
    report.rows.push(row);
    const binding = await page.evaluate(() => {
      const sim = window.__sim.match, frame = sim.physicsEngine.getFrame();
      for (const slot of sim.playerSlots) sim.consumeFinalEvents(sim.finalSmashController.resetParticipant(slot.playerIndex,
        slot.character.getPositionResetGeneration(), 'owner-reset', 0), frame);
      sim.consumeFinalEvents(sim.finalSmashController.grantBall(0, frame), frame);
      return window.__sim.inputResolver.dispatcher.bindings.get(sim.playerSlots[0].bindingsSlot).bindings.special.find(b => b.kind === 'keyboard');
    });
    const code = binding?.keyCode ?? binding?.code;
    assert.ok(Number.isInteger(code), 'saved keyboard special binding');
    const key = code === 32 ? 'Space' : String.fromCharCode(code);
    await page.keyboard.down(key);
    row.trace.push(await page.evaluate(() => window.__renderingInteractions.step(null, true)));
    await page.keyboard.up(key);
    const sampled = new Set(); let started = row.trace[0].phase !== null;
    for (let n = 0; n < (characterId === 'pikachu' ? 650 : 350); n++) {
      const state = await page.evaluate(() => window.__renderingInteractions.step({}, true));
      row.trace.push(state); started ||= state.phase !== null;
      const cues = [state.phase && `phase-${state.phase}`, ...state.arrows.map(arrow => `arrow-${arrow.phase}`)];
      if (state.captures.length) cues.push('captured');
      if (characterId === 'donkeykong' && state.phase === 'success' && state.age >= 5) cues.push('barrage');
      if (characterId === 'pikachu' && state.phase === 'finish' && state.age >= 10) cues.push('finish-burst');
      for (const cue of cues.filter(Boolean)) if (!sampled.has(cue)) { sampled.add(cue); await capture(row, cue); }
      if (started && !state.phase && !state.arrows.length) break;
    }
    await capture(row, 'released');
    row.phases = [...new Set(row.trace.map(state => state.phase).filter(Boolean))];
    row.maxDamage = Math.max(...row.trace.map(state => state.fighters[1].damage));
    row.maxCaptures = Math.max(...row.trace.map(state => state.captures.length));
    row.finished = started && row.trace.at(-1).phase === null;
    assert.ok(row.finished && row.trace.at(-1).fighters.every(fighter => fighter.final === null), row.key + ' completes and releases controls');
    assert.ok(row.maxDamage > 0, row.key + ' hit produces damage');
    if (characterId !== 'link') assert.ok(row.maxCaptures > 0, row.key + ' captures victim');
    else assert.ok(row.trace.some(state => state.arrows.some(arrow => arrow.phase === 'fighter-blast')), 'Link arrow reaches actual fighter blast');
    console.log(JSON.stringify({ key: row.key, phases: row.phases, damage: row.maxDamage, samples: row.samples.length }));
    await save();
  }

  const item = { key: 'link-raygun', setup: await setup('link', 'donkeykong', 250, true), trace: [], samples: [], screenshots: [] };
  report.rows.push(item);
  await page.evaluate(() => {
    const sim = window.__sim.match, fighter = sim.p1, transform = sim.baseStage.transform;
    const floor = sim.baseStage.bodies.platformBodies.find(body => body.label === 'platform.solid');
    const position = fighter.getPosition(), scale = transform.viewportScale;
    let once = true;
    sim.itemSpawnManager.step = frame => once ? (once = false, [{ frame, anchorIndex: 0,
      anchor: { x: (position.x + 20 - transform.offsetX) / scale, y: (floor.bounds.min.y - transform.offsetY) / scale },
      spawnPosition: { x: (position.x + 20 - transform.offsetX) / scale, y: (floor.bounds.min.y - 30 - transform.offsetY) / scale } }]) : [];
  });
  for (let n = 0; n < 40; n++) item.trace.push(await page.evaluate(() => window.__renderingInteractions.step({})));
  item.trace.push(await page.evaluate(() => window.__renderingInteractions.step({ attack: true })));
  for (let n = 0; n < 35; n++) item.trace.push(await page.evaluate(() => window.__renderingInteractions.step({})));
  assert.equal(item.trace.at(-1).fighters[0].held, 'rayGun', 'real pickup commits ray gun');
  await capture(item, 'held');
  for (let n = 0; n < 50; n++) {
    item.trace.push(await page.evaluate(n => window.__renderingInteractions.step({ moveX: n < 20 ? .5 : 0, attack: n === 0 }), n));
    if ([3, 8, 16, 30].includes(n)) await capture(item, `shoot-${n}`);
  }
  assert.ok(item.samples.some(sample => sample.appearances[0]?.layers?.length === 2), 'actual upper/lower shooting composition');
  assert.ok(item.trace.some(state => state.projectiles.length), 'held gun emits a real projectile');
  console.log(JSON.stringify({ key: item.key, samples: item.samples.length })); await save();

  const grab = { key: 'link-grab', setup: await setup('link', 'donkeykong', 55), trace: [], samples: [], screenshots: [] };
  report.rows.push(grab);
  for (let n = 0; n < 100; n++) {
    const input = n === 0 ? { grab: true } : n === 26 ? { attack: true } : n === 48 ? { moveX: 1 } : {};
    const state = await page.evaluate(input => window.__renderingInteractions.step(input), input);
    grab.trace.push(state);
    if ([12, 25, 30, 54, 75].includes(n)) await capture(grab, `tick-${n}`);
  }
  assert.ok(grab.trace.some(state => state.fighters[1].grabbed), 'ordinary grab actually captures');
  assert.ok(grab.trace.some(state => state.fighters[1].damage > 0), 'pummel/throw deals damage');
  assert.equal(grab.trace.at(-1).fighters[1].grabbed, false, 'throw releases ordinary victim');
  console.log(JSON.stringify({ key: grab.key, samples: grab.samples.length }));

  const compare = arg('compare', null);
  if (compare) {
    const baseline = JSON.parse(await readFile(compare, 'utf8'));
    assert.deepEqual(report.rows.map(row => row.key), baseline.rows.map(row => row.key));
    for (const row of report.rows) {
      const before = baseline.rows.find(candidate => candidate.key === row.key);
      // JSON evidence omits undefined optional fields; normalize the live
      // Playwright objects to the same representation before comparison.
      assert.deepEqual(JSON.parse(JSON.stringify(row.trace)), before.trace, row.key + ' identical authority, collision, socket and event trace');
      assert.deepEqual(JSON.parse(JSON.stringify(row.samples)), before.samples, row.key + ' identical submitted appearances');
    }
    report.comparison = { baseline: compare, matchedTicks: report.rows.reduce((count, row) => count + row.trace.length, 0),
      matchedAppearanceSamples: report.rows.reduce((count, row) => count + row.samples.length, 0) };
  }
  assert.deepEqual(report.errors, [], 'no browser page errors');
  report.result = 'PASS';
} catch (error) { report.result = 'FAIL'; report.failure = error.stack; throw error; }
finally { await save(); await context.close(); await browser.close(); await edge?.close(); }
