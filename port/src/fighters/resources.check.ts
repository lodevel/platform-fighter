import { describe, expect, it, vi } from 'vitest';
import { prepareAppearanceResources, prepareRegisteredAppearanceResources, registerAppearanceResourceProvider,
  registerSharedAppearanceResources, type AppearanceResourceHost } from './resources';

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const plan = [{ profile: { id: 'test', revision: '1' }, capability: 'computed', resources: [] }];

describe('appearance resource ownership', () => {
  it('waits for both availability and shader readiness', async () => {
    const resources = deferred(), shaders = deferred();
    const lease = prepareAppearanceResources(plan, { prepare: () => resources.promise },
      { prepare: () => shaders.promise, cancel: vi.fn() }, vi.fn());
    const ready = vi.fn();
    void lease.ready.then(ready);
    resources.resolve();
    await resources.promise;
    expect(lease.resourcesAvailable).toBe(true);
    expect(lease.shadersReady).toBe(false);
    expect(ready).not.toHaveBeenCalled();
    shaders.resolve();
    await lease.ready;
    expect(lease.shadersReady).toBe(true);
    expect(ready).toHaveBeenCalledOnce();
  });

  it('suppresses late work after cancellation and disposes idempotently', async () => {
    const resources = deferred(), shaders = deferred(), progress = vi.fn(), cancel = vi.fn();
    let signal!: AbortSignal, report!: (done: number, total: number) => void;
    const lease = prepareAppearanceResources(plan, { prepare: (s, p) => { signal = s; report = p; return resources.promise; } },
      { prepare: () => shaders.promise, cancel }, progress);
    report(0, 4);
    lease.cancel(); lease.dispose(); lease.dispose();
    report(4, 4);
    resources.resolve(); shaders.resolve();
    await lease.ready;
    expect(signal.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    expect(progress.mock.calls).toEqual([[0, 4]]);
    expect(lease.resourcesAvailable).toBe(false);
    expect(lease.shadersReady).toBe(false);
  });

  it('cancels remaining work on failure and keeps revision/capability identity', async () => {
    const resources = deferred(), shaders = deferred(), cancel = vi.fn();
    const lease = prepareAppearanceResources(plan, { prepare: () => resources.promise },
      { prepare: () => shaders.promise, cancel }, vi.fn());
    resources.reject(new Error('decode failed'));
    await expect(lease.ready).rejects.toThrow('decode failed');
    expect(cancel).toHaveBeenCalledOnce();
    expect(lease.cancelled).toBe(true);
    expect(lease.identity).toContain('computed');
    expect(lease.identity).toContain('1');
    shaders.resolve();
  });

  it('dispatches registered capability resources and shared resources together', async () => {
    const host = {} as AppearanceResourceHost;
    const prepare = vi.fn(async (_resources: readonly string[], _host: AppearanceResourceHost,
      context: { signal: AbortSignal; progress: (done: number, total: number) => void }) => {
      context.progress(0, 3); context.progress(3, 3);
    });
    registerAppearanceResourceProvider({ capability: 'dispatch-test', prepare });
    registerSharedAppearanceResources('dispatch-test', ['shared-items']);
    const progress = vi.fn();
    const lease = prepareRegisteredAppearanceResources([
      { profile: { id: 'one', revision: '2' }, capability: 'dispatch-test', resources: ['body'] },
      { profile: { id: 'two', revision: '1' }, capability: 'dispatch-test', resources: ['body', 'equipment'] },
    ], host, { prepare: async () => undefined, cancel: vi.fn() }, progress);
    await lease.ready;
    expect(prepare).toHaveBeenCalledOnce();
    expect(prepare.mock.calls[0]![0]).toEqual(['shared-items', 'body', 'equipment']);
    expect(prepare.mock.calls[0]![1]).toBe(host);
    expect(progress.mock.calls).toEqual([[0, 3], [3, 3]]);
    // The shared policy still runs when a computed actor has no stored resources.
    const geometryOnly = prepareRegisteredAppearanceResources(plan, host, { prepare: async () => undefined, cancel: vi.fn() }, vi.fn());
    await geometryOnly.ready;
    expect(prepare.mock.calls[1]![0]).toEqual(['shared-items']);
  });

  it('rejects undeclared resource providers before starting any work', () => {
    const shaders = { prepare: vi.fn(async () => undefined), cancel: vi.fn() };
    expect(() => prepareRegisteredAppearanceResources([
      { profile: { id: 'missing', revision: '1' }, capability: 'unregistered', resources: ['required'] },
    ], {} as AppearanceResourceHost, shaders, vi.fn())).toThrow("No resource preparation provider for 'unregistered'");
    expect(shaders.prepare).not.toHaveBeenCalled();
  });
});
