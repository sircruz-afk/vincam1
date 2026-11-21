/**
 * Every filter is a GLSL snippet defining `vec3 filt(vec2 uv)`.
 * Helpers available to every filter (see renderer.ts):
 *   tex(uv)      -> camera colour at uv (0..1, already cropped/mirrored)
 *   luma(c)      -> perceived brightness
 *   u_time       -> seconds since start
 *   u_res        -> output size in pixels
 *   u_texel      -> size of one output pixel in uv space
 *   hash(p)      -> pseudo random 0..1
 */
export interface Filter {
  id: string;
  name: string;
  glsl: string;
}

export const FILTERS: Filter[] = [
  {
    id: 'original',
    name: 'Original',
    glsl: `vec3 filt(vec2 uv) { return tex(uv); }`,
  },
  {
    id: 'vivid',
    name: 'Vivid',
    glsl: `
vec3 filt(vec2 uv) {
  vec3 c = tex(uv);
  float l = luma(c);
  c = mix(vec3(l), c, 1.55);
  c = (c - 0.5) * 1.15 + 0.5;
  return c;
}`,
  },
  {
    id: 'mono',
    name: 'Mono',
    glsl: `
vec3 filt(vec2 uv) {
  float l = luma(tex(uv));
  l = smoothstep(0.02, 0.98, l);
  return vec3(l);
}`,
  },
  {
    id: 'noir',
    name: 'Noir',
    glsl: `
vec3 filt(vec2 uv) {
  float l = luma(tex(uv));
  l = smoothstep(0.18, 0.82, l);
  float v = 1.0 - smoothstep(0.35, 0.95, length(uv - 0.5) * 1.25);
  float g = (hash(uv * u_res + fract(u_time) * 97.0) - 0.5) * 0.08;
  return vec3(l * v + g);
}`,
  },
  {
    id: 'vintage',
    name: 'Vintage',
    glsl: `
vec3 filt(vec2 uv) {
  vec3 c = tex(uv);
  vec3 s = vec3(
    dot(c, vec3(0.393, 0.769, 0.189)),
    dot(c, vec3(0.349, 0.686, 0.168)),
    dot(c, vec3(0.272, 0.534, 0.131)));
  c = mix(c, s, 0.75);
  c = c * 0.86 + vec3(0.09, 0.06, 0.03);        // faded blacks
  float v = 1.0 - smoothstep(0.4, 1.0, length(uv - 0.5) * 1.3);
  float g = (hash(uv * u_res + fract(u_time) * 61.0) - 0.5) * 0.07;
  return c * (0.55 + 0.45 * v) + g;
}`,
  },
  {
    id: 'arctic',
    name: 'Arctic',
    glsl: `
vec3 filt(vec2 uv) {
  vec3 c = tex(uv);
  float l = luma(c);
  c = mix(vec3(l), c, 0.7);
  c *= vec3(0.86, 1.0, 1.18);
  c += vec3(0.0, 0.03, 0.07);
  return c;
}`,
  },
  {
    id: 'duotone',
    name: 'Duotone',
    glsl: `
vec3 filt(vec2 uv) {
  float l = smoothstep(0.05, 0.95, luma(tex(uv)));
  vec3 dark = vec3(0.16, 0.05, 0.45);
  vec3 light = vec3(1.0, 0.42, 0.62);
  return mix(dark, light, l);
}`,
  },
  {
    id: 'thermal',
    name: 'Thermal',
    glsl: `
vec3 heat(float t) {
  vec3 a = vec3(0.0, 0.0, 0.25);
  vec3 b = vec3(0.45, 0.0, 0.75);
  vec3 c = vec3(1.0, 0.15, 0.1);
  vec3 d = vec3(1.0, 0.85, 0.0);
  vec3 e = vec3(1.0, 1.0, 1.0);
  if (t < 0.25) return mix(a, b, t / 0.25);
  if (t < 0.5)  return mix(b, c, (t - 0.25) / 0.25);
  if (t < 0.75) return mix(c, d, (t - 0.5) / 0.25);
  return mix(d, e, (t - 0.75) / 0.25);
}
vec3 filt(vec2 uv) {
  return heat(clamp(luma(tex(uv)), 0.0, 1.0));
}`,
  },
  {
    id: 'neon',
    name: 'Neon',
    glsl: `
vec3 filt(vec2 uv) {
  vec2 o = u_texel * 1.5;
  float tl = luma(tex(uv + vec2(-o.x,  o.y)));
  float  t = luma(tex(uv + vec2( 0.0,  o.y)));
  float tr = luma(tex(uv + vec2( o.x,  o.y)));
  float  l = luma(tex(uv + vec2(-o.x,  0.0)));
  float  r = luma(tex(uv + vec2( o.x,  0.0)));
  float bl = luma(tex(uv + vec2(-o.x, -o.y)));
  float  b = luma(tex(uv + vec2( 0.0, -o.y)));
  float br = luma(tex(uv + vec2( o.x, -o.y)));
  float gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br;
  float gy = -tl - 2.0 * t - tr + bl + 2.0 * b + br;
  float e = smoothstep(0.08, 0.5, length(vec2(gx, gy)));
  float h = fract(uv.y * 0.8 + uv.x * 0.4 + u_time * 0.12);
  vec3 hue = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return hue * e * 1.4 + tex(uv) * 0.06;
}`,
  },
  {
    id: 'comic',
    name: 'Comic',
    glsl: `
vec3 filt(vec2 uv) {
  vec3 c = tex(uv);
  vec2 o = u_texel * 1.2;
  float gx = luma(tex(uv + vec2(o.x, 0.0))) - luma(tex(uv - vec2(o.x, 0.0)));
  float gy = luma(tex(uv + vec2(0.0, o.y))) - luma(tex(uv - vec2(0.0, o.y)));
  float edge = smoothstep(0.06, 0.16, length(vec2(gx, gy)));
  float l = luma(c);
  c = mix(vec3(l), c, 1.6);
  c = floor(c * 4.0 + 0.5) / 4.0;
  return c * (1.0 - edge);
}`,
  },
  {
    id: 'sketch',
    name: 'Sketch',
    glsl: `
vec3 filt(vec2 uv) {
  vec2 o = u_texel * 1.2;
  float gx = luma(tex(uv + vec2(o.x, 0.0))) - luma(tex(uv - vec2(o.x, 0.0)));
  float gy = luma(tex(uv + vec2(0.0, o.y))) - luma(tex(uv - vec2(0.0, o.y)));
  float e = clamp(length(vec2(gx, gy)) * 4.0, 0.0, 1.0);
  float l = luma(tex(uv));
  vec2 p = uv * u_res;
  float hatch = l < 0.35 ? step(0.5, fract((p.x + p.y) / 6.0)) * 0.25 : 0.0;
  float ink = clamp(e + hatch, 0.0, 1.0);
  vec3 paper = vec3(0.97, 0.95, 0.9) - (hash(floor(p / 2.0)) * 0.04);
  return paper * (1.0 - ink * 0.9);
}`,
  },
  {
    id: 'halftone',
    name: 'Dots',
    glsl: `
vec3 filt(vec2 uv) {
  float cell = max(u_res.x, u_res.y) / 110.0;
  vec2 p = uv * u_res;
  float a = 0.785398;
  mat2 rot = mat2(cos(a), -sin(a), sin(a), cos(a));
  vec2 rp = rot * p;
  vec2 cellC = (floor(rp / cell) + 0.5) * cell;
  vec2 back = (cellC * rot) / u_res;            // inverse rotation (orthonormal)
  float l = luma(tex(back));
  float rad = (1.0 - l) * cell * 0.62;
  float d = length(rp - cellC);
  float dot_ = 1.0 - smoothstep(rad - 1.0, rad + 1.0, d);
  vec3 ink = vec3(0.08, 0.1, 0.2);
  vec3 paper = vec3(1.0, 0.97, 0.88);
  return mix(paper, ink, dot_);
}`,
  },
  {
    id: 'pixel',
    name: '8-Bit',
    glsl: `
vec3 filt(vec2 uv) {
  vec2 blocks = vec2(64.0, 64.0 * u_res.y / u_res.x);
  vec2 q = (floor(uv * blocks) + 0.5) / blocks;
  vec3 c = tex(q);
  c = mix(vec3(luma(c)), c, 1.3);
  return floor(c * 5.0 + 0.5) / 5.0;
}`,
  },
  {
    id: 'glitch',
    name: 'Glitch',
    glsl: `
vec3 filt(vec2 uv) {
  float t = floor(u_time * 12.0);
  float band = floor(uv.y * 24.0);
  float r = hash(vec2(band, t));
  float shift = r > 0.82 ? (hash(vec2(t, band + 3.0)) - 0.5) * 0.12 : 0.0;
  vec2 q = vec2(uv.x + shift, uv.y);
  float split = 0.006 + 0.012 * hash(vec2(t, 7.0));
  vec3 c = vec3(tex(q + vec2(split, 0.0)).r, tex(q).g, tex(q - vec2(split, 0.0)).b);
  if (hash(vec2(band, t + 9.0)) > 0.96) c = 1.0 - c;
  return c;
}`,
  },
  {
    id: 'vhs',
    name: 'VHS',
    glsl: `
vec3 filt(vec2 uv) {
  float wob = sin(uv.y * 40.0 + u_time * 3.0) * 0.0015
            + (hash(vec2(floor(uv.y * 240.0), floor(u_time * 30.0))) - 0.5) * 0.002;
  vec2 q = vec2(uv.x + wob, uv.y);
  vec3 c = vec3(tex(q + vec2(0.004, 0.0)).r, tex(q).g, tex(q - vec2(0.004, 0.0)).b);
  c = mix(vec3(luma(c)), c, 0.8);
  float scan = 0.88 + 0.12 * sin(uv.y * u_res.y * 1.6);
  float roll = smoothstep(0.0, 0.02, abs(fract(uv.y - u_time * 0.07) - 0.5));
  float n = (hash(uv * u_res + u_time * 50.0) - 0.5) * 0.12;
  return c * scan * (0.85 + 0.15 * roll) + n + vec3(0.02, 0.0, 0.04);
}`,
  },
  {
    id: 'kaleido',
    name: 'Kaleido',
    glsl: `
vec3 filt(vec2 uv) {
  vec2 p = uv - 0.5;
  p.x *= u_res.x / u_res.y;
  float r = length(p);
  float a = atan(p.y, p.x) + u_time * 0.15;
  float seg = 6.2831853 / 8.0;
  a = mod(a, seg);
  a = abs(a - seg * 0.5);
  vec2 q = vec2(cos(a), sin(a)) * r;
  q.x /= u_res.x / u_res.y;
  return tex(fract(q + 0.5));
}`,
  },
  {
    id: 'mirror',
    name: 'Mirror',
    glsl: `
vec3 filt(vec2 uv) {
  return tex(vec2(0.5 - abs(uv.x - 0.5), uv.y));
}`,
  },
  {
    id: 'xray',
    name: 'X-Ray',
    glsl: `
vec3 filt(vec2 uv) {
  float l = 1.0 - luma(tex(uv));
  l = smoothstep(0.1, 0.95, l);
  return vec3(l * 0.75, l * 0.95, l * 1.1);
}`,
  },
];
