import type { Filter } from './filters';

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG_HEADER = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec4 u_crop;      // xy = offset, zw = scale inside the video texture
uniform float u_mirror;
uniform float u_amount;
uniform float u_time;
uniform float u_round;    // corner radius in px (thumbnails), 0 = none
uniform vec2 u_res;
uniform vec2 u_texel;

vec3 tex(vec2 uv) {
  uv = clamp(uv, 0.0, 1.0);
  if (u_mirror > 0.5) uv.x = 1.0 - uv.x;
  return texture2D(u_tex, u_crop.xy + uv * u_crop.zw).rgb;
}
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
`;

const FRAG_MAIN = `
void main() {
  vec3 base = tex(v_uv);
  vec3 c = clamp(mix(base, filt(v_uv), u_amount), 0.0, 1.0);
  float a = 1.0;
  if (u_round > 0.0) {
    vec2 p = abs(v_uv * u_res - u_res * 0.5) - (u_res * 0.5 - u_round);
    float d = length(max(p, 0.0)) + min(max(p.x, p.y), 0.0) - u_round;
    a = 1.0 - smoothstep(-0.75, 0.75, d);
  }
  gl_FragColor = vec4(c * a, a);
}`;

interface Program {
  prog: WebGLProgram;
  loc: Record<string, WebGLUniformLocation | null>;
}

const UNIFORMS = ['u_tex', 'u_crop', 'u_mirror', 'u_amount', 'u_time', 'u_round', 'u_res', 'u_texel'];

export interface DrawOptions {
  filter: number;
  x: number;
  y: number;
  w: number;
  h: number;
  mirror: boolean;
  amount: number;
  time: number;
  round?: number;
}

/** A small WebGL1 renderer that runs one fragment shader per filter over the camera frame. */
export class Renderer {
  readonly gl: WebGLRenderingContext;
  private programs: (Program | null)[];
  private texture: WebGLTexture;
  private videoW = 0;
  private videoH = 0;

  constructor(readonly canvas: HTMLCanvasElement, private filters: Filter[], alpha = false) {
    const gl = canvas.getContext('webgl', {
      alpha,
      premultipliedAlpha: true,
      antialias: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL is not available on this device.');
    this.gl = gl;
    this.programs = filters.map(() => null);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    this.texture = tex;
  }

  get hasFrame() {
    return this.videoW > 0;
  }

  private compile(type: number, src: string) {
    const gl = this.gl;
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error('Shader compile failed: ' + log);
    }
    return sh;
  }

  private program(i: number): Program {
    const cached = this.programs[i];
    if (cached) return cached;
    const gl = this.gl;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, this.compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, this.compile(gl.FRAGMENT_SHADER, FRAG_HEADER + this.filters[i].glsl + FRAG_MAIN));
    gl.bindAttribLocation(prog, 0, 'a_pos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(`Filter "${this.filters[i].name}" failed to link: ${gl.getProgramInfoLog(prog)}`);
    }
    const loc: Program['loc'] = {};
    for (const u of UNIFORMS) loc[u] = gl.getUniformLocation(prog, u);
    const p = { prog, loc };
    this.programs[i] = p;
    return p;
  }

  /** Compile every filter up front so switching is instant. */
  warmUp() {
    this.filters.forEach((_, i) => this.program(i));
  }

  upload(video: HTMLVideoElement) {
    if (video.readyState < 2 || !video.videoWidth) return false;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    this.videoW = video.videoWidth;
    this.videoH = video.videoHeight;
    return true;
  }

  clear() {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  draw(o: DrawOptions) {
    if (!this.hasFrame) return;
    const gl = this.gl;
    const p = this.program(o.filter);
    gl.useProgram(p.prog);
    gl.viewport(o.x, o.y, o.w, o.h);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);

    // "cover" crop: fill the output rect without stretching the camera image
    const outAspect = o.w / o.h;
    const vidAspect = this.videoW / this.videoH;
    let sx = 1, sy = 1;
    if (vidAspect > outAspect) sx = outAspect / vidAspect;
    else sy = vidAspect / outAspect;

    gl.uniform1i(p.loc.u_tex, 0);
    gl.uniform4f(p.loc.u_crop, (1 - sx) / 2, (1 - sy) / 2, sx, sy);
    gl.uniform1f(p.loc.u_mirror, o.mirror ? 1 : 0);
    gl.uniform1f(p.loc.u_amount, o.amount);
    gl.uniform1f(p.loc.u_time, o.time);
    gl.uniform1f(p.loc.u_round, o.round ?? 0);
    gl.uniform2f(p.loc.u_res, o.w, o.h);
    gl.uniform2f(p.loc.u_texel, 1 / o.w, 1 / o.h);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
