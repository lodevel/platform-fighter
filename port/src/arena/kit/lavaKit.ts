import * as THREE from 'three';

/**
 * Molten scenery shared by the lava arenas (Magma Caldera, Inferno): the
 * flowing-lava shader (pools, seas, falls, craters) and a smoky glowing sky
 * that can flash. `time` drives both; set it once per frame.
 */
export interface LavaSkyColours {
  readonly top: number;
  readonly horizon: number;
  readonly below: number;
}

export function lavaKit(scene: THREE.Scene, fog: THREE.Fog, colours: LavaSkyColours) {
  const shared = { time: { value: 0 }, fogColor: { value: fog.color }, fogNear: { value: fog.near }, fogFar: { value: fog.far } };
  const LAVA_FRAG = `
    uniform float time, glow, scale, fogNear, fogFar; uniform vec2 flow; uniform int mode; uniform vec3 fogColor;
    varying vec3 vWorld; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y); }
    float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
    void main(){
      vec2 p = mode == 0 ? vec2(vWorld.x + vWorld.z * 0.7, vWorld.y + vWorld.z * 0.4) : mode == 1 ? vWorld.xz : vUv * vec2(1.0, 8.0);
      p *= scale;
      float n = fbm(p + flow * time);
      float m = fbm(p * 1.8 + n * 1.6 + flow * time * 1.7);
      float heat = smoothstep(0.28, 0.8, m);
      vec3 c = mix(vec3(0.22, 0.03, 0.03), vec3(1.0, 0.32, 0.04), heat);
      c = mix(c, vec3(1.0, 0.86, 0.38), smoothstep(0.68, 0.92, m));
      c *= glow;
      float depth = gl_FragCoord.z / gl_FragCoord.w;
      c = mix(c, fogColor, smoothstep(fogNear, fogFar, depth) * 0.8);
      float a = mode == 2 ? smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x) : 1.0;
      gl_FragColor = vec4(c, a);
    }`;
  const LAVA_VERT = 'varying vec3 vWorld; varying vec2 vUv; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }';
  const lavaMaterial = (mode: number, scale: number, flow: [number, number], glow = 1, transparent = false) =>
    new THREE.ShaderMaterial({
      vertexShader: LAVA_VERT, fragmentShader: LAVA_FRAG, transparent, depthWrite: !transparent,
      uniforms: { ...shared, mode: { value: mode }, scale: { value: scale }, flow: { value: new THREE.Vector2(...flow) }, glow: { value: glow } },
    });

  // ---------- sky and light ----------
  const skyFlash = { value: 0 };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { time: shared.time, flash: skyFlash, top: { value: new THREE.Color(colours.top) }, horizon: { value: new THREE.Color(colours.horizon) }, below: { value: new THREE.Color(colours.below) } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform float time, flash; uniform vec3 top, horizon, below; varying vec3 vDir;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y); }
      float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.1; a *= 0.5; } return v; }
      void main(){
        vec3 d = normalize(vDir); float y = d.y;
        vec3 col = y > 0.0 ? mix(horizon, top, pow(clamp(y, 0.0, 1.0), 0.45)) : mix(horizon, below, pow(clamp(-y, 0.0, 1.0), 0.6));
        if (y > 0.0) {
          vec2 uv = d.xz / (y + 0.25) * 1.6 + vec2(time * 0.015, 0.0);
          float smoke = smoothstep(0.35, 0.85, fbm(uv));
          col = mix(col, vec3(0.06, 0.03, 0.05), smoke * 0.8);
          col += vec3(0.9, 0.3, 0.08) * smoke * (1.0 - smoothstep(0.0, 0.35, y)) * 0.35;
        }
        col += vec3(1.0, 0.45, 0.15) * flash * (1.0 - clamp(y, 0.0, 1.0)) * 0.6;
        gl_FragColor = vec4(col, 1.0);
      }`,
  }));
  sky.onBeforeRender = (_r, _s, camera) => { sky.position.copy(camera.position); };
  scene.add(sky);
  return { time: shared.time, skyFlash, lavaMaterial };
}

/**
 * Lava geysers erupting from a lava surface on staggered timers: a hot core
 * column inside an additive glow column, a base glow, and droplets thrown on
 * ballistic arcs that fall back. Visual only; driven by the stage clock.
 */
export function lavaGeysers(scene: THREE.Scene, options: {
  readonly spots: ReadonlyArray<{ readonly x: number; readonly z: number }>;
  readonly surfaceY: number;
  readonly glow: THREE.Texture;
  readonly rand: () => number;
  /** Peak column height, world units. */
  readonly height?: number;
}): { update(elapsed: number): void } {
  const ERUPT = 1.8, DROPS = 14, GRAVITY = 60;
  const height = options.height ?? 70;
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xffb53a });
  const sheathMat = new THREE.MeshBasicMaterial({ color: 0xff4a10, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  const dropMat = new THREE.MeshBasicMaterial({ color: 0xffa030 });
  const column = new THREE.CylinderGeometry(0.55, 1.4, 1, 12, 1, true).translate(0, 0.5, 0);
  const drop = new THREE.SphereGeometry(1.2, 8, 6);
  const geysers = options.spots.map((spot) => {
    const g = new THREE.Group();
    g.position.set(spot.x, options.surfaceY, spot.z);
    const core = new THREE.Mesh(column, coreMat);
    const sheath = new THREE.Mesh(column, sheathMat);
    const base = new THREE.Sprite(new THREE.SpriteMaterial({ map: options.glow, color: 0xff5a18, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    base.position.y = 2;
    const drops = Array.from({ length: DROPS }, () => {
      const m = new THREE.Mesh(drop, dropMat);
      g.add(m);
      const a = options.rand() * Math.PI * 2, out = 6 + options.rand() * 14;
      return { m, vx: Math.cos(a) * out, vz: Math.sin(a) * out * 0.5, vy: 30 + options.rand() * 35, delay: options.rand() * ERUPT * 0.6 };
    });
    g.add(core, sheath, base);
    scene.add(g);
    const period = 6 + options.rand() * 5;
    return { core, sheath, base, drops, period, offset: options.rand() * period, peak: height * (0.7 + options.rand() * 0.5) };
  });
  return {
    update(elapsed) {
      for (const ge of geysers) {
        const t = (elapsed + ge.offset) % ge.period;
        const on = t < ERUPT ? Math.pow(Math.sin((Math.PI * t) / ERUPT), 0.7) : 0;
        const h = Math.max(0.001, ge.peak * on);
        ge.core.scale.set(2.5 + 1.5 * on, h, 2.5 + 1.5 * on);
        ge.sheath.scale.set(5 + 3 * on, h * 1.05, 5 + 3 * on);
        ge.core.visible = ge.sheath.visible = on > 0.01;
        // The base glows a little before and after the eruption.
        const warm = Math.max(on, t > ge.period - 0.8 ? (t - (ge.period - 0.8)) / 0.8 : 0, t >= ERUPT && t < ERUPT + 0.6 ? 1 - (t - ERUPT) / 0.6 : 0);
        ge.base.material.opacity = 0.25 + 0.75 * warm;
        ge.base.scale.setScalar(24 + 30 * warm);
        for (const d of ge.drops) {
          const s = t - d.delay;
          d.m.visible = s > 0 && s < 2.6;
          if (!d.m.visible) continue;
          // Thrown from near the column's peak, they fall back into the lava.
          const y = ge.peak * 0.75 + d.vy * s - 0.5 * GRAVITY * s * s;
          d.m.visible = y > 0;
          d.m.position.set(d.vx * s, y, d.vz * s);
        }
      }
    },
  };
}
