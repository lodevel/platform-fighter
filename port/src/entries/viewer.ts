import { STAGES } from '../../../src/stages/stageDefinitions';
import { StagePresenter } from '../arena/presenter';
import '@fontsource/bungee/400.css';
import '@fontsource/chakra-petch/600.css';
import { gazeDemoAppearances, gazeDemoHud } from '../fighters/gazeDemo';
import { MatchHud } from '../ui/hud/matchHud';
import { viewerFighterAppearances } from '../fighters/lineup';
import { AppearanceCollection, applyFighterDisplay } from '../fighters/appearance';

/**
 * Stage viewer: any built-in stage in 3D with the stand-in cast, the stage
 * hazards stepped at 60 Hz, and the exact collision outlines on demand.
 * Query: ?stage=lava&frame=120&overlay=1&mood=night&pause=1&ui=0&fighters=0
 */
const params = new URLSearchParams(location.search);
const presenter = new StagePresenter(document.getElementById('view')!);
applyFighterDisplay();
const appearances = new AppearanceCollection();
addEventListener('pagehide', () => appearances.dispose(), { once: true });
presenter.paused = params.get('pause') === '1';
let showFighters = params.get('fighters') !== '0';
let overlay = params.get('overlay') === '1';
let stageId = params.get('stage') ?? 'flat';
presenter.appearanceSource = (runtime) => {
  if (!showFighters) return [];
  // Stages with the Inferno head run its demo: crouch or be blasted away.
  if (runtime.hazards.gaze) return gazeDemoAppearances(appearances, runtime);
  return viewerFighterAppearances(appearances, runtime);
};

function setStage(id: string): void {
  const frame = presenter.runtime?.frame ?? Number(params.get('frame') ?? 0);
  stageId = id;
  const runtime = presenter.setStage(id);
  runtime.view.overlay.visible = overlay;
  runtime.setFrame(frame);
  buildButtons();
}

// ---------- controls ----------
const ui = document.getElementById('panel')!;
ui.hidden = params.get('ui') === '0';
const frameOut = document.getElementById('frame')!;
const pressed = (b: HTMLElement, on: boolean) => b.setAttribute('aria-pressed', String(on));
function buttonRow(hostId: string, items: readonly string[], active: string, pick: (v: string) => void): void {
  const row = document.getElementById(hostId)!;
  row.replaceChildren(...items.map((v) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = v;
    pressed(b, v === active);
    b.onclick = () => { pick(v); row.querySelectorAll('button').forEach((x) => pressed(x, x === b)); };
    return b;
  }));
}
function buildButtons(): void {
  buttonRow('stages', Object.keys(STAGES), stageId, setStage);
  const { theme } = presenter.runtime.view;
  const mood = params.get('mood');
  if (mood && theme.moods.includes(mood)) theme.setMood(mood);
  buttonRow('moods', theme.moods, mood && theme.moods.includes(mood) ? mood : theme.moods[0]!, (m) => theme.setMood(m));
}
const toggle = (id: string, get: () => boolean, set: (on: boolean) => void) => {
  const b = document.getElementById(id)!;
  pressed(b, get());
  b.onclick = () => { set(!get()); pressed(b, get()); };
  return b;
};
toggle('fighters', () => showFighters, (on) => { showFighters = on; });
const overlayBtn = toggle('overlay', () => overlay, (on) => { overlay = on; presenter.runtime.view.overlay.visible = on; });
const pauseBtn = toggle('pause', () => presenter.paused, (on) => { presenter.paused = on; });
document.getElementById('step')!.onclick = () => presenter.runtime.step();

setStage(stageId);
// The Inferno demo also shows the match HUD (damage, stocks).
const hud = new MatchHud();
document.body.append(hud.root);
function tick(now: number): void {
  presenter.frame(now);
  const hudView = showFighters ? gazeDemoHud(presenter.runtime) : null;
  hud.root.hidden = !hudView;
  if (hudView) hud.update(hudView);
  frameOut.textContent = `frame ${presenter.runtime.frame}`;
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// Probe hook for Playwright captures (mirrors window.__game in the Phaser build).
Object.assign(window, {
  __port: {
    setStage,
    setFrame: (n: number) => presenter.runtime.setFrame(n),
    setOverlay: (on: boolean) => { overlay = on; presenter.runtime.view.overlay.visible = on; pressed(overlayBtn, on); },
    setPaused: (on: boolean) => { presenter.paused = on; pressed(pauseBtn, on); },
    project: (x: number, y: number) => presenter.project(x, y),
    get frame() { return presenter.runtime.frame; },
    get stage() { return stageId; },
  },
});
