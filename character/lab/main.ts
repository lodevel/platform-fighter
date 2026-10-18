import { evaluate, scheduleLength, type Facing } from '../evaluator/evaluate';
import type { CharacterPackage } from '../package/types';
import references from './references.json';
import { actionMemory, packageMemory, sharedDrawings, type MemoryEstimate } from '../package/memory';
import { loadReference, type ReferenceClip } from './reference';
import { openPickedFolder, openServedPackage, servedPackages, type OpenPackage } from './source';
import { PackageView } from './packageView';
import { drawStage, type StageView } from './stage';

interface FighterReferences { readonly referenceSet: readonly string[]; readonly ultimate: Readonly<Record<string, string>> }
const REFERENCES = references.fighters as Readonly<Record<string, FighterReferences>>;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const packageSelect = $<HTMLSelectElement>('package'), status = $('status'), filter = $<HTMLInputElement>('filter');
const actionList = $('action-list'), stage = $<HTMLCanvasElement>('stage'), referenceCanvas = $<HTMLCanvasElement>('reference');
const referenceNote = $('reference-note'), windowsCanvas = $<HTMLCanvasElement>('windows'), seek = $<HTMLInputElement>('seek');
const playButton = $<HTMLButtonElement>('play'), tickReadout = $('tick'), costumeSelect = $<HTMLSelectElement>('costume');
const compareSelect = $<HTMLSelectElement>('compare-package'), compareCanvas = $<HTMLCanvasElement>('compare');

/** The package being inspected, and optionally a second one (such as a candidate) shown beside it. */
let main: PackageView | null = null, compare: PackageView | null = null;
let action = '', tick = 0, playing = true, carry = 0, viewTicks = 1;
let reference: ReferenceClip | null = null, referenceToken = 0;

const radio = (name: string) => (document.querySelector(`input[name="${name}"]:checked`) as HTMLInputElement).value;
const checked = (id: string) => $<HTMLInputElement>(id).checked;
const view = (): StageView => ({ zoom: Number(radio('zoom')), facing: Number(radio('facing')) as Facing,
  overlays: { root: checked('ov-root'), sockets: checked('ov-sockets'), bounds: checked('ov-bounds') } });
const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const mib = (bytes: number) => `${(bytes / 1048576).toFixed(bytes < 10485760 ? 2 : 1)} MiB`;

function listCostumes(pkg: CharacterPackage): void {
  const list = pkg.costumes?.list ?? [];
  costumeSelect.replaceChildren(...list.map((costume, i) => Object.assign(document.createElement('option'), { value: String(i), textContent: `${i} ${costume.name}` })));
  $('costume-box').hidden = list.length < 2;
}

async function show(next: OpenPackage, label: string): Promise<void> {
  main = new PackageView(next, () => render()); listCostumes(next.pkg);
  status.textContent = `${label}: revision ${next.pkg.revision.slice(0, 12) || 'none'}`;
  const problems = $('problems');
  problems.replaceChildren(...(next.problems.length ? next.problems : ['None']).map(text => Object.assign(document.createElement('li'), { textContent: text })));
  listActions();
  const first = REFERENCES[next.pkg.id]?.referenceSet.find(id => next.pkg.actions[id]) ?? Object.keys(next.pkg.actions).sort()[0]!;
  await selectAction(first);
}

function listActions(): void {
  const open = main?.open;
  if (!open) return;
  const query = filter.value.trim().toLowerCase(), all = Object.keys(open.pkg.actions).sort();
  const pinned = (REFERENCES[open.pkg.id]?.referenceSet ?? []).filter(id => open.pkg.actions[id]);
  const item = (id: string) => {
    const li = document.createElement('li'), button = document.createElement('button');
    button.type = 'button'; button.textContent = id; button.setAttribute('aria-current', String(id === action));
    button.addEventListener('click', () => void selectAction(id));
    li.append(button); return li;
  };
  const group = (text: string) => Object.assign(document.createElement('li'), { className: 'group', textContent: text });
  const matches = (id: string) => !query || id.toLowerCase().includes(query);
  actionList.replaceChildren(
    ...(pinned.some(matches) ? [group('Reference set'), ...pinned.filter(matches).map(item)] : []),
    group(`All actions (${all.length})`), ...all.filter(matches).map(item));
}

/** Ticks to show for an action: one loop, or the action plus half a second after it. */
function actionTicks(pkg: CharacterPackage, id: string): number {
  const schedule = pkg.actions[id]?.drawings;
  return !schedule ? 1 : schedule.after === 'loop' ? scheduleLength(schedule) : scheduleLength(schedule) + 30;
}

async function selectAction(id: string): Promise<void> {
  if (!main) return;
  const pkg = main.pkg;
  action = id; tick = 0; carry = 0;
  const schedule = pkg.actions[id]!.drawings, length = scheduleLength(schedule);
  viewTicks = Math.max(actionTicks(pkg, id), compare ? actionTicks(compare.pkg, id) : 1);
  listActions();
  $('stage-caption').textContent = `Package: ${pkg.id} / ${id}`;
  describe();
  facts($('action-facts'), [['Length', `${length} ticks`], ['After the end', schedule.after], ['Windows', String(schedule.windows.length)],
    ['Sockets', Object.keys(pkg.actions[id]!.sockets ?? {}).join(', ') || 'none']]);
  reference?.close(); reference = null;
  const token = ++referenceToken, path = REFERENCES[pkg.id]?.ultimate[id];
  referenceNote.textContent = path ? 'Loading the Ultimate recording…' : 'No Ultimate recording for this action yet.';
  if (path) {
    try {
      const clip = await loadReference(`/references/${path}`);
      if (token !== referenceToken) { clip?.close(); return; }
      reference = clip;
      referenceNote.textContent = clip ? `Ultimate Frame Data recording, ${clip.ticks} ticks, played on the same clock.`
        : 'This browser cannot decode the recording frame by frame (needs ImageDecoder, e.g. Edge).';
      if (clip) viewTicks = Math.max(viewTicks, clip.ticks);
    } catch (error) {
      if (token === referenceToken) referenceNote.textContent = `Recording unavailable here: ${(error as Error).message}`;
    }
  }
  seek.max = String(viewTicks - 1);
  render();
}

/** Memory of the action and package, and of the compared package when one is chosen. */
function describe(): void {
  if (!main) return;
  const rows = (view: PackageView, prefix: string): [string, string][] => [
    ...memoryRows(`${prefix}action`, actionMemory(view.pkg, action), []),
    ...memoryRows(`${prefix}package`, packageMemory(view.pkg), [['Shared drawings', String(sharedDrawings(view.pkg))]])];
  facts($('memory'), [...rows(main, ''), ...(compare ? rows(compare, 'Compared ') : [])]);
  const compared = compare?.pkg.actions[action];
  $('compare-caption').textContent = compare ? `Compared: ${compareSelect.value} / ${compared ? action : `${action} is missing`}` : '';
}

function memoryRows(title: string, m: MemoryEstimate, extra: [string, string][]): [string, string][] {
  return [[`${title[0]!.toUpperCase()}${title.slice(1)}: drawings`, String(m.drawings)], ['Pages', String(m.pages)], ['Drawn pixels', `${(m.drawnPixels / 1e6).toFixed(2)} M`],
    ['RGBA8', mib(m.rgbaBytes)], ['BC7', mib(m.bc7Bytes)], ['GPU', mib(m.gpuBytes)], ...extra];
}

function facts(list: HTMLElement, rows: [string, string][]): void {
  list.replaceChildren(...rows.flatMap(([term, value]) => [
    Object.assign(document.createElement('dt'), { textContent: term }), Object.assign(document.createElement('dd'), { textContent: value })]));
}

function render(): void {
  if (!main || !action) return;
  const v = view(), light = radio('stage') === 'light', costume = Number(costumeSelect.value || 0);
  const colors = { stage: css(light ? '--stage-light' : '--stage-dark'), floor: css('--floor'), root: css('--root'), socket: css('--socket'), bounds: css('--bounds') };
  const draw = (canvas: HTMLCanvasElement, packageView: PackageView) => {
    const pose = evaluate(packageView.pkg, { action, tick, facing: v.facing });
    drawStage(canvas, packageView.pkg, pose, drawing => packageView.pixels(drawing, costume), v, colors);
    return pose;
  };
  const pose = draw(stage, main);
  if (compare?.pkg.actions[action]) draw(compareCanvas, compare);
  drawReference(light);
  drawWindows();
  seek.value = String(tick);
  tickReadout.textContent = `tick ${tick} / ${viewTicks}  ·  drawing ${pose.drawing ?? 'none'}${pose.sample === undefined ? '' : `  ·  source frame ${pose.sample}`}`;
}

function drawReference(light: boolean): void {
  const ratio = devicePixelRatio || 1, width = referenceCanvas.clientWidth, height = referenceCanvas.clientHeight;
  referenceCanvas.width = Math.round(width * ratio); referenceCanvas.height = Math.round(height * ratio);
  const ctx = referenceCanvas.getContext('2d')!;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.fillStyle = css(light ? '--stage-light' : '--stage-dark'); ctx.fillRect(0, 0, width, height);
  if (!reference) return;
  const frame = reference.frameAt(tick), fit = Math.min(width / frame.width, height / frame.height);
  ctx.save();
  if (view().facing === -1) { ctx.translate(width, 0); ctx.scale(-1, 1); }
  ctx.drawImage(frame, (width - frame.width * fit) / 2, (height - frame.height * fit) / 2, frame.width * fit, frame.height * fit);
  ctx.restore();
}

/** The action's drawing windows as alternating bands (the compared package's below), with the current tick marked. */
function drawWindows(): void {
  const ratio = devicePixelRatio || 1, width = windowsCanvas.clientWidth, height = windowsCanvas.clientHeight;
  windowsCanvas.width = Math.round(width * ratio); windowsCanvas.height = Math.round(height * ratio);
  const ctx = windowsCanvas.getContext('2d')!, x = (t: number) => t / viewTicks * width;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.fillStyle = css('--panel'); ctx.fillRect(0, 0, width, height);
  const rows = [main, compare].map(view => view?.pkg.actions[action]?.drawings.windows).filter(windows => windows !== undefined);
  const band = (height - 8) / rows.length;
  rows.forEach((windows, row) => windows.forEach((w, i) => {
    ctx.fillStyle = i % 2 ? css('--line') : css('--muted');
    ctx.fillRect(x(w.start), 4 + row * band + 1, Math.max(1, x(w.end) - x(w.start) - 1), band - 2);
  }));
  ctx.fillStyle = css('--accent'); ctx.fillRect(x(tick), 0, Math.max(2, width / viewTicks), height);
}

function setTick(next: number): void { tick = ((Math.round(next) % viewTicks) + viewTicks) % viewTicks; render(); }

let last = performance.now();
function frame(now: number): void {
  const speed = Number(radio('speed'));
  if (playing && main && action) {
    carry += (now - last) / (1000 / 60) * speed;
    if (carry >= 1) { const steps = Math.floor(carry); carry -= steps; setTick(tick + steps); }
  }
  last = now;
  requestAnimationFrame(frame);
}

function setPlaying(next: boolean): void { playing = next; playButton.textContent = next ? 'Pause' : 'Play'; }

playButton.addEventListener('click', () => setPlaying(!playing));
$('back').addEventListener('click', () => { setPlaying(false); setTick(tick - 1); });
$('next').addEventListener('click', () => { setPlaying(false); setTick(tick + 1); });
seek.addEventListener('input', () => { setPlaying(false); setTick(Number(seek.value)); });
filter.addEventListener('input', listActions);
document.querySelectorAll('.options input').forEach(input => input.addEventListener('change', render));
costumeSelect.addEventListener('change', () => {
  try { render(); } catch (error) { status.textContent = (error as Error).message; costumeSelect.value = '0'; render(); }
});
compareSelect.addEventListener('change', () => void openCompare(compareSelect.value));
addEventListener('resize', render);
addEventListener('keydown', event => {
  if (event.target instanceof HTMLInputElement && event.target.type === 'search') return;
  if (event.key === ' ') { event.preventDefault(); setPlaying(!playing); }
  else if (event.key === 'ArrowLeft') { setPlaying(false); setTick(tick - 1); }
  else if (event.key === 'ArrowRight') { setPlaying(false); setTick(tick + 1); }
});
packageSelect.addEventListener('change', () => void openServed(packageSelect.value));
$<HTMLInputElement>('folder').addEventListener('change', async event => {
  const files = (event.target as HTMLInputElement).files;
  if (!files?.length) return;
  try { await show(await openPickedFolder(files), 'Folder'); } catch (error) { status.textContent = (error as Error).message; }
});

async function openServed(id: string): Promise<void> {
  try { await show(await openServedPackage(id), id); } catch (error) { status.textContent = (error as Error).message; }
}

async function openCompare(id: string): Promise<void> {
  try { compare = id ? new PackageView(await openServedPackage(id), () => render()) : null; } catch (error) { status.textContent = (error as Error).message; compare = null; }
  $('compare-box').hidden = !compare;
  if (action) await selectAction(action);
}

async function start(): Promise<void> {
  setPlaying(!matchMedia('(prefers-reduced-motion: reduce)').matches);
  const ids = await servedPackages();
  packageSelect.replaceChildren(...ids.map(id => Object.assign(document.createElement('option'), { value: id, textContent: id })));
  packageSelect.parentElement!.hidden = ids.length === 0;
  compareSelect.replaceChildren(Object.assign(document.createElement('option'), { value: '', textContent: 'nothing' }),
    ...ids.map(id => Object.assign(document.createElement('option'), { value: id, textContent: id })));
  compareSelect.parentElement!.hidden = ids.length === 0;
  const wanted = new URLSearchParams(location.search).get('package'), first = ids.includes(wanted ?? '') ? wanted! : ids[0];
  if (first) { packageSelect.value = first; await openServed(first); }
  else status.textContent = 'No served packages: run scripts/export-character-packages.ts, or open a package folder.';
  const wantedAction = new URLSearchParams(location.search).get('action');
  const wantedCompare = new URLSearchParams(location.search).get('compare');
  if (wantedCompare && ids.includes(wantedCompare)) { compareSelect.value = wantedCompare; await openCompare(wantedCompare); }
  if (wantedAction && main?.pkg.actions[wantedAction]) await selectAction(wantedAction);
  requestAnimationFrame(frame);
}
void start();
