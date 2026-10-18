import '@fontsource/bungee/400.css';
import '@fontsource/chakra-petch/500.css';
import '@fontsource/chakra-petch/600.css';
import '../ui/shell/menu.css';
import { isUnlocked } from '../../../src/config/accessGate';
import { loadGameSettings } from '../../../src/config/gameSettings';
import { SCREENS } from '../ui/screens';
import { StagePresenter } from '../arena/presenter';
import { MenuInput } from '../ui/shell/input';
import type { App, Screen, ScreenName } from '../ui/shell/app';
import type { MatchConfig } from '../../../src/types';
import { startFrameLoop, type FrameFault } from '../ui/shell/frameLoop';
import { createFrameRateMeter } from '../ui/components/frameRateMeter';
import { createAppVersionBadge } from '../ui/components/appVersion';
import { SIMULATION_BUILD_ID } from '../../../src/engine/buildIdentity';
import { version } from '../../../package.json';
import { packageLibrary } from '../fighters/packageLibrary';

/**
 * The port's game shell: HTML/CSS menus over a live 3D arena. Replaces the
 * Phaser menu scenes (PLAN.md step 3); the match itself arrives in step 6.
 */

const presenter = new StagePresenter(document.getElementById('backdrop')!, 'cover');
// Before any screen loads sprites, so the first match uses the saved quality.
presenter.sprites.textures.setTextureQuality(loadGameSettings().textureQuality);
const vignette = document.querySelector<HTMLElement>('.vignette')!;
const host = document.getElementById('screens')!;
const input = new MenuInput();
const frameRate = createFrameRateMeter(document.body);
createAppVersionBadge(document.body, { version, buildIdentity: SIMULATION_BUILD_ID });
let current: Screen | null = null;
let currentName: ScreenName = 'gate';
let inputFaulted = false, screenFaulted = false, rendererFaulted = false;
let graphicsAvailable = true;
const faults: Array<FrameFault & {screen: ScreenName}> = [];

// A slow sideways drift: parallax on the scenery, the gameplay plane stays put.
presenter.beforeRender = (t) => { presenter.camera.sway = Math.sin(t * 0.12) * 10; };

const app: App = {
  input,
  presenter,
  reportFault: frameFault,
  go(name, data) {
    const previous = current;
    current = null;
    inputFaulted = screenFaulted = false;
    rendererFaulted = !graphicsAvailable;
    currentName = name;
    try {
      previous?.leave?.();
      current = SCREENS[name](app, data);
      host.replaceChildren(current.root);
    } catch (error) {
      // A failed constructor has no safe screen lease to resume. Keep DOM
      // navigation available instead of forwarding to a disposed screen.
      host.replaceChildren();
      frameFault({phase: 'screen', now: performance.now(),
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack ?? null : null});
      return;
    }
    if (!graphicsAvailable) frameFault({phase: 'renderer', now: performance.now(),
      message: 'The graphics connection was lost. Wait for it to recover, then restart the match.', stack: null});
    const target = window as Window & { __sim?: { startMatch: (config: MatchConfig) => void } };
    target.__sim ??= { startMatch: (config) => app.go('match', { pending: config }) };
  },
  backdrop({ stage, mood, light, appearances }) {
    presenter.paused = false;
    presenter.viewRect = null;
    presenter.beforeRender = (t) => { presenter.camera.sway = Math.sin(t * 0.12) * 10; };
    const runtime = presenter.setStage(stage);
    runtime.view.setPlatforms(null);
    const { theme } = runtime.view;
    theme.setMood(mood && theme.moods.includes(mood) ? mood : theme.moods[0]!);
    presenter.spriteSource = null;
    presenter.appearanceSource = appearances ?? null;
    vignette.classList.toggle('is-light', Boolean(light));
    return runtime;
  },
};

input.on((event) => current?.onAction?.(event));

function frameFault(fault: FrameFault): void {
  if (fault.phase === 'input') inputFaulted = true;
  if (fault.phase === 'renderer') { rendererFaulted = true; frameRate.reset(); }
  screenFaulted = true;
  faults.push({...fault, screen: currentName});
  if (faults.length > 20) faults.shift();
  console.error(`Game ${fault.phase} stopped on ${currentName}: ${fault.message}`, fault.stack);
  if (current?.onFault) current.onFault(fault);
  else {
    const message = document.createElement('section');
    message.className = 'screen overlay';
    message.setAttribute('role', 'alertdialog');
    const panel = document.createElement('div');
    panel.className = 'center-card panel';
    panel.textContent = 'The screen stopped after an error. Return to the menu to continue.';
    const button = document.createElement('button');
    button.textContent = 'Return to menu';
    button.onclick = () => app.go('title');
    panel.append(button); message.append(panel); host.append(message);
  }
}

presenter.renderer.domElement.addEventListener('webglcontextlost', event => {
  event.preventDefault();
  graphicsAvailable = false;
  frameFault({phase: 'renderer', now: performance.now(),
    message: 'The graphics connection was lost. Wait for it to recover, then restart the match.', stack: null});
});
presenter.renderer.domElement.addEventListener('webglcontextrestored', () => {
  graphicsAvailable = true;
  rendererFaulted = false;
  // The affected screen stays stopped; its DOM restart/menu actions remain
  // available. Never continue a partially completed simulation step.
});

app.go(isUnlocked() ? 'title' : 'gate');
startFrameLoop({requestFrame: callback => window.requestAnimationFrame(callback),
  cancelFrame: id => window.cancelAnimationFrame(id),
  stages: [
    {phase: 'input', run: now => { if (!inputFaulted) input.poll(now); }},
    {phase: 'screen', run: now => { if (!screenFaulted) current?.onFrame?.(now); }},
    {phase: 'renderer', run: now => {
      if (!rendererFaulted) { presenter.frame(now); frameRate.rendered(now); }
    }},
  ], onFault: frameFault});

/** Dedicated sandbox and probes launch the same match screen as the menus. */
export function startMatch(config: MatchConfig): void { app.go('match', { pending: config }); }

// Probe hook for Playwright captures.
Object.assign(window, { __menu: { go: app.go, startMatch: (config: MatchConfig) => app.go('match', { pending: config }),
  faults,
  get screen() { return currentName; },
  presentation: () => presenter.sprites.submittedDraws().map(({ indexed, ...draw }) => {
    if (indexed) return { ...draw, indexed: { rect: indexed.rect, paletteRow: indexed.paletteRow }, loaded: true, frameWidth: indexed.rect[2], frameHeight: indexed.rect[3] };
    const sheet = presenter.sprites.textures.get(draw.key);
    return { ...draw, loaded: Boolean(sheet), frameWidth: sheet?.frameWidth, frameHeight: sheet?.frameHeight };
  }),
  /** Character packages resident on the GPU (`?packages=` opt-in). */
  packages: () => packageLibrary.diagnostics(),
} });
