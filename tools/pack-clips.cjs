/**
 * pack-clips.cjs — turn raw 1024² generated frames into game-ready sprite strips.
 *
 * Reads assets/gen/frames/<fighter>/<anim>-<i>.png (magenta-bg AI frames) + the idle
 * keyframe, chroma-keys them, computes ONE global union-alpha bbox across EVERY frame
 * (so the character stays pinned at the same grid position across all anims), crops
 * each frame to that rect, downscales to a uniform cell, packs a horizontal strip per
 * anim, and writes assets/characters/<fighter>/animations/<anim>.png + frames.json.
 *
 * Idle is synthesized as a 4-frame breathing loop from a single keyframe; the other
 * anims use their generated frames directly. Pure Node + pngjs.
 */
const { PNG } = require('pngjs');
const fs = require('fs');
const path = require('path');

const FIGHTER = process.argv[2] || 'link';
const ROOT = path.join(__dirname, '..');
const FRAMES_DIR = path.join(ROOT, 'assets', 'gen', 'frames', FIGHTER);
const IDLE_KEYFRAME = path.join(ROOT, 'assets', 'gen', '_spike', 'cn-link.png');
const OUT_DIR = path.join(ROOT, 'assets', 'characters', FIGHTER);
const ANIM_DIR = path.join(OUT_DIR, 'animations');
const CELL_H = 64;
const BREATH = [1.0, 0.975, 1.0, 1.02];

function readPng(f) { return PNG.sync.read(fs.readFileSync(f)); }
// Chroma-key the flat background colour → alpha 0. Selectable via argv[3]:
//   magenta (#FF00FF, default): bg is high-R, high-B, low-G.
//   green   (#00FF00): for PINK fighters (Kirby) whose pink overlaps magenta in
//                      colour space — magenta can't separate them, green can.
// Tests are absolute per-channel (NOT relative like the old `g < r-50`, which a pink
// body satisfies → it keyed Kirby out, leaving a white ghost).
const KEYERS = {
  magenta: (r, g, b) => r > 140 && b > 140 && g < 80,
  green: (r, g, b) => g > 140 && r < 110 && b < 110,
};
const KEY_NAME = (process.argv[3] || 'magenta').toLowerCase();
const isBgPixel = KEYERS[KEY_NAME] || KEYERS.magenta;
function keyMagenta(p) {
  const d = p.data;
  for (let i = 0; i < d.length; i += 4) {
    if (isBgPixel(d[i], d[i + 1], d[i + 2])) d[i + 3] = 0;
  }
  return p;
}
function accumBbox(p, acc) {
  const { width: w, height: h, data } = p;
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) if (data[(w * y + x) * 4 + 3] > 32) row++;
    if (row >= 8) { if (y < acc.minY) acc.minY = y; if (y > acc.maxY) acc.maxY = y; }
  }
  for (let x = 0; x < w; x++) {
    let col = 0;
    for (let y = 0; y < h; y++) if (data[(w * y + x) * 4 + 3] > 32) col++;
    if (col >= 8) { if (x < acc.minX) acc.minX = x; if (x > acc.maxX) acc.maxX = x; }
  }
}
// fit cropped rect of src into a cell (cw x ch), preserving aspect, bottom-pinned,
// optional vertical breath scale.
function makeCell(src, rect, cw, ch, breath) {
  const cell = new PNG({ width: cw, height: ch }); cell.data.fill(0);
  const rw = rect.maxX - rect.minX + 1, rh = rect.maxY - rect.minY + 1;
  const drawH = Math.round(ch * 0.96 * breath);
  const drawW = Math.min(cw, Math.round(drawH * (rw / rh)));
  const offX = Math.floor((cw - drawW) / 2), offY = ch - drawH;
  for (let dy = 0; dy < drawH; dy++) {
    const ty = offY + dy; if (ty < 0 || ty >= ch) continue;
    const sy = Math.min(rh - 1, Math.max(0, Math.round((dy / (drawH - 1)) * (rh - 1))));
    for (let dx = 0; dx < drawW; dx++) {
      const tx = offX + dx; if (tx < 0 || tx >= cw) continue;
      const sx = Math.min(rw - 1, Math.max(0, Math.round((dx / (drawW - 1)) * (rw - 1))));
      const si = (src.width * (rect.minY + sy) + (rect.minX + sx)) * 4;
      const di = (cw * ty + tx) * 4;
      cell.data[di] = src.data[si]; cell.data[di + 1] = src.data[si + 1];
      cell.data[di + 2] = src.data[si + 2]; cell.data[di + 3] = src.data[si + 3];
    }
  }
  return cell;
}

function listAnim(anim) {
  return fs.readdirSync(FRAMES_DIR).filter((f) => f.startsWith(anim + '-') && f.endsWith('.png'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((f) => path.join(FRAMES_DIR, f));
}

function main() {
  // Discover EVERY <anim>-<N>.png group in the frames dir (idle/run/jump/attack/
  // crouch + per-move attacks/specials) — no hardcoded list, so new clips pack
  // automatically.
  const groupNames = [...new Set(
    fs.readdirSync(FRAMES_DIR)
      .filter((f) => /^[a-z][a-z0-9_]*-\d+\.png$/.test(f))
      .map((f) => f.replace(/-\d+\.png$/, '')),
  )].sort();
  // Idle: if the fighter shipped generated idle frames, pack them like any group;
  // otherwise synthesize a breathing loop from the legacy keyframe (link v1).
  const hasIdleFrames = groupNames.includes('idle');
  const idleSrc = hasIdleFrames ? null : keyMagenta(readPng(IDLE_KEYFRAME));
  const anims = {};
  for (const anim of groupNames) anims[anim] = listAnim(anim).map((f) => keyMagenta(readPng(f)));
  // global bbox across EVERYTHING (the legacy keyframe only when it's actually used)
  const acc = { minX: 1e9, minY: 1e9, maxX: -1, maxY: -1 };
  if (idleSrc) accumBbox(idleSrc, acc);
  for (const a of Object.values(anims)) for (const p of a) accumBbox(p, acc);
  const rw = acc.maxX - acc.minX + 1, rh = acc.maxY - acc.minY + 1;
  // FIXED square cell so the manifest's frameWidth/frameHeight never drift across
  // regenerations (makeCell fits the global rect into it, aspect-preserved + bottom-
  // pinned, so the character is centred with horizontal padding as needed).
  const cellW = CELL_H, cellH = CELL_H;
  console.log(`global rect ${rw}x${rh} -> cell ${cellW}x${cellH} (fixed square)`);

  fs.mkdirSync(ANIM_DIR, { recursive: true });
  const framesJson = { meta: { source: 'AI: Z-Image ControlNet pose-source pipeline (tools/gen-frames.ts + pack-clips.cjs)', cellWidth: cellW, cellHeight: cellH }, animations: {} };

  // idle: breathing loop from the keyframe ONLY when no idle frames were generated
  if (!hasIdleFrames && idleSrc) {
    const idleCells = BREATH.map((b) => makeCell(idleSrc, acc, cellW, cellH, b));
    writeStrip('idle', idleCells, cellW, cellH, framesJson);
  }
  // every discovered group (incl. generated idle if present): one cell per frame
  for (const anim of groupNames) {
    const cells = anims[anim].map((p) => makeCell(p, acc, cellW, cellH, 1.0));
    if (cells.length) writeStrip(anim, cells, cellW, cellH, framesJson);
  }
  fs.writeFileSync(path.join(OUT_DIR, 'frames.json'), JSON.stringify(framesJson, null, 2));
  console.log('wrote frames.json with anims:', Object.keys(framesJson.animations).join(', '));
}

function writeStrip(anim, cells, cw, ch, framesJson) {
  const strip = new PNG({ width: cw * cells.length, height: ch }); strip.data.fill(0);
  cells.forEach((c, i) => PNG.bitblt(c, strip, 0, 0, cw, ch, i * cw, 0));
  fs.writeFileSync(path.join(ANIM_DIR, `${anim}.png`), PNG.sync.write(strip));
  framesJson.animations[anim] = { strip: `animations/${anim}.png`, frameCount: cells.length, frameWidth: cw, frameHeight: ch, sourceCells: cells.map((_, i) => [i, 0]) };
  console.log(`  ${anim}: ${cells.length} frames -> ${cw * cells.length}x${ch}`);
}

main();
