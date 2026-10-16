import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { chromium } from 'playwright';

// Measure real move contact in the running MatchScene at its normal game size.
// This fixture overrides only input sampling and initial positions/percent.
const output = process.env.PF_PROBE_OUT ?? 'docs/review/2026-10-05/damage-knockback/browser-after';
const url = process.env.PF_REWORK_URL ?? 'http://127.0.0.1:4175/platform-fighter/';
const spinSourceDiagnostic = process.env.PF_SPIN_SOURCE_DIAGNOSTIC === '1';
const allowDev = process.env.PF_ALLOW_DEV === '1';
const selectedTargets = process.env.PF_TARGETS?.split(',') ?? ['donkeykong', 'link'];
const allGroundedMoves = ['jab', 'jab2', 'forward-tilt', 'up-tilt', 'down-tilt', 'dash-attack',
  'forward-smash', 'up-smash', 'down-smash', 'giant-punch-uncharged', 'giant-punch-full',
  'grounded-spinning-kong', 'side-special', 'down-special'];
const selectedMoves = process.env.PF_MOVES?.split(',') ?? (process.env.PF_ALL_GROUNDED === '1'
  ? allGroundedMoves : ['giant-punch-uncharged', 'giant-punch-full', 'forward-smash', 'grounded-spinning-kong']);
const selectedPercents = process.env.PF_PERCENTS?.split(',').map(Number) ?? [0, 75, 100, 150, 200];
const selectedFacings = process.env.PF_FACINGS?.split(',').map(Number) ?? [1];
const selectedSpinSpacings = process.env.PF_SPIN_SPACINGS?.split(',').map(Number) ?? [80];
const expectCorrectedScale = process.env.PF_EXPECT_CORRECTED_SCALE === '1';
const expectedFloorWidth = Number(process.env.PF_EXPECT_FLOOR_WIDTH ?? 800);
const expectSpinFinisher = process.env.PF_EXPECT_SPIN_FINISHER === '1';
const captureScreenshots = process.env.PF_SCREENSHOTS === '1';
const defenderBehavior = process.env.PF_DEFENDER_BEHAVIOR ?? 'neutral';
assert.ok(['neutral', 'inward-di', 'jump-recovery', 'attack-escape', 'dodge-escape'].includes(defenderBehavior));
const bootTimeout = Number(process.env.PF_BOOT_TIMEOUT_MS ?? (allowDev ? 180000 : 60000));
let savedDkSpec = null;
let savedDkOverride = null;
if (process.env.PF_DK_SPEC) {
  const raw = await readFile(process.env.PF_DK_SPEC, 'utf8');
  const parsed = JSON.parse(raw);
  savedDkSpec = parsed.spec ?? parsed;
  assert.equal(savedDkSpec.id, 'donkeykong', 'PF_DK_SPEC must contain a saved Donkey Kong spec');
  savedDkOverride = { path: process.env.PF_DK_SPEC, sha256: createHash('sha256').update(raw).digest('hex') };
}
await mkdir(output, { recursive: true });
const report = {
  url, bundleUrl: null, bundleName: null, bundleSha256: null, errors: [], consoleErrors: [], failedRequests: [],
  spinSourceDiagnostic, allowDev,
  notes: [
    'Real attack hitboxes, damage handler, Matter integration and blast-zone stock loss; deterministic opponent input sampling.',
    'No game.scale resizing or direct applyHit injection. Tests do not establish exact Ultimate KO percentages.',
    'Neutral-special fixtures detect the registered input policy: press/wind/fire uses a fresh second press; legacy hold/release keeps its original route. This is deterministic input sampling, not physical keyboard evidence.',
  ],
  expectCorrectedScale, expectSpinFinisher, captureScreenshots, savedDkOverride, defenderBehavior, scenarios: [], checks: [],
};
function check(scenario, label, actual, assertion) {
  try { assertion(); report.checks.push({ scenario, label, actual, passed: true }); }
  catch (error) { report.checks.push({ scenario, label, actual, passed: false, error: error.message }); }
}
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const scripts = new Map();
const responseReads = [];
page.on('pageerror', error => report.errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
page.on('requestfailed', request => report.failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
page.on('response', response => {
  if (response.request().resourceType() !== 'script') return;
  responseReads.push((async () => {
    try { scripts.set(response.url(), { status: response.status(), sha256: createHash('sha256').update(await response.body()).digest('hex') }); }
    catch (error) { scripts.set(response.url(), { error: error.message }); }
  })());
});

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: bootTimeout });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: bootTimeout });
  await Promise.all(responseReads);
  if (allowDev) report.loadedSourceModules = Object.fromEntries([...scripts.entries()]
    .filter(([value]) => value.includes('/src/')));
  const main = [...scripts.keys()].find(value => /\/assets\/index-[^/]+\.js(?:\?|$)/.test(value))
    ?? (allowDev ? [...scripts.keys()].find(value => /\/src\/main\.ts(?:\?|$)/.test(value)) : undefined);
  report.bundleUrl = main ?? null;
  report.bundleName = main ? basename(new URL(main).pathname) : null;
  report.bundleSha256 = main ? scripts.get(main)?.sha256 ?? null : null;
  assert.ok(main, allowDev ? 'Expected production or explicitly allowed development entry' : 'Expected production main bundle');
  assert.equal(scripts.get(main)?.status, 200);
  if (captureScreenshots) {
    await page.evaluate(() => {
      const game = window.__game;
      for (const scene of game.scene.getScenes(true)) game.scene.stop(scene.scene.key);
      game.scene.start('MatchScene', { matchConfig: {
        mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 1005, itemFrequency: 'off',
        players: [
          { index: 1, characterId: 'donkeykong', paletteIndex: 0, inputType: 'keyboard_p1' },
          { index: 2, characterId: 'link', paletteIndex: 1, inputType: 'keyboard_p2' },
        ],
      } });
      game.scene.getScene('MatchScene').physicsEngine.pause();
    });
    await page.screenshot({ path: join(output, 'battlefield-scale-match-start.png') });
  }

  for (const target of spinSourceDiagnostic ? ['donkeykong'] : selectedTargets) {
    for (const move of spinSourceDiagnostic ? ['grounded-spinning-kong'] : selectedMoves) {
      for (const percent of spinSourceDiagnostic ? [0, 150, 200] : selectedPercents) {
        for (const facing of selectedFacings) {
        for (const spinSpacing of move === 'grounded-spinning-kong' ? selectedSpinSpacings : [80]) {
        let result = await page.evaluate(({ target, move, percent, facing, spinSpacing, spinSourceDiagnostic, captureScreenshots, savedDkSpec, defenderBehavior }) => {
          const game = window.__game;
          for (const scene of game.scene.getScenes(true)) game.scene.stop(scene.scene.key);
          game.scene.start('MatchScene', { ...(savedDkSpec ? { characterOverrides: [{ slotIndex: 1, spec: savedDkSpec }] } : {}), matchConfig: {
            mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 1005,
            itemFrequency: 'off', players: [
              { index: 1, characterId: 'donkeykong', paletteIndex: 0, inputType: 'keyboard_p1' },
              { index: 2, characterId: target, paletteIndex: 1, inputType: 'keyboard_p2' },
            ],
          } });
          const s = game.scene.getScene('MatchScene');
          s.physicsEngine.pause();
          const floor = s.baseStage.bodies.platformBodies.find(body => body.label === 'platform.solid');
          if (!floor) throw new Error('Flat stage has no solid floor');
          const zone = s.baseStage.getViewportBlastZone();
          let input = {};
          let defenderInput = {};
          s.inputResolver.getMoveVector = player => {
            const sampled = player === 1 ? input : player === 2 ? defenderInput : {};
            return { x: sampled.moveX ?? 0, y: sampled.moveY ?? 0 };
          };
          s.inputResolver.isActionHeld = (player, action) => (player === 1 ? input : defenderInput)[action] === true;
          s.inputResolver.getSmash = player => ({ buttonHeld: player === 1 && input.attackHeavy === true,
            stickJustPressed: false, x: 0, y: 0 });
          const clone = value => value == null ? null : JSON.parse(JSON.stringify(value));
          if (spinSourceDiagnostic) {
            // Diagnostic only: replace the live registered move with the pinned
            // script correction before testing contact. Normal acceptance never
            // modifies shipped data and records this option explicitly.
            const corrected = clone(s.p1.getAttack('donkeykong.up_special'));
            delete corrected.groundedVariant.knockback.reference.setWeight;
            for (const window of corrected.groundedVariant.hitWindows) {
              if (!window.group.startsWith('rung')) continue;
              delete window.knockback.reference.setWeight;
              const inner = window.collisionHits.find(hit => hit.id === 1);
              inner.knockback = { x: 0, y: 0, scaling: 0,
                reference: { base: 0, growth: 100, angle: 20, fixed: 65 } };
            }
            s.p1.attacks.set(corrected.id, corrected);
          }
          const victim = s.p2;
          const contacts = [];
          const stockEvents = [];
          const apply = victim.applyHitDetailed.bind(victim);
          victim.applyHitDetailed = hit => {
            const before = { position: clone(victim.getPosition()), percent: victim.getDamagePercent() };
            const result = apply(hit);
            contacts.push({ frame: s.physicsEngine.getFrame(), attackerMoveFrame: s.p1.getActiveAttack()?.framesElapsed ?? null,
              before, hit: clone(hit), result: clone(result) });
            return result;
          };
          const loseStock = s.recordStockLossWithStats.bind(s);
          s.recordStockLossWithStats = (player, frame) => {
            const before = s.stockTracker.getStocks(player);
            const body = player === 1 ? victim.body : s.p1.body;
            const position = clone(body.position);
            const bounds = clone(body.bounds);
            const edgeDistances = {
              left: Math.abs(bounds.min.x - zone.x),
              right: Math.abs(bounds.max.x - (zone.x + zone.width)),
              top: Math.abs(bounds.min.y - zone.y),
              bottom: Math.abs(bounds.max.y - (zone.y + zone.height)),
            };
            const edge = Object.entries(edgeDistances).sort((a, b) => a[1] - b[1])[0][0];
            const result = loseStock(player, frame);
            if (s.stockTracker.getStocks(player) < before) stockEvents.push({ player, frame,
              position, bounds, edge, edgeDistances, phase: victim.isInHitstun() ? 'hitstun' : 'actionable',
              velocity: clone(victim.getVelocity()), launchVelocity: clone(victim.launchVelocity) });
            return result;
          };
          const initialStocks = s.stockTracker.getStocks(1);
          const compactReference = energy => energy == null ? null : ({
            vertical: energy.vertical, groupsLength: energy.groups?.length ?? null,
            groupIndex: energy.groupIndex ?? null, groupSize: energy.groups?.[energy.groupIndex] ?? null,
            interrupted: energy.interrupted ?? null, gravityY: energy.gravityY ?? null, firstStep: energy.firstStep ?? null,
          });
          const read = () => ({
            frame: s.physicsEngine.getFrame(),
            position: clone(victim.getPosition()), velocity: clone(victim.getVelocity()),
            percent: victim.getDamagePercent(), stocks: s.stockTracker.getStocks(1),
            grounded: victim.isGrounded(), hitlag: victim.hitlagRemaining, hitstun: victim.hitstunRemaining,
            launchVelocity: clone(victim.launchVelocity), referenceLaunch: compactReference(victim.referenceLaunch),
            pendingKnockback: victim.pendingKnockback == null ? null : ({
              ...clone({ ...victim.pendingKnockback, referenceLaunch: undefined }),
              referenceLaunch: compactReference(victim.pendingKnockback.referenceLaunch),
            }),
            attackerMove: s.p1.getActiveAttack()?.move.id ?? null,
            attackerMoveFrame: s.p1.getActiveAttack()?.framesElapsed ?? null,
            attackerCharge: s.p1.getActiveAttack()?.chargeHeldFrames ?? null,
            storedCharge: clone(s.p1.storedSpecialCharge),
            defenderInput: clone(defenderInput),
            defenderMove: victim.getActiveAttack()?.move.id ?? null,
            defenderMoveFrame: victim.getActiveAttack()?.framesElapsed ?? null,
            defenderJumpsUsed: victim.jumpsUsed ?? null,
            defenderDodgeState: clone(victim.dodgeState),
          });
          const reactionEvents = [];
          let actionFrame = null;
          let recoveryPressed = false;
          let firstActionable = null;
          const tick = (next = {}) => {
            input = next;
            defenderInput = contacts.length && defenderBehavior !== 'neutral' ? { moveX: -facing } : {};
            const frame = s.physicsEngine.getFrame();
            if (contacts.length && victim.hitlagRemaining === 0 && victim.hitstunRemaining === 0 &&
              victim.pendingKnockback === null && s.stockTracker.getStocks(1) === initialStocks) {
              firstActionable ??= read();
              if (!victim.isGrounded() && actionFrame === null && !['neutral', 'inward-di'].includes(defenderBehavior)) {
                actionFrame = frame;
                const action = defenderBehavior === 'jump-recovery' ? 'jump'
                  : defenderBehavior === 'attack-escape' ? 'attack' : 'dodge';
                defenderInput[action] = true;
                reactionEvents.push({ frame, action, before: read() });
              } else if (defenderBehavior === 'jump-recovery' && actionFrame !== null && !recoveryPressed &&
                frame >= actionFrame + 10 && !victim.isGrounded() && victim.getActiveAttack() === null) {
                recoveryPressed = true;
                defenderInput = { moveX: -facing * 0.8, moveY: -1, special: true };
                reactionEvents.push({ frame, action: 'up-special', before: read() });
              }
            }
            const before = s.physicsEngine.getFrame();
            s.physicsEngine.resume(); s.update(0, s.physicsEngine.fixedTimestepMs); s.physicsEngine.pause();
            if (s.physicsEngine.getFrame() !== before + 1) throw new Error('Not exactly one gameplay frame');
            const state = read();
            if (reactionEvents.at(-1)?.frame === before) reactionEvents.at(-1).after = state;
            return state;
          };
          // Let the normal match startup finish, then author only the fixture state.
          for (let frame = 0; frame < 120; frame++) tick();
          const moveSpacings = { jab: 80, jab2: 70,
            'up-tilt': (s.p1.getTuning().width + victim.getTuning().width) / 2 + 1, 'down-tilt': 80,
            'up-smash': 65, 'down-smash': 70, 'side-special': 110, 'down-special': 65, 'dash-attack': 300 };
          const spacingHalf = move === 'grounded-spinning-kong' ? spinSpacing / 2
            : (moveSpacings[move] ?? 140) / 2;
          s.p1.resetForRound(floor.position.x - facing * spacingHalf, floor.bounds.min.y - s.p1.getTuning().height / 2);
          s.p1.setFacing(facing); s.p1.setDamagePercent(0);
          victim.resetForRound(floor.position.x + facing * spacingHalf, floor.bounds.min.y - victim.getTuning().height / 2);
          victim.setFacing(-facing); victim.setDamagePercent(percent);
          for (let frame = 0; frame < 12; frame++) tick();
          if (!s.p1.isGrounded() || !victim.isGrounded()) throw new Error('Fixture not grounded');
          let start = read();
          const prep = [];
          const punchInputBehavior = s.p1.getAttack('donkeykong.neutral_special')?.charge?.inputBehavior ?? 'hold-release';
          if (move === 'giant-punch-full') {
            const windingSteps = punchInputBehavior === 'press-wind-fire' ? 125 : 120;
            for (let frame = 0; frame < windingSteps; frame++) prep.push(tick({ special: true }));
            prep.push(tick()); prep.push(tick({ special: true }));
          } else if (move === 'giant-punch-uncharged') {
            prep.push(tick({ special: true }));
            if (punchInputBehavior === 'press-wind-fire') {
              // Seven independently sourced entry steps, then a fresh press
              // before the first loop charge increment. No direct fire helper.
              for (let frame = 0; frame < 7; frame++) prep.push(tick());
              prep.push(tick({ special: true }));
            }
            prep.push(tick());
          } else if (move === 'forward-smash') {
            prep.push(tick({ attackHeavy: true })); prep.push(tick());
          } else if (move === 'up-smash' || move === 'down-smash') {
            prep.push(tick({ moveY: move === 'up-smash' ? -1 : 1, attackHeavy: true })); prep.push(tick());
          } else if (move === 'grounded-spinning-kong') {
            prep.push(tick({ moveY: -1, special: true })); prep.push(tick());
          } else if (move === 'side-special') {
            prep.push(tick({ moveX: facing, special: true })); prep.push(tick());
          } else if (move === 'down-special') {
            prep.push(tick({ moveY: 1, special: true })); prep.push(tick());
          } else if (move === 'jab') {
            prep.push(tick({ attack: true })); prep.push(tick());
          } else if (move === 'jab2') {
            // Isolate the second jab: the first swing deliberately misses;
            // reposition the fixture before the normal re-press chains to jab 2.
            victim.resetForRound(floor.position.x + facing * 340, start.position.y);
            victim.setDamagePercent(percent);
            prep.push(tick({ attack: true }));
            for (let frame = 0; frame < 7; frame++) prep.push(tick());
            victim.resetForRound(s.p1.getPosition().x + facing * 70, start.position.y);
            victim.setDamagePercent(percent);
            start = read();
            prep.push(tick({ attack: true })); prep.push(tick());
          } else if (move === 'forward-tilt') {
            prep.push(tick({ moveX: facing * 0.5 }));
            prep.push(tick({ moveX: facing * 0.5, attack: true })); prep.push(tick());
          } else if (move === 'up-tilt' || move === 'down-tilt') {
            prep.push(tick({ moveY: move === 'up-tilt' ? -0.5 : 0.5, attack: true })); prep.push(tick());
          } else if (move === 'dash-attack') {
            for (let frame = 0; frame < 20; frame++) prep.push(tick({ moveX: facing }));
            // Set the opponent at the end of the run-up, then settle its floor
            // contact while retaining genuine running input/momentum.
            victim.resetForRound(s.p1.getPosition().x + facing * 105, start.position.y);
            victim.setDamagePercent(percent);
            prep.push(tick({ moveX: facing })); prep.push(tick({ moveX: facing }));
            start = read();
            prep.push(tick({ moveX: facing, attack: true })); prep.push(tick());
          } else {
            throw new Error(`Unknown grounded move probe: ${move}`);
          }
          const timeline = [...prep.slice(-2)];
          let hitFrame = null;
          let firstLaunch = null;
          let stockLoss = null;
          let maxDx = 0; let maxRise = 0; let maxSpeed = 0;
          let processedFrames = 0;
          let captureState = null;
          const requestedIds = {
            jab: 'donkeykong.jab', jab2: 'donkeykong.jab2', 'forward-tilt': 'donkeykong.tilt',
            'up-tilt': 'donkeykong.utilt', 'down-tilt': 'donkeykong.dtilt', 'dash-attack': 'donkeykong.dashAttack',
            'forward-smash': 'donkeykong.smash', 'up-smash': 'donkeykong.usmash', 'down-smash': 'donkeykong.dsmash',
            'giant-punch-uncharged': 'donkeykong.neutral_special', 'giant-punch-full': 'donkeykong.neutral_special',
            'grounded-spinning-kong': 'donkeykong.up_special', 'side-special': 'donkeykong.side_special',
            'down-special': 'donkeykong.down_special',
          };
          const result = () => ({
            target, move, percent, facing, spinSpacing: move === 'grounded-spinning-kong' ? spinSpacing : null,
            fixtureSpacing: spacingHalf * 2,
            engineVersion: s.getMatchStartMetadata?.()?.engineVersion ?? null,
            gameSize: { width: game.scale.gameSize.width, height: game.scale.gameSize.height },
            floor: clone(floor.bounds), blastZone: clone(zone), victimTuning: clone(victim.getTuning()),
            stageIdentity: { id: s.activeStage?.id ?? null, name: s.activeStage?.name ?? null },
            attackerTuning: clone(s.p1.getTuning()), requestedMoveId: requestedIds[move],
            selectedMoveIds: [...new Set([...prep, ...timeline].map(state => state.attackerMove).filter(Boolean))],
            attackerMoveSpec: clone(s.p1.getAttack(requestedIds[move])),
            fixtureNotes: move === 'jab2' ? ['First jab intentionally misses; victim placed for an isolated second-jab contact.']
              : move === 'dash-attack' ? ['Genuine 22-frame running input, then victim placed for dash contact.'] : [],
            start, contacts, punchInputBehavior, fullChargeBeforePress: prep.find(state => state.storedCharge !== null)?.storedCharge ?? null,
            hitFrame, firstLaunch, firstActionable, defenderBehavior, reactionEvents, maxDx, maxRise, maxSpeed,
            ko: stockLoss !== null, stockLoss, stockEvents, timeline, captureState,
          });
          const finish = (pauseForOffstage = false) => {
            while (processedFrames++ < 400) {
              const state = tick(); timeline.push(state);
              if (contacts.length && hitFrame === null) hitFrame = contacts[0].frame;
              if (hitFrame !== null && state.stocks === initialStocks) {
                maxDx = Math.max(maxDx, facing * (state.position.x - start.position.x));
                maxRise = Math.max(maxRise, start.position.y - state.position.y);
                maxSpeed = Math.max(maxSpeed, Math.hypot(state.velocity.x, state.velocity.y));
                if (firstLaunch === null && state.launchVelocity !== null) firstLaunch = state;
              }
              if (state.stocks < initialStocks) { stockLoss = state; break; }
              if (pauseForOffstage && hitFrame !== null && state.hitlag === 0 &&
                (percent === 150 ? state.hitstun > 0 : state.hitstun === 0) &&
                (facing === 1 ? state.position.x > floor.bounds.max.x : state.position.x < floor.bounds.min.x)) {
                captureState = state;
                return { ...result(), captureAwaiting: true };
              }
            }
            return result();
          };
          window.__finishKnockbackProbe = () => finish();
          return finish(captureScreenshots && facing === 1 &&
            ((move === 'giant-punch-uncharged' && percent === 100) ||
              (['giant-punch-full', 'forward-smash'].includes(move) && percent === 150)));
        }, { target, move, percent, facing, spinSpacing, spinSourceDiagnostic, captureScreenshots, savedDkSpec, defenderBehavior });
        if (result.captureAwaiting) {
          const name = `${target}-${move}-${percent}-${percent === 150 ? 'launch' : 'offstage'}.png`;
          await page.screenshot({ path: join(output, name) });
          result = await page.evaluate(() => window.__finishKnockbackProbe());
          result.screenshots = [{ name, kind: percent === 150 ? 'airborne launch during hitstun before stock loss'
            : 'offstage with control restored before idle fall or recovery' }];
        }
        if (captureScreenshots && facing === 1 && percent === 150 && result.ko &&
          ['giant-punch-full', 'forward-smash'].includes(move)) {
          const name = `${target}-${move}-150-ko.png`;
          await page.screenshot({ path: join(output, name) });
          (result.screenshots ??= []).push({ name, kind: 'stock loss after a real move contact' });
        }
        report.scenarios.push(result);
        const scenario = `${target}/${move}/${percent}/facing${facing}/spacing${result.fixtureSpacing}`;
        check(scenario, 'real move contact lands', result.contacts.length, () => assert.ok(result.contacts.length));
        check(scenario, 'ordinary input dispatch selects the requested move', result.selectedMoveIds,
          () => assert.ok(result.selectedMoveIds.includes(result.requestedMoveId)));
        if (expectCorrectedScale) {
          const width = result.floor.max.x - result.floor.min.x;
          check(scenario, `main floor is ${expectedFloorWidth} pixels wide`, width,
            () => assert.ok(Math.abs(width - expectedFloorWidth) < 1));
          check(scenario, 'side blast margins retain 800 pixels per ledge', result.blastZone.width,
            () => assert.ok(Math.abs(result.blastZone.width - (expectedFloorWidth + 1600)) < 1));
          if (percent === 0 && ['giant-punch-full', 'forward-smash'].includes(move)) {
            const direct = result.stockEvents.some(event => event.player === 1 && event.phase === 'hitstun');
            check(scenario, 'zero percent does not produce a blast-zone KO during hitstun', direct,
              () => assert.equal(direct, false));
          }
          if (percent >= 150 && ['giant-punch-full', 'forward-smash'].includes(move)) {
            const direct = result.stockEvents.some(event => event.player === 1 && event.phase === 'hitstun');
            check(scenario, 'high percent produces a blast-zone KO during hitstun', direct,
              () => assert.equal(direct, true));
          }
          if ((percent === 150 || percent === 100 && expectedFloorWidth <= 800) && move === 'giant-punch-uncharged') {
            const edgeDistance = facing === 1 ? result.floor.max.x - result.start.position.x
              : result.start.position.x - result.floor.min.x;
            check(scenario, 'moderate punch forces the victim beyond the main floor',
              { maxDx: result.maxDx, edgeDistance }, () => assert.ok(result.maxDx > edgeDistance));
          }
        }
        if (expectSpinFinisher && percent >= 150 && move === 'grounded-spinning-kong') {
          const finisher = result.contacts.some(contact => contact.attackerMoveFrame === 61 && contact.hit.damage >= 4);
          check(scenario, 'grounded spin finisher connects at action frame 61', finisher,
            () => assert.equal(finisher, true));
          if (percent === 200) {
            const lower = report.scenarios.find(value => value.target === target && value.move === move &&
              value.percent === 150 && value.facing === facing && value.spinSpacing === spinSpacing);
            const lowerHit = lower?.contacts.find(contact => contact.attackerMoveFrame === 61 && contact.hit.damage >= 4);
            const highHit = result.contacts.find(contact => contact.attackerMoveFrame === 61 && contact.hit.damage >= 4);
            if (lower) check(scenario, 'finisher launch grows between 150 and 200 percent',
              { at150: lowerHit?.result.knockback.magnitude ?? null, at200: highHit?.result.knockback.magnitude ?? null },
              () => assert.ok(highHit?.result.knockback.magnitude > lowerHit?.result.knockback.magnitude));
          }
        }
        console.log(JSON.stringify({ target, move, percent, facing, defenderBehavior, damage: result.contacts[0]?.hit.damage,
          vector: result.contacts[0]?.result.knockback?.vector, firstVelocity: result.firstLaunch?.velocity,
          maxDx: result.maxDx, maxRise: result.maxRise, ko: result.ko }));
        }
        }
      }
    }
  }
  report.summary = {
    scenarios: report.scenarios.length,
    contacts: report.scenarios.filter(value => value.contacts.length > 0).length,
    highPercentFullPunchKOs: report.scenarios.filter(value => value.percent >= 150 && value.move === 'giant-punch-full' && value.ko).length,
    errors: report.errors.length,
    assertions: { passed: report.checks.filter(check => check.passed).length,
      failed: report.checks.filter(check => !check.passed).length, total: report.checks.length },
  };
  if (report.summary.assertions.failed > 0 || report.errors.length > 0) process.exitCode = 1;
} catch (error) {
  report.fatalError = error.stack ?? error.message;
  process.exitCode = 1;
} finally {
  report.scriptResponses = Object.fromEntries(scripts);
  await writeFile(join(output, 'dk-knockback-acceptance.json'), `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
}
