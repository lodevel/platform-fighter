/**
 * comfy-client.ts — thin typed client for the ComfyUI HTTP API.
 *
 * Round-trip: POST /prompt (queue a workflow) -> poll /history/<id> -> fetch the
 * output PNG via /view. Pure transport; no art knowledge (that's comfy-style.ts).
 * Reusable by every pipeline stage.
 *
 * ComfyUI API ref: /prompt, /history/{prompt_id}, /view?filename=&subfolder=&type=
 */
import type { ComfyWorkflow } from './comfy-style.ts';

export interface ComfyClientOpts {
  /** Base URL of a running ComfyUI server. Default 127.0.0.1:8188. */
  baseUrl?: string;
  /** Poll interval (ms) while waiting for the render. */
  pollIntervalMs?: number;
  /** Overall timeout (ms) for a single render. */
  timeoutMs?: number;
}

export interface ComfyImageRef {
  filename: string;
  subfolder: string;
  /** "output" | "temp" | "input" */
  type: string;
}

const DEFAULTS = {
  baseUrl: 'http://127.0.0.1:8188',
  pollIntervalMs: 1500,
  // 15 min: a cold render under ComfyUI `--disable-smart-memory` reloads the full
  // ~19 GB Z-Image model from disk each time (~280-400s), so 5 min was too tight.
  timeoutMs: 15 * 60_000,
};

export class ComfyClient {
  readonly baseUrl: string;
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;

  constructor(opts: ComfyClientOpts = {}) {
    this.baseUrl = (opts.baseUrl ?? DEFAULTS.baseUrl).replace(/\/$/, '');
    this.pollIntervalMs = opts.pollIntervalMs ?? DEFAULTS.pollIntervalMs;
    this.timeoutMs = opts.timeoutMs ?? DEFAULTS.timeoutMs;
  }

  /** True if the server answers /system_stats. */
  async isUp(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/system_stats`, {
        signal: AbortSignal.timeout(4000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Queue a workflow; returns the prompt_id. */
  async queue(workflow: ComfyWorkflow): Promise<string> {
    const res = await fetch(`${this.baseUrl}/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: workflow }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`POST /prompt failed (${res.status}): ${body}`);
    }
    const json = (await res.json()) as { prompt_id?: string; error?: unknown; node_errors?: unknown };
    if (!json.prompt_id) {
      throw new Error(`/prompt returned no prompt_id: ${JSON.stringify(json)}`);
    }
    return json.prompt_id;
  }

  /** Poll history for saved images, optionally from one specific output node. */
  async waitForImages(promptId: string, outputNodeId?: string): Promise<ComfyImageRef[]> {
    const deadline = Date.now() + this.timeoutMs;
    for (;;) {
      const res = await fetch(`${this.baseUrl}/history/${promptId}`);
      if (res.ok) {
        const hist = (await res.json()) as Record<string, HistoryEntry>;
        const entry = hist[promptId];
        if (entry) {
          const status = entry.status?.status_str;
          if (status === 'error') {
            throw new Error(`Render failed: ${JSON.stringify(entry.status?.messages ?? entry.status)}`);
          }
          const images = collectImages(entry, outputNodeId);
          if (images.length > 0) return images;
          if (entry.status?.completed) {
            throw new Error(`Completed prompt ${promptId} has no saved images${outputNodeId ? ` at node ${outputNodeId}` : ''}`);
          }
        }
      }
      if (Date.now() > deadline) {
        throw new Error(`Timed out after ${this.timeoutMs}ms waiting for prompt ${promptId}`);
      }
      await sleep(this.pollIntervalMs);
    }
  }

  /** Fetch the raw bytes of an output image via /view. */
  async fetchImage(ref: ComfyImageRef): Promise<Uint8Array> {
    const qs = new URLSearchParams({
      filename: ref.filename,
      subfolder: ref.subfolder,
      type: ref.type,
    });
    const res = await fetch(`${this.baseUrl}/view?${qs.toString()}`);
    if (!res.ok) throw new Error(`GET /view failed (${res.status}) for ${ref.filename}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  /** Queue and fetch the selected final output; never infer it from history order. */
  async render(workflow: ComfyWorkflow, outputNodeId?: string): Promise<{ promptId: string; bytes: Uint8Array; ref: ComfyImageRef }> {
    const saveNodes = Object.entries(workflow).filter(([, node]) => node.class_type === 'SaveImage');
    const selectedNode = outputNodeId ?? (saveNodes.length === 1 ? saveNodes[0]?.[0] : undefined);
    if (!selectedNode) {
      throw new Error('Specify outputNodeId for a workflow with zero or multiple SaveImage nodes');
    }
    if (!workflow[selectedNode]) throw new Error(`Output node ${selectedNode} is absent from workflow`);
    const promptId = await this.queue(workflow);
    const images = await this.waitForImages(promptId, selectedNode);
    const ref = images[0];
    if (!ref) throw new Error(`No image produced for prompt ${promptId}`);
    const bytes = await this.fetchImage(ref);
    return { promptId, bytes, ref };
  }
}

// ─── internal ───────────────────────────────────────────────────────────────
interface HistoryEntry {
  status?: { status_str?: string; messages?: unknown; completed?: boolean };
  outputs?: Record<string, { images?: ComfyImageRef[] }>;
}

function collectImages(entry: HistoryEntry, outputNodeId?: string): ComfyImageRef[] {
  const out: ComfyImageRef[] = [];
  const nodes = outputNodeId === undefined
    ? Object.values(entry.outputs ?? {})
    : [entry.outputs?.[outputNodeId]];
  for (const node of nodes) {
    if (!node) continue;
    for (const img of node.images ?? []) {
      if (img.type === 'output') out.push(img);
    }
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
