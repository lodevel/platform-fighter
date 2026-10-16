import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import type { CharacterInput } from './Character';
import type { HitInfo } from './combat';
import { Link, LINK_TILT, LINK_UAIR } from './Link';
import { DonkeyKong } from './DonkeyKong';
import { stepCharacterPhysics } from './stepCharacterPhysics';
import { GAME_CONFIG } from '../engine/constants';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import { BlastZonePositionWatcher, type KoEvent } from '../match/BlastZonePositionWatcher';
import { createFlatStage } from '../stages/stageDefinitions';
import { PLATFORM_LABELS } from '../stages/stageBodies';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');
type Vector = { x: number; y: number };
type FighterId = 'link' | 'donkeykong';
const NEUTRAL: CharacterInput = { moveX: 0, moveY: 0, jump: false };
const UP: CharacterInput = { ...NEUTRAL, moveY: -1 };
const DOWN: CharacterInput = { ...NEUTRAL, moveY: 1 };
const LEFT: CharacterInput = { ...NEUTRAL, moveX: -1 };
const RIGHT: CharacterInput = { ...NEUTRAL, moveX: 1 };
const TILT: HitInfo = { damage: LINK_TILT.damage, knockback: LINK_TILT.knockback, facing: 1 };
const UAIR: HitInfo = { damage: LINK_UAIR.damage, knockback: LINK_UAIR.knockback, facing: 1 };
const PROFILES = {
  link: { weight: 104, height: 72, gravity: 0.48, cap: 8, verticalGravity: 0.38472 },
  donkeykong: { weight: 127, height: 84, gravity: 0.425, cap: 8.15, verticalGravity: 0.42336 },
} as const;
const STAGE = createFlatStage({ omitFloatingPlatforms: true });
const evidence: unknown[] = [];

function expectVector(actual: Vector, expected: Vector, label = '') {
  expect(actual.x, `${label} x`).toBeCloseTo(expected.x, 7);
  expect(actual.y, `${label} y`).toBeCloseTo(expected.y, 7);
}

function inputVector(input: CharacterInput): Vector {
  const length = Math.max(1, Math.hypot(input.moveX, input.moveY ?? 0));
  return { x: input.moveX / length, y: (input.moveY ?? 0) / length };
}

/** Independent source equations; imports no runtime DI, LSI, launch or timing helper. */
function expectedLaunch(hit: HitInfo, percent: number, id: FighterId, input: CharacterInput) {
  const profile = PROFILES[id];
  const ref = hit.knockback.reference!;
  const p = Math.min(999, percent + hit.damage);
  const kb = ((p / 10 + p * hit.damage / 20) * 1.4 * 200 / (profile.weight + 100) + 18)
    * ref.growth / 100 + ref.base;
  const ordinaryHitstun = Math.floor(Math.max(5, kb * 0.4)) - 1;
  const tumble = ordinaryHitstun + 1 >= 32;
  const angle = ref.angle === 361 ? 0.663225 : ref.angle * Math.PI / 180;
  const vertical = tumble && angle >= 1.22173 && angle <= 1.91986;
  const queued = { x: kb * 0.15 * Math.cos(angle) * hit.facing,
    y: -kb * 0.15 * Math.sin(angle) - (tumble && !vertical ? 5 * (profile.gravity - 0.375) : 0) };
  const stick = inputVector(input);
  const originalAngle = Math.atan2(queued.y, queued.x);
  const eligible = tumble && Math.atan2(Math.abs(queued.y), Math.abs(queued.x)) >= 0.17;
  const rotated = originalAngle + (eligible
    ? (stick.y * Math.cos(originalAngle) - stick.x * Math.sin(originalAngle)) * 0.17 : 0);
  const degrees = ((rotated * 180 / Math.PI) % 360 + 360) % 360;
  const suppressed = (degrees > 65 && degrees < 115) || (degrees > 245 && degrees < 295);
  const lsi = !eligible || suppressed ? 1 : stick.y < 0 ? 1 - 0.095 * stick.y : 1 - 0.08 * stick.y;
  const speed = Math.hypot(queued.x, queued.y) * lsi;
  const launch = { x: speed * Math.cos(rotated), y: speed * Math.sin(rotated) };
  return { queued, launch, lsi, ordinaryHitstun, tumble, vertical,
    gravity: vertical ? profile.verticalGravity : profile.gravity, cap: vertical ? 9 : profile.cap };
}

/** Iterative reaction-clock oracle, distinct from production's geometric shortcut. */
function sourceGroups(hitstun: number, tumble: boolean): number[] {
  const faf = hitstun + 1;
  if (!tumble) return Array<number>(faf).fill(1);
  const maxRate = 1 + 5 * Math.min(1, Math.max(0, (faf - 30) / 50));
  const remaining = (start: number) => {
    let clock = start;
    let rate = maxRate;
    let steps = 0;
    while (rate > 1) {
      const ratio = Math.min(1, Math.max(0, (faf * 0.3 - clock) / (faf * 0.3 - faf)));
      rate = ratio * maxRate;
      clock -= Math.max(1, rate);
      steps++;
    }
    return steps + Math.ceil(clock);
  };
  const count = remaining(faf);
  const groups = Array<number>(count).fill(0);
  for (let tick = 0; tick < faf; tick++) groups[count - remaining(faf - tick)]!++;
  return groups;
}

function sampleTick(oracle: ReturnType<typeof expectedLaunch>, tick: number) {
  const speed = Math.hypot(oracle.launch.x, oracle.launch.y);
  const scale = speed === 0 ? 0 : Math.max(0, 1 - tick * 0.255 / speed);
  const moving = speed === 0 ? 0 : Math.min(tick, Math.floor(speed / 0.255));
  const launchSum = speed === 0 ? 0 : moving + 1 - 0.255 / speed * moving * (moving + 1) / 2;
  const uncapped = Math.min(tick, Math.floor(oracle.cap / oracle.gravity));
  const gravitySum = oracle.gravity * uncapped * (uncapped + 1) / 2 + (tick - uncapped) * oracle.cap;
  return {
    position: { x: oracle.launch.x * launchSum, y: oracle.launch.y * launchSum + gravitySum },
    velocity: { x: oracle.launch.x * scale, y: oracle.launch.y * scale + Math.min(tick * oracle.gravity, oracle.cap) },
  };
}

function originFor(id: FighterId): Vector {
  const ground = STAGE.platforms[0]!;
  return { x: ground.x, y: ground.y - ground.height / 2 - PROFILES[id].height / 2 - 1 };
}

function world(id: FighterId = 'link', flatStage = false) {
  const engine = Engine.create();
  engine.gravity.x = 0;
  engine.gravity.y = GAME_CONFIG.gravity;
  const names: Record<string, string> = {
    collisionstart: 'collisionStart', collisionactive: 'collisionActive', collisionend: 'collisionEnd',
  };
  const scene: any = { matter: { body: Body, add: {
    rectangle(x: number, y: number, width: number, height: number, options: object) {
      const body = Bodies.rectangle(x, y, width, height, options);
      Composite.add(engine.world, body);
      return body;
    },
  }, world: {
    on(event: string, callback: (...args: any[]) => void) { Events.on(engine, names[event] ?? event, callback); },
    off(event: string, callback: (...args: any[]) => void) { Events.off(engine, names[event] ?? event, callback); },
    remove(body: any) { Composite.remove(engine.world, body); },
  } } };
  const origin = flatStage ? originFor(id) : { x: 0, y: 0 };
  const Fighter = id === 'link' ? Link : DonkeyKong;
  const ch = new Fighter(scene, { spawnX: origin.x, spawnY: origin.y });
  if (flatStage) {
    const ground = STAGE.platforms[0]!;
    Composite.add(engine.world, Bodies.rectangle(ground.x, ground.y, ground.width, ground.height, {
      isStatic: true, label: PLATFORM_LABELS.solid,
      collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID },
    }));
  }
  let observer: (() => void) | undefined;
  const step = (input: CharacterInput = NEUTRAL) => {
    ch.applyInput(input);
    const afterInput = { velocity: { ...ch.getVelocity() }, position: { ...ch.getPosition() } };
    let substeps = 0;
    stepCharacterPhysics({ characters: [ch], bodies: Composite.allBodies(engine.world),
      gravity: engine.gravity, body: Body, deltaMs: GAME_CONFIG.fixedTimestepMs,
      stepWorld: delta => Engine.update(engine, delta),
      afterSubstep: () => { substeps++; observer?.(); } });
    return { afterInput, position: { ...ch.getPosition() }, velocity: { ...ch.getVelocity() }, substeps };
  };
  const release = (hit: HitInfo, percent: number, input = NEUTRAL,
    earlyInput: (frame: number) => CharacterInput = () => NEUTRAL) => {
    ch.setDamagePercent(percent);
    const result = ch.applyHit(hit);
    const hitlag = ch.getHitlagRemaining();
    for (let frame = 0; ch.getHitlagRemaining() > 1 && frame < 100; frame++) step(earlyInput(frame));
    expect(ch.getHitlagRemaining()).toBe(1);
    const released = step(input);
    expect(ch.getHitlagRemaining()).toBe(0);
    return { result, released, hitlag };
  };
  const dispose = () => { ch.destroy(); Engine.clear(engine); Composite.clear(engine.world, false); };
  return { ch, engine, step, release, dispose, setObserver: (callback: () => void) => { observer = callback; } };
}

describe('Reference launch influence through final hitlag and real Matter', () => {
  it.each([
    { name: 'neutral', input: NEUTRAL }, { name: 'up', input: UP }, { name: 'down', input: DOWN },
    { name: 'partial up', input: { ...NEUTRAL, moveY: -0.25 } },
    { name: 'keyboard diagonal', input: { ...NEUTRAL, moveX: 1, moveY: -1 } },
  ])('$name matches independent DI then LSI release and grouped trajectory for both weights', ({ name, input }) => {
    for (const id of ['link', 'donkeykong'] as const) {
      const fixture = world(id);
      const expected = expectedLaunch(TILT, 100, id, input);
      const groups = sourceGroups(expected.ordinaryHitstun, expected.tumble);
      const { result, released, hitlag } = fixture.release(TILT, 100, input);
      expectVector(result.vector, expected.queued, `${id} queued`);
      expectVector(released.afterInput.velocity, expected.launch, `${id} influenced release`);
      expect(result.ordinaryHitstunFrames).toBe(id === 'link' ? 65 : 61);
      expect(result.hitstunFrames).toBe(id === 'link' ? 44 : 43);
      expect(groups).toHaveLength(result.hitstunFrames + 1);
      let tick = -1;
      for (let displayed = 0; displayed <= 10; displayed++) {
        tick += groups[displayed]!;
        const actual = displayed === 0 ? released : fixture.step();
        const sample = sampleTick(expected, tick);
        expectVector(actual.velocity, sample.velocity, `${id} ${name} display ${displayed} velocity`);
        expectVector(actual.position, {
          x: released.afterInput.position.x + sample.position.x,
          y: released.afterInput.position.y + sample.position.y,
        }, `${id} ${name} display ${displayed} position`);
      }
      evidence.push({ kind: 'release', fighter: id, input: name, percent: 100, hitlag,
        ordinaryHitstun: result.ordinaryHitstunFrames, displayedHitstun: result.hitstunFrames,
        release: released.afterInput, expectedLsi: expected.lsi });
      fixture.dispose();
    }
  });

  it('mirrors horizontal launch and diagonal input while retaining the same vertical LSI', () => {
    const forward = world();
    const reverse = world();
    const right = forward.release(TILT, 100, { ...UP, moveX: 1 }).released.afterInput;
    const left = reverse.release({ ...TILT, facing: -1 }, 100, { ...UP, moveX: -1 }).released.afterInput;
    expectVector(left.velocity, { x: -right.velocity.x, y: right.velocity.y });
    expectVector(left.position, { x: -right.position.x, y: right.position.y });
    expectVector(left.velocity, expectedLaunch({ ...TILT, facing: -1 }, 100, 'link', { ...UP, moveX: -1 }).launch);
    forward.dispose(); reverse.dispose();
  });

  it.each([
    { name: 'non-tumble', base: 79, angle: 45, facing: 1 as const },
    { name: 'near-horizontal', base: 100, angle: 5, facing: 1 as const },
    { name: 'mirrored near-horizontal', base: 100, angle: 5, facing: -1 as const },
  ])('keeps $name outside both reference influence operations', ({ base, angle, facing }) => {
    const hit: HitInfo = { damage: 1, facing, knockback: { x: 0, y: 0, scaling: 0,
      reference: { base, growth: 0, angle } } };
    const fixture = world();
    const expected = expectedLaunch(hit, 0, 'link', UP);
    const { released } = fixture.release(hit, 0, UP);
    expect(expected.lsi).toBe(1);
    expectVector(released.afterInput.velocity, expected.queued);
    fixture.dispose();
  });

  it('samples influence only at release while early hitlag flicks remain positional SDI', () => {
    const early = world();
    const neutral = world();
    const changed = world();
    const earlyRelease = early.release(TILT, 100, NEUTRAL, frame => frame === 0 ? UP : NEUTRAL).released;
    const neutralRelease = neutral.release(TILT, 100).released;
    const changedRelease = changed.release(TILT, 100, DOWN, frame => frame === 0 ? UP : NEUTRAL).released;
    expectVector(earlyRelease.afterInput.velocity, neutralRelease.afterInput.velocity);
    expectVector(earlyRelease.afterInput.position, { x: 0, y: -10 });
    expectVector(changedRelease.afterInput.position, { x: 0, y: 0 });
    expectVector(changedRelease.afterInput.velocity, expectedLaunch(TILT, 100, 'link', DOWN).launch);
    const fixed = world();
    fixed.release(TILT, 100, DOWN, frame => frame === 0 ? UP : NEUTRAL);
    for (let frame = 0; frame < 8; frame++) {
      const changedInput = changed.step(UP);
      const unchangedInput = fixed.step();
      expectVector(changedInput.velocity, unchangedInput.velocity);
      expectVector(changedInput.position, unchangedInput.position);
    }
    for (const fixture of [early, neutral, changed, fixed]) fixture.dispose();
  });

  it('keeps carried motion unscaled and advances it once per displayed frame', () => {
    const plain = world();
    const carried = world();
    const carry = { x: 3, y: -2 };
    const plainRelease = plain.release(TILT, 100, DOWN);
    const carriedRelease = carried.release({ ...TILT, velocityCarry: carry }, 100, DOWN);
    expect(carriedRelease.result.hitstunFrames).toBe(plainRelease.result.hitstunFrames);
    expectVector(carriedRelease.released.afterInput.velocity, {
      x: plainRelease.released.afterInput.velocity.x + carry.x,
      y: plainRelease.released.afterInput.velocity.y + carry.y,
    });
    for (let frame = 0; frame < 6; frame++) {
      const a = frame === 0 ? plainRelease.released : plain.step();
      const b = frame === 0 ? carriedRelease.released : carried.step();
      expectVector(b.velocity, { x: a.velocity.x + carry.x, y: a.velocity.y + carry.y });
      expectVector(b.position, { x: a.position.x + carry.x * (frame + 1), y: a.position.y + carry.y * (frame + 1) });
    }
    plain.dispose(); carried.dispose();
  });

  it('keeps pre-DI vertical gravity classification when DI exits the LSI exclusion sector', () => {
    const hit: HitInfo = { damage: 1, facing: 1, knockback: { x: 0, y: 0, scaling: 0,
      reference: { base: 160, growth: 0, angle: 70 } } };
    const input = { ...DOWN, moveX: 1 };
    const expected = expectedLaunch(hit, 0, 'link', input);
    expect(expected.vertical).toBe(true);
    expect(-Math.atan2(expected.launch.y, expected.launch.x) * 180 / Math.PI).toBeLessThan(65);
    expect(expected.lsi).toBeLessThan(1);
    const fixture = world();
    const { result, released } = fixture.release(hit, 0, input);
    const groups = sourceGroups(expected.ordinaryHitstun, true);
    expect(result.hitstunFrames).toBe(groups.length - 1);
    expectVector(released.afterInput.velocity, expected.launch);
    let tick = -1;
    for (let display = 0; display < 12; display++) {
      tick += groups[display]!;
      const actual = display === 0 ? released : fixture.step();
      expectVector(actual.velocity, sampleTick(expected, tick).velocity);
    }
    fixture.dispose();
  });

  it('retains magnitude-preserving legacy DI without opting legacy knockback into LSI', () => {
    const hit: HitInfo = { damage: 1, facing: 1, knockback: { x: 100, y: -80, scaling: 0 } };
    const neutral = world();
    const influenced = world();
    const a = neutral.release(hit, 0).released.afterInput.velocity;
    const b = influenced.release(hit, 0, UP).released.afterInput.velocity;
    expect(influenced.ch.isTumbling()).toBe(true);
    expect(Math.hypot(b.x, b.y)).toBeCloseTo(Math.hypot(a.x, a.y), 7);
    expect(Math.atan2(b.y, b.x)).not.toBeCloseTo(Math.atan2(a.y, a.x), 5);
    neutral.dispose(); influenced.dispose();
  });
});

function sdiOffset(input: CharacterInput): Vector {
  const x = input.moveX;
  const y = input.moveY ?? 0;
  const length = Math.hypot(x, y);
  return Math.max(Math.abs(x), Math.abs(y)) >= 0.5
    ? { x: 10 * x / Math.max(1, length), y: 10 * y / Math.max(1, length) } : { x: 0, y: 0 };
}

function oracleKo(percent: number, id: FighterId, hit: HitInfo, input: CharacterInput): boolean {
  const expected = expectedLaunch(hit, percent, id, input);
  const origin = originFor(id);
  const sdi = sdiOffset(input);
  for (let tick = 0; tick <= expected.ordinaryHitstun; tick++) {
    const position = sampleTick(expected, tick).position;
    const x = origin.x + sdi.x + position.x;
    const y = origin.y + sdi.y + position.y;
    if (x < STAGE.blastZone.left || x > STAGE.blastZone.right
      || y < STAGE.blastZone.top || y > STAGE.blastZone.bottom) return true;
  }
  return false;
}

function measureKo(percent: number, id: FighterId, hit: HitInfo, input: CharacterInput) {
  const fixture = world(id, true);
  const events: Array<KoEvent & { substep: number; remainingHitstun: number }> = [];
  let display = -1;
  let substep = 0;
  const watcher = new BlastZonePositionWatcher(STAGE.blastZone, event => {
    events.push({ ...event, substep, remainingHitstun: fixture.ch.getHitstunRemaining() });
  });
  watcher.registerPlayer(0, fixture.ch.body);
  fixture.ch.setDamagePercent(percent);
  const result = fixture.ch.applyHit(hit);
  while (fixture.ch.getHitlagRemaining() > 1) fixture.step();
  fixture.setObserver(() => { substep++; watcher.update(display); });
  display = 0;
  const released = fixture.step(input);
  const checkpoints = [{ display, position: released.position, velocity: released.velocity, substeps: released.substeps }];
  for (display = 1; display <= result.hitstunFrames; display++) {
    substep = 0;
    const sample = fixture.step();
    if (display === 1 || display === 5 || display === result.hitstunFrames) {
      checkpoints.push({ display, position: sample.position, velocity: sample.velocity, substeps: sample.substeps });
    }
  }
  // The horizon includes release and every locked step; no actionable step is integrated.
  expect(fixture.ch.getHitstunRemaining()).toBe(0);
  expect(events.length).toBeLessThanOrEqual(1);
  const measurement = { percent, ordinaryHitstun: result.ordinaryHitstunFrames,
    displayedHitstun: result.hitstunFrames, release: released.afterInput, events, checkpoints,
    finalPosition: { ...fixture.ch.getPosition() } };
  fixture.dispose();
  return measurement;
}

describe('Flat-stage KO brackets through the final locked launch step', () => {
  const cases = (['link', 'donkeykong'] as const).flatMap(fighter => [
    { fighter, move: 'tilt', direction: 'up', hit: TILT, input: UP },
    { fighter, move: 'tilt', direction: 'down', hit: TILT, input: DOWN },
    { fighter, move: 'tilt', direction: 'neutral', hit: TILT, input: NEUTRAL },
    { fighter, move: 'uair', direction: 'left', hit: UAIR, input: LEFT },
    { fighter, move: 'uair', direction: 'right', hit: UAIR, input: RIGHT },
    { fighter, move: 'uair', direction: 'neutral', hit: UAIR, input: NEUTRAL },
  ]);
  it.each(cases)('$fighter $move $direction measures neighboring safe/KO integer percents', ({ fighter, move, direction, hit, input }) => {
    let safe = 0;
    let ko = 400;
    expect(oracleKo(safe, fighter, hit, input)).toBe(false);
    expect(oracleKo(ko, fighter, hit, input)).toBe(true);
    while (ko - safe > 1) {
      const percent = Math.floor((safe + ko) / 2);
      if (oracleKo(percent, fighter, hit, input)) ko = percent;
      else safe = percent;
    }
    const safeResult = measureKo(safe, fighter, hit, input);
    const koResult = measureKo(ko, fighter, hit, input);
    expect(safeResult.events, `${safe}% is safe through the locked horizon`).toEqual([]);
    expect(koResult.events, `${ko}% crosses during a physics substep`).toHaveLength(1);
    expect(koResult.events[0]!.edge).toBe(move === 'tilt' ? 'right' : 'top');
    expect(koResult.events[0]!.frame).toBeLessThanOrEqual(koResult.displayedHitstun);
    evidence.push({ kind: 'ko-bracket', fighter, move, direction, input: inputVector(input),
      origin: originFor(fighter), safe: safeResult, ko: koResult });
  });
});

afterAll(() => {
  const output = process.env.LAUNCH_INFLUENCE_PHYSICS_OUTPUT;
  if (output) writeFileSync(output, `${JSON.stringify({
    schemaVersion: 1, blastZone: STAGE.blastZone, ground: STAGE.platforms[0],
    geometry: 'Airborne centre at actual flat-stage ground centre, standing height minus 1 pixel; solid floor included.',
    sampling: 'Neutral before final hitlag input; its fresh full-stick SDI contributes 10 pixels (2 reference units). KO checks every coordinator substep.',
    horizon: 'Release display 0 through final locked display hitstunFrames inclusive; first actionable step excluded.',
    cases: evidence,
  }, null, 2)}\n`);
});
