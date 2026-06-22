/**
 * render-asset.ts — shared "build prompt + workflow, render, write PNG" logic.
 *
 * Factored out of gen-sprite.ts so the single-asset CLI and the manifest-driven
 * batch driver (batch-gen.ts) share one code path instead of duplicating the
 * prompt/workflow/render/write sequence. Pure orchestration over comfy-style
 * (recipe) + comfy-client (transport) + node fs.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { ComfyClient } from './comfy-client.ts';
import {
  buildPositivePrompt,
  buildZImageWorkflow,
  type AssetKind,
} from './comfy-style.ts';

export interface RenderAssetOpts {
  /** Asset category — selects the canonical style prefix. */
  kind: AssetKind;
  /** Subject/scene text. The locked style prefix is prepended unless rawPrompt. */
  prompt: string;
  /** Output PNG path (parent dirs are created). */
  out: string;
  /** Fixed seed for reproducibility. Default 0. */
  seed?: number;
  steps?: number;
  cfg?: number;
  width?: number;
  height?: number;
  /** Use `prompt` verbatim, skipping the locked style prefix. */
  rawPrompt?: boolean;
  /** A pre-constructed client (lets a batch reuse one connection). */
  client?: ComfyClient;
  /** ComfyUI base URL (ignored if `client` is supplied). */
  url?: string;
  log?: (line: string) => void;
}

export interface RenderAssetResult {
  readonly outPath: string;
  readonly promptId: string;
  readonly bytes: number;
  readonly elapsedMs: number;
}

/** Strip dir + extension to get a SaveImage filename_prefix from an --out path. */
export function baseName(p: string): string {
  const file = p.split(/[\\/]/).pop() ?? p;
  return file.replace(/\.[^.]+$/, '') || 'pf-gen';
}

/**
 * Compose the prompt, build the Z-Image workflow, render it on the server, and
 * write the resulting PNG to disk. Returns where it landed + timing.
 *
 * Assumes the server is already reachable — call `client.isUp()` once before a
 * batch rather than per-asset.
 */
export async function renderAsset(opts: RenderAssetOpts): Promise<RenderAssetResult> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const positive = opts.rawPrompt
    ? opts.prompt
    : buildPositivePrompt({ kind: opts.kind, subject: opts.prompt });

  const workflow = buildZImageWorkflow({
    positive,
    seed: opts.seed ?? 0,
    steps: opts.steps,
    cfg: opts.cfg,
    width: opts.width,
    height: opts.height,
    filenamePrefix: baseName(opts.out),
  });

  const client = opts.client ?? new ComfyClient({ baseUrl: opts.url });

  log(`[render] kind=${opts.kind} seed=${opts.seed ?? 0} -> ${opts.out}`);
  log(`[render] prompt: ${positive}`);
  const t0 = Date.now();
  const { promptId, bytes } = await client.render(workflow);
  const outPath = resolve(opts.out);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, bytes);
  const elapsedMs = Date.now() - t0;
  log(
    `[render] done in ${(elapsedMs / 1000).toFixed(1)}s ` +
      `(prompt_id=${promptId}) -> ${outPath} (${bytes.length} bytes)`,
  );
  return { outPath, promptId, bytes: bytes.length, elapsedMs };
}
