/**
 * gen-sprite.ts — CLI to generate a single Brawlhalla-style asset via ComfyUI.
 *
 * Usage:
 *   npx tsx tools/gen-sprite.ts --prompt "ninja cat fighting stance" --out assets/gen/cat.png
 *   npx tsx tools/gen-sprite.ts --kind background --prompt "midground: sky island, no characters" --out assets/gen/stage.png
 *   npx tsx tools/gen-sprite.ts --kind item --prompt "glowing energy sword" --seed 42 --out assets/gen/sword.png
 *
 * Flags:
 *   --prompt <text>      (required) subject/scene; the locked style prefix is auto-prepended
 *   --out <path>         (required) output PNG path (dirs created)
 *   --kind <k>           character | background | item   (default: character)
 *   --seed <n>           fixed seed for reproducibility / clip consistency (default: 0)
 *   --steps <n>          override sampler steps (default: 8)
 *   --cfg <n>            override CFG (default: 4.5)
 *   --width <n> --height <n>   override size (default: 1024x1024)
 *   --raw-prompt         use --prompt verbatim, skip the style prefix
 *   --url <baseUrl>      ComfyUI base URL (default: http://127.0.0.1:8188)
 *   --dump-workflow      print the workflow JSON and exit (no render; works offline)
 *
 * The pipeline beyond this single render (bg-removal -> slice -> manifest) is
 * documented in docs/ART-PIPELINE.md and is TODO at the integration boundary.
 */
import { ComfyClient } from './comfy-client.ts';
import {
  buildPositivePrompt,
  buildZImageWorkflow,
  type AssetKind,
} from './comfy-style.ts';
import { baseName, renderAsset } from './render-asset.ts';

interface Args {
  prompt?: string;
  out?: string;
  kind: AssetKind;
  seed: number;
  steps?: number;
  cfg?: number;
  width?: number;
  height?: number;
  rawPrompt: boolean;
  url?: string;
  dumpWorkflow: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { kind: 'character', seed: 0, rawPrompt: false, dumpWorkflow: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value for ${a}`);
      return v;
    };
    switch (a) {
      case '--prompt': args.prompt = next(); break;
      case '--out': args.out = next(); break;
      case '--kind': {
        const k = next();
        if (k !== 'character' && k !== 'background' && k !== 'item') {
          throw new Error(`--kind must be character|background|item, got "${k}"`);
        }
        args.kind = k;
        break;
      }
      case '--seed': args.seed = Number(next()); break;
      case '--steps': args.steps = Number(next()); break;
      case '--cfg': args.cfg = Number(next()); break;
      case '--width': args.width = Number(next()); break;
      case '--height': args.height = Number(next()); break;
      case '--raw-prompt': args.rawPrompt = true; break;
      case '--url': args.url = next(); break;
      case '--dump-workflow': args.dumpWorkflow = true; break;
      case '--help': case '-h': printHelpAndExit(); break;
      default: throw new Error(`Unknown flag: ${a}`);
    }
  }
  return args;
}

function printHelpAndExit(): never {
  // Header comment of this file is the canonical help text.
  process.stdout.write(
    'gen-sprite.ts — generate a Brawlhalla-style asset via ComfyUI.\n' +
      'Required: --prompt "<text>" --out <path.png>\n' +
      'Optional: --kind character|background|item --seed N --steps N --cfg N\n' +
      '          --width N --height N --raw-prompt --url <baseUrl> --dump-workflow\n',
  );
  process.exit(0);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.prompt) throw new Error('--prompt is required (use --help)');

  const positive = args.rawPrompt
    ? args.prompt
    : buildPositivePrompt({ kind: args.kind, subject: args.prompt });

  if (args.dumpWorkflow) {
    // Offline path: build the graph directly so --dump-workflow works without
    // a server (renderAsset would try to connect).
    const workflow = buildZImageWorkflow({
      positive,
      seed: args.seed,
      steps: args.steps,
      cfg: args.cfg,
      width: args.width,
      height: args.height,
      filenamePrefix: args.out ? baseName(args.out) : 'pf-gen',
    });
    process.stdout.write(JSON.stringify(workflow, null, 2) + '\n');
    return;
  }

  if (!args.out) throw new Error('--out is required (use --help)');

  const client = new ComfyClient({ baseUrl: args.url });
  if (!(await client.isUp())) {
    throw new Error(
      `ComfyUI not reachable at ${client.baseUrl}. Launch it first:\n` +
        '  cd ~/ComfyUI && source .venv/bin/activate && python main.py --listen 127.0.0.1 --port 8188\n' +
        'See docs/ART-PIPELINE.md. (Use --dump-workflow to inspect the graph offline.)',
    );
  }

  // Shared render+write path (also used by tools/batch-gen.ts).
  await renderAsset({
    kind: args.kind,
    prompt: positive,
    rawPrompt: true, // `positive` is already composed above.
    out: args.out,
    seed: args.seed,
    steps: args.steps,
    cfg: args.cfg,
    width: args.width,
    height: args.height,
    client,
    log: (line) => console.log(line.replace('[render]', '[gen-sprite]')),
  });
}

main().catch((err: unknown) => {
  console.error(`[gen-sprite] ERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
