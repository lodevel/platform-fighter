import { AudioManager, DEFAULT_AUDIO_CUES } from '../../../../src/audio/AudioManager';
import { StageMusicController } from '../../../../src/audio/StageMusicController';
import { InputProfileStore } from '../../../../src/input/InputProfileStore';
import { GamepadConnectionMonitor } from '../../../../src/input/GamepadConnectionMonitor';
import { ControllerReconnectionHandler } from '../../../../src/input/ControllerReconnectionHandler';
import { DisconnectPauseController } from '../../../../src/match/DisconnectPauseController';
import type { MatchHistoryCheckpoint } from '../../../../src/replay/MatchHistoryCheckpoint';
import { MatchSim } from '../../../../src/sim/MatchSim';
import type { SimView } from '../../../../src/sim/view';
import type { MatchConfig } from '../../../../src/types';
import type { PauseAction } from '../../../../src/scenes/pauseMenu';
import type { CharacterInput } from '../../../../src/characters/Character';
import { WebAudioSoundManager } from '../../engine/audio/webAudioSoundManager';
import { MatchView } from '../../match/matchView';
import { prepareMatchResources } from '../../match/preloadMatchArt';
import { createPauseOverlay, type PauseOverlay } from '../components/pauseOverlay';
import { createMatchControlsOverlay, type MatchControlsOverlay } from '../components/matchControlsOverlay';
import { MatchHud } from '../hud/matchHud';
import type { App, FlowData, Screen } from '../shell/app';
import { el } from '../shell/dom';
import { GameplayInput } from '../shell/gameplayInput';
import type { FrameFault } from '../shell/frameLoop';

const FRAME_MS = 1000 / 60;

/** The live browser host: fixed simulation ticks, renderer, sound, HUD and match flows. */
export function matchScreen(app: App, data: FlowData = {}): Screen {
  let config = data.pending as MatchConfig;
  const runtime = app.backdrop({ stage: config.stageId, light: true });
  const presenter = app.presenter;
  presenter.paused = true;
  presenter.beforeRender = null;
  presenter.camera.sway = 0;
  runtime.setFrame(0);
  const input = new GameplayInput(config);
  let sim = new MatchSim({ matchConfig: config, bindingsStore: input.bindings,
    runtimeBindingsStore: input.bindings, inputProfiles: new InputProfileStore(), inputHistory: input.resolver });
  const context = new AudioContext();
  const sound = new WebAudioSoundManager(context);
  sound.unlockOnGesture();
  void sound.preload(Object.keys(DEFAULT_AUDIO_CUES));
  const audio = new AudioManager({ soundManager: sound });
  const music = StageMusicController.fromSoundManager(sound);
  music.start();
  let view = new MatchView(presenter, audio);
  const hud = new MatchHud();
  const status = el('div.match-status', { role: 'status' });
  const root = el('section.live-match', { 'aria-label': 'Live match' }, hud.root, status,
    el('button.match-pause', { type: 'button', onclick: () => openPause(), title: 'Pause (Esc / Start)', 'aria-label': 'Pause match' }, 'Ⅱ'));
  let pause: PauseOverlay | null = null;
  let controls: MatchControlsOverlay | null = null;
  let fault: (FrameFault & {frame: number; buildIdentity: string}) | null = null;
  let last = performance.now(), disposed = false, manual = false;
  let ready = false;
  // Capture once so every appearance instance exists before backend preparation.
  render();
  const resources = prepareMatchResources(presenter, config.players.map((player) => player.characterId), (done, total) => {
    if (disposed || fault) return;
    status.classList.add('is-loading');
    status.textContent = `Preparing fighters · ${done}/${total}`;
  }, { prepare: () => view.prepareShaders(), cancel: () => view.cancelShaderPreparation() });
  // Shape programs compile while PNGs decode; neither path draws warm-up art.
  // Keep gameplay stopped until both preparations finish, including on restart.
  const assetsReady = resources.ready.then(() => {
    if (disposed || fault) return;
    ready = true;
    status.classList.remove('is-loading');
    status.textContent = '';
    last = performance.now();
  });
  function preparationFailed(error: unknown): void {
    if (disposed || fault) return;
    app.reportFault({phase: 'screen', now: performance.now(),
      message: `Could not prepare match: ${error instanceof Error ? error.message : String(error)}`,
      stack: error instanceof Error ? error.stack ?? null : null});
  }
  void assetsReady.catch(preparationFailed);
  const monitor = new GamepadConnectionMonitor({ bindings: input.bindings });
  const reconnect = new ControllerReconnectionHandler({ monitor, bindings: input.bindings, initialActive: true,
    onRebind(event) {
      config = { ...config, players: config.players.map((player, index) => event.affectedSlots.includes((index + 1) as 1 | 2 | 3 | 4)
        ? { ...player, inputDevice: { kind: 'gamepad', gamepadIndex: event.newGamepadIndex } } : player) };
      for (const index of [1, 2, 3, 4] as const) sim.finalBindingsStore?.set(index, input.bindings.get(index));
    } });
  const disconnectPause = new DisconnectPauseController({monitor, initialActive: true,
    simulation: {pause: () => openPause(), resume: () => closePause(true),
      isPaused: () => Boolean(pause || fault || sim.physicsEngine.isPaused())}});
  monitor.start();
  reconnect.start();
  disconnectPause.start();

  function render(deltaMs = FRAME_MS): SimView {
    const snapshot = sim.view();
    runtime.setFrame(snapshot.stageFrame ?? snapshot.frame);
    runtime.view.setPlatforms(snapshot.platforms ?? null);
    view.show(snapshot, deltaMs);
    hud.update(snapshot.hud);
    if (ready) status.textContent = sim.matchEndDetector.isMatchOver() ? 'GAME!' : sim.getSourceIntroSnapshot() ? 'READY' : '';
    return snapshot;
  }

  function closePause(fromDisconnect = false): void {
    if (fault) return;
    if (!fromDisconnect && disconnectPause.isPausedDueToDisconnect()) {
      disconnectPause.acknowledgeAndResume(); return;
    }
    pause?.node.remove();
    pause = null;
    input.clear();
    last = performance.now();
    sim.resume();
  }

  function openPause(): void {
    if (pause || fault || disposed || sim.isFinished) return;
    sim.pause();
    input.clear();
    pause = createPauseOverlay(choosePause);
    root.append(pause.node);
  }

  function stopAfterFault(reason: FrameFault): void {
    if (fault || disposed) return;
    fault = {...reason, frame: sim.physicsEngine.getFrame(), buildIdentity: sim.buildIdentity};
    resources.cancel();
    sim.pause(); input.clear();
    controls?.dispose(); controls = null;
    pause?.node.remove(); pause = null;
    app.input.suspended = false;
    status.textContent = '';
    const panel = el('section.screen.overlay', {role: 'alertdialog', 'aria-label': 'Match stopped'},
      el('div.body', {}, el('div.center-card.panel', {style: {width: 'min(520px, 100%)'}},
        el('h2', {}, 'Match stopped'),
        el('p', {}, 'An error interrupted the match. Restart it or return to the menu.'),
        el('div.pause-list', {},
          el('button.pause-opt', {type: 'button', onclick: () => choosePause('restart')}, el('b', {}, 'Restart match')),
          el('button.pause-opt', {type: 'button', onclick: () => choosePause('mainMenu')}, el('b', {}, 'Return to menu'))))));
    root.append(panel);
    panel.querySelector('button')?.focus();
  }

  function choosePause(action: PauseAction): void {
      if (action === 'resume') closePause();
      else if (action === 'restart') app.go('match', { ...data, pending: config });
      else if (action === 'characterSelect') app.go('fighters', { ...data, pending: config });
      else if (action === 'mainMenu') app.go('title');
      else if (action === 'controls') {
        app.input.suspended = true;
        pause!.node.hidden = true;
        controls = createMatchControlsOverlay(config.players, (players) => {
          controls = null;
          config = { ...config, players };
          input.refresh(players);
          for (const index of [1, 2, 3, 4] as const) sim.finalBindingsStore?.set(index, input.bindings.get(index));
          app.input.suspended = false;
          if (pause) pause.node.hidden = false;
        });
        root.append(controls.node);
      }
  }

  const blur = () => openPause();
  const debugKey = (event: KeyboardEvent) => {
    if (event.code === 'F3') { event.preventDefault(); view.debug = !view.debug; render(); }
    else if (pause && !controls) {
      const action = ({ KeyR: 'restart', KeyC: 'characterSelect', KeyM: 'mainMenu', KeyK: 'controls' } as const)[event.code as 'KeyR' | 'KeyC' | 'KeyM' | 'KeyK'];
      if (action) { event.preventDefault(); choosePause(action); }
    }
  };
  addEventListener('blur', blur);
  addEventListener('keydown', debugKey);

  // Stable probe surface: gameplay state comes from the actual simulation.
  const probe = {
    ready: assetsReady,
    get match() { return sim; },
    get frame() { return sim.physicsEngine.getFrame(); },
    get paused() { return Boolean(pause || fault); },
    get fault() { return fault; },
    get config() { return config; },
    inputResolver: input.resolver,
    state: () => sim.captureMatchHistoryEvidence(),
    checkpoint: () => sim.captureMatchHistoryCheckpoint(),
    restore: (checkpoint: MatchHistoryCheckpoint) => {
      if (!ready) throw new Error('Wait for __sim.ready before restoring the match');
      sim = sim.restoreMatchHistoryCheckpoint(checkpoint);
      for (const index of [1, 2, 3, 4] as const) if (sim.finalBindingsStore) input.bindings.set(index, sim.finalBindingsStore.get(index));
      const previousView = view;
      view = new MatchView(presenter, audio);
      if (sim.pausedForMenu && !pause) openPause();
      else if (!sim.pausedForMenu && pause) { pause.node.remove(); pause = null; }
      const snapshot = render();
      // Acquire the replacement material's cached program before releasing the
      // old view's final reference, so restored diagnostics stay prepared too.
      void view.prepareShaders().catch(preparationFailed);
      previousView.dispose();
      return snapshot;
    },
    view: () => sim.view(),
    presentation: (playerIndex: number) => view.presentation(playerIndex),
    presentationSprites: () => view.presentationSprites(),
    renderDiagnostics: () => ({textures: presenter.sprites.textures.diagnostics(),
      renderer: {memory: {...presenter.renderer.info.memory}, render: {...presenter.renderer.info.render}},
      contextLost: presenter.renderer.getContext().isContextLost()}),
    advance: (deltaMs: number) => {
      if (!ready) throw new Error('Wait for __sim.ready before advancing the match');
      sim.advance(deltaMs, (frame) => input.sample(frame));
      return render(deltaMs);
    },
    draw: () => { const snapshot = render(0); presenter.frame(performance.now()); return snapshot; },
    startMatch: (matchConfig: MatchConfig) => app.go('match', { pending: matchConfig }),
    pause: () => openPause(), resume: () => closePause(),
    /** Manual mode prevents animation frames racing deterministic probes. */
    manual: (enabled = true) => { manual = enabled; last = performance.now(); },
    step: (inputs?: readonly (CharacterInput | null | undefined)[]) => {
      if (!ready) throw new Error('Wait for __sim.ready before stepping the match');
      sim.step(inputs ?? (sim.getSourceIntroSnapshot() ? undefined : input.sample(sim.physicsEngine.getFrame())));
      return render();
    },
    project: (x: number, y: number) => presenter.project(x, y),
  };
  Object.assign(window, { __sim: probe });

  return {
    root,
    onAction(event) {
      if (fault) {
        if (event.action === 'confirm' || event.action === 'start') choosePause('restart');
        else if (event.action === 'back') choosePause('mainMenu');
        return;
      }
      if (controls) return;
      if (pause) { pause.onAction(event); return; }
      if (event.action === 'start' || (event.device === 'keyboard' && event.action === 'back')) openPause();
    },
    onFrame(now) {
      if (fault) return;
      if (controls) controls.poll(now, app.input.pads());
      const delta = Math.min(100, Math.max(0, now - last));
      last = now;
      if (!ready || pause || manual) return;
      sim.advance(delta, (frame) => sim.getSourceIntroSnapshot() ? undefined : input.sample(frame));
      render(delta);
      if (sim.isFinished && sim.result) app.go('results', { ...data, pending: config, result: sim.result });
    },
    onFault: stopAfterFault,
    leave() {
      disposed = true;
      resources.dispose();
      removeEventListener('blur', blur);
      removeEventListener('keydown', debugKey);
      controls?.dispose();
      reconnect.stop();
      disconnectPause.stop();
      monitor.stop();
      app.input.suspended = false;
      input.dispose();
      sim.dispose();
      view.dispose();
      music.destroy();
      audio.destroy();
      void context.close();
      presenter.paused = false;
      presenter.viewRect = null;
      presenter.spriteSource = null;
      presenter.appearanceSource = null;
      if ((window as Window & { __sim?: unknown }).__sim === probe) delete (window as Window & { __sim?: unknown }).__sim;
    },
  };
}
