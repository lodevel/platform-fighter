import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = process.env.PF_REWORK_OUTPUT ?? 'docs/review/2026-09-09/authoring';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { checks: [], errors: [], notes: ['Local production build; isolated Chromium storage; software WebGL.', 'Keyboard/pointer journeys and controlled real MatchScene/Matter probes; physical controllers are simulated through their connection monitor.'] };
page.on('pageerror', error => report.errors.push(error.message));
const config = {
  mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 12345, itemFrequency: 'off',
  players: [
    { index: 1, characterId: 'link', paletteIndex: 0, inputType: 'keyboard_p1' },
    { index: 2, characterId: 'donkeykong', paletteIndex: 0, inputType: 'keyboard_p2' },
  ],
};
let authoredTune;
async function open(key, data) {
  await page.evaluate(() => { for (const scene of window.__game.scene.getScenes(true)) window.__game.scene.stop(scene.scene.key); });
  await page.waitForTimeout(60);
  await page.evaluate(({ key, data }) => window.__game.scene.start(key, data), { key, data });
  await page.waitForFunction(key => window.__game.scene.isActive(key), key);
}
async function match(matchConfig = config, auto = false) {
  await page.evaluate(() => { for (const scene of window.__game.scene.getScenes(true)) window.__game.scene.stop(scene.scene.key); });
  await page.waitForTimeout(60);
  await page.evaluate(({ matchConfig, auto }) => {
    window.__game.scene.start('MatchScene', { matchConfig });
    const scene = window.__game.scene.getScene('MatchScene');
    if (!auto) scene.physicsEngine.pause();
  }, { matchConfig, auto });
  await page.waitForFunction(() => window.__game.scene.isActive('MatchScene'));
  if (auto) await page.waitForFunction(() => window.__game.scene.getScene('MatchScene').p1.isGrounded());
}
async function check(name, work) {
  if (process.env.PF_REWORK_SKIP?.split(',').some(term => name.includes(term))) return;
  const result = await work(); report.checks.push({ name, result }); console.log(`PASS ${name}`);
}
async function screenshot(name) { await page.screenshot({ path: `${output}/${name}.png` }); }
async function clickText(sceneKey, label) {
  const point = await page.evaluate(({ sceneKey, label }) => {
    const game = window.__game, scene = game.scene.getScene(sceneKey);
    const object = scene.children.list.find(child => typeof child.text === 'string' && child.text.includes(label));
    if (!object) throw new Error(`Missing text: ${label}`);
    const bounds = object.getBounds(), canvas = game.canvas.getBoundingClientRect();
    return { x: canvas.left + bounds.centerX * canvas.width / game.scale.gameSize.width,
      y: canvas.top + bounds.centerY * canvas.height / game.scale.gameSize.height };
  }, { sceneKey, label });
  await page.mouse.click(point.x, point.y);
}
try {
  await page.goto(process.env.PF_REWORK_URL ?? 'http://127.0.0.1:4173/platform-fighter/');
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });

  await check('keyboard journey from main menu through rules, roster and stage', async () => {
    await open('MainMenuScene');
    await page.keyboard.press('Enter'); await page.waitForFunction(() => window.__game.scene.isActive('ModeSelectScene'));
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
    await screenshot('rules');
    await page.keyboard.press('Enter'); await page.waitForFunction(() => window.__game.scene.isActive('CharacterSelectScene'));
    await page.keyboard.press('Space'); await page.keyboard.press('c'); await screenshot('roster');
    await page.keyboard.press('Enter'); await page.waitForFunction(() => window.__game.scene.isActive('StageSelectScene'));
    await page.keyboard.press('ArrowDown'); await screenshot('stages');
    await page.keyboard.press('Enter'); await page.waitForFunction(() => window.__game.scene.isActive('MatchScene'));
    const result = await page.evaluate(() => {
      const s = window.__game.scene.getScene('MatchScene'); s.physicsEngine.pause();
      return { stockCount: s.stockTracker.initialStocks, stage: s.activeMatchConfig.stageId, participants: s.matchParticipants.map(p => p.slot.inputType) };
    });
    assert.equal(result.stockCount, 5); assert.notEqual(result.stage, 'flat');
    assert.deepEqual(result.participants, ['keyboard_p1', 'ai']); return result;
  });

  await check('selected stocks and real KO/respawn flow', async () => {
    await match();
    const result = await page.evaluate(() => {
      const s = window.__game.scene.getScene('MatchScene'); const remaining = [];
      s.physicsEngine.resume();
      for (let i = 0; i < 5; i++) {
        s.p2.setPosition(5000, 300); s.update(0, s.physicsEngine.fixedTimestepMs);
        remaining.push(s.stockTracker.getStocks(1));
      }
      s.physicsEngine.pause();
      return { remaining, phase: s.matchEndDetector.getPhase(), winner: s.matchEndDetector.getResultPayload()?.winnerIndex, falls: s.matchStatsTracker.getAllStats(s.physicsEngine.getFrame())[1].deaths };
    });
    assert.deepEqual(result, { remaining: [4, 3, 2, 1, 0], phase: 'ending', winner: 0, falls: 5 }); return result;
  });

  await check('Time score, exact expiry, and ending freeze', async () => {
    await match({ ...config, mode: 'time', timeLimitSeconds: 1 });
    const result = await page.evaluate(() => {
      const s = window.__game.scene.getScene('MatchScene'); s.physicsEngine.resume();
      s.p2.setPosition(5000, 300); s.update(0, s.physicsEngine.fixedTimestepMs);
      const afterFall = { stocks: s.stockTracker.getStocks(1), eliminated: s.stockTracker.isEliminated(1) };
      while (s.physicsEngine.getFrame() < 59) s.update(0, s.physicsEngine.fixedTimestepMs);
      const before = s.matchEndDetector.getPhase(); s.update(0, s.physicsEngine.fixedTimestepMs);
      const after = s.matchEndDetector.getPhase(); const payload = s.matchEndDetector.getResultPayload();
      s.physicsEngine.pause();return { afterFall, before, after, winner: payload?.winnerIndex, scores: payload?.scores, endFrame: payload?.endFrame };
    });
    assert.deepEqual(result, { afterFall: { stocks: 1, eliminated: false }, before: 'active', after: 'ending', winner: 0, scores: [0, -1], endFrame: 59 }); return result;
  });

  await check('Time tie transitions to a clean sudden-death round', async () => {
    await match({ ...config, mode: 'time', timeLimitSeconds: 1 });
    const result = await page.evaluate(() => {
      const s = window.__game.scene.getScene('MatchScene'); s.physicsEngine.resume();
      while (s.physicsEngine.getFrame() < 60) s.update(0, s.physicsEngine.fixedTimestepMs);
      const start = { phase: s.matchRules.getPhase(), percent: s.playerSlots.map(p => p.character.getDamagePercent()), stocks: s.playerSlots.map(p => s.stockTracker.getStocks(p.playerIndex)), invincible: s.playerSlots.map(p => p.character.isInvincible()) };
      s.p2.setPosition(5000, 300); s.update(0, s.physicsEngine.fixedTimestepMs);
      s.physicsEngine.pause();return { start, winner: s.matchEndDetector.getResultPayload()?.winnerIndex, suddenDeath: s.matchEndDetector.getResultPayload()?.decidedBySuddenDeath };
    });
    assert.deepEqual(result, { start: { phase: 'suddenDeath', percent: [300, 300], stocks: [1, 1], invincible: [false, false] }, winner: 0, suddenDeath: true });return result;
  });

  await check('sparse participants retain fighters and physical gamepads', async () => {
    await match({ ...config, players: [
      { ...config.players[0], index: 1, inputType: 'gamepad', inputDevice: { kind: 'gamepad', gamepadIndex: 2 } },
      { ...config.players[1], index: 3, inputType: 'gamepad', inputDevice: { kind: 'gamepad', gamepadIndex: 0 } },
    ] });
    const result = await page.evaluate(() => {
      const s = window.__game.scene.getScene('MatchScene');
      return s.matchParticipants.map((p, i) => ({ fighter: s.playerSlots[i].character.id, lobbySlot: p.slot.index, runtime: p.runtimePlayerIndex, padIndices: [...new Set(Object.values(p.bindings.bindings).flat().filter(b => b.kind === 'gamepad').map(b => b.gamepadIndex))] }));
    });
    assert.deepEqual(result, [{ fighter: 'link', lobbySlot: 1, runtime: 0, padIndices: [2] }, { fighter: 'donkeykong', lobbySlot: 3, runtime: 1, padIndices: [0] }]); return result;
  });

  await check('neutral hitlag freezes real Matter position', async () => {
    await match();
    const positions = await page.evaluate(() => {
      const s = window.__game.scene.getScene('MatchScene'), f = s.p1; f.setPosition(800, 300); f.armAttackerHitlag(8);
      return Array.from({ length: 6 }, () => { f.applyInput({ moveX: 0, moveY: 0, jump: false }); s.matter.world.step(s.physicsEngine.fixedTimestepMs); f.applyPostPhysicsVelocityConstraints(); return { ...f.getPosition() }; });
    });
    for (const position of positions) assert.deepEqual(position, { x: 800, y: 300 });return positions;
  });

  await check('controller reconnect updates rematch identity without phantom players', async () => {
    await match();
    assert.deepEqual(await page.evaluate(() => window.__game.scene.getScene('MatchScene').gamepadConnectionMonitor.getAffectedSlots(0)), []);
    await match({ ...config, players: [
      { ...config.players[0], inputType: 'gamepad', inputDevice: { kind: 'gamepad', gamepadIndex: 2, gamepadId: 'Acceptance pad' } }, config.players[1],
    ] });
    const result = await page.evaluate(() => {
      const s = window.__game.scene.getScene('MatchScene');
      s.gamepadConnectionMonitor.emitDisconnect(2, { gamepadId: 'Acceptance pad' });
      s.gamepadConnectionMonitor.emitConnect(5, { gamepadId: 'Acceptance pad' });
      s.physicsEngine.pause();
      return { active: s.activeMatchConfig.players[0].inputDevice.gamepadIndex, restart: s.launchData.matchConfig.players[0].inputDevice.gamepadIndex, affected: s.gamepadConnectionMonitor.getAffectedSlots(5) };
    });
    assert.deepEqual(result, { active: 5, restart: 5, affected: [1] }); return result;
  });

  await check('moving platform carries a live fighter and keeps art and ledges aligned', async () => {
    await match({ ...config, stageId: 'moving-platform' });
    const result = await page.evaluate(() => {
      const s = window.__game.scene.getScene('MatchScene');
      const i = s.activeStage.platforms.findIndex(p => p.id === 'moving-horizontal');
      const body = s.baseStage.bodies.platformBodies[i], visual = s.baseStage.bodies.platformVisuals[i];
      s.p1.setPosition(body.position.x, body.bounds.min.y - s.p1.getTuning().height / 2);
      const initial = body.position.x; s.physicsEngine.resume();
      const offsets = [];
      for (let frame = 0; frame < 50; frame++) {
        s.update(0, s.physicsEngine.fixedTimestepMs); offsets.push(s.p1.getPosition().x - body.position.x);
      }
      s.physicsEngine.pause();
      const ledge = s.baseStage.getLedgeCandidates().find(l => l.platformId === 'moving-horizontal' && l.side === 'left');
      return { distance: body.position.x - initial, drift: Math.max(...offsets.map(Math.abs)), visualError: Math.abs(visual.x - body.position.x), ledgeError: Math.abs(ledge.x - body.bounds.min.x), grounded: s.p1.isGrounded() };
    });
    assert.ok(result.distance > 30); assert.ok(result.drift < 1); assert.equal(result.visualError, 0); assert.equal(result.ledgeError, 0); assert.equal(result.grounded, true);return result;
  });

  await check('replay file preserves every action and identifies its build', async () => {
    await match();
    const input = { moveX: 0.25, moveY: -0.75, jump: true, attack: true, attackHeavy: true, special: true, shield: true, dodge: true, grab: true, dropThrough: true, ledgeRelease: 'roll', attackStickX: -1, attackStickY: 0 };
    const result = await page.evaluate(input => {
      const s = window.__game.scene.getScene('MatchScene'); const buffer = s.getInputCaptureBuffer();
      buffer.captureFrame((buffer.getEntries().at(-1)?.frame ?? -1) + 1, [input, input]);
      s.recordingController.stop();const file = s.recordingController.buildReplayFile();
      return { version: file.version, engineVersion: file.metadata.engineVersion, input: file.inputTimeline.entries.at(-1).inputs[0] };
    }, input);
    assert.equal(result.version, 6); assert.match(result.engineVersion, /^platform-fighter-sha256-[a-f0-9]{64}$/); assert.deepEqual(result.input, input);return result;
  });

  await check('a rising pass-through surface detects crossing against its old top', async () => {
    await match();
    const result = await page.evaluate(() => {
      const s = window.__game.scene.getScene('MatchScene'), f = s.p1;
      const i = s.activeStage.platforms.findIndex(p => p.passThrough), body = s.baseStage.bodies.platformBodies[i];
      const oldTop = body.bounds.min.y;
      f.setPosition(body.position.x, oldTop - 5 - f.getTuning().height / 2);
      s.matter.body.setVelocity(f.body, { x: 0, y: 0 });
      s.prevFighterFeetY.set(f, f.getBodyBottomY()); s.prevPlatformTopY.set(body, oldTop);
      s.matter.body.setPosition(body, { x: body.position.x, y: body.position.y - 10 });
      s.updatePassThroughPlatformMasks();
      return { feetRelativeToTop: f.getBodyBottomY() - body.bounds.min.y, solid: (body.collisionFilter.mask & f.body.collisionFilter.category) !== 0 };
    });
    assert.deepEqual(result, { feetRelativeToTop: 1, solid: true });return result;
  });

  await check('wall collision does not create reverse launch acceleration', async () => {
    await match();
    const samples = await page.evaluate(() => {
      const s = window.__game.scene.getScene('MatchScene'), f = s.p1; f.setPosition(800, 300);
      const wall = s.matter.add.rectangle(855, 300, 20, 400, { isStatic: true, friction: 0 });
      f.applyHit({ damage: 10, knockback: { x: 10, y: 0, scaling: 0 }, facing: 1 });
      const samples = Array.from({ length: 25 }, () => { f.applyInput({ moveX: 0, moveY: 0, jump: false }); s.matter.world.step(s.physicsEngine.fixedTimestepMs); f.applyPostPhysicsVelocityConstraints(); return f.getVelocity().x; });
      s.matter.world.remove(wall);return samples;
    });
    assert(Math.max(...samples) > 5);assert(Math.min(...samples) > -0.01);return samples;
  });

  await check('attack/grab/defense commitment', async () => {
    const result = [];
    for (const [name, inputs] of [ ['attack-grab', [{ attack: true }, { grab: true }]], ['dodge-grab', [{ dodge: true }, { grab: true }]], ['grab-shield', [{ grab: true }, { shield: true }]], ['grab-dodge', [{ grab: true }, { dodge: true }]] ]) {
      await match(config, true);
      const state = await page.evaluate(inputs => { const s = window.__game.scene.getScene('MatchScene');s.physicsEngine.pause();for (const input of inputs) s.p1.applyInput({moveX:0,moveY:0,jump:false,...input});return {grab:s.p1.getGrabState().name,shield:s.p1.getShieldState().name,dodge:s.p1.getDodgeState().name}; }, inputs);
      if (name.endsWith('grab')) assert.equal(state.grab,'idle');
      if (name==='grab-shield') assert.equal(state.shield,'idle');
      if (name==='grab-dodge') assert.equal(state.dodge,'idle');
      result.push({name,state});
    }return result;
  });

  await check('simultaneous and delayed jump attack both select a shorter jump than held full hop', async () => {
    const velocities=[];
    for(const delay of [0,1,-1]){
      await match(config,true);
      velocities.push(await page.evaluate(delay=>{const s=window.__game.scene.getScene('MatchScene');s.physicsEngine.pause();for(let frame=0;frame<4;frame++){s.p1.applyInput({moveX:0,moveY:0,jump:true,attack:frame===delay});if(frame<3){s.matter.world.step(s.physicsEngine.fixedTimestepMs);s.p1.applyPostPhysicsVelocityConstraints();}}return s.p1.getVelocity().y;},delay));
    }
    assert(Math.abs(velocities[0]-velocities[1])<0.001);
    assert(velocities.every(v=>v<0));
    assert(Math.abs(velocities[0])<Math.abs(velocities[2])*0.7);
    assert(Math.abs(velocities[0])>Math.abs(velocities[2])*0.5);
    return { simultaneous:velocities[0],delayed:velocities[1],full:velocities[2] };
  });

  await check('hitlag pose and paused match stay frozen', async () => {
    await match(config,true);
    await page.evaluate(()=>{const s=window.__game.scene.getScene('MatchScene');s.p1.applyInput({moveX:0,moveY:0,jump:false,attack:true});s.p1.armAttackerHitlag(60);s.physicsEngine.pause();});
    await page.waitForTimeout(50);
    const frames=[];
    for(let i=0;i<4;i++){await page.waitForTimeout(70);frames.push(await page.evaluate(()=>window.__game.scene.getScene('MatchScene').playerSlots[0].sprite.frame.name));}
    assert.equal(new Set(frames).size,1);return frames;
  });

  await check('Lab tune survives restart, return, undo and re-entry', async () => {
    await open('CharacterEditorScene');
    const initial = await page.evaluate(() => { const spec = window.__game.scene.getScene('CharacterEditorScene').editState.getSpec(); return { id: spec.id, speed: spec.movement.maxRunSpeed }; });
    assert.equal(initial.id, 'link');
    await page.evaluate(()=>window.__game.scene.getScene('CharacterEditorScene').editState.setMovementField('maxRunSpeed',10));
    await page.keyboard.press('t');await page.waitForFunction(()=>window.__game.scene.isActive('MatchScene'));
    await page.keyboard.press('Escape');await page.waitForFunction(()=>window.__game.scene.isActive('PauseMenuScene'));
    await page.keyboard.press('r');await page.waitForTimeout(200);
    const restarted=await page.evaluate(()=>{const s=window.__game.scene.getScene('MatchScene');return{speed:s.p1.getTuning().maxRunSpeed,recordingStopped:s.recordingStopped,labMode:s.launchData.labMode};});
    assert.deepEqual(restarted,{speed:10,recordingStopped:true,labMode:true});
    await page.keyboard.press('Escape');await page.waitForFunction(()=>window.__game.scene.isActive('PauseMenuScene'));await page.keyboard.press('l');
    await page.waitForFunction(()=>window.__game.scene.isActive('CharacterEditorScene'));await screenshot('lab-retained');
    const returned=await page.evaluate(()=>{const s=window.__game.scene.getScene('CharacterEditorScene');const before=s.editState.getSpec().movement.maxRunSpeed;s.editState.undo();return{before,after:s.editState.getSpec().movement.maxRunSpeed};});
    assert.deepEqual(returned,{before:10,after:initial.speed});return {restarted,returned};
  });

  await check('Pause Controls returns to the same suspended match', async () => {
    await match(config,true);await page.keyboard.press('Escape');await page.waitForFunction(()=>window.__game.scene.isActive('PauseMenuScene'));
    const before=await page.evaluate(()=>{const s=window.__game.scene.getScene('MatchScene');return{frame:s.physicsEngine.getFrame(),position:s.p1.getPosition(),id:s.p1.body.id};});
    await page.keyboard.press('k');await page.waitForFunction(()=>window.__game.scene.isActive('RebindingScene'));await screenshot('controls');
    await page.keyboard.press('Escape');await page.waitForFunction(()=>window.__game.scene.isActive('PauseMenuScene'));
    const after=await page.evaluate(()=>{const s=window.__game.scene.getScene('MatchScene');return{frame:s.physicsEngine.getFrame(),position:s.p1.getPosition(),id:s.p1.body.id};});
    assert.deepEqual(after,before);await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => window.__game.scene.getScene('MatchScene').pausedForMenu || window.__game.scene.isActive('PauseMenuScene')), false);
    await page.keyboard.press('Escape'); await page.waitForFunction(() => window.__game.scene.isActive('PauseMenuScene'));
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => window.__game.scene.getScene('MatchScene').pausedForMenu || window.__game.scene.isActive('PauseMenuScene')), false);
    return after;
  });
  await check('Link full kit can be edited, saved and tested from the Lab', async () => {
    await open('CharacterEditorScene');
    const kit = await page.evaluate(() => {
      const s = window.__game.scene.getScene('CharacterEditorScene');
      const before = s.editState.getSpec();
      s.editState.setMovementField('maxRunSpeed', 11);
      s.editState.setMoveNumericField('jab', ['damage'], 9);
      return { id: before.id, moves: Object.keys(before.moves) };
    });
    assert.equal(kit.id, 'link');
    for (const move of ['jab2', 'jab3', 'bair', 'dashAttack', 'upSmash', 'downSmash']) assert.ok(kit.moves.includes(move));
    await page.keyboard.press('s');
    await page.waitForFunction(() => window.__game.scene.getScene('CharacterEditorScene').savedSlotId === 'link-tune');
    await screenshot('link-saved');
    await page.keyboard.press('t'); await page.waitForFunction(() => window.__game.scene.isActive('MatchScene'));
    const actual = await page.evaluate(() => { const s = window.__game.scene.getScene('MatchScene');
      return { id: s.p1.id, speed: s.p1.getTuning().maxRunSpeed, jab: s.p1.getAttack('link.jab').damage, jab2: !!s.p1.getAttack('link.jab2'), lab: s.launchData.labMode }; });
    assert.deepEqual(actual, { id: 'link', speed: 11, jab: 9, jab2: true, lab: true });
    return { kit, actual };
  });

  await check('saved tune survives fighter and stage handoff, storage deletion, replay and restart', async () => {
    await page.evaluate(() => { window.__game.registry.remove('lastCharacterSelectState'); window.__game.registry.remove('lastCharacterSelectPads'); });
    await open('CharacterSelectScene', { restorePlayers: true, pendingMatchConfig: { ...config, players: [config.players[0], { ...config.players[1], index: 3, inputType: 'ai' }] } });
    await page.keyboard.press('t');
    await page.waitForFunction(() => window.__game.scene.getScene('CharacterSelectScene').state.slots[0].customCharacter?.slotId === 'link-tune');
    authoredTune = await page.evaluate(() => window.__game.scene.getScene('CharacterSelectScene').state.slots[0].customCharacter);
    await screenshot('tune-selected');
    await page.keyboard.press('Enter'); await page.waitForFunction(() => window.__game.scene.isActive('StageSelectScene'));
    await page.evaluate(() => localStorage.removeItem('platformfighter:characters:v1:link-tune'));
    await page.keyboard.press('Escape'); await page.waitForFunction(() => window.__game.scene.isActive('CharacterSelectScene'));
    assert.equal(await page.evaluate(() => window.__game.scene.getScene('CharacterSelectScene').state.slots[0].customCharacter.spec.movement.maxRunSpeed), 11);
    await page.keyboard.press('Enter'); await page.waitForFunction(() => window.__game.scene.isActive('StageSelectScene'));
    await page.keyboard.press('Enter'); await page.waitForFunction(() => window.__game.scene.isActive('MatchScene'));
    const actual = await page.evaluate(() => {
      const s = window.__game.scene.getScene('MatchScene'); s.physicsEngine.pause();
      s.recordingController.stop(); s.recordingStopped = true; const replay = s.recordingController.buildReplayFile();
      return { speed: s.p1.getTuning().maxRunSpeed, jab: s.p1.getAttack('link.jab').damage,
        lobby: s.activeMatchConfig.players.map(p => p.index), version: replay.version,
        saved: replay.matchConfig.players[0].customCharacter.spec.movement.maxRunSpeed, items: replay.matchConfig.itemFrequency };
    });
    assert.deepEqual(actual, { speed: 11, jab: 9, lobby: [1, 3], version: 6, saved: 11, items: 'off' });
    await page.keyboard.press('Escape'); await page.waitForFunction(() => window.__game.scene.isActive('PauseMenuScene'));
    await page.keyboard.press('r'); await page.waitForTimeout(200);
    const restarted = await page.evaluate(() => { const s = window.__game.scene.getScene('MatchScene'); return { speed: s.p1.getTuning().maxRunSpeed, jab: s.p1.getAttack('link.jab').damage, recording: s.recordingController.isRecording() }; });
    assert.deepEqual(restarted, { speed: 11, jab: 9, recording: true });return { actual, restarted };
  });

  await check('four identical base fighters keep separate tuned and untuned kits', async () => {
    const second = structuredClone(authoredTune); second.slotId = 'link-second'; second.spec.movement.maxRunSpeed = 12; second.spec.moves.jab.damage = 10;
    await match({ ...config, players: [
      { ...config.players[0], customCharacter: authoredTune },
      { ...config.players[0], index: 2, inputType: 'ai' },
      { ...config.players[0], index: 3, inputType: 'keyboard_p2', customCharacter: second },
      { ...config.players[0], index: 4, inputType: 'ai' },
    ] });
    const actual = await page.evaluate(() => window.__game.scene.getScene('MatchScene').playerSlots.map(p => ({ speed: p.character.getTuning().maxRunSpeed, jab: p.character.getAttack('link.jab').damage })));
    assert.deepEqual(actual, [{ speed: 11, jab: 9 }, { speed: 7.8, jab: 3 }, { speed: 12, jab: 10 }, { speed: 7.8, jab: 3 }]);return actual;
  });

  await check('pointer rules and stage navigation work in a narrow landscape viewport', async () => {
    await page.setViewportSize({ width: 844, height: 390 });
    await open('MainMenuScene'); await clickText('MainMenuScene', 'VERSUS');
    await page.waitForFunction(() => window.__game.scene.isActive('ModeSelectScene'));
    await clickText('ModeSelectScene', '[ CONTINUE ]');
    await page.waitForFunction(() => window.__game.scene.isActive('CharacterSelectScene'));
    await clickText('CharacterSelectScene', 'READY TO FIGHT');
    await page.waitForFunction(() => window.__game.scene.isActive('StageSelectScene'));
    await screenshot('stages-narrow'); await clickText('StageSelectScene', '[ BACK ]');
    await page.waitForFunction(() => window.__game.scene.isActive('CharacterSelectScene'));
    await clickText('CharacterSelectScene', '[ BACK ]');
    await page.waitForFunction(() => window.__game.scene.isActive('ModeSelectScene'));
    await clickText('ModeSelectScene', '[ BACK ]'); await page.waitForFunction(() => window.__game.scene.isActive('MainMenuScene'));
    await page.setViewportSize({ width: 390, height: 844 }); await open('MainMenuScene'); await screenshot('main-portrait');
    await clickText('MainMenuScene', 'CHARACTER LAB'); await page.waitForFunction(() => window.__game.scene.isActive('CharacterEditorScene'));
    await screenshot('lab-portrait');return { landscape: '844x390 pointer journey passed', portrait: '390x844 navigation passed; scaled desktop text remains small' };
  });
  assert.deepEqual(report.errors,[]);
}catch(error){report.failure=error.stack;process.exitCode=1;console.error(error);}finally{await writeFile(`${output}/acceptance.json`,JSON.stringify(report,null,2)+'\n');await browser.close();}
