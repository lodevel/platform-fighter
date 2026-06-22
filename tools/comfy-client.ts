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
  timeoutMs: 5 * 60_000,
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

  /** Poll /history/<id> until the prompt produces images (or timeout). */
  async waitForImages(promptId: string): Promise<ComfyImageRef[]> {
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
          const images = collectImages(entry);
          if (images.length > 0) return images;
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

  /** Convenience: queue -> wait -> fetch first image bytes. */
  async render(workflow: ComfyWorkflow): Promise<{ promptId: string; bytes: Uint8Array; ref: ComfyImageRef }> {
    const promptId = await this.queue(workflow);
    const images = await this.waitForImages(promptId);
    const ref = images[0];
    if (!ref) throw new Error(`No image produced for prompt ${promptId}`);
    const bytes = await this.fetchImage(ref);
    return { promptId, bytes, ref };
  }
}

// ─── internal ───────────────────────────────────────────────────────────────
interface HistoryEntry {
  status?: { status_str?: string; messages?: unknown };
  outputs?: Record<string, { images?: ComfyImageRef[] }>;
}

function collectImages(entry: HistoryEntry): ComfyImageRef[] {
  const out: ComfyImageRef[] = [];
  for (const node of Object.values(entry.outputs ?? {})) {
    for (const img of node.images ?? []) {
      if (img.type === 'output') out.push(img);
    }
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
