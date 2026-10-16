import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReplayFile } from '../../../src/replay/ReplayFile';
import type { MatchConfig } from '../../../src/types';
import type { App, FlowData } from './shell/app';
import { resultsScreen } from './screens/results';

const mocks = vi.hoisted(() => ({ download: vi.fn(), dispose: vi.fn() }));
vi.mock('../fighters/appearance', () => ({ AppearanceCollection: class { dispose() { mocks.dispose(); } } }));
vi.mock('../fighters/lineup', () => ({ lineupAppearances: () => [] }));
vi.mock('../../../src/replay/downloadReplay', () => ({ downloadReplayFile: mocks.download }));

/** Only DOM construction, focus and click semantics used by this screen. The
 * browser acceptance checks the actual layout and downloaded replay payload. */
class Element {
  children: Array<Element | string> = [];
  attributes: Record<string, string> = {};
  style: Record<string, string> = {};
  className = '';
  disabled = false;
  onclick: (() => void) | null = null;
  onfocus: (() => void) | null = null;
  focused = false;
  constructor(readonly tagName: string) {}
  classList = { toggle: (name: string, enabled: boolean) => {
    const names = new Set(this.className.split(' ').filter(Boolean));
    if (enabled) names.add(name); else names.delete(name);
    this.className = [...names].join(' ');
  } };
  setAttribute(key: string, value: string) { this.attributes[key] = value; }
  append(child: Element | string) { this.children.push(child); }
  get textContent(): string { return this.children.map(child => typeof child === 'string' ? child : child.textContent).join(''); }
  set textContent(text: string) { this.children = [text]; }
  click() { if (!this.disabled) this.onclick?.(); }
  focus() { this.focused = true; this.onfocus?.(); }
}
function descendants(root: Element): Element[] {
  return [root, ...root.children.flatMap(child => typeof child === 'string' ? [] : descendants(child))];
}
const config: MatchConfig = { mode: 'stocks', stockCount: 3, stageId: 'flat', rngSeed: 77,
  players: [{ index: 1, characterId: 'link', paletteIndex: 0, inputType: 'keyboard_p1' },
    { index: 2, characterId: 'pikachu', paletteIndex: 1, inputType: 'keyboard_p2' }] };
function flow(replayId = 'first'): FlowData {
  // The UI must pass this already prepared artifact unchanged. Serializer and
  // real recording contents have their own replay tests and browser check.
  const file = Object.freeze({ metadata: Object.freeze({ engineVersion: replayId }) }) as ReplayFile;
  return { pending: config, selectionOwners: [{ device: 'keyboard', slot: 1 }],
    result: { winnerIndex: 0, winnerName: 'Link', finalStocks: [1, 0], playerNames: ['Link', 'Pikachu'],
      endFrame: 120, stageName: 'Flat', playerStats: null },
    replay: { file, fileName: `${replayId}.replay.json` } };
}
function screen(data = flow()) {
  const app = { backdrop: vi.fn(), go: vi.fn() } as unknown as App;
  const result = resultsScreen(app, data), nodes = descendants(result.root as unknown as Element);
  const buttons = nodes.filter(node => node.tagName === 'button');
  const status = nodes.find(node => node.attributes.role === 'status')!;
  return { app, result, buttons, save: buttons.find(button => button.textContent === 'Save Replay')!, status };
}
beforeEach(() => {
  vi.stubGlobal('document', { createElement: (tag: string) => new Element(tag) });
  mocks.download.mockReset().mockReturnValue({ fileName: 'first.replay.json', byteLength: 100, objectUrl: 'blob:test' });
  mocks.dispose.mockReset();
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('results replay export', () => {
  it('shows Save Replay beside existing actions and downloads the completed artifact on click', () => {
    const data = flow(), ui = screen(data);
    expect(ui.buttons.map(button => button.textContent)).toEqual(['REMATCH', 'Save Replay', 'BACK TO LOBBY']);
    expect(ui.status.attributes).toMatchObject({ 'aria-live': 'polite', 'aria-atomic': 'true' });
    expect(ui.save.attributes['aria-describedby']).toBe('results-replay-status');
    expect(mocks.download).not.toHaveBeenCalled();
    ui.save.click();
    expect(mocks.download).toHaveBeenCalledWith(data.replay!.file, { fileName: data.replay!.fileName });
    expect(ui.status.textContent).toBe('Replay download started: first.replay.json.');
    expect(ui.app.go).not.toHaveBeenCalled();
  });

  it('reports a download failure and retries the same recording without leaving results', () => {
    const data = flow(), ui = screen(data);
    mocks.download.mockImplementationOnce(() => { throw new Error('Download blocked'); });
    ui.save.click();
    expect(ui.status.textContent).toContain('Download blocked');
    expect(ui.status.textContent).toContain('Try Save Replay again');
    ui.save.click();
    expect(mocks.download).toHaveBeenCalledTimes(2);
    expect(mocks.download.mock.calls.every(call => call[0] === data.replay!.file)).toBe(true);
    expect(ui.status.textContent).toBe('Replay download started: first.replay.json.');
    expect(ui.app.go).not.toHaveBeenCalled();
  });

  it.each([undefined, 'The completed recording could not be prepared.'])('keeps the action visible and explains an unavailable recording (%s)', replayError => {
    const ui = screen({ ...flow(), replay: undefined, replayError });
    expect(ui.save).toBeDefined();
    ui.save.click();
    expect(ui.status.textContent).toBe(replayError ? `Replay unavailable: ${replayError}` : 'Replay unavailable for this match.');
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it.each(['keyboard', 'pad0'] as const)('navigates to Save Replay and confirms with %s', device => {
    const ui = screen();
    ui.result.onAction?.({ device, action: 'right' });
    expect(ui.save.className).toContain('is-focused');
    expect(ui.save.focused).toBe(true);
    ui.result.onAction?.({ device, action: 'confirm' });
    expect(mocks.download).toHaveBeenCalledOnce();
    expect(ui.app.go).not.toHaveBeenCalled();
  });

  it('tracks native Tab focus so Enter saves the focused replay action', () => {
    const ui = screen(); ui.save.focus();
    ui.result.onAction?.({ device: 'keyboard', action: 'start' });
    expect(mocks.download).toHaveBeenCalledOnce();
    expect(ui.app.go).not.toHaveBeenCalled();
  });

  it('keeps Rematch selected by default and removes the completed replay/error/result from navigation', () => {
    const data = { ...flow(), replayError: 'old error' }, ui = screen(data);
    ui.result.onAction?.({ device: 'keyboard', action: 'confirm' });
    expect(ui.app.go).toHaveBeenCalledWith('match', { pending: config, selectionOwners: data.selectionOwners });
    ui.result.onAction?.({ device: 'pad0', action: 'back' });
    expect(ui.app.go).toHaveBeenLastCalledWith('fighters', { pending: config, selectionOwners: data.selectionOwners });
    ui.buttons[2]!.click();
    expect(ui.app.go).toHaveBeenLastCalledWith('fighters', { pending: config, selectionOwners: data.selectionOwners });
    expect(mocks.download).not.toHaveBeenCalled();
    ui.result.leave?.(); expect(mocks.dispose).toHaveBeenCalledOnce();
  });

  it('uses only the next completed match recording when results are recreated', () => {
    const first = screen(flow('first')); first.save.click(); first.result.leave?.();
    const secondData = flow('second'), second = screen(secondData); second.save.click();
    expect(mocks.download).toHaveBeenLastCalledWith(secondData.replay!.file, { fileName: 'second.replay.json' });
  });
});
