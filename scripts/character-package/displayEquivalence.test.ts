/**
 * Phase 6 step 0: the selector's package display shows what the legacy sprite path draws. Real headless
 * matches (CPU play on every stage, every Final against every victim) are drawn by the legacy path
 * (selector + port poses.ts, as the legacy sprite backend does) and the display is evaluated against the
 * exported packages, built in memory; every fighter is compared at every simulation tick.
 */
import { describe, expect, it } from 'vitest';
import { evaluate, type DisplayPose } from '../../character/evaluator/evaluate';
import type { CharacterPackage } from '../../character/package/types';
import { fighterDraw, fighterDrawsFromArt, knockoutFlightDraw } from '../../port/src/fighters/poses';
import type { SpriteDraw } from '../../port/src/engine/sprites/spriteLayer';
import type { ActionDisplay } from '../../src/characterPresentation/contracts';
import { createLegacyAppearanceBridge } from '../../src/characterPresentation/legacy/bridge';
import { createLegacyArtSelector } from '../../src/characterPresentation/legacy/selector';
import { clipOfSheet, sheetDisplay } from '../../src/characters/actionDisplay';
import { resolveSimulationAction, type ActionPose, type SimulationAnimationSnapshot } from '../../src/characters/simulationSpriteAnimation';
import { NEUTRAL_INPUT } from '../../src/replay/InputCaptureBuffer';
import { buildSimView } from '../../src/sim/buildSimView';
import { MatchSim } from '../../src/sim/MatchSim';
import type { CharacterId, MatchConfig } from '../../src/types';
import type { CharacterInput } from '../../src/characters/Character';
import { ITEM_CATALOG } from '../../src/items/itemCatalog';
import { exportFighter } from './exportLegacy';
import { EXPORTED_FIGHTERS, sheetsOf, type ExportedFighter } from './legacyClips';

interface Exported { readonly pkg: CharacterPackage; readonly placement: ReadonlyMap<string, readonly number[]> }
const exported = new Map<string, Exported>();
function packageOf(id: string): Exported {
  let found = exported.get(id);
  if (!found) {
    const { pkg, placements } = exportFighter(id as ExportedFighter);
    // Drawing id → [originX, originY, scale] it was placed with.
    found = { pkg, placement: new Map([...placements].map(([key, drawing]) => [drawing, (JSON.parse(key) as number[]).slice(2)])) };
    exported.set(id, found);
  }
  return found;
}

const close = (a: number, b: number) => Math.abs(a - b) < 1e-6;
/** The clip (package action) a legacy draw's texture holds. */
const sheetOf = (id: string, draw: SpriteDraw) => clipOfSheet(id as CharacterId, draw.key.slice(`char.${id}.`.length));
const frameHeight = (id: string, sheet: string) => sheetsOf(id as ExportedFighter).get(sheet)!.frameHeight;

/** Every way the display can disagree with the legacy draw, empty when they agree. */
function differences(id: string, display: ActionDisplay, draws: readonly SpriteDraw[], centre: { x: number; y: number }): string[] {
  const { pkg, placement } = packageOf(id), out: string[] = [];
  const shown = (action: string, tick: number): DisplayPose | null => pkg.actions[action] ? evaluate(pkg, { action, tick, facing: display.facing }) : null;
  const sameDrawing = (pose: DisplayPose | null, draw: SpriteDraw, what: string) => {
    const want = `${sheetOf(id, draw)}/${draw.frame}`, got = pose?.drawing?.replace(/@\d+$/, '') ?? null;
    if (got !== want) out.push(`${what} shows ${pose ? got ?? 'nothing' : 'an unknown action'}, legacy draws ${want}`);
  };
  const base = draws[0]!, pose = shown(display.action, display.tick);
  sameDrawing(pose, base, 'drawing');
  if (!pose?.drawing) return out;
  const flip = base.flipX ? -1 : 1, [originX, originY, scale] = placement.get(pose.drawing)!;
  if (display.facing !== flip) out.push(`facing ${display.facing}, legacy ${flip}`);
  if (!close(display.rotation ?? 0, base.rotation ?? 0)) out.push(`rotation ${display.rotation ?? 0}, legacy ${base.rotation ?? 0}`);
  if (!close(scale! * (display.scale?.x ?? 1), base.scaleX ?? 1) || !close(scale! * (display.scale?.y ?? 1), base.scaleY ?? 1)) out.push('scale differs');
  if (display.pivot) {
    // The legacy draw moves its origin to the pivot and places it there.
    if (!close(base.x, centre.x + display.pivot.x * display.facing) || !close(base.y, centre.y + display.pivot.y)) out.push('pivot differs');
  } else {
    if (!close(base.originX ?? .5, flip === 1 ? originX! : 1 - originX!) || !close(base.originY ?? .5, originY!)) out.push('placement differs');
    if (!close(base.x, centre.x) || !close(base.y, centre.y - pose.bodyCentreFromRootY)) out.push('root differs');
  }
  const overlay = display.overlay;
  if (!overlay !== (draws.length === 1)) { out.push(`overlay ${overlay ? 'shown' : 'missing'}, legacy draws ${draws.length} layers`); return out; }
  if (!overlay) return out;
  const upper = draws[1]!, upperPose = shown(overlay.action, overlay.tick);
  sameDrawing(upperPose, upper, 'overlay');
  if (!upperPose?.drawing) return out;
  if (!close(upper.x, centre.x + overlay.offset.x * display.facing) || !close(upper.y, centre.y - upperPose.bodyCentreFromRootY + overlay.offset.y)) out.push('overlay offset differs');
  const cut = (drawing: string, row: number | undefined, draw: SpriteDraw) => {
    const [, y, s] = placement.get(drawing)!;
    return ((row ?? NaN) - y! * frameHeight(id, sheetOf(id, draw))) * s!;
  };
  if (!close(cut(pose.drawing, base.clipRows?.top, base), overlay.clip.base) || !close(cut(upperPose.drawing, upper.clipRows?.bottom, upper), overlay.clip.overlay))
    out.push('overlay waist line differs');
  return out;
}

/** How the legacy selector chose the drawing: on the clip's own clock, or a generic fallback. */
function route(pose: ActionPose, s: SimulationAnimationSnapshot): string {
  if (pose.display) return `explicit display: ${s.finalVictimSelection ? 'Final victim' : s.finalSmash?.sheet ? 'Final owner'
    : pose.state === 'dodge.directional-air' ? 'directional air dodge' : pose.state.split('.')[0]}`;
  if (pose.directArtFrame !== undefined) return 'clip clock (resolved drawing)';
  if (pose.reviewedSheet) return 'clip clock (reviewed windows)';
  if (pose.nativeTimedSheet) return 'clip clock (native samples)';
  if (pose.move) return 'fallback: attack timeline';
  if (pose.phase) return 'fallback: phase';
  if (pose.hold) return `fallback: hold ${pose.hold}`;
  if (pose.duration !== undefined) return 'fallback: duration';
  return 'fallback: fixed rate';
}

interface Tally { frames: number; nothing: number; mismatches: Map<string, number>; routes: Map<string, number>; fallbacks: Map<string, number>;
  features: Map<string, number>; unexported: Map<string, number>; actions: Map<string, number> }
const tally: Tally = { frames: 0, nothing: 0, mismatches: new Map(), routes: new Map(), fallbacks: new Map(), features: new Map(), unexported: new Map(), actions: new Map() };
const count = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);

/** Steps a match, drawing every fighter (and knockout flight) through the legacy path and its display. */
function run(sim: MatchSim, steps: number, input: (step: number) => Parameters<MatchSim['step']>[0] = () => undefined): void {
  const bridge = createLegacyAppearanceBridge(), selectors = new Map<number, ReturnType<typeof createLegacyArtSelector>>();
  try {
    for (let step = 0; step < steps && !sim.isFinished; step++) {
      sim.step(input(step));
      const view = buildSimView(sim);
      for (const fighter of view.fighters) {
        if (fighter.eliminated) continue;
        const request = bridge.match(fighter), selector = selectors.get(fighter.playerIndex) ?? createLegacyArtSelector();
        selectors.set(fighter.playerIndex, selector);
        const art = selector.select(request);
        if (!art) { tally.nothing++; continue; }
        const animation: SimulationAnimationSnapshot = fighter.animation, pose = resolveSimulationAction(animation);
        const draws = fighterDrawsFromArt({ characterId: fighter.characterId, paletteIndex: fighter.paletteIndex, position: fighter.position,
          facing: fighter.facing }, art, 0xffffff, animation.pikachuSpecial, animation);
        if (!draws.length) { tally.nothing++; continue; }
        tally.frames++;
        const kind = `${fighter.characterId} ${animation.frozen ? 'frozen (last pose)' : route(pose, animation)}`;
        count(tally.routes, kind);
        if (kind.includes('fallback')) count(tally.fallbacks, `${kind}: ${pose.state} → ${sheetOf(fighter.characterId, draws[0]!)}` +
          (art.display ? art.display.tick === (pose.frame ?? -1) ? ' (tick = pose clock)' : ' (first tick showing the drawing)' : ' (no action)'));
        if (!art.display) { count(tally.unexported, `${fighter.characterId} ${sheetOf(fighter.characterId, draws[0]!)} (${pose.state})`); continue; }
        count(tally.actions, `${fighter.characterId} ${art.display.action}`);
        for (const feature of ['rotation', 'pivot', 'scale', 'overlay'] as const) if (art.display[feature] !== undefined) count(tally.features, `${fighter.characterId} ${feature}`);
        for (const problem of differences(fighter.characterId, art.display, draws, fighter.position))
          count(tally.mismatches, `${kind}: ${pose.state}: ${problem}`);
      }
      for (const flight of view.knockoutFlights ?? []) {
        const draw = knockoutFlightDraw(flight, 0xffffff);
        if (!draw) continue;
        tally.frames++;
        count(tally.routes, `${flight.characterId} knockout flight`);
        const display = sheetDisplay(flight.characterId as CharacterId, 'tumble', flight.age, flight.facing);
        const pose = evaluate(packageOf(flight.characterId).pkg, display);
        if (pose.drawing?.replace(/@\d+$/, '') !== `${sheetOf(flight.characterId, draw)}/${draw.frame}`) count(tally.mismatches, `${flight.characterId} knockout flight drawing`);
      }
    }
  } finally { sim.dispose(); }
}

const ROSTER = EXPORTED_FIGHTERS as readonly CharacterId[];
/** Inputs held for a number of steps: directional air dodges, smash charges, every special, grab, walk, crouch, taunt. */
const SCRIPT: readonly (readonly [Partial<CharacterInput>, number])[] = [
  [{ jump: true }, 1], [{}, 8], [{ shield: true, moveX: 1, moveY: -1 }, 2], [{}, 70],
  [{ jump: true }, 1], [{}, 8], [{ dodge: true, moveX: -1, moveY: 1 }, 2], [{}, 70],
  [{ jump: true }, 1], [{}, 8], [{ shield: true }, 2], [{}, 70],
  [{ attackHeavy: true, moveX: 1 }, 70], [{}, 60], [{ attackHeavy: true, moveY: -1 }, 70], [{}, 60], [{ attackHeavy: true, moveY: 1 }, 70], [{}, 60],
  [{ special: true }, 30], [{}, 60], [{ special: true, moveX: 1 }, 50], [{}, 80],
  [{ special: true, moveY: -1 }, 2], [{ moveX: 1, moveY: -1 }, 20], [{}, 90], [{ special: true, moveY: 1 }, 2], [{}, 90],
  [{ jump: true }, 1], [{}, 6], [{ special: true, moveX: 1 }, 40], [{}, 90],
  [{ grab: true }, 2], [{}, 20], [{ moveX: 1 }, 2], [{}, 60], [{ moveX: 1 }, 40], [{ moveY: 1 }, 30], [{ appeal: true }, 2], [{}, 90],
];
const STAGES = ['flat', 'lava', 'wind', 'crumbling', 'moving-platform', 'inferno'];

describe('package display equals the legacy drawing in real matches', () => {
  it.each(STAGES.map((stage, n) => [stage, n] as const))('four hard CPUs with items on %s', (stageId, n) => {
    const config: MatchConfig = { mode: 'stocks', stockCount: 99, stageId, rngSeed: 4100 + n, itemFrequency: 'high', linkIntroPolicy: 'none',
      finalSmashRules: { schemaVersion: 1, meterEnabled: true, smashBallEnabled: true },
      players: [0, 1, 2, 3].map(i => ({ index: (i + 1) as 1 | 2 | 3 | 4, characterId: ROSTER[(i + n) % ROSTER.length]!, paletteIndex: i,
        inputType: 'ai' as const, aiDifficulty: 'hard' as const })) };
    run(new MatchSim({ matchConfig: config }), 5400);
  }, 600_000);

  it.each(ROSTER.map((id, n) => [id, n] as const))('%s against hard CPUs with only shooting items', (id, n) => {
    const config: MatchConfig = { mode: 'stocks', stockCount: 99, stageId: 'flat', rngSeed: 4200 + n, itemFrequency: 'high', linkIntroPolicy: 'none',
      itemSwitch: Object.fromEntries(ITEM_CATALOG.map(def => [def.type, ['rayGun', 'superScope', 'fireFlower'].includes(def.type)])),
      players: [id, ...ROSTER.filter(other => other !== id)].map((characterId, i) => ({ index: (i + 1) as 1 | 2 | 3, characterId, paletteIndex: i,
        inputType: 'ai' as const, aiDifficulty: 'hard' as const })) };
    run(new MatchSim({ matchConfig: config }), 5400);
  }, 600_000);

  it.each(ROSTER.map((id, n) => [id, n] as const))('%s scripted through dodges, charges and specials against a hard CPU', (id, n) => {
    const config: MatchConfig = { mode: 'stocks', stockCount: 99, stageId: 'flat', rngSeed: 4300 + n, itemFrequency: 'off', linkIntroPolicy: 'none',
      players: [{ index: 1, characterId: id, paletteIndex: 0, inputType: 'keyboard_p1' },
        { index: 2, characterId: ROSTER[(n + 1) % ROSTER.length]!, paletteIndex: 1, inputType: 'ai', aiDifficulty: 'hard' }] };
    const script = SCRIPT.flatMap(([input, steps]) => Array.from({ length: steps }, () => input));
    run(new MatchSim({ matchConfig: config }), 6000, step => {
      const input = script[step % script.length]!, side = Math.floor(step / script.length) % 2 ? -1 : 1;
      return [{ ...NEUTRAL_INPUT, ...input, moveX: (input.moveX ?? 0) * side }, undefined];
    });
  }, 600_000);

  it.each(ROSTER.flatMap(owner => ROSTER.flatMap(victim => [false, true].map(air => [owner, victim, air] as const))))(
    '%s Final against %s (air %s)', (owner, victim, air) => {
      const config: MatchConfig = { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 1510, itemFrequency: 'off', linkIntroPolicy: 'none',
        finalSmashRules: { schemaVersion: 1, meterEnabled: false, smashBallEnabled: true }, players: [
          { index: 1, characterId: owner, paletteIndex: 0, inputType: 'keyboard_p1' },
          { index: 2, characterId: victim, paletteIndex: 1, inputType: 'keyboard_p2' }] };
      const sim = new MatchSim({ matchConfig: config }), idle = [NEUTRAL_INPUT, NEUTRAL_INPUT];
      for (let n = 0; n < 240; n++) sim.step(idle);
      const floor = sim.baseStage.bodies.platformBodies.find(b => b.label === 'platform.solid')!, top = floor.bounds.min.y;
      sim.p1.resetForRound(floor.position.x, top - 25 - (air ? 160 : 0)); sim.p1.setFacing(1);
      sim.p2.resetForRound(floor.position.x + 120, top - sim.p2.getTuning().height / 2); sim.p2.setFacing(-1);
      const frame = sim.physicsEngine.getFrame();
      for (const slot of sim.playerSlots) sim.consumeFinalEvents(sim.finalSmashController!.resetParticipant(slot.playerIndex,
        slot.character.getPositionResetGeneration(), 'owner-reset', 0), frame);
      sim.consumeFinalEvents(sim.finalSmashController!.grantBall(0, frame), frame);
      run(sim, 900, step => step === 0 ? [{ ...NEUTRAL_INPUT, special: true }, NEUTRAL_INPUT] : idle);
    }, 120_000);

  it('menu and knockout-flight sheets match their package actions', () => {
    for (const id of ROSTER) for (const sheet of ['idle', 'tumble']) for (let age = 0; age < 400; age++) for (const facing of [1, -1] as const) {
      const draw = fighterDraw({ characterId: id, x: 0, y: 0, facing }, sheet, age, 0xffffff)!;
      const pose = evaluate(packageOf(id).pkg, sheetDisplay(id, sheet, age, facing));
      if (pose.drawing?.replace(/@\d+$/, '') !== `${sheetOf(id, draw)}/${draw.frame}`) count(tally.mismatches, `${id} menu ${sheet}`);
    }
  }, 120_000);

  it('found no difference', () => {
    const table = (map: Map<string, number>) => [...map].sort((a, b) => b[1] - a[1]).map(([key, n]) => `${String(n).padStart(7)}  ${key}`).join('\n');
    const seen = ROSTER.map(id => `${id} ${[...tally.actions.keys()].filter(key => key.startsWith(`${id} `)).length}/${Object.keys(packageOf(id).pkg.actions).length}`);
    console.log(`frames checked: ${tally.frames} (nothing drawn: ${tally.nothing})\nactions shown / exported: ${seen.join(', ')}\n\nroutes:\n${table(tally.routes)}\n\n` +
      `generic fallbacks:\n${table(tally.fallbacks)}\n\ndisplay extras:\n${table(tally.features)}\n\n` +
      `drawn without a package action:\n${table(tally.unexported)}\n\nmismatches:\n${table(tally.mismatches)}`);
    expect([...tally.mismatches.keys()]).toEqual([]);
    // No fighter vanishes: every live fighter-frame is drawn (invisible-fighters.md).
    expect(tally.nothing).toBe(0);
    // Every drawing shown in these matches belongs to an exported action.
    expect(new Set([...tally.unexported.keys()].map(key => key.split(' ').slice(0, 2).join(' ')))).toEqual(new Set());
  });
});
