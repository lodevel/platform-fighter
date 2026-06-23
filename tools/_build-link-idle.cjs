/**
 * _build-link-idle.cjs — v1 idle clip from one clean ControlNet keyframe.
 *
 * Pipeline proof: chroma-key the keyframe -> crop to content -> synthesize a 4-frame
 * subtle "breathing" idle (bottom-pinned vertical squash/stretch) -> pack a horizontal
 * strip at a uniform cell -> emit frames.json. Distinct AI poses (run/jump/attack) come
 * later via the pose-source step; idle reads well as subtle motion, so it's the safe
 * first end-to-end. Pure Node + pngjs.
 */
const { PNG } = require('pngjs');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'assets', 'gen', '_spike', 'cn-link.png');
const OUT_DIR = path.join(__dirname, '..', 'assets', 'characters', 'link');
const ANIM_DIR = path.join(OUT_DIR, 'animations');
const CELL = 64; // match wolf's 64x64 grid convention
const FRAMES = 4;
// bottom-pinned vertical scale per frame — gentle breathing loop
const BREATH = [1.0, 0.975, 1.0, 1.02];

function readPng(f) { return PNG.sync.read(fs.readFileSync(f)); }

// magenta chroma-key -> alpha 0. Tolerant (ControlNet bg is ~[240,18,228] with
// slight noise): magenta = high R+B, G well below both.
function keyMagenta(png) {
  const { data } = png;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (r > 140 && b > 120 && g < r - 50 && g < b - 40) data[i + 3] = 0;
  }
  return png;
}

// bbox of opaque content, ignoring sparse stray pixels: a row/col counts only if it
// has >= MIN_RUN opaque pixels, so a few un-keyed noise specks don't inflate the box.
function alphaBbox(png) {
  const { width: w, height: h, data } = png;
  const MIN = 8;
  const colCnt = new Int32Array(w), rowCnt = new Int32Array(h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(w * y + x) * 4 + 3] > 32) { colCnt[x]++; rowCnt[y]++; }
  }
  let minX = w, maxX = -1, minY = h, maxY = -1;
  for (let x = 0; x < w; x++) if (colCnt[x] >= MIN) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
  for (let y = 0; y < h; y++) if (rowCnt[y] >= MIN) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
  return { minX, minY, maxX, maxY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

// sample src (cropped region) at (sx,sy) with bilinear-ish nearest, returns rgba
function sample(png, bb, fx, fy) {
  const x = Math.min(bb.w - 1, Math.max(0, Math.round(bb.minX + fx * (bb.w - 1))));
  const y = Math.min(bb.h - 1, Math.max(0, Math.round(bb.minY + fy * (bb.h - 1))));
  const i = (png.width * y + x) * 4;
  return [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]];
}

// render one cell: fit cropped subject into CELL preserving aspect, bottom-pinned,
// vertical scale = breath. Feet stay at the same baseline across frames.
function makeCell(png, bb, breath) {
  const cell = new PNG({ width: CELL, height: CELL });
  cell.data.fill(0);
  const aspect = bb.w / bb.h;
  // base draw height fills ~92% of cell; breath squashes/stretches vertically
  const drawH = Math.round(CELL * 0.92 * breath);
  const drawW = Math.min(CELL, Math.round(drawH * aspect));
  const offX = Math.floor((CELL - drawW) / 2);
  const offY = CELL - drawH; // bottom-pinned
  for (let dy = 0; dy < drawH; dy++) {
    const ty = offY + dy;
    if (ty < 0 || ty >= CELL) continue;
    for (let dx = 0; dx < drawW; dx++) {
      const tx = offX + dx;
      if (tx < 0 || tx >= CELL) continue;
      const [r, g, b, a] = sample(png, bb, dx / (drawW - 1), dy / (drawH - 1));
      const di = (CELL * ty + tx) * 4;
      cell.data[di] = r; cell.data[di + 1] = g; cell.data[di + 2] = b; cell.data[di + 3] = a;
    }
  }
  return cell;
}

function main() {
  const src = keyMagenta(readPng(SRC));
  const bb = alphaBbox(src);
  console.log(`source content bbox: ${bb.w}x${bb.h}`);
  const strip = new PNG({ width: CELL * FRAMES, height: CELL });
  strip.data.fill(0);
  for (let f = 0; f < FRAMES; f++) {
    const cell = makeCell(src, bb, BREATH[f]);
    PNG.bitblt(cell, strip, 0, 0, CELL, CELL, f * CELL, 0);
  }
  fs.mkdirSync(ANIM_DIR, { recursive: true });
  fs.writeFileSync(path.join(ANIM_DIR, 'idle.png'), PNG.sync.write(strip));
  const framesJson = {
    meta: { source: 'AI: Z-Image ControlNet (canny) keyframe + procedural breathing', cellWidth: CELL, cellHeight: CELL, generator: 'tools/_build-link-idle.cjs' },
    animations: {
      idle: { strip: 'animations/idle.png', frameCount: FRAMES, frameWidth: CELL, frameHeight: CELL, sourceCells: Array.from({ length: FRAMES }, (_, i) => [i, 0]) },
    },
  };
  fs.writeFileSync(path.join(OUT_DIR, 'frames.json'), JSON.stringify(framesJson, null, 2));
  console.log(`wrote ${path.join(ANIM_DIR, 'idle.png')} (${CELL * FRAMES}x${CELL}) + frames.json`);
}
main();
