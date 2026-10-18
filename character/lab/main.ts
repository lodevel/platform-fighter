import { evaluate, scheduleLength, type Facing } from '../evaluator/evaluate';
import type { CharacterPackage } from '../package/types';
import references from './references.json';
import { actionMemory, packageMemory, sharedDrawings, type MemoryEstimate } from './memory';
import { loadReference, type ReferenceClip } from './reference';
import { openPickedFolder, openServedPackage, servedPackages, type OpenPackage } from './source';
import { drawStage, type StageView } from './stage';

interface FighterReferences { readonly referenceSet: readonly string[]; readonly ultimate: Readonly<Record<string, string>> }
const REFERENCES = references.fighters as Readonly<Record<string, FighterReferences>>;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const packageSelect = $<HTMLSelectElement>('package'), status = $('status'), filter = $<HTMLInputElement>('filter');
const actionList = $('action-list'), stage = $<HTMLCanvasElement>('stage'), referenceCanvas = $<HTMLCanvasElement>('reference');
const referenceNote = $('reference-note'), windowsCanvas = $<HTMLCanvasElement>('windows'), seek = $<HTMLInputElement>('seek');
const playButton = $<HTMLButtonElement>('play'), tickReadout = $('tick');

let open: OpenPackage | null = null, action = '', tick = 0, playing = true, carry = 0, viewTicks = 1;
let reference: ReferenceClip | null = null, referenceToken = 0;
const images = new Map<string, HTMLImageElement>();

const radio = (name: string) => (document.querySelector(`input[name="${name}"]:checked`) as HTMLInputElement).value;
const checked = (id: string) => $<HTMLInputElement>(id).checked;
const view = (): StageView => ({ zoom: Number(radio('zoom')), facing: Number(radio('facing')) as Facing,
  overlays: { root: checked('ov-root'), sockets: checked('ov-sockets'), bounds: checked('ov-bounds') } });
const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const mib = (bytes: number) => `${(bytes / 1048576).toFixed(bytes < 10485760 ? 2 : 1)} MiB`;

function pageImage(page: string): HTMLImageElement | undefined {
  if (!open) return undefined;
  let image = images.get(page);
  if (!image) {
    image = new Image();
    image.src = open.fileUrl(open.pkg.pages[page]!.file);
    image.onload = () => render();
    images.set(page, image);
  }
  return image.complete && image.naturalWidth ? image : undefined;
}

async function show(next: OpenPackage, label: string): Promise<void> {
  open = next; images.clear();
  status.textContent = `${label}: revision ${next.pkg.revision.slice(0, 12) || 'none'}`;
  const problems = $('problems');
  problems.replaceChildren(...(next.problems.length ? next.problems : ['None']).map(text => Object.assign(document.createElement('li'), { textContent: text })));
  const memory = packageMemory(next.pkg);
  facts($('memory'), memoryRows('Package', memory, [['Shared drawings', String(sharedDrawings(next.pkg))]]));
  listActions();
  const first = REFERENCES[next.pkg.id]?.referenceSet.find(id => next.pkg.actions[id]) ?? Object.keys(next.pkg.actions).sort()[0]!;
  await selectAction(first);
}

function listActions(): void {
  if (!open) return;
  const query = filter.value.trim().toLowerCase(), all = Object.keys(open.pkg.actions).sort();
  const pinned = (REFERENCES[open.pkg.id]?.referenceSet ?? []).filter(id => open!.pkg.actions[id]);
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

async function selectAction(id: string): Promise<void> {
  if (!open) return;
  action = id; tick = 0; carry = 0;
  const schedule = open.pkg.actions[id]!.drawings, length = scheduleLength(schedule);
  viewTicks = schedule.after === 'loop' ? length : length + 30;
  listActions();
  $('stage-caption').textContent = `Package: ${open.pkg.id} / ${id}`;
  const memory = actionMemory(open.pkg, id);
  facts($('action-facts'), [['Length', `${length} ticks`], ['After the end', schedule.after], ['Windows', String(schedule.windows.length)],
    ['Sockets', Object.keys(open.pkg.actions[id]!.sockets ?? {}).join(', ') || 'none'], ...memoryRows('This action', memory, [])]);
  reference?.close(); reference = null;
  const token = ++referenceToken, path = REFERENCES[open.pkg.id]?.ultimate[id];
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

function memoryRows(title: string, m: MemoryEstimate, extra: [string, string][]): [string, string][] {
  return [[`${title}: drawings`, String(m.drawings)], ['Pages', String(m.pages)], ['Drawn pixels', `${(m.drawnPixels / 1e6).toFixed(2)} M`],
    ['RGBA8', mib(m.rgbaBytes)], ['BC7', mib(m.bc7Bytes)], ...extra];
}

function facts(list: HTMLElement, rows: [string, string][]): void {
  list.replaceChildren(...rows.flatMap(([term, value]) => [
    Object.assign(document.createElement('dt'), { textContent: term }), Object.assign(document.createElement('dd'), { textContent: value })]));
}

function render(): void {
  if (!open || !action) return;
  const v = view(), pose = evaluate(open.pkg, { action, tick, facing: v.facing });
  const light = radio('stage') === 'light';
  drawStage(stage, open.pkg, pose, pageImage, v, { stage: css(light ? '--stage-light' : '--stage-dark'), floor: css('--floor'),
    root: css('--root'), socket: css('--socket'), bounds: css('--bounds') });
  drawReference(light);
  drawWindows(open.pkg);
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

/** The action's drawing windows as alternating bands, with the current tick marked. */
function drawWindows(pkg: CharacterPackage): void {
  const ratio = devicePixelRatio || 1, width = windowsCanvas.clientWidth, height = windowsCanvas.clientHeight;
  windowsCanvas.width = Math.round(width * ratio); windowsCanvas.height = Math.round(height * ratio);
  const ctx = windowsCanvas.getContext('2d')!, x = (t: number) => t / viewTicks * width;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.fillStyle = css('--panel'); ctx.fillRect(0, 0, width, height);
  pkg.actions[action]!.drawings.windows.forEach((w, i) => {
    ctx.fillStyle = i % 2 ? css('--line') : css('--muted');
    ctx.fillRect(x(w.start), 6, Math.max(1, x(w.end) - x(w.start) - 1), height - 12);
  });
  ctx.fillStyle = css('--accent'); ctx.fillRect(x(tick), 0, Math.max(2, width / viewTicks), height);
}

function setTick(next: number): void { tick = ((Math.round(next) % viewTicks) + viewTicks) % viewTicks; render(); }

let last = performance.now();
function frame(now: number): void {
  const speed = Number(radio('speed'));
  if (playing && open && action) {
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

async function start(): Promise<void> {
  setPlaying(!matchMedia('(prefers-reduced-motion: reduce)').matches);
  const ids = await servedPackages();
  packageSelect.replaceChildren(...ids.map(id => Object.assign(document.createElement('option'), { value: id, textContent: id })));
  packageSelect.parentElement!.hidden = ids.length === 0;
  const wanted = new URLSearchParams(location.search).get('package'), first = ids.includes(wanted ?? '') ? wanted! : ids[0];
  if (first) { packageSelect.value = first; await openServed(first); }
  else status.textContent = 'No served packages: run scripts/export-character-packages.ts, or open a package folder.';
  const wantedAction = new URLSearchParams(location.search).get('action');
  if (wantedAction && open?.pkg.actions[wantedAction]) await selectAction(wantedAction);
  requestAnimationFrame(frame);
}
void start();
