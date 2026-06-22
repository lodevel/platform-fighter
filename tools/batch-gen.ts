/**
 * batch-gen.ts — manifest-driven batch wrapper over comfy-style + comfy-client.
 *
 * Renders a list of assets in sequence (one GPU, serialized). Reuses the shared
 * render path in render-asset.ts (same code gen-sprite.ts uses) so the recipe,
 * prompt composition, and PNG write are identical.
 *
 * Usage:
 *   npx tsx tools/batch-gen.ts <manifest.json> [--url <baseUrl>] [--continue-on-error]
 *
 * Manifest schema (JSON array OR { items: [...] }):
 *   [
 *     { "kind": "background", "prompt": "...", "seed": 10, "out": "assets/gen/stage1.png" },
 *     { "kind": "item",       "prompt": "...", "seed": 42, "out": "assets/gen/sword.png",
 *       "width": 1024, "height": 1024, "rawPrompt": false }
 *   ]
 *
 * Entry fields: kind (character|background|item, required), prompt (required),
 * out (required), seed?, steps?, cfg?, width?, height?, rawPrompt?.
 */
import { readFile } from 'node:fs/promises';
import { ComfyClient } from './comfy-client.ts';
import { renderAsset } from './render-asset.ts';
import type { AssetKind } from './comfy-style.ts';

interface ManifestEntry {
  kind: AssetKind;
  prompt: string;
  out: string;
  seed?: number;
  steps?: number;
  cfg?: number;
  width?: number;
  height?: number;
  rawPrompt?: boolean;
}

interface BatchArgs {
  manifestPath: string;
  url?: string;
  continueOnError: boolean;
}

function parseArgs(argv: string[]): BatchArgs {
  let manifestPath: string | undefined;
  let url: string | undefined;
  let continueOnError = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--url') {
      url = argv[++i];
    } else if (a === '--continue-on-error') {
      continueOnError = true;
    } else if (a === '--help' || a === '-h') {
      process.stdout.write(
        'batch-gen.ts — render a manifest of assets via ComfyUI.\n' +
          'Usage: npx tsx tools/batch-gen.ts <manifest.json> [--url <baseUrl>] [--continue-on-error]\n',
      );
      process.exit(0);
    } else if (a.startsWith('--')) {
      throw new Error(`Unknown flag: ${a}`);
    } else if (!manifestPath) {
      manifestPath = a;
    } else {
      throw new Error(`Unexpected argument: ${a}`);
    }
  }
  if (!manifestPath) throw new Error('manifest path is required (use --help)');
  return { manifestPath, url, continueOnError };
}

const VALID_KINDS: ReadonlySet<string> = new Set(['character', 'background', 'item']);

function validateEntry(e: unknown, idx: number): ManifestEntry {
  if (typeof e !== 'object' || e === null) {
    throw new Error(`manifest[${idx}]: expected object`);
  }
  const o = e as Record<string, unknown>;
  if (typeof o['kind'] !== 'string' || !VALID_KINDS.has(o['kind'])) {
    throw new Error(`manifest[${idx}].kind must be character|background|item`);
  }
  if (typeof o['prompt'] !== 'string' || o['prompt'].length === 0) {
    throw new Error(`manifest[${idx}].prompt must be a non-empty string`);
  }
  if (typeof o['out'] !== 'string' || o['out'].length === 0) {
    throw new Error(`manifest[${idx}].out must be a non-empty string`);
  }
  return o as unknown as ManifestEntry;
}

async function loadManifest(path: string): Promise<ManifestEntry[]> {
  const text = await readFile(path, 'utf8');
  const raw: unknown = JSON.parse(text);
  const arr = Array.isArray(raw)
    ? raw
    : typeof raw === 'object' && raw !== null && Array.isArray((raw as Record<string, unknown>)['items'])
      ? ((raw as Record<string, unknown>)['items'] as unknown[])
      : null;
  if (!arr) throw new Error('manifest must be a JSON array or { "items": [...] }');
  return arr.map(validateEntry);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const entries = await loadManifest(args.manifestPath);
  console.log(`[batch-gen] ${entries.length} asset(s) from ${args.manifestPath}`);

  const client = new ComfyClient({ baseUrl: args.url });
  if (!(await client.isUp())) {
    throw new Error(
      `ComfyUI not reachable at ${client.baseUrl}. Launch it first:\n` +
        '  cd ~/ComfyUI && source .venv/bin/activate && python main.py --listen 127.0.0.1 --port 8188',
    );
  }

  const t0 = Date.now();
  let ok = 0;
  const failures: Array<{ out: string; err: string }> = [];

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    console.log(`\n[batch-gen] (${i + 1}/${entries.length}) ${e.out}`);
    try {
      await renderAsset({
        kind: e.kind,
        prompt: e.prompt,
        out: e.out,
        seed: e.seed ?? 0,
        steps: e.steps,
        cfg: e.cfg,
        width: e.width,
        height: e.height,
        rawPrompt: e.rawPrompt,
        client,
      });
      ok++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failures.push({ out: e.out, err: msg });
      console.error(`[batch-gen] FAILED ${e.out}: ${msg}`);
      if (!args.continueOnError) throw err;
    }
  }

  console.log(
    `\n[batch-gen] done: ${ok}/${entries.length} rendered in ` +
      `${((Date.now() - t0) / 1000 / 60).toFixed(1)}min`,
  );
  if (failures.length > 0) {
    console.log(`[batch-gen] ${failures.length} failure(s):`);
    for (const f of failures) console.log(`  - ${f.out}: ${f.err}`);
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error(`[batch-gen] ERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
