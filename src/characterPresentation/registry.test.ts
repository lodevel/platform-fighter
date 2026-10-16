import { describe, expect, it } from 'vitest';
import type { AppearanceRequest, PresentationProfile, PresentationRoute } from './contracts';
import { createPresentationRegistry } from './registry';

const route = (id: string, patch: Partial<PresentationRoute> = {}): PresentationRoute => ({
  id, action: '*', layer: 'body', capability: 'stored', resources: ['bank:example'], ...patch,
});
const profile = (routes: readonly PresentationRoute[]): PresentationProfile => ({ id: 'example', revision: '1', characterId: 'example', routes });
const request = (action = 'run', phase = 'active'): AppearanceRequest => ({
  actorId: 'actor-1', characterId: 'example', profile: { id: 'example', revision: '1' },
  action: { id: action, instanceId: 'run-1', phase, clock: { domain: 'action-age', age: 2, tick: 50, rate: 60 }, frozen: false, hitlag: false },
  transform: { position: { x: 0, y: 0 }, facing: 1, scale: { x: 1, y: 1 }, rotation: 0 },
  palette: { index: 0 }, visibility: { visible: true, alpha: 1 }, attachments: [], equipment: [], context: {},
  restoreGeneration: 0, pass: 'world', order: 0,
});
function registry() {
  const result = createPresentationRegistry();
  result.registerCapability({ id: 'stored' });
  result.registerCapability({ id: 'computed' });
  return result;
}

describe('portable presentation registry', () => {
  it('resolves stored, computed and mixed routes without any drawing shape', () => {
    const r = registry();
    r.registerProfile(profile([
      route('default'), route('run', { action: 'run', capability: 'computed', resources: ['rig:runner'] }),
      route('run-start', { action: 'run', phase: 'startup' }),
      route('held', { action: 'run', layer: 'held-item' }),
    ]));
    expect(r.resolve(request('idle')).map(x => x.id)).toEqual(['default']);
    expect(r.resolve(request()).map(x => [x.id, x.capability])).toEqual([['run', 'computed'], ['held', 'stored']]);
    expect(r.resolve(request('run', 'startup')).map(x => x.id)).toEqual(['run-start', 'held']);
    expect(r.resolve(request('idle')).map(x => x.id)).toEqual(['default']);
  });

  it('fails unknown capabilities and unmatched actions explicitly instead of showing idle', () => {
    const r = registry();
    expect(() => r.registerProfile(profile([route('unknown', { capability: 'uninstalled' })]))).toThrow('Unsupported presentation capability');
    r.registerProfile(profile([route('idle-only', { action: 'idle' })]));
    expect(() => r.resolve(request())).toThrow('Missing presentation route');
    expect(() => r.resolve({ ...request(), profile: { id: 'example', revision: '2' } })).toThrow('Unknown presentation profile');
    expect(() => r.resolve({ ...request('idle'), characterId: 'different' })).toThrow('character mismatch');
  });

  it('rejects ambiguous selectors and duplicate registrations', () => {
    const r = registry();
    expect(() => r.registerCapability({ id: 'stored' })).toThrow('Duplicate');
    expect(() => r.registerProfile(profile([route('a'), route('b', { phase: '*' })]))).toThrow('Ambiguous');
    expect(() => r.registerProfile(profile([route('same'), route('same', { action: 'run' })]))).toThrow('Duplicate');
    r.registerProfile(profile([route('a')]));
    expect(() => r.registerProfile(profile([route('b')]))).toThrow('Duplicate');
  });

  it('snapshots registered resources so later caller mutation cannot redirect a prepared profile', () => {
    const r = registry(), resources = ['bank:one'];
    r.registerProfile(profile([route('body', { resources })]));
    resources[0] = 'bank:other';
    expect(r.resolve(request())[0]!.resources).toEqual(['bank:one']);
    expect(Object.isFrozen(r.profile(request().profile).routes[0])).toBe(true);
  });
});
