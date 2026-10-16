import {openMatchHost} from './browser-match-host.mjs';
// Link playable probe (maintained; derived from the 2026-10-14 link-takeover triage probe).
// Diagnostic: records per-scenario metrics, asserts nothing, exit code 0 unless the harness dies.
// ALL INPUT IS SIMULATED at the DeviceInputDispatcher (sampleActions / sampleMoveX / sampleMoveY /
// sampleSmash) per fixed step; no keyboard, no gamepad. The real InputResolver.update derives edges
// and the shield + stick `dodge` chord (overriding isActionHeld bypassed it, so shield + side/down
// never rolled or spot-dodged; B3 diagnosis 2026-10-15). Record key `dodge` = direct dodge button.
// Usage: node tools/link-playable-probe.mjs --out <dir> [--shots] [--url <url>] [--set 1|2] [--only <substr>]
//   needs a running preview (default http://127.0.0.1:4173/platform-fighter/). Writes <dir>/report.json
//   (+ PNGs with --shots). Expectations: tools/link-playable-expectations.json (SmashWiki damage per normal).
// Per scenario: invisibleFrames, hurtbox min/max, contacts (damage, angle), articles (spawned, lifetime), errors.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const arg = (n, d) => { const k = process.argv.indexOf(`--${n}`); return k < 0 ? d : process.argv[k + 1]; };
const flag = n => process.argv.includes(`--${n}`);
const out = arg('out');
if (!out) { console.error('usage: node tools/link-playable-probe.mjs --out <dir> [--shots] [--url <url>] [--set 1|2] [--only <substr>]'); process.exit(2); }
const PASS = arg('set', '1');
const SHOTS = flag('shots');
const ONLY = arg('only', null);
const WARM = 240; // wait out the match-start entry lock (Link is not actionable for ~140 frames)
const EXPECT = JSON.parse(await readFile(new URL('./link-playable-expectations.json', import.meta.url), 'utf8'));
await mkdir(out, { recursive: true });
const url = arg('url', 'http://127.0.0.1:4173/platform-fighter/');
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const report = { url, inputMode: 'SIMULATED (DeviceInputDispatcher overrides; real InputResolver)', pageErrors: [], consoleErrors: [], failedRequests: [], boot: {}, scenarios: [] };
page.on('pageerror', e => report.pageErrors.push({ at: report.current ?? 'boot', message: e.message, stack: (e.stack ?? '').split('\n').slice(0, 6).join('\n') }));
page.on('console', m => { if (m.type() === 'error' && report.consoleErrors.length < 200) report.consoleErrors.push({ at: report.current ?? 'boot', text: m.text().slice(0, 500) }); });
page.on('requestfailed', r => report.failedRequests.push(r.url()));
const save = () => writeFile(`${out}/report.json`, JSON.stringify(report, null, 1));

// ---- in-page harness ----------------------------------------------------
async function installHarness(opts = {}) {
  return page.evaluate(async (opts) => {
    const sw = {};
    for (const t of ['homeRunBat','beamSword','hammer','rayGun','bobOmb','crate','starRod','superScope','fireFlower','bananaPeel','goldenHammer','food','heartContainer','maximTomato','barrel','capsule','smashBall'])
      sw[t] = opts.item ? t === opts.item : false;
    await window.__launchProbeMatch({ mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 1014,
      itemFrequency: opts.item ? 'low' : 'off', itemSwitch: sw, players: [
        { index: 1, characterId: 'link', paletteIndex: 0, inputType: 'keyboard_p1' },
        { index: 2, characterId: 'donkeykong', paletteIndex: 0, inputType: 'keyboard_p2' }] });
    const s = window.__sim.match;
    if (!s.p1 || !s.p2) return { ok: false, why: 'MatchScene did not create p1/p2 synchronously', keys: Object.keys(s).length };
    s.physicsEngine.pause(); s.roundStartCountdown = 0;
    let input = {}, victim = {};
    // Simulate the device layer only; InputResolver.update stays real (edges, dodge chord).
    const rec = p => (p === 1 ? input : victim), disp = s.inputResolver.dispatcher;
    disp.sampleActions = p => { const i = rec(p), x = i.moveX ?? 0, y = i.moveY ?? 0;
      return { left: x <= -0.5, right: x >= 0.5, up: y <= -0.5, down: y >= 0.5, jump: i.jump === true, attack: i.attack === true,
        special: i.special === true, shield: i.shield === true, grab: i.grab === true, taunt: i.dodge === true,
        smash: i.smash === true, appeal: false, walk: false }; };
    disp.sampleMoveX = p => rec(p).moveX ?? 0;
    disp.sampleMoveY = p => rec(p).moveY ?? 0;
    disp.sampleSmash = p => { const held = rec(p).smash === true; return { held, buttonHeld: held, fromStick: false, x: 0, y: 0 }; };
    const a = s.p1, d = s.p2, slot = s.playerSlots[0];
    const floor = s.baseStage.bodies.platformBodies.find(b => b.label === 'platform.solid');
    const contacts = [], itemShots = []; const H = { s, a, d, floor, contacts, itemShots, frame: 0 };
    // Shot-origin readout: every item shot Link's consumeItemShots hands MatchScene, relative to Link's body centre,
    // with the held socket and the held item's drawn height at that moment (the drawn muzzle is
    // heldItemSocket.ts heldItemMuzzle(socket, visual); this probe records the inputs, it does not recompute it).
    const consumeShots = a.consumeItemShots.bind(a);
    a.consumeItemShots = () => { const events = consumeShots(), p = a.getPosition(), k = a.getHeldItemSocket(),
      visual = a.getEquippedItem()?.definition?.visual;
      for (const e of events) itemShots.push({ frame: H.frame, id: e.shot.id, origin: { x: +(e.x - p.x).toFixed(1), y: +(e.y - p.y).toFixed(1) },
        socket: { x: +(k.x - p.x).toFixed(1), y: +(k.y - p.y).toFixed(1), angle: k.angle, length: k.length },
        itemHeight: visual?.height ?? null, facing: e.facing });
      return events; };
    const apply = d.applyHitDetailed?.bind(d);
    if (apply) d.applyHitDetailed = hit => { const r = apply(hit);
      contacts.push({ frame: H.frame, moveId: hit?.moveId ?? hit?.move?.id ?? hit?.attackId ?? null, damage: hit?.damage ?? null,
        angle: hit?.knockback?.reference?.angle ?? hit?.angle ?? null, result: (() => { try { return JSON.parse(JSON.stringify(r ?? null, (k, v) => typeof v === 'object' && v && v.constructor && /Body|Character|Scene/.test(v.constructor.name) ? undefined : v)); } catch { return String(r); } })() });
      return r; };
    const safe = f => { try { return f(); } catch (e) { return { error: String(e.message ?? e) }; } };
    const small = v => { try { return JSON.parse(JSON.stringify(v ?? null, (k, x) => (typeof x === 'object' && x && (x.constructor?.name?.match(/Body|Character|Scene|Sprite|Map/) )) ? undefined : x)); } catch { return '[unserialisable]'; } };
    const read = () => {
      const sp = window.__sim.presentation(slot.playerIndex), pose = safe(() => a.getPackedBodyState()), aa = a.getActiveAttack();
      const rendered = window.__sim.view();
      const dp = d.getPosition(), dv = d.getVelocity();
      return { f: H.frame, x: +a.getPosition().x.toFixed(1), y: +a.getPosition().y.toFixed(1), vx: +a.getVelocity().x.toFixed(2), vy: +a.getVelocity().y.toFixed(2),
        hurt: safe(() => a.getActiveHurtboxes().length),
        g: a.isGrounded(), face: a.getFacing(),
        atk: aa ? `${aa.move.id}:${aa.phase}:${aa.framesElapsed}` : null,
        anim: safe(() => String(a.getCurrentAnimation())), sm: safe(() => sp?.art?.key ?? null),
        pose: pose && !pose.error ? { clock: pose.clock, committed: pose.committed, intrinsic: pose.intrinsic, tail: pose.tail } : (pose?.error ? pose : null),
        spr: sp ? { vis: sp.visible, a: sp.alpha ?? 1, key: sp.key, fr: sp.frame, w: sp.frameWidth, h: sp.frameHeight, x: Math.round(sp.x), y: Math.round(sp.y) } : null,
        shield: a.shieldState ? `${a.shieldState.name}:${Math.round(a.shieldState.health)}` : null,
        dodge: a.dodgeState ? `${a.dodgeState.name}${a.dodgeState.active ? ':' + (a.dodgeState.active.variant ?? a.dodgeState.active.kind ?? '') : ''}` : null,
        ledge: a.ledgeHangState?.name ?? null,
        grab: safe(() => { const g = a.getGrabState(); return g?.phase ?? g?.kind ?? g?.state ?? small(g); }),
        charge: safe(() => a.getChargeProgress()),
        helpless: safe(() => a.isHelpless()),
        p2: { pct: +d.getDamagePercent().toFixed(2), x: Math.round(dp.x), y: Math.round(dp.y), vx: +dv.x.toFixed(2), vy: +dv.y.toFixed(2), grabbed: safe(() => d.isGrabbed()), hitstun: safe(() => d.getHitstunRemaining()) },
        // Link's articles ride the generic paths (src/match/linkArticles.ts): arrows/boomerangs are projectiles, the bomb an item.
        arts: { arrows: s.projectiles?.filter(p => p.link?.kind === 'arrow').length ?? null, boomerangs: s.projectiles?.filter(p => p.link?.kind === 'boomerang').length ?? null,
          bombs: s.itemRegistry?.getActive().filter(e => e.definition.generated?.kind === 'link-remote-bomb').length ?? null,
          blasts: s.itemExplosions?.filter(e => e.moveId === 'item.link-remote-bomb.explosion').length ?? null,
          beams: rendered.projectiles.filter(p => p.visualRecipe?.kind === 'sword-beam').length,
          arrowItems: s.itemRegistry?.getActive().filter(e => e.definition.generated?.kind === 'link-arrow').length ?? null,
          projectiles: s.projectiles?.length ?? s.activeProjectiles?.length ?? null,
          articleSprites: rendered.projectiles.filter(p => p.visualRecipe?.kind === 'link-arrow' || p.visualRecipe?.kind === 'link-boomerang').length },
        articleView: s.projectiles?.filter(p => p.link).map(p => ({ kind: p.link.kind, x: Math.round(p.x), y: Math.round(p.y), dmg: +p.damage.toFixed(2) })),
        deps: s.linkArticleRenderDependencies?.size ? [...s.linkArticleRenderDependencies.values()].map(v => v.dependency).slice(0, 4) : undefined,
        item: safe(() => { const it = a.getEquippedItem(); return it ? (it.definition?.type ?? it.type ?? 'held') : null; }),
        fs: safe(() => { const r = s.finalSmashController?.getActive(); return r ? `${r.owner?.fighter}:${r.phase}:${r.phaseAge}` : null; }) };
    };
    const step = (i = {}, v = {}) => { input = i; victim = v; H.frame++; s.physicsEngine.resume(); s.update(0, s.physicsEngine.fixedTimestepMs); s.physicsEngine.pause(); return read(); };
    const groundY = () => floor.bounds.min.y - a.getTuning().height / 2;
    const reset = ({ dist = 90, facing = 1, air = 0, dAir = 0, dx = 0 } = {}) => {
      contacts.length = 0; itemShots.length = 0; input = {}; victim = {};
      const cx = floor.position.x + dx;
      a.resetForRound(cx, groundY() - air); a.setFacing?.(facing);
      d.resetForRound(cx + dist * facing, floor.bounds.min.y - d.getTuning().height / 2 - dAir); d.setFacing?.(-facing);
      if (typeof d.setDamagePercent === 'function') d.setDamagePercent(0); else d.damagePercent = 0;
      const rows = []; for (let i = 0; i < 10; i++) rows.push(step());
      return { grounded: a.isGrounded(), row: rows.at(-1), floor: { minX: floor.bounds.min.x, maxX: floor.bounds.max.x, top: floor.bounds.min.y } };
    };
    let lockFrames = null; const x0 = a.getPosition().x;
    if (opts.warmup) { for (let k = 0; k < opts.warmup; k++) { const r = step({ moveX: k % 2 ? 0.0 : 0.0 }); if (lockFrames === null && a.isGrounded() && r.spr?.vis) lockFrames = k + 1; } }
    H.lockFrames = lockFrames;
    window.__H = { H, read, step, reset, small, safe,
      run: (segments) => { const rows = []; for (const seg of segments) for (let n = 0; n < (seg.n ?? 1); n++) rows.push(step(seg.i ?? {}, seg.v ?? {})); return rows; },
      contacts: () => contacts.slice(),
      itemShots: () => itemShots.slice(),
    };
    return { ok: true, lockFrames, p1Id: a.id, p2Id: d.id, tuning: small(a.getTuning()), linkClass: a.constructor?.name, firstRead: read(),
      moveIds: safe(() => ({ light: a.getLightAttackId(), tilt: a.getTiltAttackId(), utilt: a.getUpTiltId(), dtilt: a.getDownTiltId(), heavy: a.getHeavyAttackId(), usmash: a.getUpSmashId(), dsmash: a.getDownSmashId(), dash: a.getDashAttackId(),
        nair: a.getAerialNeutralId(), fair: a.getAerialForwardId(), bair: a.getAerialBackId(), uair: a.getAerialUpId(), dair: a.getAerialDownId(), nspec: a.getNeutralSpecialId(), sspec: a.getSideSpecialId(), uspec: a.getUpSpecialId(), dspec: a.getDownSpecialId() })) };
  }, opts);
}

// spawned = rising edges of the per-frame count; lifetimeFrames = frames with count > 0 (longest run).
function articleStats(rows) {
  const res = {};
  for (const k of ['arrows', 'boomerangs', 'bombs', 'blasts', 'beams', 'arrowItems']) {
    let spawned = 0, prev = 0, run = 0, longest = 0, total = 0;
    for (const r of rows) { const c = r.arts[k] ?? 0; if (c > prev) spawned += c - prev; prev = c; if (c > 0) { run++; total++; longest = Math.max(longest, run); } else run = 0; }
    res[k] = { spawned, longestLifetimeFrames: longest, framesAlive: total };
  }
  return res;
}
// Multiset match of observed contact damage against the SmashWiki table (tolerance in %).
function compare(name, contacts) {
  const exp = EXPECT.scenarios[name];
  if (!exp) return null;
  const left = contacts.map(c => c.damage).filter(Number.isFinite);
  const missing = [];
  for (const e of exp.damage) {
    const k = left.findIndex(d => Math.abs(d - e) <= e * EXPECT.tolerancePct / 100);
    if (k < 0) missing.push(e); else left.splice(k, 1);
  }
  return { expected: exp.damage, observed: contacts.map(c => c.damage), missing, result: missing.length ? 'MISMATCH' : 'MATCH' };
}

function summarize(name, rows, contacts, extra = {}) {
  const atks = [...new Set(rows.map(r => r.atk?.split(':')[0]).filter(Boolean))];
  const anims = [...new Set(rows.map(r => typeof r.anim === 'string' ? r.anim : JSON.stringify(r.anim)))];
  const sms = [...new Set(rows.map(r => typeof r.sm === 'string' ? r.sm : JSON.stringify(r.sm)))].slice(0, 12);
  const invisible = rows.filter(r => !r.spr?.vis || !r.pose).length;
  const keys = [...new Set(rows.map(r => `${r.spr?.key}`))];
  const p2max = Math.max(0, ...rows.map(r => r.p2.pct));
  const p2peakV = Math.max(0, ...rows.map(r => Math.hypot(r.p2.vx, r.p2.vy)));
  const deps = [...new Set(rows.flatMap(r => r.deps ?? []))].slice(0, 6);
  return { name, frames: rows.length, attacks: atks, anims: anims.slice(0, 12), spriteStates: sms, framesWithoutPoseOrInvisible: invisible, textureKeys: keys,
    contacts: contacts.length, contactSample: contacts.slice(0, 4), p2MaxPct: p2max, p2PeakSpeed: +p2peakV.toFixed(2),
    shieldStates: [...new Set(rows.map(r => JSON.stringify(r.shield)))].slice(0, 6), dodgeStates: [...new Set(rows.map(r => JSON.stringify(r.dodge)))].slice(0, 6),
    ledgeStates: [...new Set(rows.map(r => JSON.stringify(r.ledge)))].slice(0, 6), grabStates: [...new Set(rows.map(r => JSON.stringify(r.grab)))].slice(0, 8),
    articles: { maxArrows: Math.max(0, ...rows.map(r => r.arts.arrows ?? 0)), maxBoomerangs: Math.max(0, ...rows.map(r => r.arts.boomerangs ?? 0)), maxBombs: Math.max(0, ...rows.map(r => r.arts.bombs ?? 0)), maxBlasts: Math.max(0, ...rows.map(r => r.arts.blasts ?? 0)), maxBeams: Math.max(0, ...rows.map(r => r.arts.beams ?? 0)), maxArticleSprites: Math.max(0, ...rows.map(r => r.arts.articleSprites ?? 0)) },
    articleRenderDependencies: deps, items: [...new Set(rows.map(r => JSON.stringify(r.item)))], finalSmash: [...new Set(rows.map(r => r.fs).filter(Boolean))].slice(0, 12),
    invisibleFrames: invisible,
    hurtboxes: (() => { const h = rows.map(r => r.hurt).filter(Number.isFinite); return { min: h.length ? Math.min(...h) : null, max: h.length ? Math.max(...h) : null }; })(),
    contactList: contacts.map(c => ({ frame: c.frame, moveId: c.moveId, damage: c.damage, angle: c.angle })),
    articleStats: articleStats(rows),
    articleTrack: rows.filter(r => r.articleView?.length).filter((_, i) => i % 8 === 0).slice(0, 25).map(r => ({ f: r.f, a: r.articleView })),
    expectation: compare(name, contacts),
    minY: Math.min(...rows.map(r => r.y)), ...extra };
}

// Scenario: setup + segments. `shot` takes a screenshot after that many frames.
const T = { attack: true }, F = 1;
const tap = (i, hold = 1, after = 50) => [{ i, n: hold }, { n: after }];
const air = (i) => [{ i: { jump: true }, n: 1 }, { n: 7 }, { i, n: 1 }, { n: 60 }];
const S = [
  { name: 'idle', setup: { dist: 200 }, seg: [{ n: 30 }], shot: 20 },
  { name: 'walk/run', setup: { dist: 300, dx: -200 }, seg: [{ i: { moveX: 1 }, n: 30 }], shot: 20 },
  { name: 'jump', setup: { dist: 300 }, seg: [{ i: { jump: true }, n: 12 }, { n: 60 }], shot: 15 },
  { name: 'jab1', setup: { dist: 60 }, seg: tap(T), shot: 6 },
  { name: 'jab123', setup: { dist: 60 }, seg: [{ i: T }, { n: 6 }, { i: T }, { n: 6 }, { i: T }, { n: 6 }, { i: T }, { n: 60 }], shot: 20 },
  { name: 'ftilt', setup: { dist: 80 }, seg: [{ i: { moveX: .5 }, n: 1 }, { i: { moveX: .5, attack: true } }, { n: 50 }], shot: 14 },
  { name: 'utilt', setup: { dist: 50 }, seg: [{ i: { moveY: -.5 }, n: 1 }, { i: { moveY: -.5, attack: true } }, { n: 50 }], shot: 10 },
  { name: 'dtilt', setup: { dist: 80 }, seg: [{ i: { moveY: 1 }, n: 4 }, { i: { moveY: 1, attack: true } }, { n: 40 }], shot: 14 },
  { name: 'dash attack', setup: { dist: 260, dx: -150 }, seg: [{ i: { moveX: 1 }, n: 14 }, { i: { moveX: 1, attack: true } }, { n: 60 }], shot: 24 },
  { name: 'fsmash (uncharged)', setup: { dist: 90 }, seg: [{ i: { moveX: 1, smash: true }, n: 1 }, { n: 70 }], shot: 16 },
  { name: 'fsmash2 follow-up', setup: { dist: 90 }, seg: [{ i: { moveX: 1, smash: true }, n: 1 }, { n: 20 }, { i: { attack: true }, n: 1 }, { n: 60 }], shot: 30 },
  { name: 'fsmash charged 60f', setup: { dist: 90 }, seg: [{ i: { moveX: 1, smash: true }, n: 70 }, { n: 70 }], shot: 40 },
  { name: 'usmash', setup: { dist: 40 }, seg: [{ i: { moveY: -1, smash: true }, n: 1 }, { n: 70 }], shot: 14 },
  { name: 'dsmash', setup: { dist: 70 }, seg: [{ i: { moveY: 1, smash: true }, n: 1 }, { n: 70 }], shot: 10 },
  { name: 'nair', setup: { dist: 60, dAir: 0 }, seg: air(T), shot: 14 },
  { name: 'fair', setup: { dist: 70 }, seg: air({ moveX: 1, attack: true }), shot: 22 },
  { name: 'bair', setup: { dist: 70, facing: -1 }, seg: air({ moveX: 1, attack: true }), shot: 18, note: 'facing -1, stick +x = back' },
  { name: 'uair', setup: { dist: 30 }, seg: air({ moveY: -1, attack: true }), shot: 20 },
  { name: 'dair', setup: { dist: 30 }, seg: [{ i: { jump: true }, n: 1 }, { n: 14 }, { i: { moveY: 1, attack: true } }, { n: 70 }], shot: 30 },
  { name: 'neutral-B bow tap', setup: { dist: 300 }, seg: [{ i: { special: true }, n: 1 }, { n: 90 }], shot: 20 },
  { name: 'neutral-B bow full charge', setup: { dist: 300 }, seg: [{ i: { special: true }, n: 80 }, { n: 90 }], shot: 85 },
  { name: 'side-B boomerang', setup: { dist: 250 }, seg: [{ i: { moveX: 1, special: true }, n: 1 }, { n: 140 }], shot: 40 },
  { name: 'up-B ground spin', setup: { dist: 60 }, seg: [{ i: { moveY: -1, special: true }, n: 1 }, { n: 100 }], shot: 14 },
  { name: 'up-B air recovery', setup: { dist: 300, air: 200 }, seg: [{ i: { moveY: -1, special: true }, n: 1 }, { n: 130 }], shot: 20 },
  { name: 'down-B bomb pull + throw', setup: { dist: 200 }, seg: [{ i: { moveY: 1, special: true }, n: 1 }, { n: 40 }, { i: { moveX: 1, attack: true } }, { n: 40 }], shot: 30 },
  { name: 'down-B bomb pull + detonate', setup: { dist: 200 }, seg: [{ i: { moveY: 1, special: true }, n: 1 }, { n: 40 }, { i: { moveX: 1, attack: true } }, { n: 20 }, { i: { moveY: 1, special: true } }, { n: 60 }], shot: 63 },
  // B1 article evidence: the blast drawn at its radius, and a tapped arrow stuck in the floor as a pickup arrow.
  { name: 'down-B bomb throw + detonate (blast)', setup: { dist: 200 }, seg: [{ i: { moveY: 1, special: true } }, { n: 40 }, { i: { moveX: 1, attack: true } }, { n: 30 }, { i: { moveY: 1, special: true } }, { n: 40 }], shot: 86 },
  { name: 'neutral-B bow tap (arrow sticks)', setup: { dist: 400 }, seg: [{ i: { special: true } }, { n: 120 }], shot: 40 },
  { name: 'grab (standing)', setup: { dist: 55 }, seg: [{ i: { grab: true } }, { n: 40 }], shot: 12 },
  { name: 'grab + pummel', setup: { dist: 55 }, seg: [{ i: { grab: true } }, { n: 20 }, { i: T }, { n: 30 }], shot: 26 },
  { name: 'grab + fthrow', setup: { dist: 55 }, seg: [{ i: { grab: true } }, { n: 20 }, { i: { moveX: 1 } }, { n: 60 }], shot: 30 },
  { name: 'grab + bthrow', setup: { dist: 55 }, seg: [{ i: { grab: true } }, { n: 20 }, { i: { moveX: -1 } }, { n: 60 }], shot: 30 },
  { name: 'grab + uthrow', setup: { dist: 55 }, seg: [{ i: { grab: true } }, { n: 20 }, { i: { moveY: -1 } }, { n: 60 }], shot: 30 },
  { name: 'grab + dthrow', setup: { dist: 55 }, seg: [{ i: { grab: true } }, { n: 20 }, { i: { moveY: 1 } }, { n: 60 }], shot: 30 },
  { name: 'dash grab', setup: { dist: 260, dx: -150 }, seg: [{ i: { moveX: 1 }, n: 14 }, { i: { moveX: 1, grab: true } }, { n: 40 }], shot: 20 },
  { name: 'shield hold', setup: { dist: 300 }, seg: [{ i: { shield: true }, n: 40 }, { n: 20 }], shot: 20 },
  { name: 'shield vs DK jab', setup: { dist: 70 }, seg: [{ i: { shield: true }, n: 6 }, { i: { shield: true }, v: { attack: true } }, { i: { shield: true }, n: 30 }, { n: 10 }], shot: 12 },
  { name: 'spot dodge', setup: { dist: 300 }, seg: [{ i: { shield: true }, n: 3 }, { i: { shield: true, moveY: 1 }, n: 2 }, { n: 40 }], shot: 8 },
  { name: 'roll forward', setup: { dist: 300 }, seg: [{ i: { shield: true }, n: 3 }, { i: { shield: true, moveX: 1 }, n: 2 }, { n: 40 }], shot: 10 },
  { name: 'dodge button (ground)', setup: { dist: 300 }, seg: [{ i: { dodge: true }, n: 1 }, { n: 40 }], shot: 8 },
  { name: 'air dodge', setup: { dist: 300 }, seg: [{ i: { jump: true }, n: 1 }, { n: 10 }, { i: { dodge: true } }, { n: 60 }], shot: 16 },
  { name: 'taunt (appeal)', setup: { dist: 300 }, seg: [{ n: 2 }], shot: 1, skip: true },
  { name: 'DK hits Link (hurt state)', setup: { dist: 70 }, seg: [{ n: 2 }, { v: { moveX: -1, smash: true }, n: 1 }, { n: 60 }], shot: 30, observeLinkDamage: true },
];
// Pass 2: re-run what pass 1 could not judge (match-start lock, wrong setups).
const S2 = [
  { name: 'idle', setup: { dist: 200 }, seg: [{ n: 60 }], shot: 30 },
  { name: 'walk (stick .4)', setup: { dist: 400, dx: -250 }, seg: [{ i: { moveX: .4 }, n: 40 }], shot: 20 },
  { name: 'dash/run', setup: { dist: 400, dx: -250 }, seg: [{ i: { moveX: 1 }, n: 40 }, { n: 20 }], shot: 25 },
  { name: 'turnaround', setup: { dist: 400 }, seg: [{ i: { moveX: -1 }, n: 10 }, { n: 20 }], shot: 4 },
  { name: 'crouch', setup: { dist: 300 }, seg: [{ i: { moveY: 1 }, n: 30 }], shot: 15 },
  { name: 'full hop', setup: { dist: 300 }, seg: [{ i: { jump: true }, n: 12 }, { n: 60 }], shot: 15 },
  { name: 'short hop + double jump', setup: { dist: 300 }, seg: [{ i: { jump: true } }, { n: 15 }, { i: { jump: true } }, { n: 70 }], shot: 25 },
  { name: 'jab chain mash every 4f', setup: { dist: 60 }, seg: Array.from({ length: 10 }, () => [{ i: T }, { n: 3 }]).flat().concat([{ n: 40 }]), shot: 22 },
  { name: 'jab chain hold attack', setup: { dist: 60 }, seg: [{ i: T, n: 60 }, { n: 30 }], shot: 30 },
  ...[8, 14, 20, 26].map(k => ({ name: `fsmash2 press at +${k}`, setup: { dist: 90 }, seg: [{ i: { moveX: 1, smash: true } }, { n: k - 1 }, { i: T }, { n: 70 }], shot: 40 })),
  { name: 'bair (DK behind)', setup: { dist: -60 }, seg: [{ i: { jump: true } }, { n: 7 }, { i: { moveX: -1, attack: true } }, { n: 60 }], shot: 14 },
  { name: 'uair (DK jumps above)', setup: { dist: 15 }, seg: [{ v: { jump: true }, n: 6 }, { i: { jump: true } }, { n: 4 }, { i: { moveY: -1, attack: true } }, { n: 60 }], shot: 20 },
  { name: 'dair (from full hop over DK)', setup: { dist: 30 }, seg: [{ i: { jump: true, moveX: .3 }, n: 12 }, { n: 4 }, { i: { moveY: 1, attack: true } }, { n: 70 }], shot: 26 },
  { name: 'bow tap', setup: { dist: 300 }, seg: [{ i: { special: true } }, { n: 90 }], shot: 30 },
  { name: 'bow hold 70f then release', setup: { dist: 300 }, seg: [{ i: { special: true }, n: 70 }, { n: 90 }], shot: 80 },
  { name: 'boomerang', setup: { dist: 250 }, seg: [{ i: { moveX: 1, special: true } }, { n: 150 }], shot: 40 },
  { name: 'spin attack ground (DK close)', setup: { dist: 50 }, seg: [{ i: { moveY: -1, special: true } }, { n: 100 }], shot: 15 },
  { name: 'bomb pull, then down-B again', setup: { dist: 200 }, seg: [{ i: { moveY: 1, special: true } }, { n: 60 }, { i: { moveY: 1, special: true } }, { n: 60 }], shot: 50 },
  { name: 'shield', setup: { dist: 300 }, seg: [{ i: { shield: true }, n: 40 }, { n: 20 }], shot: 20 },
  { name: 'shield vs DK fsmash', setup: { dist: 80 }, seg: [{ i: { shield: true }, n: 4 }, { i: { shield: true }, v: { moveX: -1, smash: true } }, { i: { shield: true }, n: 40 }, { n: 10 }], shot: 20 },
  { name: 'spot dodge', setup: { dist: 300 }, seg: [{ i: { shield: true }, n: 3 }, { i: { shield: true, moveY: 1 }, n: 2 }, { n: 40 }], shot: 8 },
  { name: 'roll forward', setup: { dist: 300 }, seg: [{ i: { shield: true }, n: 3 }, { i: { shield: true, moveX: 1 }, n: 2 }, { n: 40 }], shot: 10 },
  { name: 'roll back', setup: { dist: 300 }, seg: [{ i: { shield: true }, n: 3 }, { i: { shield: true, moveX: -1 }, n: 2 }, { n: 40 }], shot: 10 },
  { name: 'dodge button', setup: { dist: 300 }, seg: [{ i: { dodge: true } }, { n: 40 }], shot: 8 },
  { name: 'air dodge', setup: { dist: 300 }, seg: [{ i: { jump: true } }, { n: 10 }, { i: { dodge: true } }, { n: 60 }], shot: 16 },
  { name: 'Link hurt + tumble (DK fsmash)', setup: { dist: 70 }, seg: [{ v: { moveX: -1, smash: true } }, { n: 80 }], shot: 40, observeLinkDamage: true },
];
const SCEN = PASS === '2' ? S2 : S;

try {
  const t0 = Date.now();
  const bundle=await openMatchHost(page,url);
  report.boot.msToMenu = Date.now() - t0;
  report.boot.bundle = bundle;
  report.boot.bundleSha256 = createHash('sha256').update(await (await page.request.get(bundle)).body()).digest('hex');
  report.boot.heapMB = await page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null);
  report.boot.renderer = 'Three.js / MatchSim';
  if (SHOTS) await page.screenshot({ path: `${out}/00-boot.png` });
  report.current = 'match-start-unpatched';
  try { const raw = await installHarness({ noBypass: true }); report.boot.unpatchedMatch = { ok: raw.ok, p1Id: raw.p1Id, p2Id: raw.p2Id, linkClass: raw.linkClass }; }
  catch (e) { report.boot.unpatchedMatch = { error: String(e.message ?? e).slice(0, 500) }; }
  report.current = 'match-start';
  const t1 = Date.now();
  report.boot.match = await installHarness({ warmup: WARM });
  report.boot.msMatchStart = Date.now() - t1;
  await save();
  if (!report.boot.match?.ok) throw new Error('match did not start');

  let idx = 1;
  for (const sc of SCEN) {
    if (sc.skip || (ONLY && !sc.name.includes(ONLY))) continue;
    report.current = sc.name;
    const errBefore = report.pageErrors.length;
    try {
      const setup = await page.evaluate(o => window.__H.reset(o), sc.setup);
      // Split segments at the screenshot frame.
      const flat = sc.seg.flatMap(seg => Array.from({ length: seg.n ?? 1 }, () => ({ i: seg.i ?? {}, v: seg.v ?? {} })));
      const a = flat.slice(0, sc.shot), b = flat.slice(sc.shot);
      const rowsA = await page.evaluate(segs => window.__H.run(segs), a);
      const shot = `${String(idx++).padStart(2, '0')}-${sc.name.replace(/[^a-z0-9]+/gi, '_')}.png`;
      if (SHOTS) { await page.waitForTimeout(60); await page.screenshot({ path: `${out}/${shot}` }); }
      const rowsB = await page.evaluate(segs => window.__H.run(segs), b);
      const contacts = await page.evaluate(() => window.__H.contacts());
      const rows = [...rowsA, ...rowsB];
      const linkDamage = sc.observeLinkDamage ? await page.evaluate(() => window.__H.H.a.getDamagePercent()) : undefined;
      report.scenarios.push({ ...summarize(sc.name, rows, contacts, { setupGrounded: setup.grounded, screenshot: SHOTS ? shot : null, linkDamage, note: sc.note }),
        newPageErrors: report.pageErrors.slice(errBefore).map(e => e.message), trace: rows.filter((r, k) => k % 3 === 0 || r.atk).slice(0, 80) });
    } catch (e) {
      report.scenarios.push({ name: sc.name, harnessError: String(e.message ?? e).slice(0, 800), newPageErrors: report.pageErrors.slice(errBefore).map(x => x.message) });
      // Recover: restart the match for the next scenario.
      try { await installHarness({ warmup: WARM }); } catch (e2) { report.scenarios.push({ name: 'restart-failed', error: String(e2) }); break; }
    }
    console.log(JSON.stringify({ s: sc.name, ...(({ attacks, contacts, p2MaxPct, framesWithoutPoseOrInvisible, harnessError }) => ({ attacks, contacts, p2MaxPct, framesWithoutPoseOrInvisible, harnessError }))(report.scenarios.at(-1)) }));
    await save();
  }

  // ---- Final Smash ---------------------------------------------------------
  report.current = 'final-smash';
  try {
    if (PASS === '2') await installHarness({ warmup: WARM }); else await page.evaluate(o => window.__H.reset(o), { dist: 120 });
    const grant = await page.evaluate(() => { const { s } = window.__H.H; const pi = s.playerSlots[0].playerIndex, fr = s.physicsEngine.getFrame();
      const before = { canOwn: s.finalSmashController?.canOwnResource(pi), rules: s.finalSmashController?.rules };
      const ev = s.finalSmashController.grantBall(pi, fr); s.consumeFinalEvents(ev, fr);
      return { pi, before, events: window.__H.small(ev), available: s.finalSmashController.getAvailableResource(pi), legallyActionable: s.p1.canActivateFinalSmash() }; });
    const rowsA = await page.evaluate(() => window.__H.run([{ n: 2 }, { i: { special: true } }, { n: 40 }]));
    if (SHOTS) await page.screenshot({ path: `${out}/90-final-smash-early.png` });
    const rowsB = await page.evaluate(() => window.__H.run([{ n: 120 }]));
    if (SHOTS) await page.screenshot({ path: `${out}/91-final-smash-late.png` });
    const rowsC = await page.evaluate(() => window.__H.run([{ n: 300 }]));
    const contacts = await page.evaluate(() => window.__H.contacts());
    const rows = [...rowsA, ...rowsB, ...rowsC];
    report.finalSmash = { grant, ...summarize('final-smash', rows, contacts), trace: rows.filter((r, k) => k % 6 === 0).slice(0, 90),
      finalPresentation: await page.evaluate(() => window.__H.small(window.__H.safe(() => window.__H.H.a.getFinalSmashPresentation()))),
      victimDeps: await page.evaluate(() => [...(window.__H.H.s.finalVictimFitDependencies?.values?.() ?? [])].slice(0, 5).map(x => window.__H.small(x))) };
  } catch (e) { report.finalSmash = { harnessError: String(e.message ?? e).slice(0, 800) }; }
  await save();

  // ---- Held items ----------------------------------------------------------
  // Target spacing (body centres) per item: inside the item's own swing reach. The Home-Run Bat's authored box ends
  // 64 px in front (HomeRunBat.ts BAT_HITBOX), so a Donkey Kong at 110 px is out of reach for every fighter; the
  // real-Matter parity test (src/items/linkHeldItems.physics.test.ts) hits it at 80 px (B4 diagnosis section 1).
  const ITEM_SPACING = { beamSword: 110, rayGun: 110, homeRunBat: 80, bobOmb: 110 };
  for (const item of ['beamSword', 'rayGun', 'homeRunBat', 'bobOmb']) {
    report.current = `item-${item}`;
    try {
      const h = await installHarness({ item, warmup: WARM });
      await page.evaluate(o => window.__H.reset(o), { dist: ITEM_SPACING[item] });
      const spawned = await page.evaluate(() => { const { s, a, floor } = window.__H.H, tr = s.baseStage.transform, sc = s.stage.scale, p = a.getPosition();
        let once = true; s.itemSpawnManager.step = frame => once ? (once = false, [{ frame, anchorIndex: 0, anchor: { x: (p.x + 20 - tr.offsetX) / sc, y: (floor.bounds.min.y - tr.offsetY) / sc }, spawnPosition: { x: (p.x + 20 - tr.offsetX) / sc, y: (floor.bounds.min.y - 30 - tr.offsetY) / sc } }]) : [];
        window.__H.run([{ n: 40 }]); const it = s.getItemRegistry().getActive().at(-1); return it ? { type: it.definition.type, state: it.getSnapshot?.().state } : null; });
      const pick = await page.evaluate(() => window.__H.run([{ i: { attack: true } }, { n: 20 }]));
      const use = await page.evaluate(() => window.__H.run([{ i: { attack: true } }, { n: 45 }, { i: { moveX: 1, smash: true } }, { n: 60 }]));
      if (SHOTS) await page.screenshot({ path: `${out}/95-item-${item}.png` });
      const thr = await page.evaluate(() => window.__H.run([{ i: { grab: true, moveX: 1 } }, { n: 50 }]));
      const contacts = await page.evaluate(() => window.__H.contacts());
      const itemShots = await page.evaluate(() => window.__H.itemShots());
      report.scenarios.push({ ...summarize(`item ${item}`, [...pick, ...use, ...thr], contacts), spawned, matchOk: h.ok, spacing: ITEM_SPACING[item], itemShots,
        heldAfterPickup: pick.at(-1)?.item, heldAfterThrow: thr.at(-1)?.item, trace: [...pick, ...use, ...thr].filter((r, k) => k % 3 === 0).slice(0, 70) });
    } catch (e) { report.scenarios.push({ name: `item ${item}`, harnessError: String(e.message ?? e).slice(0, 800) }); }
    await save();
  }

  // ---- Ledge ---------------------------------------------------------------
  report.current = 'ledge';
  try {
    await installHarness({ warmup: WARM });
    await page.evaluate(o => window.__H.reset(o), { dist: 300, dx: -300 });
    const rows = await page.evaluate(() => { const { s, a, floor } = window.__H.H;
      // Body side against the stage wall: the grab radius is the body half-width (Link 23 px).
      s.matter.body.setPosition(a.body, { x: floor.bounds.max.x + a.getTuning().width / 2, y: floor.bounds.min.y + 30 }); s.matter.body.setVelocity(a.body, { x: 0, y: 2 }); a.setFacing?.(-1);
      return window.__H.run([{ n: 30 }]); });
    if (SHOTS) await page.screenshot({ path: `${out}/96-ledge-hang.png` });
    const getup = await page.evaluate(() => window.__H.run([{ i: { moveX: -1 } }, { n: 50 }]));
    report.scenarios.push({ ...summarize('ledge grab (placed below ledge, simulated fall) + getup', [...rows, ...getup], []), trace: [...rows, ...getup].filter((r, k) => k % 2 === 0).slice(0, 50) });
  } catch (e) { report.scenarios.push({ name: 'ledge', harnessError: String(e.message ?? e).slice(0, 800) }); }

  report.heapMBEnd = await page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null);
} catch (e) {
  report.fatal = String(e.stack ?? e).slice(0, 2000);
} finally {
  report.current = undefined;
  await save();
  await browser.close();
}
console.log(JSON.stringify({ fatal: report.fatal, pageErrors: report.pageErrors.length, scenarios: report.scenarios.length }));
