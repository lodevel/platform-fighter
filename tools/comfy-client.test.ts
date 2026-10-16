import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComfyClient } from './comfy-client.ts';
import type { ComfyWorkflow } from './comfy-style.ts';

const graph: ComfyWorkflow = {
  raw: { class_type: 'SaveImage', inputs: {} },
  final: { class_type: 'SaveImage', inputs: {} },
};
const image = (filename: string) => ({ filename, subfolder: '', type: 'output' });
const response = (value: unknown) => new Response(JSON.stringify(value), {
  status: 200, headers: { 'content-type': 'application/json' },
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('ComfyClient output selection', () => {
  it('retrieves the masked final even when the raw diagnostic is listed first', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ prompt_id: 'job' }))
      .mockResolvedValueOnce(response({ job: {
        status: { completed: true, status_str: 'success' },
        outputs: { raw: { images: [image('diagnostic.png')] }, final: { images: [image('masked.png')] } },
      } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal('fetch', fetch);
    const result = await new ComfyClient().render(graph, 'final');
    expect(result.ref.filename).toBe('masked.png');
    expect(result.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(fetch.mock.calls[2]?.[0]).toContain('filename=masked.png');
  });

  it('rejects ambiguous graphs before queueing a GPU job', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(new ComfyClient().render(graph)).rejects.toThrow('Specify outputNodeId');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a missing selected node before submission', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(new ComfyClient().render(graph, 'missing')).rejects.toThrow('absent');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports a completed job missing its final output without choosing the diagnostic', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ job: {
      status: { completed: true, status_str: 'success' },
      outputs: { raw: { images: [image('diagnostic.png')] } },
    } }));
    vi.stubGlobal('fetch', fetch);
    await expect(new ComfyClient().waitForImages('job', 'final')).rejects.toThrow('no saved images at node final');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('waits for the selected final node when a diagnostic appears during execution', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ job: { outputs: { raw: { images: [image('diagnostic.png')] } } } }))
      .mockResolvedValueOnce(response({ job: { outputs: { final: { images: [image('masked.png')] } } } }));
    vi.stubGlobal('fetch', fetch);
    expect(await new ComfyClient({ pollIntervalMs: 1 }).waitForImages('job', 'final')).toEqual([image('masked.png')]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps automatic selection for existing single-output workflows', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ prompt_id: 'job' }))
      .mockResolvedValueOnce(response({ job: { outputs: { final: { images: [image('only.png')] } } } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([4])));
    vi.stubGlobal('fetch', fetch);
    const result = await new ComfyClient().render({ final: graph.final! });
    expect(result.ref.filename).toBe('only.png');
  });
});
