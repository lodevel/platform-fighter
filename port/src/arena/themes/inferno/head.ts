import * as THREE from 'three';
import type { GazeView, StageClock } from '../../contract';
import { restEye } from '../../../engine/space';
import { LEGACY_LIGHT, glowSprite } from '../../kit/toonKit';

/**
 * The Inferno's giant head, filling most of the screen behind the stage.
 * The picture is a personal one, served from port/private (never built or
 * committed); without it a carved stone face stands in. Eye positions are
 * in texture UVs of the 1024² cut-out (head-cutout from the upscale).
 */
export const HEAD_IMAGE_URL = `${import.meta.env.BASE_URL}private/inferno-head.png`;
const EYES: readonly [THREE.Vector2, THREE.Vector2] = [new THREE.Vector2(0.4, 1 - 0.508), new THREE.Vector2(0.596, 1 - 0.523)];
/**
 * The strip between the nose and the upper lip, in texture UVs (v up): where
 * the mustache platform sits when the head is fully risen. Measured on the
 * 1024² cut-out: nose base y≈708, upper lip y≈745, centre x≈492, nostrils
 * ≈ 11.4% of the picture's width.
 */
export const PHILTRUM = Object.freeze({ u: 492 / 1024, vTop: 1 - 708 / 1024, vBottom: 1 - 745 / 1024, width: 0.114 });

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const FRAG = `
  uniform sampler2D map; uniform float eyeGlow, heat, time; uniform vec2 eyeL, eyeR; uniform vec3 haze;
  varying vec2 vUv;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y); }
  void main(){
    vec4 tex = texture2D(map, vUv);
    if (tex.a < 0.03) discard;
    // Lit by the lava from below, falling into darkness at the top.
    vec3 col = tex.rgb * mix(vec3(1.35, 0.55, 0.32), vec3(0.42, 0.24, 0.26), smoothstep(0.1, 0.95, vUv.y));
    // Molten coat that drains off as the head rises.
    // Streaks run down the face: a level that drops as heat falls, broken into drips.
    float streak = noise(vec2(vUv.x * 38.0, vUv.y * 1.2 + time * 0.9));
    float level = 1.0 - heat * 1.1;
    float coat = smoothstep(level - 0.02, level + 0.02, (1.0 - vUv.y) * 0.85 + streak * 0.3) * step(0.02, heat);
    col = mix(col, vec3(1.0, 0.38, 0.07) * (0.85 + 0.3 * streak), coat * 0.9);
    // Eyes: white-hot cores and an orange bloom.
    float d = min(length((vUv - eyeL) * vec2(1.0, 1.9)), length((vUv - eyeR) * vec2(1.0, 1.9)));
    col = mix(col, vec3(1.0, 0.97, 0.82), smoothstep(0.05, 0.0, d) * eyeGlow);
    col += vec3(1.0, 0.42, 0.1) * smoothstep(0.17, 0.0, d) * eyeGlow * 0.9;
    col = mix(col, haze, 0.18);
    gl_FragColor = vec4(col, tex.a);
  }`;

/** Stand-in face when the personal picture is absent: carved stone with horns. */
function stoneFace(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const x = c.getContext('2d')!;
  x.fillStyle = '#5b4a4f';
  x.beginPath(); x.ellipse(256, 270, 150, 190, 0, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#3b2d33';
  [[-1, 120], [1, 392]].forEach(([s, hx]) => { x.beginPath(); x.moveTo(hx!, 170); x.quadraticCurveTo(hx! + s! * 70, 40, hx! + s! * 40, 10); x.lineTo(hx! - s! * 10, 150); x.fill(); });
  x.fillStyle = '#140b0e';
  EYES.forEach((e) => { x.beginPath(); x.ellipse(e.x * 512, (1 - e.y) * 512, 34, 20, 0, 0, Math.PI * 2); x.fill(); });
  x.beginPath(); x.ellipse(256, 400, 70, 20, 0, 0, Math.PI * 2); x.fill();
  return new THREE.CanvasTexture(c);
}

export interface GiantHead {
  update(view: GazeView, clock: StageClock): void;
  /**
   * Size and place the risen head so that, seen from the rest eye, the
   * strip under its nose lies exactly behind a gameplay-plane rectangle whose
   * top-centre is `target` and width is `width` (the mustache platform).
   */
  alignPhiltrum(target: THREE.Vector3, width: number): void;
  /** 0..1 flash brightness this frame, for the arena's own lights. */
  readonly flash: number;
  readonly eyeGlow: number;
}

export function createGiantHead(scene: THREE.Scene, glowTex: THREE.Texture, opts: { seaY: number; z: number; haze: number; target: THREE.Vector3; width: number }): GiantHead {
  const uniforms = {
    map: { value: stoneFace() as THREE.Texture }, eyeGlow: { value: 0 }, heat: { value: 1 }, time: { value: 0 },
    eyeL: { value: EYES[0] }, eyeR: { value: EYES[1] }, haze: { value: new THREE.Color(opts.haze) },
  };
  new THREE.TextureLoader().load(HEAD_IMAGE_URL, (tex) => { uniforms.map.value = tex; }, undefined, () => { /* keep the stone face */ });
  // A unit plane scaled to `size`, so alignment can resize it.
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
    new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false }));
  mesh.visible = false;
  scene.add(mesh);
  const eye = restEye();
  const placed = { size: 1, x: 0, risenY: 0, hiddenY: 0 };

  const eyeSprites = EYES.map(() => glowSprite(glowTex, 0xffb060, 1, 1, false));
  eyeSprites.forEach((s) => mesh.add(s));
  const light = new THREE.PointLight(0xff4a1a, 0, 900, 1);
  scene.add(light);
  // The flash: a white veil over the whole arena (fighters stay drawn on top).
  const veil = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshBasicMaterial({
    color: 0xfff6e0, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false,
  }));
  veil.position.z = 60;
  veil.renderOrder = 999;
  scene.add(veil);

  const easeOut = (t: number) => 1 - (1 - t) ** 3;
  const easeIn = (t: number) => t ** 3;
  const head: GiantHead = {
    flash: 0, eyeGlow: 0,
    update({ phase, progress }, { elapsed }) {
      let rise = 0, glow = 0, flash = 0, heat = 1;
      if (phase === 'rising') { rise = easeOut(progress); heat = Math.max(0, 0.9 - progress * 1.1); glow = 0.08; }
      else if (phase === 'glare') { rise = 1; heat = 0; glow = 0.15 + 0.85 * progress ** 1.6; }
      else if (phase === 'flash') { rise = 1; heat = 0; glow = 1; flash = (1 - progress) ** 0.6; }
      else if (phase === 'sinking') { rise = 1 - easeIn(progress); heat = progress * 0.8; glow = (1 - progress) * 0.4; }
      mesh.visible = phase !== 'dormant';
      // A low rumble while it moves and glares; still during the flash.
      const tremble = phase === 'glare' ? 0.6 * glow : phase === 'rising' || phase === 'sinking' ? 0.35 : 0;
      mesh.position.set(placed.x + Math.sin(elapsed * 31) * tremble, placed.hiddenY + (placed.risenY - placed.hiddenY) * rise + Math.sin(elapsed * 23) * tremble, opts.z);
      uniforms.eyeGlow.value = glow;
      uniforms.heat.value = heat;
      uniforms.time.value = elapsed;
      eyeSprites.forEach((s, i) => {
        const e = EYES[i]!;
        // Children of the unit-plane mesh: positions and sizes are in picture units.
        s.position.set(e.x - 0.5, e.y - 0.5, 0.01);
        const size = 0.05 + 0.25 * glow + 1.2 * flash;
        s.scale.set(size, size, 1);
        s.material.opacity = Math.min(1, glow * 1.2);
      });
      light.position.set(placed.x, opts.seaY + placed.size * 0.4, opts.z + 120);
      light.intensity = (glow * 2.5 + flash * 12) * LEGACY_LIGHT;
      (veil.material as THREE.MeshBasicMaterial).opacity = flash * 0.92;
      (head as { flash: number }).flash = flash;
      (head as { eyeGlow: number }).eyeGlow = glow;
    },
    alignPhiltrum(target, width) {
      // Along the ray from the eye through the target, at the head's depth.
      const k = (eye.z - opts.z) / (eye.z - target.z);
      const at = eye.clone().add(target.clone().sub(eye).multiplyScalar(k));
      placed.size = (width * k) / PHILTRUM.width;
      placed.x = at.x - (PHILTRUM.u - 0.5) * placed.size;
      placed.risenY = at.y - (PHILTRUM.vTop - 0.5) * placed.size;
      placed.hiddenY = opts.seaY - placed.size / 2 - 4;
      mesh.scale.set(placed.size, placed.size, 1);
    },
  };
  head.alignPhiltrum(opts.target, opts.width);
  return head;
}
