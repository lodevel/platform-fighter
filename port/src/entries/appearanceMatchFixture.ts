/** Qualification-only real match, included by PF_PRESENTATION_FIXTURE=1.
 * The production MatchView receives the same SimView as the evidence reader. */
import * as THREE from 'three';
import { MatchSim } from '../../../src/sim/MatchSim';
import type { SimView } from '../../../src/sim/view';
import type { MatchConfig } from '../../../src/types';
import { NEUTRAL_INPUT } from '../../../src/replay/InputCaptureBuffer';
import type { PresentationProfile } from '../../../src/characterPresentation/contracts';
import { createLegacyMatchAppearanceRequest } from '../../../src/characterPresentation/legacy/bridge';
import { LEGACY_SPRITE_CAPABILITY, legacyPresentationProfile } from '../../../src/characterPresentation/legacy/profiles';
import { StagePresenter } from '../arena/presenter';
import { MatchView } from '../match/matchView';
import { prepareMatchResources } from '../match/preloadMatchArt';
import { characterAppearances } from '../fighters/appearance';
import { COMPUTED_FIXTURE_CAPABILITY, computedFixtureBackend } from '../fighters/backends/computedFixture';
import { toWorldX, toWorldY } from '../engine/space';

const FRAMES = 450;
const PAUSE_FRAMES = new Set([65, 185]);
const config: MatchConfig = {
  mode: 'stocks', stockCount: 9, stageId: 'flat', rngSeed: 20261016, itemFrequency: 'off', linkIntroPolicy: 'none',
  finalSmashRules: { schemaVersion: 1, meterEnabled: false, smashBallEnabled: false },
  players: [
    { index: 1, characterId: 'link', paletteIndex: 2, inputType: 'keyboard_p1' },
    { index: 2, characterId: 'pikachu', paletteIndex: 1, inputType: 'keyboard_p2' },
  ],
};
const profile: PresentationProfile = {
  id: 'fixture.real-match-link', revision: '1', characterId: 'link',
  routes: [
    { id: 'stored', action: '*', layer: 'body', capability: LEGACY_SPRITE_CAPABILITY, resources: ['fighter:link'] },
    { id: 'walking-body', action: 'walk', layer: 'body', capability: COMPUTED_FIXTURE_CAPABILITY, resources: [] },
    { id: 'jab-contact-body', action: 'jab', phase: 'active', layer: 'body', capability: COMPUTED_FIXTURE_CAPABILITY, resources: [] },
    ...['jump', 'jump_b', 'jump_short', 'jump_short_b'].map(action => ({ id: `air-accent:${action}`, action,
      layer: 'accent', capability: COMPUTED_FIXTURE_CAPABILITY, resources: [] })),
  ],
};
const check: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};
const same = (a: unknown, b: unknown, message: string) => check(JSON.stringify(a) === JSON.stringify(b), message);
const yieldBrowser = () => new Promise<void>(resolve => setTimeout(resolve, 0));

function inputs(frame: number) {
  const link = { ...NEUTRAL_INPUT };
  if (frame >= 31 && frame <= 90 || frame >= 301 && frame <= 340) link.moveX = .6;
  if (frame >= 156 && frame <= 205) link.moveX = -.6;
  if (frame >= 221 && frame <= 255) link.moveX = -.35;
  if (frame >= 346 && frame <= 375) link.moveX = .35;
  if ([110, 140, 390].includes(frame)) link.attack = true;
  if (frame === 220 || frame === 345) link.jump = true;
  return [link, { ...NEUTRAL_INPUT }];
}

function authority(sim: MatchSim, snapshot: SimView) {
  return {
    fighters: snapshot.fighters.map((fighter, index) => ({
      position: fighter.position, facing: fighter.facing, sourceRoot: fighter.sourceRoot,
      attachments: fighter.poseAttachments, equipment: fighter.equipment,
      receiving: sim.playerSlots[index]!.character.getActiveHurtboxes(),
      damage: sim.playerSlots[index]!.character.getDamagePercent(),
      grounded: sim.playerSlots[index]!.character.isGrounded(),
    })),
    contacts: snapshot.debugAreas ?? [],
    events: snapshot.events,
  };
}

interface ReferenceFrame {
  frame: number;
  hash: string;
  authority: ReturnType<typeof authority>;
}
const reference: ReferenceFrame[] = [];
const report = {
  schema: 'character-appearance-real-match/1', result: 'PREPARING', buildIdentity: '', totalFrames: FRAMES,
  method: 'Two sequential seeded MatchSim instances, identical scripted controls, one SimView capture per produced frame; second instance uses unchanged MatchView with registered mixed Link profile and legacy Pikachu.',
  comparison: { hashes: 0, authoritativeFrames: 0, contactFrames: 0, sourceSocketFrames: 0 },
  rows: [] as Array<Record<string, unknown>>,
  modes: { stored: 0, computed: 0, mixed: 0 },
  facings: [] as number[],
  transitions: [] as Array<{ frame: number; from: string; to: string; action: string; phase: string }>,
  pauses: [] as Array<Record<string, unknown>>,
  restores: [] as Array<Record<string, unknown>>,
  maximumAttachmentError: 0,
  maximumRootError: 0,
  preparation: null as null | { resourcesAvailable: boolean; shadersReady: boolean; identity: string },
  cleanup: null as null | Record<string, unknown>,
};

const presenter = new StagePresenter(document.getElementById('view')!);
presenter.setStage('flat'); presenter.paused = true; presenter.camera.sway = 0;
let sim: MatchSim;
let view: MatchView;
let lastSnapshot: SimView;
let currentFrame = 0, lastMode = '';
let resources: ReturnType<typeof prepareMatchResources> | undefined;
let disposed = false;

function show(snapshot: SimView) {
  lastSnapshot = snapshot;
  presenter.runtime.setFrame(snapshot.stageFrame ?? snapshot.frame);
  presenter.runtime.view.setPlatforms(snapshot.platforms ?? null);
  view.show(snapshot, sim.physicsEngine.fixedTimestepMs);
  presenter.frame(performance.now());
}

function observation(snapshot: SimView) {
  const fighter = snapshot.fighters[0]!;
  const request = createLegacyMatchAppearanceRequest(fighter, { profile });
  const routes = characterAppearances.registry.resolve(request);
  const stored = routes.some(route => route.capability === LEGACY_SPRITE_CAPABILITY);
  const computed = routes.filter(route => route.capability === COMPUTED_FIXTURE_CAPABILITY);
  const mode: 'mixed' | 'computed' | 'stored' = computed.length ? stored ? 'mixed' : 'computed' : 'stored';
  const draws = presenter.sprites.submittedDraws();
  const linkDraws = draws.filter(draw => draw.key.startsWith('char.link.'));
  const pikachuDraws = draws.filter(draw => draw.key.startsWith('char.pikachu.'));
  check(pikachuDraws.length > 0, `Legacy Pikachu missing at ${snapshot.frame}`);
  check(stored === (linkDraws.length > 0), `Stored Link route disagrees with actual submissions at ${snapshot.frame}`);
  const socket = fighter.poseAttachments?.find(attachment => attachment.id === 'item-grip');
  const sourceRoot = fighter.sourceRoot;
  check(socket?.space === 'world' && sourceRoot, 'Simulation did not publish an authoritative world item-grip/root');
  let attachmentError = 0, rootError = 0;
  const nodes = computed.map(route => {
    const group = presenter.sprites.scene.getObjectByName(`fixture:${route.id}`);
    check(group, `Computed route ${route.id} has no actual scene node at ${snapshot.frame}`);
    const hand = group.getObjectByName('computed-attachment');
    check(hand, `Computed route ${route.id} has no attachment geometry`);
    const world = hand.getWorldPosition(new THREE.Vector3());
    attachmentError = Math.max(attachmentError, Math.hypot(world.x - toWorldX(socket.position.x), world.y - toWorldY(socket.position.y)));
    const root = group.getWorldPosition(new THREE.Vector3());
    rootError = Math.max(rootError, Math.hypot(root.x - toWorldX(sourceRoot.x), root.y - toWorldY(sourceRoot.y)));
    return { route: route.id, handWorld: world.toArray(), rootWorld: root.toArray(), order: hand.renderOrder };
  });
  check(attachmentError < 1e-8, `Computed hand moved away from real simulation socket: ${attachmentError}`);
  check(rootError < 1e-8, `Computed body moved away from real simulation root: ${rootError}`);
  const actualGroups = presenter.sprites.scene.children.filter(child => child.name.startsWith('fixture:'));
  check(actualGroups.length === computed.length, 'Hidden routes left duplicate geometry in the scene');
  return { frame: snapshot.frame, mode, action: request.action.id, phase: request.action.phase, facing: fighter.facing,
    frozen: fighter.animation.frozen, hitlag: fighter.animation.hitlagRemaining,
    linkSprites: linkDraws.length, pikachuSprites: pikachuDraws.length,
    sourceRoot: fighter.sourceRoot, socket: socket.position, attachmentError, rootError, nodes,
    diagnostics: view.presentation(0), hash: sim.getSimDigest().hash };
}

async function prepare() {
  const baseline = new MatchSim({ matchConfig: config });
  report.buildIdentity = baseline.buildIdentity;
  try {
    // Initial read belongs to this first instance. It is not reused as a later frame.
    baseline.view();
    for (let frame = 1; frame <= FRAMES; frame++) {
      check(baseline.step(inputs(frame)) === 1, `Reference did not advance at ${frame}`);
      if (PAUSE_FRAMES.has(frame)) baseline.pause();
      const snapshot = baseline.view();
      reference.push({ frame, hash: baseline.getSimDigest().hash, authority: authority(baseline, snapshot) });
      if (PAUSE_FRAMES.has(frame)) baseline.resume();
      if (frame % 30 === 0) await yieldBrowser();
    }
  } finally { baseline.dispose(); }
  characterAppearances.registry.registerCapability({ id: COMPUTED_FIXTURE_CAPABILITY });
  characterAppearances.registry.registerProfile(profile);
  characterAppearances.registerBackend(computedFixtureBackend);
  characterAppearances.selectProfile(profile);
  sim = new MatchSim({ matchConfig: config });
  view = new MatchView(presenter);
  check(sim.buildIdentity === report.buildIdentity, 'Sequential reference build identity changed');
  // One initial view creates all actor routes before resource/shader preparation.
  const initial = sim.view();
  lastSnapshot = initial;
  presenter.runtime.setFrame(initial.stageFrame ?? initial.frame);
  view.show(initial, 0);
  resources = prepareMatchResources(presenter, ['link', 'pikachu'], () => undefined,
    { prepare: () => view.prepareShaders(), cancel: () => view.cancelShaderPreparation() });
  await resources.ready;
  report.preparation = { identity: resources.identity, resourcesAvailable: resources.resourcesAvailable, shadersReady: resources.shadersReady };
  check(resources.resourcesAvailable && resources.shadersReady, 'Match readiness was incomplete');
  presenter.frame(performance.now());
  observation(initial);
  report.result = 'READY';
}

async function runTo(target: number) {
  check(!disposed && target >= currentFrame && target <= FRAMES, 'Invalid fixture target');
  for (let frame = currentFrame + 1; frame <= target; frame++) {
    check(sim.step(inputs(frame)) === 1, `Rendered match did not advance at ${frame}`);
    if (PAUSE_FRAMES.has(frame)) sim.pause();
    const snapshot = sim.view(); // sole capture, shared by renderer and comparison
    show(snapshot);
    const expected = reference[frame - 1]!;
    check(sim.getSimDigest().hash === expected.hash, `Visual routing changed canonical gameplay at ${frame}`);
    same(authority(sim, snapshot), expected.authority, `Visual routing changed roots, receiving, sockets, contacts or events at ${frame}`);
    const row = observation(snapshot);
    report.rows.push(row);
    report.comparison.hashes++; report.comparison.authoritativeFrames++; report.comparison.sourceSocketFrames++;
    if (snapshot.debugAreas?.length) report.comparison.contactFrames++;
    report.modes[row.mode]++;
    if (!report.facings.includes(row.facing)) report.facings.push(row.facing);
    report.maximumAttachmentError = Math.max(report.maximumAttachmentError, row.attachmentError);
    report.maximumRootError = Math.max(report.maximumRootError, row.rootError);
    if (row.mode !== lastMode) report.transitions.push({ frame, from: lastMode, to: row.mode, action: row.action, phase: row.phase });
    lastMode = row.mode;
    if (PAUSE_FRAMES.has(frame)) {
      const before = observation(snapshot), hash = sim.getSimDigest().hash;
      for (let repeat = 0; repeat < 8; repeat++) presenter.frame(performance.now());
      same(observation(snapshot), before, 'Repeated paused render changed the appearance');
      check(sim.getSimDigest().hash === hash, 'Repeated paused render changed simulation');
      report.pauses.push({ frame, facing: row.facing, mode: row.mode, frozen: row.frozen, repeats: 8, stable: true });
      sim.resume();
    }
    currentFrame = frame;
    if (frame % 30 === 0) await yieldBrowser();
  }
  if (currentFrame === FRAMES) {
    check(report.modes.stored > 0 && report.modes.computed > 0 && report.modes.mixed > 0, 'Script did not exercise all three visual compositions');
    check(report.facings.includes(-1) && report.facings.includes(1), 'Script did not exercise both facings');
    report.result = 'PASS';
  }
  return observation(lastSnapshot);
}

async function restore() {
  const checkpoint = sim.captureMatchHistoryCheckpoint(), before = sim.getSimDigest().hash;
  const priorAuthority = authority(sim, { ...lastSnapshot, events: [] });
  const previousView = view;
  sim = sim.restoreMatchHistoryCheckpoint(checkpoint);
  view = new MatchView(presenter);
  const snapshot = sim.view(); // one initial read of the reconstructed instance
  lastSnapshot = snapshot;
  view.show(snapshot, 0);
  const preparation = view.prepareShaders();
  previousView.dispose();
  await preparation;
  presenter.frame(performance.now());
  check(sim.getSimDigest().hash === before, 'Checkpoint restoration changed gameplay hash');
  same(authority(sim, { ...snapshot, events: [] }), priorAuthority, 'Checkpoint restoration changed roots/contacts/sockets');
  const row = observation(snapshot);
  report.restores.push({ frame: currentFrame, hash: before, exact: true, observation: row });
  return row;
}

function dispose() {
  if (disposed) return report.cleanup;
  disposed = true; resources?.dispose(); view.dispose(); sim.dispose();
  characterAppearances.selectProfile(legacyPresentationProfile('link'));
  presenter.frame(performance.now());
  const remainingGeometry = presenter.sprites.scene.children.filter(node => node.name.startsWith('fixture:')).length;
  check(remainingGeometry === 0, 'Disposed real-match fixture retained computed scene nodes');
  report.cleanup = { remainingGeometry, textures: presenter.sprites.textures.diagnostics(), renderer: { ...presenter.renderer.info.memory } };
  return report.cleanup;
}

const ready = prepare().catch((error: unknown) => { report.result = 'FAIL'; throw error; });
Object.assign(window, { __appearanceMatchFixture: { ready, report, runTo, restore, dispose,
  snapshot: () => observation(lastSnapshot),
  renderer: () => {
    const gl = presenter.renderer.getContext(), extension = gl.getExtension('WEBGL_debug_renderer_info');
    return { vendor: extension ? gl.getParameter(extension.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
  },
} });
