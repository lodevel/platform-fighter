// Build packed horizontal animation strips for the post-batch-2 fighters
// (Volt / Nova / Bruno) from their upstream per-frame PNG sources.
//
// For each pack we compute ONE global union alpha bbox across every frame
// of every animation (so a single crop rect keeps the character pinned at
// the same grid position across idle/run/jump), crop each frame to that
// rect, box-filter downscale to a fixed cell size, and write a horizontal
// strip per animation. The cell size is uniform per pack so Phaser's
// `load.spritesheet({ frameWidth, frameHeight })` slices cleanly.
//
// Pure Node + pngjs (already a devDependency). No PIL / ImageMagick.

const { PNG } = require('pngjs');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '_spritesrc');
const OUT_ROOT = path.join(__dirname, '..', 'assets', 'characters');

function readPng(file) {
  return PNG.sync.read(fs.readFileSync(file));
}

function listPng(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.png'))
    .sort();
}

// Global union alpha bbox over a list of {dir,files} groups.
function unionBbox(groups) {
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (const g of groups) {
    for (const f of g.files) {
      const p = readPng(path.join(g.dir, f));
      for (let y = 0; y < p.height; y++) {
        for (let x = 0; x < p.width; x++) {
          if (p.data[(p.width * y + x) * 4 + 3] > 16) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
    }
  }
  return { minX, minY, maxX, maxY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

// Box-filter downscale a cropped region of `src` (rect in src coords) into
// a `dw`x`dh` RGBA Float buffer, then quantise to 8-bit. Pads (transparent)
// when the rect runs off the source canvas.
function downscaleCrop(src, rect, dw, dh) {
  const out = new PNG({ width: dw, height: dh });
  const sx = rect.w / dw;
  const sy = rect.h / dh;
  for (let oy = 0; oy < dh; oy++) {
    for (let ox = 0; ox < dw; ox++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      const x0 = Math.floor(ox * sx), x1 = Math.max(x0 + 1, Math.floor((ox + 1) * sx));
      const y0 = Math.floor(oy * sy), y1 = Math.max(y0 + 1, Math.floor((oy + 1) * sy));
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const px = rect.minX + xx, py = rect.minY + yy;
          if (px < 0 || py < 0 || px >= src.width || py >= src.height) { n++; continue; }
          const i = (src.width * py + px) * 4;
          const al = src.data[i + 3] / 255;
          r += src.data[i] * al; g += src.data[i + 1] * al; b += src.data[i + 2] * al;
          a += src.data[i + 3];
          n++;
        }
      }
      if (n === 0) n = 1;
      const oi = (dw * oy + ox) * 4;
      const aa = a / n;
      const alphaW = aa > 0 ? (a / 255) : 1; // un-premultiply
      out.data[oi] = Math.round(r / alphaW);
      out.data[oi + 1] = Math.round(g / alphaW);
      out.data[oi + 2] = Math.round(b / alphaW);
      out.data[oi + 3] = Math.round(aa);
    }
  }
  return out;
}

// Compose downscaled frames into one horizontal strip.
function buildStrip(src, frames, cellW, cellH) {
  const strip = new PNG({ width: cellW * frames.length, height: cellH });
  // transparent init
  strip.data.fill(0);
  frames.forEach((rect, idx) => {
    const cell = downscaleCrop(src.__img ?? src, rect.__crop ?? rect, cellW, cellH);
    PNG.bitblt(cell, strip, 0, 0, cellW, cellH, idx * cellW, 0);
  });
  return strip;
}

// Build a strip for one animation given an array of full-frame source PNGs,
// a shared crop rect, and a target cell size. Each frame is cropped to the
// SAME rect (centring the character consistently) then downscaled.
function buildAnim(srcPngs, rect, cellW, cellH) {
  const strip = new PNG({ width: cellW * srcPngs.length, height: cellH });
  strip.data.fill(0);
  srcPngs.forEach((img, idx) => {
    const cell = downscaleCrop(img, rect, cellW, cellH);
    PNG.bitblt(cell, strip, 0, 0, cellW, cellH, idx * cellW, 0);
  });
  return strip;
}

function writeStrip(outDir, name, png) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, name), PNG.sync.write(png));
}

// ---- Pack descriptors -----------------------------------------------------

const PACKS = {
  volt: {
    base: path.join(SRC, 'kitten', 'TINY CAT SPRITE'),
    anims: {
      idle: '01_Idle',
      run: '02_Run',
      jump: '03_Jump/01_Up',
      attack: '03_Jump/02_Fall', // reuse the fall pounce as the "attack" pose
    },
    cellW: 64,
    cellH: 80,
  },
  nova: {
    base: path.join(SRC, 'cyborg', 'CyborgMark'),
    anims: {
      idle: 'Idle',
      run: 'RUN',
      jump: 'Jump',
      attack: 'Shoot',
    },
    cellW: 72,
    cellH: 96,
  },
  bruno: {
    base: path.join(SRC, 'platformer', 'generic_platformer_pack__bakudas', 'Player'),
    anims: {
      idle: 'idle',
      run: 'run',
      jump: 'jump',
      attack: 'run', // no attack frames in pack — reuse run lunge for attack pose
    },
    // native pixel art is 22x32; keep 1:1-ish to preserve crisp pixels
    cellW: 28,
    cellH: 36,
  },
};

const report = {};

for (const [id, pack] of Object.entries(PACKS)) {
  // Gather frame file groups.
  const groups = {};
  for (const [anim, rel] of Object.entries(pack.anims)) {
    const dir = path.join(pack.base, rel);
    groups[anim] = { dir, files: listPng(dir) };
  }
  // Global union bbox across ALL anims for consistent character placement,
  // padded a touch so downscale doesn't clip edges.
  const bbox = unionBbox(Object.values(groups));
  const PAD = Math.round(Math.max(bbox.w, bbox.h) * 0.04);
  // Make the crop rect match the cell aspect ratio so the downscale doesn't
  // distort: expand the shorter axis around the bbox centre.
  const cellAspect = pack.cellW / pack.cellH;
  let cw = bbox.w + PAD * 2;
  let ch = bbox.h + PAD * 2;
  const cx = bbox.minX + bbox.w / 2;
  const cy = bbox.minY + bbox.h / 2;
  if (cw / ch > cellAspect) {
    ch = cw / cellAspect; // too wide → grow height
  } else {
    cw = ch * cellAspect; // too tall → grow width
  }
  const rect = {
    minX: Math.round(cx - cw / 2),
    minY: Math.round(cy - ch / 2),
    w: Math.round(cw),
    h: Math.round(ch),
  };

  const outDir = path.join(OUT_ROOT, id, 'animations');
  const animReport = {};
  for (const [anim, grp] of Object.entries(groups)) {
    const srcPngs = grp.files.map((f) => readPng(path.join(grp.dir, f)));
    const strip = buildAnim(srcPngs, rect, pack.cellW, pack.cellH);
    writeStrip(outDir, `${anim}.png`, strip);
    animReport[anim] = grp.files.length;
  }
  report[id] = { cell: [pack.cellW, pack.cellH], rect, frames: animReport };
}

console.log(JSON.stringify(report, null, 2));
