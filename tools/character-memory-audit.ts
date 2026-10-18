#!/usr/bin/env node
/**
 * Read installed PNG headers and the actual runtime manifest without decoding pixels.
 * Run: npx tsx tools/character-memory-audit.ts --fighters donkeykong,pikachu,link --out report.json
 * This measures asset allocations; it neither changes assets nor enforces a budget.
 */
import { closeSync, mkdirSync, openSync, readSync, statSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAllAssetEntries, type SpritesheetAssetEntry } from '../src/assets/manifest';
import { frameRect, gridCells, type SheetLayout } from '../src/assets/packedFrames';
import { legacySheets, type LegacySheetFighter } from '../src/assets/legacyFighterSheets';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
interface Clip extends SheetLayout { readonly strip: string }
interface PngSize { readonly width: number; readonly height: number; readonly diskBytes: number; readonly rgba8Bytes: number }
type ActionRow = readonly [action: string, runtimeKeys: readonly string[], sheet: string, drawings: number,
  uniqueDrawingSlots: number, width: number, height: number, pngDiskBytes: number, rgba8Bytes: number];

function pngSize(path: string): PngSize {
  const header = Buffer.alloc(33), fd = openSync(path, 'r');
  try {
    if (readSync(fd, header, 0, header.length, 0) !== header.length ||
      !header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      header.readUInt32BE(8) !== 13 || header.toString('ascii', 12, 16) !== 'IHDR') {
      throw new Error(`Invalid PNG IHDR: ${path}`);
    }
  } finally { closeSync(fd); }
  const width = header.readUInt32BE(16), height = header.readUInt32BE(20);
  if (!width || !height) throw new Error(`Invalid PNG dimensions: ${path}`);
  return { width, height, diskBytes: statSync(path).size, rgba8Bytes: width * height * 4 };
}

function sheetPath(url: string, fighter: string): string {
  const prefix = `/characters/${fighter}/`;
  const pathname = decodeURIComponent(new URL(url, 'https://asset-audit.invalid').pathname);
  const start = pathname.indexOf(prefix);
  if (start < 0) throw new Error(`Unexpected character URL: ${url}`);
  const sheet = pathname.slice(start + prefix.length);
  if (!sheet || sheet.split('/').some(part => part === '..' || part === '.')) {
    throw new Error(`Invalid sheet path: ${url}`);
  }
  return sheet;
}

function auditFighter(fighter: string) {
  const characterRoot = resolve(root, 'assets/characters', fighter);
  const metadata = { animations: legacySheets(fighter as LegacySheetFighter) as Readonly<Record<string, Clip>> };
  const manifestEntries = getAllAssetEntries().filter(entry => entry.key.startsWith(`char.${fighter}.`));
  if (!manifestEntries.length) throw new Error(`No runtime manifest entries for ${fighter}`);
  const entriesBySheet = new Map<string, SpritesheetAssetEntry[]>();
  const urls = new Map<string, { png: PngSize; keys: string[]; sheet: string }>();
  const runtimeKeys = new Set<string>();
  for (const entry of manifestEntries) {
    if (entry.kind !== 'spritesheet') throw new Error(`Unsupported character asset kind: ${entry.key} (${entry.kind})`);
    if (runtimeKeys.has(entry.key)) throw new Error(`Duplicate runtime key: ${entry.key}`);
    runtimeKeys.add(entry.key);
    const sheet = sheetPath(entry.url, fighter);
    const entries = entriesBySheet.get(sheet) ?? [];
    entries.push(entry);
    entriesBySheet.set(sheet, entries);
    let resource = urls.get(entry.url);
    if (!resource) {
      resource = { png: pngSize(resolve(characterRoot, sheet)), keys: [], sheet };
      urls.set(entry.url, resource);
    }
    resource.keys.push(entry.key);
  }
  const referencedSheets = new Set<string>(), uniqueSlots = new Set<string>(), actions: ActionRow[] = [];
  for (const action of Object.keys(metadata.animations).sort(compare)) {
    const clip = metadata.animations[action]!;
    const entries = entriesBySheet.get(clip.strip);
    if (!entries?.length) throw new Error(`No runtime manifest entry for ${fighter}/${action} (${clip.strip})`);
    referencedSheets.add(clip.strip);
    const entry = entries[0]!, png = urls.get(entry.url)!.png;
    if (!Number.isInteger(clip.frameCount) || clip.frameCount <= 0) throw new Error(`Invalid frame count: ${fighter}/${action}`);
    for (const runtime of entries) {
      if (runtime.frameCount !== clip.frameCount || runtime.frameWidth !== clip.frameWidth ||
        runtime.frameHeight !== clip.frameHeight || JSON.stringify(runtime.trims) !== JSON.stringify(clip.trims) ||
        JSON.stringify(runtime.atlas) !== JSON.stringify(clip.atlas)) {
        throw new Error(`Metadata/runtime layout mismatch: ${fighter}/${action} (${runtime.key})`);
      }
    }
    if (clip.atlas && (clip.atlas[0] !== png.width || clip.atlas[1] !== png.height)) {
      throw new Error(`Metadata/PNG dimensions mismatch: ${fighter}/${action}`);
    }
    const layout = { ...entry, columns: gridCells(entry, png.width, png.height).columns };
    const actionSlots = new Set<string>();
    for (let i = 0; i < clip.frameCount; i += 1) {
      const rect = frameRect(layout, i);
      if (rect.x < 0 || rect.y < 0 || rect.w <= 0 || rect.h <= 0 ||
        rect.x + rect.w > png.width || rect.y + rect.h > png.height) {
        throw new Error(`Drawing outside PNG bounds: ${fighter}/${action}[${i}]`);
      }
      const crop = JSON.stringify([rect.x, rect.y, rect.w, rect.h]);
      actionSlots.add(crop);
      for (const runtime of entries) uniqueSlots.add(JSON.stringify([runtime.url, crop]));
    }
    actions.push([action, entries.map(runtime => runtime.key).sort(compare), clip.strip, clip.frameCount,
      actionSlots.size, png.width, png.height, png.diskBytes, png.rgba8Bytes]);
  }
  for (const sheet of entriesBySheet.keys()) {
    if (!referencedSheets.has(sheet)) throw new Error(`Runtime sheet missing from frames.json: ${fighter}/${sheet}`);
  }
  const resources = [...urls.values()];
  const rgba8BytesByUniqueUrl = resources.reduce((sum, resource) => sum + resource.png.rgba8Bytes, 0);
  const rgba8BytesByRuntimeKey = resources.reduce((sum, resource) => sum + resource.png.rgba8Bytes * resource.keys.length, 0);
  return {
    fighter,
    metadataClipCount: actions.length,
    manifestKeyCount: manifestEntries.length,
    uniqueSheetUrlCount: urls.size,
    logicalFrameCount: actions.reduce((sum, row) => sum + row[3], 0),
    uniqueDrawingSlotCount: uniqueSlots.size,
    pngDiskBytesByUniqueUrl: resources.reduce((sum, resource) => sum + resource.png.diskBytes, 0),
    rgba8BytesByUniqueUrl,
    rgba8BytesByRuntimeKey,
    sharedUrlExtraRgba8Bytes: rgba8BytesByRuntimeKey - rgba8BytesByUniqueUrl,
    sharedUrls: [...urls].filter(([, resource]) => resource.keys.length > 1).sort(([a], [b]) => compare(a, b))
      .map(([url, resource]) => ({ url, runtimeKeys: resource.keys.sort(compare), rgba8Bytes: resource.png.rgba8Bytes })),
    topMemoryActions: [...actions].sort((a, b) => b[8] - a[8] || compare(a[0], b[0])).slice(0, 10).map(row => row[0]),
    actions,
  };
}

/** Keep each action row on one line, without duplicating rows in the ranking. */
function compactJson(value: unknown, depth = 0): string {
  const pad = '  '.repeat(depth), childPad = `${pad}  `;
  if (Array.isArray(value)) {
    const simple = (item: unknown): boolean => item === null || typeof item !== 'object';
    if (value.every(item => simple(item) || (Array.isArray(item) && item.every(simple)))) return JSON.stringify(value);
    return `[\n${value.map(item => childPad + compactJson(item, depth + 1)).join(',\n')}\n${pad}]`;
  }
  if (value !== null && typeof value === 'object') {
    const rows = Object.entries(value).map(([key, item]) => `${childPad}${JSON.stringify(key)}: ${compactJson(item, depth + 1)}`);
    return `{\n${rows.join(',\n')}\n${pad}}`;
  }
  return JSON.stringify(value);
}

function main(): void {
  let fighters = ['donkeykong', 'pikachu', 'link'], out: string | undefined;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      console.log('Usage: npx tsx tools/character-memory-audit.ts [--fighters donkeykong,pikachu,link] [--out report.json]');
      return;
    }
    if (arg !== '--fighters' && arg !== '--out') throw new Error(`Unknown argument: ${arg}`);
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    if (arg === '--fighters') fighters = value.split(','); else out = value;
  }
  if (fighters.some(fighter => !/^[a-z][a-z0-9_]*$/.test(fighter))) throw new Error('Invalid fighter identifier');
  const reports = [...new Set(fighters)].sort(compare).map(auditFighter);
  const report = {
    schema: 'character-memory-audit/1',
    measurement: {
      inputs: 'Current src/assets/manifest.ts, assets/characters/<fighter>/frames.json, PNG IHDR dimensions and file sizes.',
      drawingSlots: 'A distinct URL plus crop rectangle; repeated references share a slot. Separate rectangles or URLs count separately even if their pixels are identical. This is not a count of 60 Hz simulation frames.',
      rgba8Bytes: 'width * height * 4 per physical PNG. Runtime-key estimate assumes one full sheet allocation per cache key; unique-URL estimate deduplicates keys sharing a URL.',
      memoryLimits: 'Estimates exclude mipmaps, driver overhead, transient copies and CPU/browser decoded-image retention. They are neither measured CPU/GPU/process usage nor an additive CPU+GPU total. PNG disk bytes are compressed file sizes.',
      actionRows: 'Per-action sheet costs are descriptive, not additive when clips share a URL. Totals deduplicate URLs or count runtime keys explicitly. Top memory actions reference the action rows below.',
      scope: 'No image decoding, content hashing, browser execution, budget enforcement or asset mutation. Only --out writes a report.',
    },
    actionColumns: ['action', 'runtimeKeys', 'sheet', 'drawings', 'uniqueDrawingSlots', 'width', 'height', 'pngDiskBytes', 'rgba8Bytes'],
    fighters: reports,
  };
  console.log('Fighter       Clips  Keys  URLs  Drawings   PNG MiB  RGBA MiB/key  RGBA MiB/URL');
  for (const row of reports) {
    console.log(`${row.fighter.padEnd(13)} ${String(row.metadataClipCount).padStart(5)} ${String(row.manifestKeyCount).padStart(5)} ${String(row.uniqueSheetUrlCount).padStart(5)} ${String(row.uniqueDrawingSlotCount).padStart(9)} ${(row.pngDiskBytesByUniqueUrl / 1048576).toFixed(2).padStart(9)} ${(row.rgba8BytesByRuntimeKey / 1048576).toFixed(2).padStart(13)} ${(row.rgba8BytesByUniqueUrl / 1048576).toFixed(2).padStart(13)}`);
  }
  console.log('RGBA8 estimates exclude CPU copies, mipmaps and driver overhead; drawing slots are URL + crop, not simulation frames.');
  if (out) {
    const outputPath = resolve(out);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${compactJson(report)}\n`);
    console.log(`Report: ${relative(process.cwd(), outputPath) || outputPath}`);
  }
}

try { main(); } catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
