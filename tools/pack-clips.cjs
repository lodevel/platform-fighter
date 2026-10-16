/**
 * pack-clips.cjs — turn raw 1024² generated frames into game-ready sprite strips.
 *
 * Reads assets/gen/frames/<fighter>/<anim>-<i>.png (magenta-bg AI frames) + the idle
 * keyframe, chroma-keys them, computes ONE global union-alpha bbox across EVERY frame
 * (so the character stays pinned at the same grid position across all anims), crops
 * each frame to that rect, downscales to a uniform 256×256 cell (CELL_H), packs a horizontal strip per
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
// Idle keyframe for the synthesized breathing loop (used only when no idle-*.png
// frames were generated). Per-fighter `cn-<fighter>.png` if present, else the
// legacy Link keyframe. Picking the wrong fighter's keyframe renders the WRONG
// character's idle, so always ship a per-fighter keyframe for new packs.
const SPIKE_DIR = path.join(ROOT, 'assets', 'gen', '_spike');
const IDLE_KEYFRAME = fs.existsSync(path.join(SPIKE_DIR, `cn-${FIGHTER}.png`))
  ? path.join(SPIKE_DIR, `cn-${FIGHTER}.png`)
  : path.join(SPIKE_DIR, 'cn-link.png');
const OUT_DIR = path.join(ROOT, 'assets', 'characters', FIGHTER);
const ANIM_DIR = path.join(OUT_DIR, 'animations');
const CELL_H = 256;
const BREATH = [1.0, 0.975, 1.0, 1.02];

function readPng(f) { return PNG.sync.read(fs.readFileSync(f)); }
// Chroma-key the flat background colour → alpha 0. Selectable via argv[3]:
//   magenta (#FF00FF, default): bg is high-R, high-B, low-G.
//   green   (#00FF00): for PINK fighters (Kirby) whose pink overlaps magenta in
//                      colour space — magenta can't separate them, green can.
// Tests are absolute per-channel (NOT relative like the old `g < r-50`, which a pink
// body satisfies → it keyed Kirby out, leaving a white ghost).
const KEYERS = {
  // Hue-based: the renderer does not always hit #FF00FF — DK's back-throw
  // frames came out on (142,0,104) / (188,0,129) and the old absolute test
  // (r > 140 && b > 140 && g < 80) left those backgrounds opaque, ballooning
  // the union rect to the whole frame. Anything strongly red+blue with little
  // green is background; fighter reds have b ≈ g, skins have high g.
  // The VAE leaves a one-pixel border of desaturated mauve (~175,94,154) on
  // the canvas edge; with g up to ~110 it must still key, else the union rect
  // grows to the canvas bottom and a stray dot survives in every cell.
  magenta: (r, g, b) => r > 100 && b > 70 && g < 110 && r - g > 70 && b - g > 50 && b > 0.6 * r,
  green: (r, g, b) => g > 140 && r < 110 && b < 110,
};
const KEY_NAME = (process.argv[3] || 'magenta').toLowerCase();
const isBgPixel = KEYERS[KEY_NAME] || KEYERS.magenta;
// Looser magenta test for red-tinted background in concavities (crotch,
// armpit, behind a limb): the renderer bleeds fur red into the key colour
// there, leaving (240,8,115)-style hot pink. Applied ONLY to pixels reachable
// from the frame border through pixels that pass this test — as a plain
// threshold it would open holes in pinkish interior shading (51k px in one
// Spinning Kong frame).
const LOOSE_MAGENTA = (r, g, b) => r > 100 && b > 60 && g < 110 && r - g > 70 && b - g > 50 && b > 0.3 * r;
function keyMagenta(p) {
  const d = p.data;
  for (let i = 0; i < d.length; i += 4) {
    if (isBgPixel(d[i], d[i + 1], d[i + 2])) d[i + 3] = 0;
  }
  if (KEY_NAME === 'magenta') keyConnectedResidue(p);
  return despeckle(p);
}
function keyConnectedResidue(p) {
  const { width: w, height: h, data: d } = p;
  const loose = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    if (d[o + 3] === 0 || LOOSE_MAGENTA(d[o], d[o + 1], d[o + 2])) loose[i] = 1;
  }
  // Components of loose pixels: key those that touch the frame border (the
  // background itself and everything red-tinted attached to it) and small
  // enclosed pockets (< SMALL_POCKET px: pink showing through between legs,
  // under an arm). Large enclosed pinkish regions are shading and stay.
  const SMALL_POCKET = Math.round(400 * (w * h) / (1024 * 1024));
  const seen = new Uint8Array(w * h); const stack = [];
  let keyed = 0;
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || !loose[s]) continue;
    const comp = []; let border = false;
    stack.push(s); seen[s] = 1;
    while (stack.length) {
      const i = stack.pop(); comp.push(i);
      const x = i % w, y = (i - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
      const nb = [];
      if (x > 0) nb.push(i - 1);
      if (x < w - 1) nb.push(i + 1);
      if (y > 0) nb.push(i - w);
      if (y < h - 1) nb.push(i + w);
      for (const j of nb) if (!seen[j] && loose[j]) { seen[j] = 1; stack.push(j); }
    }
    if (border || comp.length < SMALL_POCKET) {
      for (const i of comp) if (d[i * 4 + 3] !== 0) { d[i * 4 + 3] = 0; keyed++; }
    }
  }
  // Floating specks: opaque components smaller than SMALL_SPECK px (a
  // detached pink streak, a stray cream fragment) are not fighter.
  const SMALL_SPECK = Math.round(250 * (w * h) / (1024 * 1024));
  const seen2 = new Uint8Array(w * h);
  for (let s = 0; s < w * h; s++) {
    if (seen2[s] || d[s * 4 + 3] === 0) continue;
    const comp = []; stack.push(s); seen2[s] = 1;
    while (stack.length) {
      const i = stack.pop(); comp.push(i);
      const x = i % w, y = (i - x) / w;
      const nb = [];
      if (x > 0) nb.push(i - 1);
      if (x < w - 1) nb.push(i + 1);
      if (y > 0) nb.push(i - w);
      if (y < h - 1) nb.push(i + w);
      for (const j of nb) if (!seen2[j] && d[j * 4 + 3] !== 0) { seen2[j] = 1; stack.push(j); }
    }
    if (comp.length < SMALL_SPECK) for (const i of comp) { d[i * 4 + 3] = 0; keyed++; }
  }
  return keyed;
}
// Drop isolated opaque pixels the keyer leaves behind (off-tint corner pixels,
// stray noise): an opaque pixel with fewer than 2 opaque 8-neighbours becomes
// transparent. Real silhouette pixels always have neighbours, so the body is
// untouched; without this, a single off-magenta corner pixel survives into the
// cell and shows as a dot at the sprite's corner.
function despeckle(p) {
  const { width: w, height: h, data: d } = p;
  const alpha = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) alpha[i] = d[i * 4 + 3] > 32 ? 1 : 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!alpha[w * y + x]) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const yy = y + dy, xx = x + dx;
          if (yy >= 0 && yy < h && xx >= 0 && xx < w && alpha[w * yy + xx]) n++;
        }
      }
      if (n < 2) d[(w * y + x) * 4 + 3] = 0;
    }
  }
  return p;
}
// Frames may come on different canvas sizes (a wide-reach pose rendered on a
// 1536x1024 canvas next to 1024x1024 frames). Every canvas shares the same
// registration — fighter centroid at the horizontal centre, ground line the
// same distance above the bottom — so frames are aligned on a virtual canvas
// of the largest width/height: centred horizontally, bottom-aligned.
function alignFrames(frames) {
  const wMax = Math.max(...frames.map((p) => p.width));
  const hMax = Math.max(...frames.map((p) => p.height));
  for (const p of frames) { p.offX = Math.floor((wMax - p.width) / 2); p.offY = hMax - p.height; }
  return { wMax, hMax };
}
function accumBbox(p, acc) {
  const { width: w, height: h, data } = p;
  const offX = p.offX || 0, offY = p.offY || 0;
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) if (data[(w * y + x) * 4 + 3] > 32) row++;
    if (row >= 8) { if (y + offY < acc.minY) acc.minY = y + offY; if (y + offY > acc.maxY) acc.maxY = y + offY; }
  }
  for (let x = 0; x < w; x++) {
    let col = 0;
    for (let y = 0; y < h; y++) if (data[(w * y + x) * 4 + 3] > 32) col++;
    if (col >= 8) { if (x + offX < acc.minX) acc.minX = x + offX; if (x + offX > acc.maxX) acc.maxX = x + offX; }
  }
}
// fit cropped rect of src into a cell (cw x ch), preserving aspect, bottom-pinned,
// optional vertical breath scale.
function makeCell(src, rect, cw, ch, breath) {
  const cell = new PNG({ width: cw, height: ch }); cell.data.fill(0);
  const rw = rect.maxX - rect.minX + 1, rh = rect.maxY - rect.minY + 1;
  // Fit BOTH dimensions: a union rect wider than it is tall (wide-reach kits
  // such as DK's smash and Spinning Kong) used to keep the 0.96 height fit and
  // clip drawW at the cell width, squashing every frame horizontally.
  const fit = Math.min((ch * 0.96) / rh, cw / rw);
  const drawH = Math.round(rh * fit * breath);
  const drawW = Math.round(rw * fit);
  const offX = Math.floor((cw - drawW) / 2), offY = ch - drawH;
  for (let dy = 0; dy < drawH; dy++) {
    const ty = offY + dy; if (ty < 0 || ty >= ch) continue;
    const sy = Math.min(rh - 1, Math.max(0, Math.round((dy / (drawH - 1)) * (rh - 1))));
    for (let dx = 0; dx < drawW; dx++) {
      const tx = offX + dx; if (tx < 0 || tx >= cw) continue;
      const sx = Math.min(rw - 1, Math.max(0, Math.round((dx / (drawW - 1)) * (rw - 1))));
      // virtual-canvas → this frame's own pixels; outside the frame = transparent
      const fx = rect.minX + sx - (src.offX || 0), fy = rect.minY + sy - (src.offY || 0);
      if (fx < 0 || fy < 0 || fx >= src.width || fy >= src.height) continue;
      const si = (src.width * fy + fx) * 4;
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
  // align mixed canvas sizes, then global bbox across EVERYTHING (the legacy
  // keyframe only when it's actually used)
  const allFrames = Object.values(anims).flat().concat(idleSrc ? [idleSrc] : []);
  const { wMax, hMax } = alignFrames(allFrames);
  console.log(`virtual canvas ${wMax}x${hMax} over ${allFrames.length} frames`);
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
