import * as THREE from 'three';
import { LEGACY_LIGHT, pointCloud, type Rand } from './toonKit';

/**
 * Open-air scenery shared by the daylight arenas (Sky Ruins, Wind Canyon,
 * Crumbling Temple, Sky Ferry): a gradient sky with sun and stars, drifting
 * cloud puffs, floating motes, the toon key light and a falling-water shader.
 */

export interface SkyColours {
  readonly top: number;
  readonly horizon: number;
  readonly bottom: number;
  readonly sun: number;
  readonly sunDir: readonly [number, number, number];
  readonly stars?: number;
}

export function gradientSky(scene: THREE.Scene, colours: SkyColours) {
  const uniforms = {
    top: { value: new THREE.Color(colours.top) }, horizon: { value: new THREE.Color(colours.horizon) },
    bottom: { value: new THREE.Color(colours.bottom) }, sunCol: { value: new THREE.Color(colours.sun) },
    sunDir: { value: new THREE.Vector3(...colours.sunDir).normalize() }, stars: { value: colours.stars ?? 0 }, time: { value: 0 },
  };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1200, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform vec3 top, horizon, bottom, sunCol, sunDir; uniform float stars, time; varying vec3 vDir;
      float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      void main(){
        vec3 d = normalize(vDir); float y = d.y;
        vec3 col = y > 0.0 ? mix(horizon, top, pow(clamp(y, 0.0, 1.0), 0.5)) : mix(horizon, bottom, pow(clamp(-y, 0.0, 1.0), 0.4));
        float sd = max(dot(d, normalize(sunDir)), 0.0);
        col += sunCol * (smoothstep(0.99935, 0.9996, sd) * 0.9 + pow(sd, 14.0) * 0.38 + pow(sd, 3.0) * 0.12);
        vec3 cell = floor(d * 260.0);
        float star = step(0.9978, h(cell)) * (0.55 + 0.45 * sin(time * 2.0 + h(cell + 1.0) * 40.0));
        col += vec3(star * stars * smoothstep(0.02, 0.3, y));
        gl_FragColor = vec4(col, 1.0);
      }`,
  }));
  sky.onBeforeRender = (_r, _s, camera) => { sky.position.copy(camera.position); };
  scene.add(sky);
  return uniforms;
}

/** Hemisphere fill plus a shadow-casting key light aimed at the stage. */
export function toonLights(scene: THREE.Scene, target: THREE.Vector3, offset: THREE.Vector3, sky = 0xffffff, ground = 0x444444) {
  const hemi = new THREE.HemisphereLight(sky, ground, 0.8 * LEGACY_LIGHT);
  const key = new THREE.DirectionalLight(0xffffff, LEGACY_LIGHT);
  key.position.copy(target).add(offset);
  key.target.position.copy(target);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -110, right: 110, top: 80, bottom: -70, near: 10, far: 400 });
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.04;
  scene.add(hemi, key, key.target);
  return { hemi, key };
}

/**
 * Cloud puffs: a sea below the stage plus clusters in the distance, drifting
 * sideways and wrapping around `centreX`.
 */
export function cloudField(scene: THREE.Scene, rand: Rand, map: THREE.Texture, centreX: number, groundTop: number,
  opts: { sea?: number; clusters?: number; seaY?: [number, number]; colour?: number } = {}) {
  const range = (a: number, b: number) => a + rand() * (b - a);
  const materials: THREE.SpriteMaterial[] = [];
  const sprites: THREE.Sprite[] = [];
  const puff = (x: number, y: number, z: number, size: number, opacity: number) => {
    const mat = new THREE.SpriteMaterial({ map, color: opts.colour ?? 0xffffff, transparent: true, opacity, depthWrite: false });
    materials.push(mat);
    const s = new THREE.Sprite(mat);
    s.position.set(centreX + x, groundTop + y, z);
    s.scale.set(size, size * 0.62, 1);
    scene.add(s);
    sprites.push(s);
  };
  const [seaLow, seaHigh] = opts.seaY ?? [-78, -48];
  for (let i = 0; i < (opts.sea ?? 170); i++) puff(range(-700, 700), range(seaLow, seaHigh), range(-650, 60), range(55, 140), range(0.7, 0.95));
  for (let i = 0; i < (opts.clusters ?? 14); i++) {
    const cx = range(-500, 500), cy = range(55, 130), cz = range(-450, -220);
    for (let k = 0; k < 6; k++) puff(cx + range(-26, 26), cy + range(-6, 6), cz + range(-10, 10), range(30, 60), 0.85);
  }
  return {
    materials,
    update(dt: number, speed = 1) {
      sprites.forEach((c, i) => {
        c.position.x += dt * (3 + (i % 5)) * speed;
        if (c.position.x > centreX + 720) c.position.x = centreX - 720;
        if (c.position.x < centreX - 720) c.position.x = centreX + 720;
      });
    },
  };
}

/** Rising glow motes (pollen, sparks, fireflies) around the stage. */
export function moteField(scene: THREE.Scene, rand: Rand, map: THREE.Texture, centreX: number, groundTop: number, count = 260, size = 0.9) {
  const range = (a: number, b: number) => a + rand() * (b - a);
  const motes = pointCloud(count, size, 0xffffff, map);
  const speed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    motes.pos.set([centreX + range(-110, 110), groundTop + range(-50, 70), range(-50, 30)], i * 3);
    speed[i] = range(0.6, 2.2);
  }
  motes.commit();
  scene.add(motes.points);
  return {
    mat: motes.mat,
    update(dt: number, elapsed: number, drift = 0) {
      for (let i = 0; i < count; i++) {
        motes.pos[i * 3 + 1]! += dt * speed[i]!;
        motes.pos[i * 3]! += Math.sin(elapsed + i) * dt * 0.4 + drift * dt;
        if (motes.pos[i * 3 + 1]! > groundTop + 70) motes.pos[i * 3 + 1] = groundTop - 50;
        if (motes.pos[i * 3]! > centreX + 120) motes.pos[i * 3] = centreX - 120;
        if (motes.pos[i * 3]! < centreX - 120) motes.pos[i * 3] = centreX + 120;
      }
      motes.commit();
    },
  };
}

/** Falling-water strip (waterfalls), animated through `time`. */
export function waterMaterial(colour: number) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { time: { value: 0 }, color: { value: new THREE.Color(colour) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform float time; uniform vec3 color; varying vec2 vUv;
      void main(){
        float s = fract(vUv.y * 7.0 + time * 1.4 + sin(vUv.x * 20.0) * 0.06);
        float edge = smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x);
        float fade = smoothstep(0.0, 0.45, vUv.y);
        vec3 c = color * (0.78 + 0.22 * smoothstep(0.0, 0.6, s)) + vec3(0.18) * step(0.9, s);
        gl_FragColor = vec4(c, edge * fade * 0.85);
      }`,
  });
}
