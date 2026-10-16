import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const output = process.env.PF_PROBE_OUT ?? 'docs/review/2026-09-25/donkeykong-character/completion-2026-10-08/runtime/items-replay';
const url = process.env.PF_REWORK_URL ?? 'http://localhost:4196/platform-fighter/';
await mkdir(output, { recursive: true });
const report = { url, errors: [], matches: [], scope: 'Two actual MatchScene lifecycles with the same seed. Normal fixed physics, actual item scheduler/entities and scene-owned recording writers. Deterministic neutral input fixture; not a physical keyboard control claim.' };
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', error => report.errors.push(error.message));
try {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'));
  const bundle = await page.evaluate(() => [...document.scripts].find(script => /assets\/index-/.test(script.src))?.src);
  report.bundle = bundle;
  report.bundleSha256 = createHash('sha256').update(await (await page.request.get(bundle)).body()).digest('hex');
  for (let match = 0; match < 2; match++) {
    await page.evaluate(() => {
      const game = window.__game;
      for (const scene of game.scene.getScenes(true)) game.scene.stop(scene.scene.key);
      game.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 81008, itemFrequency: 'high', players: [
        { index: 1, characterId: 'donkeykong', paletteIndex: 0, inputType: 'keyboard_p1' },
        { index: 2, characterId: 'pikachu', paletteIndex: 0, inputType: 'keyboard_p2' },
      ] } });
      const scene = game.scene.getScene('MatchScene');
      scene.physicsEngine.pause(); scene.roundStartCountdown = 0; scene.cpuControllers.clear();
      scene.inputResolver.getMoveVector = () => ({ x: 0, y: 0 });
      scene.inputResolver.isActionHeld = () => false;
      scene.inputResolver.justPressed = () => false;
      window.__dkItemsScene = scene;
    });
    const data = await page.evaluate(() => {
      const scene = window.__dkItemsScene;
      const initial = { typeIndex: scene.itemSpawnTypeIndex, events: structuredClone(scene.getItemSpawnEvents()), recording: scene.getRecordingController().getPhase() };
      // Four live items is the cap. Stop after four actual spawns without
      // clearing entities or altering the scheduler's eligibility path.
      for (let step = 0; step < 1400 && scene.getItemSpawnEvents().length < 4; step++) {
        scene.physicsEngine.resume(); scene.update(0, scene.physicsEngine.fixedTimestepMs); scene.physicsEngine.pause();
      }
      const events = scene.getItemSpawnEvents();
      const entities = scene.getItemRegistry().getActive().map(entity => ({ id: entity.id, type: entity.definition?.type ?? entity.type, position: entity.getPosition() }));
      const controller = scene.getRecordingController(); controller.stop();
      const replay = controller.buildReplayFile();
      const json = JSON.parse(controller.buildReplayJson());
      return { initial, events, entities, frame: scene.physicsEngine.getFrame(), replayEvents: replay.itemSpawnEvents, jsonEvents: json.itemSpawnEvents,
        replayFrameCount: controller.getStatus().frameCount, controllerStatus: controller.getStatus() };
    });
    report.matches.push(data);
    await page.screenshot({ path: `${output}/match-${match + 1}.png` });
  }
  const [first, second] = report.matches;
  report.checks = {
    fourActualSpawnsEach: report.matches.every(match => match.events.length === 4 && match.entities.length === 4),
    freshMatchCounterAndLog: report.matches.every(match => match.initial.typeIndex === 0 && match.initial.events.length === 0),
    sameSeedSameEvents: JSON.stringify(first.events) === JSON.stringify(second.events),
    fileWriterPreservesEvents: report.matches.every(match => JSON.stringify(match.events) === JSON.stringify(match.replayEvents)),
    jsonWriterPreservesEvents: report.matches.every(match => JSON.stringify(match.events) === JSON.stringify(match.jsonEvents)),
    noBrowserErrors: report.errors.length === 0,
  };
  report.result = Object.values(report.checks).every(Boolean) ? 'PASS_LIVE_ITEMS_REPLAY_AND_REMATCH_RESET' : 'FAIL';
  console.log(JSON.stringify({ result: report.result, checks: report.checks }));
  if (report.result === 'FAIL') process.exitCode = 1;
} catch (error) {
  report.failure = error.stack; process.exitCode = 1;
} finally {
  await writeFile(`${output}/observations.json`, JSON.stringify(report, null, 2) + '\n');
  await browser.close();
}
