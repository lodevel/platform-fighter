#!/usr/bin/env node
/** Approved Link-only KTX2 pilot. PNGs/layouts stay unchanged; no runtime switch. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const options = { clips: 'idle,jab,j00entryr,d04final,d04finalair', quality: '2', threads: '6',
  'ktx-dir': path.join(os.homedir(), '.local/opt/ktx-4.4.2'), 'out-dir': path.join(root, 'assets/generated/ktx2/link') };
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--help') {
    console.log('Link-only KTX2 pilot: --clips idle,jab,j00entryr,d04final,d04finalair --quality 0..4 --threads 6 --ktx-dir PATH --out-dir PATH');
    process.exit(0);
  }
  const key = args[i].replace(/^--/, '');
  if (!(key in options) || !args[i + 1] || !args[i].startsWith('--')) throw new Error(`Unknown/incomplete option ${args[i]}`);
  options[key] = args[++i];
}
const quality = Number(options.quality), threads = Number(options.threads);
if (!Number.isInteger(quality) || quality < 0 || quality > 4 || !Number.isInteger(threads) || threads < 1) throw new Error('Invalid quality/threads');
const encoder = path.join(path.resolve(options['ktx-dir']), 'bin/ktx');
const env = { ...process.env, LD_LIBRARY_PATH: [path.join(path.resolve(options['ktx-dir']), 'lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') };
function run(binary, command, allowed = [0]) {
  const result = spawnSync(binary, command, { cwd: root, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error || !allowed.includes(result.status)) throw new Error(`${binary} ${command.join(' ')}\n${result.error ?? result.stderr ?? result.stdout}`);
  return result;
}
const encoderVersion = run(encoder, ['--version']).stdout.trim();
if (encoderVersion !== 'ktx version: v4.4.2') throw new Error(`Expected pinned KTX4.4.2, found ${encoderVersion}`);
const measurementTools = JSON.parse(run('python3', ['-c', 'import json,PIL,numpy;print(json.dumps({"Pillow":PIL.__version__,"numpy":numpy.__version__}))']).stdout);
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const sourceRoot = path.join(root, 'assets/characters/link');
const frames = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'frames.json'), 'utf8'));
const output = path.resolve(options['out-dir']);
const qualityTool = path.join(root, 'tools/ktx2-quality.py');
const recipe = { encoderVersion, encoderSha256: digest(fs.readFileSync(encoder)), threads,
  format: 'R8G8B8A8_UNORM', transferFunction: 'linear', primaries: 'none',
  texcoordOrigin: 'top-left', encoding: 'uastc', quality, zstd: 18, levels: 1, mipmaps: false,
  premultiply: '(RGB*alpha+127)//255', alphaAssociation: 'KHR_DF_FLAG_ALPHA_PREMULTIPLIED',
  qualityToolSha256: digest(fs.readFileSync(qualityTool)),
  builderSha256: digest(fs.readFileSync(import.meta.filename)), measurementTools };
fs.mkdirSync(output, { recursive: true });
const index = { fighter: 'link', scope: 'reviewable pilot; renderer integration and ASTC/hardware acceptance remain unfinished',
  recipe, clips: [], passed: true };
const start = performance.now();
for (const clip of options.clips.split(',')) {
  const layout = frames.animations[clip];
  if (!layout || !/^[\w-]+$/.test(clip)) throw new Error(`Unknown Link clip ${clip}`);
  const source = path.resolve(sourceRoot, layout.strip);
  if (!source.startsWith(sourceRoot + path.sep)) throw new Error('Source must remain in Link bank');
  const sourceSha256 = digest(fs.readFileSync(source));
  if (layout.sha256 && layout.sha256 !== sourceSha256) throw new Error(`Installed Link ${clip} SHA does not match its layout`);
  const cacheKey = digest(JSON.stringify({ sourceSha256, layout, recipe }));
  const dir = path.join(output, clip, cacheKey.slice(0, 20));
  fs.mkdirSync(dir, { recursive: true });
  const ktx2 = path.join(dir, `${clip}.ktx2`);
  const prepared = path.join(dir, 'source-premultiplied.png');
  const metadata = path.join(dir, 'layout.json');
  const receiptFile = path.join(dir, 'receipt.json');
  let cached = false;
  if (fs.existsSync(receiptFile) && fs.existsSync(ktx2)) {
    const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
    cached = receipt.cacheKey === cacheKey && receipt.ktx2Sha256 === digest(fs.readFileSync(ktx2))
      && fs.existsSync(path.join(dir, 'quality.json'));
  }
  const clipStart = performance.now();
  if (!cached) {
    fs.writeFileSync(metadata, JSON.stringify(layout, null, 2) + '\n');
    run('python3', [qualityTool, 'prepare', source, prepared]);
    const command = ['create', '--format', recipe.format, '--assign-tf', 'linear', '--assign-primaries', 'none',
      '--assign-texcoord-origin', 'top-left', '--encode', 'uastc', '--uastc-quality', String(quality), '--zstd', '18',
      '--levels', '1', '--threads', String(threads), prepared, ktx2];
    run(encoder, command);
    const header = fs.readFileSync(ktx2);
    const width = header.readUInt32LE(20), height = header.readUInt32LE(24);
    if (header.readUInt32LE(12) !== 0 || header.readUInt32LE(40) !== 1 || header.readUInt32LE(44) !== 2) throw new Error('Unexpected KTX2 format/levels/supercompression');
    // ktx create4.4.2 exposes no premultiplied-alpha flag. Reflect the prepared
    // pixels in the basic DFD: totalSize4 + wordFLAGS2*4 + FLAGS_SHIFT24/8.
    // Verified against its installed KHR/khr_df.h; validate/info below check
    // the resulting container. No encoded blocks or source pixels are changed.
    const dfd = header.readUInt32LE(48), dfdLength = header.readUInt32LE(52);
    if (dfdLength < 28 || dfd + dfdLength > header.length || header.readUInt32LE(dfd + 4) !== 0) throw new Error('Unexpected KTX2 basic DFD');
    if (header[dfd + 13] !== 0 || header[dfd + 14] !== 1) throw new Error('KTX2 must retain unspecified primaries and linear transfer');
    header[dfd + 15] |= 1;
    fs.writeFileSync(ktx2, header);
    run(encoder, ['validate', ktx2]);
    const info = JSON.parse(run(encoder, ['info', '--format', 'json', ktx2]).stdout);
    fs.writeFileSync(path.join(dir, 'ktx-info.json'), JSON.stringify(info, null, 2) + '\n');
    const result = run('python3', [qualityTool, 'check', '--source', source, '--ktx2', ktx2,
      '--layout', metadata, '--clip', clip, '--out', dir, '--ktx', encoder], [0, 2]);
    if (result.stderr) process.stderr.write(result.stderr);
    if (sourceSha256 !== digest(fs.readFileSync(source))) throw new Error(`Link source changed during ${clip}; discard this receipt`);
    const receipt = { clip, cacheKey, source: path.relative(root, source), sourceSha256, layoutSha256: digest(JSON.stringify(layout)),
      recipe, command, width, height, rgbaBytes: width * height * 4,
      bc7BlockBytes: Math.ceil(width / 4) * Math.ceil(height / 4) * 16,
      ktx2Bytes: header.length, ktx2Sha256: digest(header), qualityExitCode: result.status,
      elapsedSeconds: (performance.now() - clipStart) / 1000 };
    fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2) + '\n');
  }
  const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
  const measured = JSON.parse(fs.readFileSync(path.join(dir, 'quality.json'), 'utf8'));
  const row = { ...receipt, cacheDir: path.relative(root, dir), cached, passed: measured.passed,
    targets: Object.fromEntries(Object.entries(measured.targets).map(([target, result]) => [target, {
      passed: result.passed, failedDrawings: result.drawings.filter(drawing => !drawing.passed).map(drawing => drawing.drawing),
      atlas: result.atlas,
    }])) };
  index.clips.push(row); index.passed &&= row.passed;
  console.log(JSON.stringify({ clip, cached, passed: row.passed, seconds: receipt.elapsedSeconds,
    rgbaMiB: receipt.rgbaBytes / 2 ** 20, bc7MiB: receipt.bc7BlockBytes / 2 ** 20,
    ktx2KiB: receipt.ktx2Bytes / 1024, failedDrawings: Object.fromEntries(Object.entries(row.targets).map(([target, result]) => [target, result.failedDrawings])) }));
}
index.elapsedSeconds = (performance.now() - start) / 1000;
fs.writeFileSync(path.join(output, 'index.json'), JSON.stringify(index, null, 2) + '\n');
if (!index.passed) process.exitCode = 2;
