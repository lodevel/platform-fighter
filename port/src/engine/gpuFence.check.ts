import { describe, expect, it, vi } from 'vitest';
import { gpuFinished } from './gpuFence';

describe('gpuFinished', () => {
  it('polls the fence until the GPU signals it, then deletes it', async () => {
    let polls = 0;
    const gl = { SYNC_GPU_COMMANDS_COMPLETE: 1, TIMEOUT_EXPIRED: 2, CONDITION_SATISFIED: 3, fenceSync: vi.fn(() => ({})), flush: vi.fn(),
      clientWaitSync: vi.fn(() => (++polls < 3 ? 2 : 3)), deleteSync: vi.fn() };
    await gpuFinished({ getContext: () => gl } as never);
    expect([gl.clientWaitSync.mock.calls.length, gl.deleteSync.mock.calls.length, gl.flush.mock.calls.length]).toEqual([3, 1, 1]);
  });

  it('resolves at once without fences', async () => {
    await expect(gpuFinished({ getContext: () => ({}) } as never)).resolves.toBeUndefined();
  });
});
