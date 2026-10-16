#!/usr/bin/env node
/* Ultimate items: deterministic replay of a production match that uses one item: the Home-Run Bat (phase 1 uses;
 * phase 2 pickups, grab tosses, smash throws, an air catch and a Z-drop through the shared item planner), the Beam Sword /
 * Star Rod (phase 3: the four uses with a charged forward smash; the Star Rod's stars until it is empty, then empty swings),
 * or a shooting item (phase 4: Ray Gun shots standing / walking / out of a run / in the air until empty, then the empty-gun
 * throw; Super Scope taps, charged shots (standing, walking) and an air tap until empty; Fire Flower streams standing,
 * walking and in the air until the fuel is gone; each then thrown empty), or a throwing item (phase 5: one Bob-omb held
 * until its fuse explodes in DK's hand while the next one, left alone, stands up, walks and explodes; then tosses by the
 * attack button forward / down / up, a smash toss and an air toss; Banana Peel tossed at Pikachu, re-picked and tossed again
 * until both of its uses are gone, Pikachu walking onto lying peels).
 *
 *   node tools/items-replay-check.mjs <outDir> [--url URL] [--item homeRunBat|beamSword|starRod|rayGun|superScope|fireFlower|bobOmb|bananaPeel]
 *
 * 1. Live match in the production preview (DK P1 vs Pikachu P2, items 'high', fixed seed). DK's inputs come from a
 *    scripted controller on MatchScene's CPU-controller hook (SIMULATED input, not a keyboard): walk to a grounded Home-Run
 *    Bat and pick it up, then in turn: jab / forward tilt (0.5 stick) / forward smash / dash attack; a forward grab toss; an up
 *    smash throw (V + up) caught in the air with grab on the way down; a down smash throw; a Z-drop from a jump; a dash throw.
 *    The Item Switch leaves only the bat on, so every spawn is a bat. Pikachu idles.
 *    Each step logs the same per-player fields tools/replay-resim.mjs logs.
 * 2. The scene's RecordingController writes the replay file (<outDir>/bat-match.replay.json).
 * 3. tools/replay-resim.mjs re-simulates that file in a fresh page (<outDir>/resim/trace.json).
 * 4. The two traces are compared frame by frame (position, damage, active attack, held item, stocks).
 * Wrap in `flock .tmp/dk-heavy.lock`. Output: <outDir>/items-replay-check.json.
 */
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const outDir = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--url' && argv[i - 1] !== '--item');
const ITEM = argv.includes('--item') ? argv[argv.indexOf('--item') + 1] : 'homeRunBat';
const ITEM_TYPES = ['homeRunBat', 'beamSword', 'hammer', 'rayGun', 'bobOmb', 'crate', 'starRod', 'superScope', 'fireFlower', 'bananaPeel', 'goldenHammer','food','heartContainer','maximTomato'];
if (!ITEM_TYPES.includes(ITEM)) { console.error(`unknown --item ${ITEM}`); process.exit(2); }
const url = (argv.includes('--url') ? argv[argv.indexOf('--url') + 1] : null)
  ?? process.env.PF_REWORK_URL ?? 'http://127.0.0.1:4173/platform-fighter/';
if (!outDir) { console.error('usage: node tools/items-replay-check.mjs <outDir> [--url URL]'); process.exit(2); }
await mkdir(outDir, { recursive: true });
const FRAMES = 2400;
const recoveryItem=['food','heartContainer','maximTomato'].includes(ITEM);
const matchConfig = { mode: 'stocks', stockCount: 3, stageId: 'flat', rngSeed: 1011, itemFrequency: 'high',
  itemSwitch: Object.fromEntries(ITEM_TYPES.filter(t => t !== ITEM).map(t => [t, false])), players: [
  { index: 1, characterId: 'donkeykong', paletteIndex: 0, inputType: 'keyboard_p1' },
  { index: 2, characterId: 'pikachu', paletteIndex: 1, inputType: 'keyboard_p2' }] };

const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
const live = await page.evaluate(({ matchConfig, FRAMES, ITEM }) => {
  const game = window.__game;
  for (const scene of game.scene.getScenes(true)) game.scene.stop(scene.scene.key);
  game.scene.start('MatchScene', { matchConfig });
  const s = game.scene.getScene('MatchScene');
  s.physicsEngine.pause();
  const [dk, pk] = s.playerSlots;
  const healingContacts=[];const realRecoveryHit=dk.character.applyHitDetailed.bind(dk.character);
  dk.character.applyHitDetailed=(hit,...args)=>{const budget=dk.character.getHealingState?.();const result=realRecoveryHit(hit,...args);
    if(budget&&result.damageApplied>0)healingContacts.push({frame:s.physicsEngine.getFrame(),damageApplied:result.damageApplied,budgetBeforeHit:budget.remaining,outcome:result.outcome});return result;};
  const idle = { moveX: 0, moveY: 0, jump: false, attack: false, dropThrough: false, attackHeavy: false, special: false, shield: false, dodge: false, grab: false, ledgeRelease: null };
  const held = slot => s.inventoriesByPlayerIndex.get(slot.playerIndex)?.getHeldItem()?.definition?.type ?? null;
  let pickedAt = null; const actions = [];
  // Each step runs with the item held, starting `wait` frames after the previous one ended, its input held `hold`
  // frames (a charged smash); `regrab` steps release the item, after which DK walks back to it (ground pickup) or
  // catches it (`catch`).
  const charged = { name: 'fsmash-charged', wait: 60, hold: 50, input: { attackHeavy: true } };
  const swings = [
    { name: 'jab', wait: 40, input: { attack: true } },
    { name: 'ftilt', wait: 60, input: { moveX: 0.5, attack: true } },
    charged,
    { name: 'dash-attack', wait: 120, run: 10, input: { attack: true } },
    { name: 'fsmash', wait: 60, input: { attackHeavy: true } },
  ];
  // Shooting items: `hold` repeats the press input (a held fire button, a walking stick); `run` runs first; `jumpFirst` hops.
  const fire = (name, extra = {}) => ({ name, wait: 50, input: { attack: true }, ...extra });
  const shooting = {
    rayGun: [fire('fire'), fire('fire-walk', { input: { attack: true, moveX: 0.5 }, hold: 24 }), fire('fire-run', { wait: 80, run: 14 }),
      fire('fire-air', { jumpFirst: true }), ...Array.from({ length: 12 }, (_, i) => fire(`fire-${i + 5}`, { wait: 30 })),
      fire('empty-throw', { regrab: true })],
    superScope: [fire('tap'), fire('charge', { hold: 120 }), fire('walk-charge', { wait: 70, input: { attack: true, moveX: 0.5 }, hold: 60 }),
      fire('air-tap', { jumpFirst: true }), ...Array.from({ length: 4 }, (_, i) => fire(`charge-${i + 5}`, { wait: 70, hold: 120 })),
      fire('tap-9'), fire('tap-10'), fire('empty-throw', { wait: 70, regrab: true })],
    fireFlower: [fire('stream', { hold: 120 }), fire('walk-stream', { input: { attack: true, moveX: 0.5 }, hold: 90 }),
      fire('air-stream', { jumpFirst: true, hold: 30 }), fire('stream-4', { hold: 150 }), fire('stream-5', { hold: 150 }),
      fire('empty-throw', { regrab: true })],
  }[ITEM];
  // Throwing items (phase 5): the attack button throws (`regrab`: DK then fetches the next one).
  const toss = (name, input, extra = {}) => ({ name, wait: 40, input: { attack: true, ...input }, regrab: true, ...extra });
  const throwing = {
    // First held until the fuse runs out (it explodes in DK's hand; DK is its user: unhurt); meanwhile the next spawned
    // Bob-omb is left alone, stands up, walks and explodes on its own.
    bobOmb: [{ name: 'hold-fuse', wait: 10, input: {}, hold: 640, regrab: true }, toss('toss-forward', {}), toss('toss-down', { moveY: 1 }),
      { name: 'smash-toss', wait: 40, input: { attackHeavy: true }, regrab: true }, toss('toss-up', { moveY: -1 }), toss('air-toss', {}, { jumpFirst: true })],
    bananaPeel: [toss('toss-forward', {}), toss('toss-up', { moveY: -1 }), toss('toss-down', { moveY: 1 }), toss('air-toss', {}, { jumpFirst: true }),
      toss('toss-forward-2', {}), toss('toss-forward-3', {})],
  }[ITEM];
  // Pikachu walks toward DK in bursts for the banana check (it steps on lying peels), otherwise idles.
  const pikachuWalks = ITEM === 'bananaPeel';
  const locked=['hammer','goldenHammer'].includes(ITEM)?[
    {name:'wait-lock',wait:40,input:{},hold:40},
    {name:'walk-lock',wait:40,input:{moveX:.5},hold:30},
    {name:'jump-lock',wait:40,jumpFirst:true,input:{jump:true},hold:1},
    ...Array.from({length:8},(_,i)=>({name:`float-tap-${i}`,wait:10,input:{jump:true},hold:1})),
    {name:'blocked-actions',wait:40,input:{attack:true,attackHeavy:true,special:true,shield:true,grab:true},hold:40},
    {name:'expiry',wait:40,input:{},hold:ITEM==='goldenHammer'?950:500,regrab:true}]:null;
  const steps = locked ? locked : throwing ? throwing : shooting ? shooting
    : ITEM === 'beamSword' ? [...swings, { name: 'toss-forward', wait: 70, input: { moveX: 0.7, grab: true }, regrab: true }, ...swings]
    // Star Rod: 16 stars (ftilt / fsmash), then empty swings that fire nothing.
    : ITEM === 'starRod' ? [...swings, ...Array.from({ length: 15 }, (_, i) => ({ name: `ftilt-star-${i + 3}`, wait: 34, input: { moveX: 0.5, attack: true } })),
      { name: 'ftilt-empty', wait: 40, input: { moveX: 0.5, attack: true } }, { ...charged, name: 'fsmash-charged-empty' }] : [
    { name: 'jab', wait: 40, input: { attack: true } },
    { name: 'ftilt', wait: 60, input: { moveX: 0.5, attack: true } },
    { name: 'fsmash', wait: 60, input: { attackHeavy: true } },
    { name: 'dash-attack', wait: 120, run: 10, input: { attack: true } },
    { name: 'toss-forward', wait: 70, input: { moveX: 0.7, grab: true }, regrab: true },
    { name: 'smash-throw-up', wait: 40, input: { moveY: -1, attackHeavy: true }, regrab: true, catch: true },
    { name: 'smash-throw-down', wait: 40, input: { moveY: 1, attackHeavy: true }, regrab: true },
    { name: 'z-drop', wait: 40, jumpFirst: true, input: { grab: true }, regrab: true },
    { name: 'dash-throw', wait: 40, run: 14, input: { grab: true }, regrab: true },
  ];
  let holdLeft = 0, holdInput = null;
  let stepIndex = 0, phaseStart = null, released = false, letGo = false, jumpAt = null, prevGrab = false;
  const bat = () => s.getItemRegistry().getActive().find(i => i.definition.type === ITEM);
  /** Scripted DK: reach the bat, pick it up, then each step in order toward Pikachu. */
  const isRecovery=['food','heartContainer','maximTomato'].includes(ITEM);
  let recoveryOpening=true;
  const recoveryFloor=()=>s.baseStage.bodies.platformBodies.filter(b=>b.label==='platform.solid').reduce((a,b)=>a.bounds.min.y>b.bounds.min.y?a:b);
  const onRecoveryFloor=slot=>slot.character.isGrounded()&&Math.abs(slot.character.getPosition().y+slot.character.getTuning().height/2-recoveryFloor().bounds.min.y)<8;
  const script = frame => {
    if(isRecovery){
      const me=dk.character.getPosition(),them=pk.character.getPosition(),dx=them.x-me.x;
      const platform=recoveryFloor(),floor=platform.bounds.min.y,centre=(platform.bounds.min.x+platform.bounds.max.x)/2;
      const aboveFloor=me.y+dk.character.getTuning().height/2<floor-8;
      if(recoveryOpening&&dk.character.getDamagePercent()>=20&&onRecoveryFloor(dk)&&onRecoveryFloor(pk))recoveryOpening=false;
      if(recoveryOpening)return {...idle,moveX:Math.abs(me.x-centre)>8?Math.sign(centre-me.x)*.5:0,dropThrough:aboveFloor,moveY:aboveFloor?1:0};
      if(dk.character.getEatingState?.())return idle;
      const item=s.itemRegistry.getGrounded().find(it=>it.definition.type===ITEM&&Math.abs(it.getPosition().y-(me.y+dk.character.getTuning().height/2))<40);if(!item)return idle;
      const x=item.getPosition().x-me.x;
      if(Math.abs(x)>20)return {...idle,moveX:Math.sign(x)*.5};
      if(frame%2===0){actions.push({frame,name:'recovery-pickup',variant:item.definition.foodVariant??null});pickedAt??=frame;return {...idle,attack:true};}
      return idle;
    }
    const me = dk.character.getPosition(), them = pk.character.getPosition(), toward = Math.sign(them.x - me.x) || 1;
    const step = steps[stepIndex];
    if (holdLeft > 0) { holdLeft -= 1; return holdInput; }
    if (held(dk) !== ITEM) {
      if (released) letGo = true;
      const item = bat();
      if (!item) return idle;
      const state = item.getSnapshot().state, p = item.getPosition();
      if (released && steps[stepIndex - 1]?.catch && state !== 'grounded') {
        // Air catch: jump under the falling bat and press grab (rising edges) while airborne.
        const dx = p.x - me.x;
        if (dk.character.isGrounded() && item.getSnapshot().state !== 'held' && p.y > me.y - 260 && p.y < me.y - 60) return { ...idle, jump: true };
        if (!dk.character.isGrounded()) { prevGrab = !prevGrab; return { ...idle, moveX: Math.abs(dx) > 8 ? Math.sign(dx) * 0.5 : 0, grab: prevGrab }; }
        return { ...idle, moveX: Math.abs(dx) > 8 ? Math.sign(dx) * 0.5 : 0 };
      }
      if (state !== 'grounded' || !dk.character.isGrounded()) return idle;
      const dx = p.x - me.x;
      // A lying Banana Peel slips whoever touches it (an un-placed one, everyone): pick it up from 60 px, inside the pickup range.
      const reach = ITEM === 'bananaPeel' ? 60 : 18;
      if (Math.abs(dx) > reach) return { ...idle, moveX: Math.sign(dx) * 0.6 };
      return { ...idle, attack: frame % 2 === 0 && !dk.character.getActiveAttack() && !dk.character.getItemActionState()
        && !dk.character.getItemShootingState?.() };
    }
    if (released && !letGo) return idle;   // the throw's release callback has not fired yet
    if (released) { actions.push({ frame, name: `reacquired-after-${steps[stepIndex - 1]?.name ?? '?'}` }); released = false; letGo = false; phaseStart = null; }
    pickedAt ??= frame;
    if (!dk.character.isGrounded() && jumpAt === null && !(ITEM === 'goldenHammer' && step?.name.startsWith('float-tap'))) { phaseStart = null; return idle; }   // land before the next step
    phaseStart ??= frame;
    if (!step) return idle;
    // A shooting session still running (its shots, its end) finishes before the next step.
    if (dk.character.getItemShootingState?.()) { phaseStart = frame; return idle; }
    const t = frame - phaseStart;
    // Back off when close, then turn to face Pikachu (a slow walk step toward it) before the step's input.
    if (t < step.wait - 10) return Math.abs(them.x - me.x) < 280 ? { ...idle, moveX: -0.4 * toward } : idle;
    if (t < step.wait - 4) return dk.character.getFacing() === toward ? idle : { ...idle, moveX: 0.3 * toward };
    if (t < step.wait) return idle;
    const facing = dk.character.getFacing();
    if (step.run && t < step.wait + step.run) return { ...idle, moveX: toward };
    if (step.jumpFirst) {
      jumpAt ??= frame;
      if (frame - jumpAt < 2) return { ...idle, jump: true };
      if (frame - jumpAt < 10) return idle;
    }
    const input = { ...idle, ...step.input };
    if (step.input.moveX !== undefined) input.moveX = step.input.moveX * (step.run ? toward : facing);
    if (step.run) input.moveX = toward;
    actions.push({ frame, name: step.name });
    stepIndex += 1; phaseStart = null; jumpAt = null;
    if (step.hold) { holdLeft = step.hold - 1; holdInput = input; }
    if (step.regrab) released = true;
    return input;
  };
  s.cpuControllers.clear();
  s.cpuControllers.set(dk.playerIndex, { sample: f => script(f), registerLandedHit() {}, reset() {} });
  let hammerContactMade=false;
  s.cpuControllers.set(pk.playerIndex, { sample: f => {
    if(isRecovery){
      const p=pk.character.getPosition(),dkp=dk.character.getPosition(),dx=dkp.x-p.x,toward=Math.sign(dx)||1;
      const aboveFloor=p.y+pk.character.getTuning().height/2<recoveryFloor().bounds.min.y-8;
      if(aboveFloor)return {...idle,dropThrough:true,moveY:1,moveX:Math.abs(dx)>60?toward*.5:0};
      const heal=dk.character.getHealingState?.();
      if(recoveryOpening||heal){
        if(!onRecoveryFloor(pk)||!onRecoveryFloor(dk)||Math.abs(dx)>58)return {...idle,moveX:Math.abs(dx)>58?toward*.5:0};
        // Native forward tilts build real injury quickly; fresh neutral jabs contact during gradual healing.
        const period=recoveryOpening?45:12,press=f%period===1;
        return {...idle,moveX:recoveryOpening&&press?toward*.5:f%period===0?toward*.4:0,attack:press,
          attackStickX:recoveryOpening&&press?toward*.5:0,attackStickY:0};
      }
      // Keep pace in the eater's travel direction. Chasing through the eater can jostle it backwards offstage.
      const v=dk.character.getVelocity().x,heading=Math.abs(v)>.1?Math.sign(v):dk.character.getFacing();
      const desired=dkp.x+heading*60,delta=desired-p.x;
      return {...idle,moveX:Math.abs(delta)>12?Math.sign(delta)*.5:0};
    }
    if(locked){
      if(s.itemRegistry.getActive().some(it=>Object.keys(it.getHammerState?.()?.contactFrames??{}).length))hammerContactMade=true;
      const dx=dk.character.getPosition().x-pk.character.getPosition().x;
      return !hammerContactMade && held(dk)===ITEM && Math.abs(dx)>50 ? {...idle,moveX:Math.sign(dx)} : idle;
    }
    return pikachuWalks && f % 240 < 90
    ? { ...idle, moveX: 0.5 * (Math.sign(dk.character.getPosition().x - pk.character.getPosition().x) || 1) } : { ...idle };
  },registerLandedHit() {}, reset() {} });
  const pick = c => { const p = c.getPosition(), v = c.getVelocity(), a = c.getActiveAttack?.();
    return { x: +p.x.toFixed(2), y: +p.y.toFixed(2), vx: +v.x.toFixed(3), vy: +v.y.toFixed(3), dmg: +c.getDamagePercent().toFixed(2),grounded:c.isGrounded(),facing:c.getFacing(),feet:+(p.y+c.getTuning().height/2).toFixed(2),healing:c.getHealingState?.()??null,eating:c.getEatingState?.()??null,
      attack: a ? `${a.move.id}@${a.framesElapsed}` : null }; };
  const trace = []; let clock = 0;
  for (let i = 0; i < FRAMES && game.scene.isActive('MatchScene'); i++) {
    const frame = s.physicsEngine.getFrame();
    s.physicsEngine.resume();
    let guard = 0;
    while (s.physicsEngine.getFrame() === frame && guard++ < 20) { clock += 1000 / 60; s.update(clock, 1000 / 60); }
    s.physicsEngine.pause();
    trace.push({ frame, players: s.playerSlots.map(sl => ({ ...pick(sl.character), held: held(sl) })),
      stocks: s.playerSlots.map(sl => s.stockTracker.getStocks(sl.playerIndex)),
      itemStates: s.itemRegistry.getActive().map(it => { const p = it.getPosition(), fuse = it.getBobOmbState?.(), wear = it.getDurability?.();
        return `${it.id}:${it.definition.type}:${it.getSnapshot().state}:${p.x.toFixed(2)},${p.y.toFixed(2)}`
          + (it.definition.foodVariant?`:food=${it.definition.foodVariant}`:'') + (it.getHammerState?.() ? `:h${JSON.stringify(it.getHammerState())}` : '') + (fuse ? `:${fuse.phase}@${fuse.phaseFrames}/${fuse.heldFrames}` : '') + (wear !== null && wear !== undefined ? `:w${wear}` : ''); }),
      explosions: (s.itemExplosions ?? []).map(e => `${e.x.toFixed(2)},${e.y.toFixed(2)}:${e.framesLeft}:${[...e.done].join('+')}`),
      tripped: s.playerSlots.map(sl => sl.character.isTripped()),
      itemAction: s.playerSlots[0].character.getItemActionState?.()?.plan.action ?? null,
      ammo: s.inventoriesByPlayerIndex.get(dk.playerIndex)?.getHeldItem()?.getAmmo() ?? null,
      shooting: (st => st ? `${st.phase}@${st.age}:${st.charge}:${st.shots}` : null)(s.playerSlots[0].character.getItemShootingState?.()),
      projectiles: s.projectiles.map(p => `${p.id}:${p.moveId}:${p.x.toFixed(2)},${p.y.toFixed(2)}`) });
  }
  const controller = s.getRecordingController(); controller.stop();
  return { trace, actions, pickedAt,healingContacts, replay: controller.buildReplayJson(), meta: s.getMatchStartMetadata?.() ?? null };
}, { matchConfig, FRAMES, ITEM });
await page.screenshot({ path: `${outDir}/live-final.png` });
await browser.close();
const replayFile = `${outDir}/${ITEM}-match.replay.json`;
await writeFile(replayFile, live.replay);
await writeFile(`${outDir}/live-trace.json`, JSON.stringify(live.trace));

execFileSync('node', ['tools/replay-resim.mjs', replayFile, `${outDir}/resim`], {
  stdio: 'inherit', env: { ...process.env, PF_REWORK_URL: url } });
const resim = JSON.parse(await readFile(`${outDir}/resim/trace.json`, 'utf8'));
const resimSummary=JSON.parse(await readFile(`${outDir}/resim/summary.json`,'utf8'));
const key = st => JSON.stringify({ frame: st.frame, stocks: st.stocks, itemStates: st.itemStates, projectiles: st.projectiles,
  explosions: st.explosions, ammo: st.ammo,
  players: st.players.map(({ x, y, vx, vy, dmg, attack, held,healing,eating }) => ({ x, y, vx, vy, dmg, attack, held,healing,eating })) });
const byFrame = new Map(resim.map(st => [st.frame, key(st)]));
const compared = live.trace.filter(st => byFrame.has(st.frame));
const firstMismatch = compared.find(st => byFrame.get(st.frame) !== key(st)) ?? null;
const batFrames = live.trace.filter(st => st.players[0].held === ITEM).length;
const batAttacks = [...new Set(live.trace.map(st => st.players[0].attack?.split('@')[0]).filter(a => a?.startsWith(`item.${ITEM}`)))];
// Stars: distinct projectile ids seen, and the held item's ammo at each step boundary.
const shots = [...new Set(live.trace.flatMap(st => st.projectiles.map(p => p.split(':').slice(0, 2).join(':'))))];
const ammoTrail = live.trace.filter((st, i) => i === 0 || st.ammo !== live.trace[i - 1].ammo).map(st => [st.frame, st.ammo]);
const itemActions = [...new Set(live.trace.map(st => st.itemAction).filter(Boolean))];
// A catch = the bat goes from flying/falling straight to held without a ground pickup action.
const catches = live.trace.filter((st, i) => i > 0 && st.players[0].held === ITEM && live.trace[i - 1].players[0].held !== ITEM
  && !String(live.trace[i - 1].itemAction ?? '').startsWith('pickup')).map(st => st.frame);
// Phase 5: explosions (each new one: its first frame, centre and the fighters it hit), Bob-omb walks, banana slips (P2 trips).
const explosionsSeen = live.trace.flatMap((st, i) => (st.explosions ?? []).filter(e => !(live.trace[i - 1]?.explosions ?? [])
  .some(o => o.split(':')[0] === e.split(':')[0])).map(e => ({ frame: st.frame, at: e.split(':')[0] })));
const walkingFrames = live.trace.filter(st => st.itemStates.some(s => s.includes(':walking@'))).length;
const flashingFrames = live.trace.filter(st => st.itemStates.some(s => s.includes(':flashing@'))).length;
const p2Trips = live.trace.filter((st, i) => i > 0 && st.tripped?.[1] && !live.trace[i - 1].tripped?.[1]).map(st => st.frame);
const hammerContactFrames=live.trace.filter(st=>st.itemStates.some(s=>/"contactFrames":\{"\d+":/.test(s))).length;
const report = {
  scope: 'Production preview match; DK inputs SIMULATED through the CPU-controller hook (scripted), recorded by the scene RecordingController, re-simulated by tools/replay-resim.mjs in a fresh page.',
  url, engineVersion: live.meta?.engineVersion ?? null, matchConfig, frames: live.trace.length, pickedAt: live.pickedAt, actions: live.actions,
  item: ITEM, explosionsSeen, walkingFrames, flashingFrames, p2Trips, heldFrames: batFrames, itemAttacks: batAttacks, itemActions, catches, shots, ammoTrail, comparedFrames: compared.length, identical: compared.length > 0 && firstMismatch === null,
  firstMismatch: firstMismatch && { live: JSON.parse(key(firstMismatch)), resim: JSON.parse(byFrame.get(firstMismatch.frame)) },
  healingFrames:live.trace.filter(st=>st.players[0].healing).length,eatingFrames:live.trace.filter(st=>st.players.some(p=>p.eating)).length,
  healingContactFrames:new Set(live.healingContacts.map(h=>h.frame)).size,recoveryContactEvents:live.healingContacts,
  damageDrops:live.trace.filter((st,i)=>i>0&&st.players[0].dmg<live.trace[i-1].players[0].dmg&&st.stocks[0]===live.trace[i-1].stocks[0]&&(st.players[0].healing||live.trace[i-1].players[0].healing||st.players[0].eating?.consumed)).length,
  donkeykongDamagePeak:Math.max(...live.trace.map(st=>st.players[0].dmg)),
  pikachuDamageEnd: live.trace.at(-1)?.players[1].dmg ?? null, pikachuDamagePeak:Math.max(...live.trace.map(st=>st.players[1].dmg)),hammerContactFrames,pageErrors,
};
report.damageBeforeFirstPickup=live.trace.find(st=>st.frame>=(live.pickedAt??Infinity)-1)?.players[0].dmg??null;
report.acceptance={sameEngine:live.meta?.engineVersion===resimSummary.engineVersionNow,resimClean:resimSummary.pageErrors.length===0,injuredBeforePickup:!recoveryItem||(report.damageBeforeFirstPickup??0)>0,full2400:report.frames===2400&&report.comparedFrames===2400,nonzeroRecovery:!recoveryItem||report.damageDrops>0,gradualBudgetExercised:!['heartContainer','maximTomato'].includes(ITEM)||report.healingFrames>10,damageDuringHealing:!['heartContainer','maximTomato'].includes(ITEM)||report.healingContactFrames>0};
report.accepted=report.identical&&Object.values(report.acceptance).every(Boolean)&&report.pageErrors.length===0;
await writeFile(`${outDir}/items-replay-check.json`, `${JSON.stringify(report, null, 1)}\n`);
console.log(JSON.stringify({ ...report, firstMismatch: report.firstMismatch ? 'see json' : null }, null, 1));

if(!report.accepted)process.exitCode=1;
