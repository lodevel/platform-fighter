/**
 * composite-shield.cjs — bake the ONE consistent Hylian shield sprite onto
 * every shieldless Link frame at a per-clip anchor. This is the decoupled-shield
 * system: per-frame AI can't keep a detailed shield consistent, so Link is
 * generated shieldless and the same shield image is composited in here, so its
 * design is byte-identical across all 88 frames.
 *
 * Anchors are body-bbox-relative (fx/fy fractions + scale fraction of body
 * height), tuned per clip. `layer:'back'` draws the shield BEHIND the character
 * (shield → character on top) for two-handed poses where it sits on the back;
 * `front` (default) draws it over the forearm.
 *
 * Reads shieldless frames from assets/gen/frames/link/, writes magenta-bg
 * composites back in place (run backup-shieldless first). Then pack-clips.cjs
 * as usual.
 *
 * Usage: node.exe tools/composite-shield.cjs [anchors.json]
 */
const { PNG } = require('pngjs');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FRAMES = path.join(ROOT, 'assets', 'gen', 'frames', 'link');
const SHIELD = path.join(ROOT, 'assets', 'gen', 'link-shield.png');
const MAG = [248, 0, 248];

const isMag = (r, g, b) => r > 140 && b > 140 && g < 80;

function bbox(im) {
  const { width: W, height: H, data: d } = im;
  let mnx = W, mny = H, mxx = 0, mxy = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (!isMag(d[i], d[i + 1], d[i + 2]) && d[i + 3] > 16) {
      if (x < mnx) mnx = x; if (x > mxx) mxx = x;
      if (y < mny) mny = y; if (y > mxy) mxy = y;
    }
  }
  return { mnx, mny, mxx, mxy, w: mxx - mnx + 1, h: mxy - mny + 1 };
}

// Per-clip anchor table. fx/fy = shield CENTER as a fraction of the body bbox
// (0,0 = top-left of the body). scale = shield height / body height. Tuned by
// eye on the composited contact sheet. Two-handed poses → shield on the back.
const DEFAULT = { fx: 0.28, fy: 0.50, scale: 0.34, layer: 'front' };
const BACK = { fx: 0.42, fy: 0.26, scale: 0.30, layer: 'back' };
const ANCHORS = {
  idle: { fx: 0.26, fy: 0.50, scale: 0.34, layer: 'front' },
  run: { fx: 0.30, fy: 0.50, scale: 0.33, layer: 'front' },
  jump: { fx: 0.30, fy: 0.50, scale: 0.33, layer: 'front' },
  crouch: { fx: 0.26, fy: 0.54, scale: 0.32, layer: 'front' },
  shield: { fx: 0.30, fy: 0.46, scale: 0.38, layer: 'front' },
  // two-handed / overhead → shield strapped on the back (upper-back/shoulder)
  smash: BACK,
  dair: BACK,
  attack: BACK,
  uair: BACK,
  // everything else uses DEFAULT (resolved in code)
};

function loadShield() {
  const sh = PNG.sync.read(fs.readFileSync(SHIELD));
  return { im: sh, bb: bbox(sh) };
}

function compositeFrame(framePath, anchor, shield) {
  const fr = PNG.sync.read(fs.readFileSync(framePath));
  const W = fr.width, H = fr.height;
  const fb = bbox(fr);
  const { im: sh, bb: sb } = shield;
  const targetH = anchor.scale * fb.h;
  const scale = targetH / sb.h;
  const dw = Math.round(sb.w * scale), dh = Math.round(sb.h * scale);
  const cx = fb.mnx + anchor.fx * fb.w, cy = fb.mny + anchor.fy * fb.h;
  const ox = Math.round(cx - dw / 2), oy = Math.round(cy - dh / 2);

  // Build the scaled, keyed shield as an RGBA layer.
  const shLayer = new Uint8Array(dw * dh * 4);
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    const ssx = sb.mnx + Math.floor(x / scale), ssy = sb.mny + Math.floor(y / scale);
    const si = (ssy * sh.width + ssx) * 4;
    const r = sh.data[si], g = sh.data[si + 1], b = sh.data[si + 2], a = sh.data[si + 3];
    const li = (y * dw + x) * 4;
    if (isMag(r, g, b) || a <= 16) { shLayer[li + 3] = 0; continue; }
    shLayer[li] = r; shLayer[li + 1] = g; shLayer[li + 2] = b; shLayer[li + 3] = 255;
  }

  // Output canvas filled with magenta (keeps the rest of the pipeline happy).
  const out = new PNG({ width: W, height: H });
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = MAG[0]; out.data[i + 1] = MAG[1]; out.data[i + 2] = MAG[2]; out.data[i + 3] = 255;
  }
  const paintChar = () => {
    for (let i = 0; i < fr.data.length; i += 4) {
      const r = fr.data[i], g = fr.data[i + 1], b = fr.data[i + 2];
      if (isMag(r, g, b) || fr.data[i + 3] <= 16) continue;
      out.data[i] = r; out.data[i + 1] = g; out.data[i + 2] = b; out.data[i + 3] = 255;
    }
  };
  const paintShield = () => {
    for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
      const li = (y * dw + x) * 4;
      if (shLayer[li + 3] === 0) continue;
      const tx = ox + x, ty = oy + y;
      if (tx < 0 || tx >= W || ty < 0 || ty >= H) continue;
      const di = (ty * W + tx) * 4;
      out.data[di] = shLayer[li]; out.data[di + 1] = shLayer[li + 1];
      out.data[di + 2] = shLayer[li + 2]; out.data[di + 3] = 255;
    }
  };
  if (anchor.layer === 'back') { paintShield(); paintChar(); }
  else { paintChar(); paintShield(); }
  fs.writeFileSync(framePath, PNG.sync.write(out));
}

function main() {
  const cfgPath = process.argv[2];
  const overrides = cfgPath && fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : {};
  const shield = loadShield();
  const files = fs.readdirSync(FRAMES).filter((f) => f.endsWith('.png') && !f.startsWith('_'));
  let n = 0;
  for (const f of files) {
    const clip = f.replace(/-\d+\.png$/, '');
    const anchor = overrides[clip] || ANCHORS[clip] || DEFAULT;
    compositeFrame(path.join(FRAMES, f), anchor, shield);
    n++;
  }
  console.log(`[composite-shield] composited ${n} frames (${files.length} files)`);
}
main();
