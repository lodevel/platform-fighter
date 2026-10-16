import { chromium } from 'playwright';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const out = process.env.PF_PROBE_OUT ?? 'docs/review/2026-09-25/donkeykong-character/completion-2026-10-08/runtime/giant-punch-keyboard';
const url = process.env.PF_REWORK_URL ?? 'http://localhost:4196/platform-fighter/';
await mkdir(out, { recursive: true });
const report = { url, errors: [], cases: [], scope: 'Actual browser keyboard events reach normal MatchScene input routing and real fixed Matter physics. Public round reset/position fixtures establish ground or air. No input resolver overrides. This is automated keyboard coverage; human controller feel remains untested.' };
report.sources = {};
for (const [kind, motion] of [['ground', 'SpecialN'], ['air', 'SpecialAirN'], ['full', 'SpecialNMax']]) {
  const path = `docs/review/2026-10-06/dk-all-attack-values/sources/${motion}.txt`;
  const bytes = await readFile(path);
  const native = /macros::ATTACK\(agent, 0, 0, Hash40::new\("arml"\), [\d.]+, ([\d.]+), ([\d.]+), ([\d.]+), ([\d.]+)/.exec(bytes.toString());
  if (!native) throw new Error(`Missing primary first-region launch: ${path}`);
  report.sources[kind] = { path, sha256: createHash('sha256').update(bytes).digest('hex'),
    angle: Number(native[1]), growth: Number(native[2]), fixed: Number(native[3]), base: Number(native[4]) };
}
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', error => report.errors.push(error.message));
try {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'));
  report.bundle = await page.evaluate(() => [...document.scripts].find(script => /assets\/index-/.test(script.src))?.src);
  report.bundleSha256 = createHash('sha256').update(await (await page.request.get(report.bundle)).body()).digest('hex');
  await page.evaluate(() => {
    const game = window.__game;
    for (const scene of game.scene.getScenes(true)) game.scene.stop(scene.scene.key);
    game.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 810081, itemFrequency: 'off', players: [
      { index: 1, characterId: 'donkeykong', paletteIndex: 0, inputType: 'keyboard_p1' },
      { index: 2, characterId: 'donkeykong', paletteIndex: 0, inputType: 'keyboard_p2' },
    ] } });
    const scene = game.scene.getScene('MatchScene');
    scene.physicsEngine.pause(); scene.roundStartCountdown = 0; scene.cpuControllers.clear();
    const floor = scene.baseStage.bodies.platformBodies.find(body => body.label === 'platform.solid');
    const contacts = [];
    const original = scene.p2.applyHitDetailed.bind(scene.p2);
    scene.p2.applyHitDetailed = hit => {
      const result = original(hit); contacts.push({ frame: scene.physicsEngine.getFrame(), hit: structuredClone(hit), result: structuredClone(result) }); return result;
    };
    const read = () => ({ frame: scene.physicsEngine.getFrame(), active: scene.p1.getActiveAttack()?.move.id ?? null,
      attackAge: scene.p1.getActiveAttack()?.framesElapsed ?? null,
      attackVariant: scene.p1.getActiveAttack()?.move.sheetVariant ?? null,
      bank: scene.p1.storedSpecialCharge?.framesHeld ?? 0,
      charging: structuredClone(scene.p1.chargingSpecial), bodyState: structuredClone(scene.p1.getPackedBodyState()),
      grounded: scene.p1.isGrounded(), velocity: { ...scene.p1.getVelocity() }, jumps: scene.p1.getJumpsRemaining(),
      held: scene.inputResolver.isActionHeld(1, 'special'), shield: structuredClone(scene.p1.getShieldState()) });
    window.__dkPunchKeyboard = { scene, contacts, read,
      step(count) {
        const rows = [];
        for (let age = 0; age < count; age++) { scene.physicsEngine.resume(); scene.update(0, scene.physicsEngine.fixedTimestepMs); scene.physicsEngine.pause(); rows.push(read()); }
        return rows;
      },
      reset(air = false) {
        contacts.length = 0;
        const y = floor.bounds.min.y;
        for (const [index, actor] of [scene.p1, scene.p2].entries()) {
          const top = Math.min(...scene.baseStage.bodies.platformBodies.map(body => body.bounds.min.y));
          actor.resetForRound(floor.position.x + (index ? 70 : -70), (air ? top - 240 : y) - actor.getTuning().height / 2);
          actor.setInvincibility(0); actor.setDamagePercent(0); actor.setFacing(index ? -1 : 1);
        }
        this.step(air ? 2 : 12);
      },
    };
  });
  await page.focus('canvas');
  const step = count => page.evaluate(count => window.__dkPunchKeyboard.step(count), count);
  const reset = async air => { for (const key of ['g', 'h', 'w', 'a', 'd']) await page.keyboard.up(key); await page.evaluate(air => window.__dkPunchKeyboard.reset(air), air); };
  const tap = async key => { await page.keyboard.down(key); const row = await step(1); await page.keyboard.up(key); return row; };
  const finish = async (name, data, checks) => {
    report.cases.push({ name, ...data, checks }); await page.screenshot({ path: `${out}/${name}.png` });
  };

  await reset(false);
  const entry = await tap('g'), released = await step(22);
  await finish('press-release-keeps-winding', { entry, released }, [
    { label: 'G release retains automatic windup', pass: released.at(-1).charging !== null && !released.at(-1).held },
    { label: 'Released neutral special continues accumulating charge', pass: released.at(-1).charging?.framesHeld > 8 },
    { label: 'Release does not fire', pass: released.every(row => row.active === null) },
  ]);

  await reset(false); await page.keyboard.down('g'); const held = await step(145); await page.keyboard.up('g'); await step(1);
  await finish('held-first-press-banks-full', { held }, [
    { label: 'Full UFD111 windup is banked', pass: held.at(-1).bank === 111 && held.at(-1).charging === null },
    { label: 'Held first press never auto fires or restarts', pass: held.every(row => row.active === null) && held.slice(-8).every(row => row.charging === null) },
  ]);
  const fullPress = await tap('g'), fullTrace = await step(65);
  const fullContacts = await page.evaluate(() => window.__dkPunchKeyboard.contacts);
  await finish('fresh-press-fires-full-bank', { fullPress, fullTrace, fullContacts }, [
    { label: 'Fresh G fires full bank directly', pass: fullPress.some(row => row.active === 'donkeykong.neutral_special' && row.charging === null && row.bank === 0) },
    { label: 'Full punch contacts with primary source launch through actual attack sensors', pass: fullContacts.some(contact => contact.hit.knockback.reference?.base === report.sources.full.base && contact.hit.knockback.reference?.growth === report.sources.full.growth) },
  ]);

  for (const air of [false, true]) {
    await reset(air); await tap('g'); const winding = await step(14); const fire = await tap('g'); const trace = await step(58);
    const contacts = await page.evaluate(() => window.__dkPunchKeyboard.contacts);
    await finish(`second-press-partial-${air ? 'air' : 'ground'}`, { winding, fire, trace, contacts }, [
      { label: 'Fixture enters the requested grounded or airborne context', pass: fire.at(-1).grounded === !air },
      { label: 'Partial second press fires rather than restarts charge', pass: fire.some(row => row.active === 'donkeykong.neutral_special' && row.charging === null) },
      { label: 'Charge consumed at partial fire', pass: fire.at(-1).bank === 0 },
      { label: 'Partial fire uses primary ground/air launch in actual contact', pass: contacts.some(contact => contact.hit.knockback.reference?.base === report.sources[air ? 'air' : 'ground'].base && contact.hit.knockback.reference?.growth === report.sources[air ? 'air' : 'ground'].growth) },
    ]);
  }

  await reset(false); await tap('g'); const beforeCancel = await step(21);
  await page.keyboard.down('h'); const cancel = await step(8); await page.keyboard.up('h'); await step(12);
  const bank = await page.evaluate(() => window.__dkPunchKeyboard.read()); await tap('g'); const resumed = await step(18);
  await finish('shield-bank-and-resume-partial', { beforeCancel, cancel, bank, resumed }, [
    { label: 'Shield cancel stores positive partial charge', pass: bank.bank > 0 && bank.bank < 111 && bank.charging === null },
    { label: 'Next G resumes partial windup', pass: resumed.at(-1).charging?.framesHeld > bank.bank },
    { label: 'Partial-bank resume does not immediately fire', pass: resumed.every(row => row.active === null) },
  ]);
  report.checks = report.cases.flatMap(row => row.checks);
  report.result = !report.errors.length && report.checks.every(check => check.pass) ? 'PASS_NATIVE_GIANT_PUNCH_KEYBOARD_SCOPE' : 'FAIL';
  if (report.result === 'FAIL') process.exitCode = 1;
} catch (error) { report.failure = error.stack; report.result = 'ERROR'; process.exitCode = 1; }
finally { await writeFile(`${out}/observations.json`, JSON.stringify(report, null, 2) + '\n'); await browser.close(); }
console.log(JSON.stringify({ result: report.result, checks: report.checks?.length, failed: report.checks?.filter(check => !check.pass), errors: report.errors }));
