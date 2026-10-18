import { packRecolor, recolorUniforms, RECOLOR_GLSL, type HsvShift } from '../render/recolor';

const VERT = `
  attribute vec2 position;
  varying vec2 vUv;
  void main() {
    vUv = vec2(position.x * 0.5 + 0.5, 0.5 - position.y * 0.5);
    gl_Position = vec4(position, 0.0, 1.0);
  }`;
const FRAG = `
  precision highp float;
  ${RECOLOR_GLSL}
  uniform sampler2D map;
  varying vec2 vUv;
  void main() { gl_FragColor = recolor(texture2D(map, vUv)); }`;

/**
 * Recolours one drawing with the game's costume shader (`RECOLOR_GLSL`), at the
 * drawing's own resolution. The result is reused while the drawing and costume stay the same.
 */
export class RecolorCanvas {
  readonly canvas = document.createElement('canvas');
  private readonly crop = document.createElement('canvas');
  private readonly gl: WebGLRenderingContext;
  private readonly program: WebGLProgram;
  private readonly uniforms = recolorUniforms();
  private last: { source: CanvasImageSource; rect: string; shifts: readonly HsvShift[] } | null = null;

  constructor() {
    const gl = this.canvas.getContext('webgl', { premultipliedAlpha: true, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL is unavailable, so costumes cannot be previewed');
    this.gl = gl;
    this.program = gl.createProgram()!;
    for (const [type, text] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, FRAG]] as const) {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, text); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader failed');
      gl.attachShader(this.program, shader);
    }
    gl.linkProgram(this.program); gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(this.program, 'position');
    gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    for (const [name, value] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]] as const)
      gl.texParameteri(gl.TEXTURE_2D, name, value);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  }

  /** The drawing at `rect` of `source`, recoloured; drawn at [0, 0, width, height] of `canvas`. */
  draw(source: CanvasImageSource, rect: readonly [number, number, number, number], shifts: readonly HsvShift[]): HTMLCanvasElement {
    const key = rect.join(',');
    if (this.last?.source === source && this.last.rect === key && this.last.shifts === shifts) return this.canvas;
    const [x, y, w, h] = rect, gl = this.gl;
    this.crop.width = w; this.crop.height = h;
    const ctx = this.crop.getContext('2d')!;
    ctx.clearRect(0, 0, w, h); ctx.drawImage(source, x, y, w, h, 0, 0, w, h);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.crop);
    packRecolor(shifts, this.uniforms);
    const at = (name: string) => gl.getUniformLocation(this.program, name);
    gl.uniform1i(at('recolorCount'), this.uniforms.count);
    gl.uniform3fv(at('recolorKey'), this.uniforms.key);
    gl.uniform3fv(at('recolorShift'), this.uniforms.shift);
    gl.uniform3fv(at('recolorTolerance'), this.uniforms.tolerance);
    this.canvas.width = w; this.canvas.height = h;
    gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.last = { source, rect: key, shifts };
    return this.canvas;
  }
}
