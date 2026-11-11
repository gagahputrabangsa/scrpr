"use client";

import React, { useEffect, useRef } from "react";

export interface LightVeilConfig {
  /** First color is the night; the rest run along the light ribbon */
  colors?: string[];
  shape?: number;
  flip?: number;
  thick?: number;
  glow?: number;
  veil?: number;
  prism?: number;
  sparkle?: number;
  spread?: number;
  wobble?: number;
  seed?: number;
  speed?: number;
  /** Overall linear exposure (< 1 makes it darker while keeping core white-hot) */
  exposure?: number;
  grain?: number;
}

const VERTEX_SHADER = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;

in vec2 v_uv;
out vec4 fragColor;

uniform float u_time;
uniform vec2 u_resolution;
uniform int u_blobCount;
uniform vec3 u_colLin[8];
uniform vec3 u_colLab[8];
uniform float u_exposure;
uniform float u_grain;

uniform float u_shape;
uniform float u_flip;
uniform float u_thick;
uniform float u_glow;
uniform float u_veil;
uniform float u_prism;
uniform float u_sparkle;
uniform float u_spread;
uniform float u_wobble;
uniform float u_seed;
uniform float u_speed;

const float LV_TAU = 6.28318530718;
uint g_lvSeed;
int g_shape;

uint lvHash(uint x) {
  x ^= x >> 16; x *= 0x7feb352du;
  x ^= x >> 15; x *= 0x846ca68bu;
  x ^= x >> 16;
  return x;
}
uint lvHash3(uvec3 v) { return lvHash(v.x ^ lvHash(v.y ^ lvHash(v.z))); }
float lvU(uint h) { return float(h >> 8) * (1.0 / 16777216.0); }
float lvSr(uint k) { return lvU(lvHash(g_lvSeed ^ (k * 0x9e3779b9u))); }

vec3 oklabToLinear(vec3 lab) {
  float l_ = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
  float m_ = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
  float s_ = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z;
  float l = l_ * l_ * l_;
  float m = m_ * m_ * m_;
  float s = s_ * s_ * s_;
  return vec3(
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  );
}

vec3 mixPaletteLin(int i0, int i1, float f) {
  vec3 lab = mix(u_colLab[i0], u_colLab[i1], clamp(f, 0.0, 1.0));
  return max(oklabToLinear(lab), vec3(0.0));
}

// The light colours (palette 2 .. last) as a ramp; the first colour is the night.
vec3 lvRamp(float t) {
  int n = max(u_blobCount, 1);
  int m = n - 1;
  if (m < 1) return vec3(1.0);
  if (m == 1) return u_colLin[1];
  float x = clamp(t, 0.0, 1.0) * float(m - 1);
  int i = min(int(x), m - 2);
  float f = x - float(i);
  return mixPaletteLin(1 + i, 2 + i, f * f * (3.0 - 2.0 * f));
}

vec3 lvSpectrum(float h) {
  vec3 c = 0.5 + 0.5 * cos(LV_TAU * (h + vec3(0.0, 0.67, 0.33)));
  return c * c;
}

float lvCurve(int sh, float s, float A, float j) {
  if (sh == 0) return A * (0.56 * tanh(1.55 * (s - 0.08 + j)) + 0.16 * s - 0.1);
  if (sh == 1) return A * (0.2 * sin(2.7 * s + 0.5 + j * 3.0) - 0.02 + 0.06 * sin(5.3 * s + 1.0));
  if (sh == 2) return A * (-0.42 + 0.95 * (sqrt((s - j) * (s - j) + 0.012) - 0.11));
  if (sh == 4) return A * (0.86 * s + 0.1 * sin(2.4 * s + 1.0 + j * 4.0));
  if (sh == 5) return A * (0.36 + 0.07 * sin(3.1 * s + 0.4 + j * 3.0) + 0.045 * sin(7.3 * s + 1.1));
  return A * (1.05 * (s - j) * (s - j) - 0.5);
}

float lvWobble(float s, float ph, float A) {
  return u_wobble * A * (
    0.07 * sin(2.1 * s + ph + lvSr(1u) * LV_TAU) +
    0.04 * sin(3.7 * s - 2.0 * ph + lvSr(2u) * LV_TAU) +
    0.018 * sin(6.9 * s + 3.0 * ph + lvSr(3u) * LV_TAU));
}
float lvWobbleRing(float a, float ph, float R) {
  return u_wobble * R * (
    0.06 * sin(2.0 * a + ph + lvSr(1u) * LV_TAU) +
    0.035 * sin(3.0 * a - 2.0 * ph + lvSr(2u) * LV_TAU) +
    0.016 * sin(5.0 * a + 3.0 * ph + lvSr(3u) * LV_TAU));
}

void lvFrame(vec2 p, vec2 hf, float ph, out float s, out float d, out vec2 tang) {
  float A = hf.y;
  float j = (lvSr(9u) - 0.5) * 0.24;
  if (g_shape == 3 || g_shape == 7) {
    vec2 c = g_shape == 3 ? vec2(0.0, -A * 2.15) : vec2(0.0);
    float R = g_shape == 3 ? A * 2.62 : min(hf.x, hf.y) * 0.62;
    vec2 q = p - c;
    float r = length(q);
    float a = atan(q.x, q.y);
    float Rw = R + (g_shape == 3 ? lvWobble(a * 2.6, ph, A) : lvWobbleRing(a, ph, R));
    d = r - Rw;
    s = g_shape == 3 ? a * 2.6 * (A / hf.x) * 1.4 : sin(a);
    tang = normalize(vec2(q.y, -q.x) + 1e-5);
    return;
  }
  float sx = p.x / hf.x;
  float e = 0.004;
  float y0 = lvCurve(g_shape, sx, A, j) + lvWobble(sx, ph, A);
  float y1 = lvCurve(g_shape, sx + e, A, j) + lvWobble(sx + e, ph, A);
  float ym = lvCurve(g_shape, sx - e, A, j) + lvWobble(sx - e, ph, A);
  float slope = (y1 - ym) / (2.0 * e * hf.x);
  float k = inversesqrt(1.0 + slope * slope);
  d = (p.y - y0) * k;
  s = sx;
  tang = vec2(1.0, slope) * k;
}

float lvRays(float s, float ph, float salt) {
  float r = 0.32 * sin(9.0 * s + ph + salt);
  r += 0.26 * sin(14.3 * s - 2.0 * ph + salt * 1.7);
  r += 0.2 * sin(23.7 * s + 3.0 * ph + salt * 2.3);
  r += 0.14 * sin(37.1 * s - ph + salt * 3.1);
  r += 0.08 * sin(53.0 * s + 2.0 * ph + salt * 4.7);
  return 0.5 + 0.5 * r;
}

float lvVn(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  uvec2 b = uvec2(ivec2(i) + 32768);
  float a = lvU(lvHash3(uvec3(b, 11u))), bb = lvU(lvHash3(uvec3(b + uvec2(1u, 0u), 11u)));
  float c = lvU(lvHash3(uvec3(b + uvec2(0u, 1u), 11u))), d = lvU(lvHash3(uvec3(b + uvec2(1u, 1u), 11u)));
  return mix(mix(a, bb, u.x), mix(c, d, u.x), u.y);
}

// Dust: two crossfaded jittered grids drifting along the flow.
vec3 lvDust(vec2 p, float px, float cell, float rad, float prob, float t, vec2 drift, float bright, uint salt, float ph, vec3 tint) {
  vec3 acc = vec3(0.0);
  for (int g = 0; g < 2; g++) {
    float tt = fract(t + 0.5 * float(g));
    float w = 1.0 - abs(2.0 * tt - 1.0);
    vec2 q = (p - drift * (tt - 0.5)) / cell;
    vec2 id = floor(q), f = fract(q);
    uint h = lvHash3(uvec3(uvec2(ivec2(id) + 32768), salt + uint(g) * 7919u) ^ uvec3(0u, 0u, g_lvSeed));
    float a = clamp((prob - lvU(h)) * 14.0, 0.0, 1.0);
    if (a <= 0.0) continue;
    vec2 c = 0.25 + 0.5 * vec2(lvU(lvHash(h + 1u)), lvU(lvHash(h + 2u)));
    float dist = length(f - c) * cell;
    float sz = lvU(lvHash(h + 3u));
    float rr = cell * rad * (0.35 + 0.65 * sz * sz);
    float re = max(rr, 0.7 * px);
    float win = max(0.25 * cell, 1.5 * re);
    float ib = exp(-dist * dist / (re * re)) * (rr / re) * (1.0 - smoothstep(0.7 * win, win, dist));
    uint h4 = lvHash(h + 4u);
    float lum = 0.25 + 1.75 * pow(lvU(h4), 3.0);
    float tw = 0.55 + 0.45 * sin(float(1u + (h4 & 3u)) * ph + lvU(lvHash(h + 5u)) * LV_TAU);
    vec3 hue = mix(tint, lvSpectrum(lvU(lvHash(h + 6u))) * 1.6, u_prism * 0.85);
    acc += a * w * ib * lum * tw * bright * hue;
  }
  return acc;
}

vec3 lvGlints(vec2 p, float px, float cell, float prob, float ph, vec3 tint) {
  vec2 q = p / cell;
  vec2 id = floor(q), f = fract(q);
  uint h = lvHash3(uvec3(uvec2(ivec2(id) + 32768), 0x51edu ^ g_lvSeed));
  float a = clamp((prob - lvU(h)) * 10.0, 0.0, 1.0);
  if (a <= 0.0) return vec3(0.0);
  vec2 c = 0.35 + 0.3 * vec2(lvU(lvHash(h + 1u)), lvU(lvHash(h + 2u)));
  vec2 v = (f - c) * cell;
  float size = cell * (0.012 + 0.02 * lvU(lvHash(h + 3u)));
  float re = max(size, 0.8 * px);
  float core = exp(-dot(v, v) / (re * re)) * (size * size) / (re * re);
  float halo = exp(-length(v) / (size * 6.0)) * 0.08;
  float L = cell * 0.3;
  float th = max(px * 0.6, size * 0.25);
  float spk = exp(-abs(v.y) / th) * max(0.0, 1.0 - abs(v.x) / L) + exp(-abs(v.x) / th) * max(0.0, 1.0 - abs(v.y) / L);
  spk *= spk * 0.5 * (th * th) / max(th * th, px * px);
  float tw = 0.5 + 0.5 * sin(float(1u + (h & 1u)) * ph + lvU(lvHash(h + 4u)) * LV_TAU);
  tw = tw * tw;
  vec3 hue = mix(mix(tint, vec3(1.0), 0.6), lvSpectrum(lvU(lvHash(h + 5u))) * 1.5, u_prism * 0.6);
  return a * (core * 6.0 + halo + spk * 1.6) * tw * hue;
}

vec3 linearToSrgb(vec3 x) {
  vec3 lo = 12.92 * x;
  vec3 hi = 1.055 * pow(max(x, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), x));
}

void writeColorLinear(vec3 col) {
  vec3 exposed = col * u_exposure;
  vec3 srgb = clamp(linearToSrgb(exposed), 0.0, 1.0);
  uint gh = lvHash3(uvec3(uvec2(gl_FragCoord.xy), 137u));
  float grainNoise = (lvU(gh) - 0.5) * u_grain;
  srgb = clamp(srgb + grainNoise, 0.0, 1.0);
  fragColor = vec4(srgb, 1.0);
}

void main() {
  float S = min(u_resolution.x, u_resolution.y);
  vec2 hf = 0.5 * u_resolution / S;
  vec2 p = (v_uv - 0.5) * u_resolution / S;
  float px = max(max(fwidth(p.x), fwidth(p.y)), 1e-6);
  float ph = u_time * u_speed * 2.0;
  g_lvSeed = lvHash(uint(max(u_seed, 0.0)) * 2654435761u + 1u);
  g_shape = int(u_shape + 0.5);

  float s, d0;
  vec2 tang;
  lvFrame(p, hf, ph, s, d0, tang);
  float side = (u_flip > 0.5 ? -1.0 : 1.0) * (g_shape == 5 ? -1.0 : 1.0);

  float A = hf.y;
  float wc = mix(0.0025, 0.028, u_thick);
  float L = mix(0.04, 0.42, u_veil);
  float G = mix(0.02, 0.22, u_glow);
  float sp = mix(0.03, 0.45, u_spread);

  vec3 bg = u_colLin[0];
  vec3 light = vec3(0.0);
  float dens = 0.0;
  vec3 tint0 = vec3(1.0);

  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float off = 0.0, wgt = 1.0, wi = wc, hotK = 1.0;
    if (i == 1) {
      off = A * 0.14 * sin(1.7 * s + ph + lvSr(11u) * LV_TAU) * (0.3 + 0.7 * u_wobble);
      wgt = 0.6; wi = wc * 0.7; hotK = 0.6;
    } else if (i == 2) {
      off = A * 0.16 * sin(2.3 * s - ph + lvSr(12u) * LV_TAU) * (0.3 + 0.7 * u_wobble);
      wgt = 0.45; wi = wc * 3.0; hotK = 0.0;
    }
    float d = (d0 - off) * side;
    float pulse = 0.5 + 0.5 * sin(1.9 * s - ph + lvSr(20u + uint(i)) * LV_TAU);
    pulse = 0.35 + 0.85 * pulse * (0.65 + 0.35 * sin(3.1 * s + 2.0 * ph + fi));

    float x = d / wi;
    float hot = exp(-x * x);
    float body = exp(-x * x / 10.0);
    float tube = exp(-x * x / 45.0);
    float edge = smoothstep(-3.0 * wi, 1.5 * wi, d);
    float rr = lvRays(s * (1.0 + 0.15 * fi), ph, lvSr(30u + uint(i)) * LV_TAU);
    float rayMix = smoothstep(0.0, L * 0.5, d);
    float tail = edge * exp(-max(d, 0.0) / L) * mix(1.0, 0.45 + 1.1 * rr, rayMix * 0.6);
    float near = edge * exp(-max(d, 0.0) / (L * 0.18));
    float haze = exp(-abs(d) / G);

    float t = 0.5 + 0.46 * s + (fi - 1.0) * 0.14 + 0.1 * sin(ph + 1.7 * s + fi);
    float tv = t + 0.35 * (1.0 - exp(-max(d, 0.0) / L));
    vec3 c = lvRamp(t);
    vec3 cv = lvRamp(tv);
    float cl = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(c, lvSpectrum(0.55 + d / (wi * 26.0) + 0.35 * s + 0.2 * fi - ph / LV_TAU) * (0.25 + cl), u_prism * 0.75);
    cv = mix(cv, lvSpectrum(0.2 + d / (L * 1.6) + 0.35 * s + 0.2 * fi - ph / LV_TAU) * (0.25 + cl), u_prism * 0.6);

    float dl = u_prism * wi * 1.4;
    vec3 coreRGB = vec3(exp(-pow((d - dl) / wi, 2.0)), hot, exp(-pow((d + dl) / wi, 2.0)));
    coreRGB = mix(vec3(hot), coreRGB, u_prism);

    vec3 Li = c * (body + tube * 0.35 + haze * (0.02 + 0.16 * u_glow))
            + cv * (tail * 0.2 + near * 0.4)
            + mix(c, vec3(1.0), 0.6) * coreRGB * 2.4 * hotK;
    light += Li * pulse * wgt;

    float dn = edge * exp(-max(d, 0.0) / sp) * (0.45 + 0.55 * rr) + (1.0 - edge) * exp(-abs(d) / (sp * 0.15));
    dn += 1.4 * exp(-d * d / (wi * wi * 40.0));
    dens += dn * wgt * (0.45 + 0.55 * pulse);
    if (i == 0) tint0 = mix(c, cv, 0.4);
  }

  float clump = lvVn(p * 7.0 + vec2(lvSr(40u), lvSr(41u)) * 50.0) * 0.6 + lvVn(p * 19.0 + 13.0) * 0.4;
  dens *= 0.35 + 1.3 * clump;
  dens = dens / (1.0 + dens * 0.45);
  float prob = pow(dens, 1.6) * u_sparkle * 0.9 + u_sparkle * 0.006;
  vec3 dt = mix(normalize(tint0 + 0.02) * 1.35, vec3(1.0), 0.45);
  vec2 flow = tang * (u_flip > 0.5 ? -1.0 : 1.0);
  float cyc = ph / LV_TAU;
  vec3 dust = lvDust(p, px, 1.0 / 420.0, 0.21, prob, cyc * 2.0, flow * 0.06, 3.0, 0x1u, ph, dt);
  dust += lvDust(p, px, 1.0 / 210.0, 0.21, prob * 0.8, cyc, flow * 0.08, 4.6, 0x2u, ph, dt);
  dust += lvDust(p + 0.37, px, 1.0 / 120.0, 0.18, prob * 0.42, cyc, flow * 0.11, 5.2, 0x3u, ph, dt);
  dust += lvGlints(p, px, 1.0 / 38.0, prob * 0.42 * u_sparkle, ph, dt);

  vec3 col = bg + light + dust + bg * dot(light, vec3(0.33)) * 0.2;
  // Bright light rolls off towards white instead of clipping.
  col = 1.0 - exp(-col);
  writeColorLinear(col);
}
`;

function hexToRgb01(hex: string): [number, number, number] {
  const clean = hex.replace("#", "").trim();
  const num = parseInt(clean, 16);
  if (isNaN(num)) return [0, 0, 0];
  return [(num >> 16) / 255, ((num >> 8) & 255) / 255, (num & 255) / 255];
}

function srgbToLinear1(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToOklab([r, g, b]: [number, number, number]): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error("LightVeil shader compile error:", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/**
 * Animated WebGL2 "Light Veil" background shader from Gradient Lab (Polar Veil),
 * tuned slightly darker so foreground UI cards and typography maintain crisp contrast.
 */
export function LightVeilBackground({
  // Polar Veil palette with a deeper midnight base (#020307)
  colors = ["#020307", "#2ce5b0", "#169ee0", "#694ce6"],
  shape = 0, // 0 = Swoosh curve
  flip = 0,
  thick = 0.33,
  glow = 0.45,
  veil = 0.5,
  prism = 0.15,
  sparkle = 0.62,
  spread = 0.45,
  wobble = 0.55,
  seed = 3,
  speed = 0.22,
  exposure = 0.72, // Slightly darker than 1.0 for high-contrast UI legibility
  grain = 0.035,
}: LightVeilConfig) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl2", {
      antialias: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) return;

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    if (!vs || !fs) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("LightVeil program link error:", gl.getProgramInfoLog(program));
      return;
    }

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );

    const posLoc = gl.getAttribLocation(program, "a_pos");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    // Uniform locations
    const loc = {
      u_time: gl.getUniformLocation(program, "u_time"),
      u_resolution: gl.getUniformLocation(program, "u_resolution"),
      u_blobCount: gl.getUniformLocation(program, "u_blobCount"),
      u_colLin: gl.getUniformLocation(program, "u_colLin"),
      u_colLab: gl.getUniformLocation(program, "u_colLab"),
      u_exposure: gl.getUniformLocation(program, "u_exposure"),
      u_grain: gl.getUniformLocation(program, "u_grain"),
      u_shape: gl.getUniformLocation(program, "u_shape"),
      u_flip: gl.getUniformLocation(program, "u_flip"),
      u_thick: gl.getUniformLocation(program, "u_thick"),
      u_glow: gl.getUniformLocation(program, "u_glow"),
      u_veil: gl.getUniformLocation(program, "u_veil"),
      u_prism: gl.getUniformLocation(program, "u_prism"),
      u_sparkle: gl.getUniformLocation(program, "u_sparkle"),
      u_spread: gl.getUniformLocation(program, "u_spread"),
      u_wobble: gl.getUniformLocation(program, "u_wobble"),
      u_seed: gl.getUniformLocation(program, "u_seed"),
      u_speed: gl.getUniformLocation(program, "u_speed"),
    };

    // Precompute linear & Oklab color arrays (up to 8 stops)
    const colLin = new Float32Array(24);
    const colLab = new Float32Array(24);
    const count = Math.min(8, Math.max(1, colors.length));

    for (let i = 0; i < 8; i++) {
      const hex = colors[i] ?? colors[colors.length - 1] ?? "#000000";
      const [sr, sg, sb] = hexToRgb01(hex);
      const lr = srgbToLinear1(sr);
      const lg = srgbToLinear1(sg);
      const lb = srgbToLinear1(sb);
      colLin[i * 3] = lr;
      colLin[i * 3 + 1] = lg;
      colLin[i * 3 + 2] = lb;

      const [L, A, B] = linearToOklab([lr, lg, lb]);
      colLab[i * 3] = L;
      colLab[i * 3 + 1] = A;
      colLab[i * 3 + 2] = B;
    }

    const updateSize = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      let dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      if (Math.max(w, h) * dpr > 1920) {
        dpr = 1920 / Math.max(w, h);
      }
      const pw = Math.max(1, Math.floor(w * dpr));
      const ph = Math.max(1, Math.floor(h * dpr));
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
      }
      gl.viewport(0, 0, pw, ph);
    };

    const ro = new ResizeObserver(updateSize);
    ro.observe(canvas);
    updateSize();

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    let rafId = 0;
    let accTime = 0;
    let lastNow = performance.now();

    const render = (now: number) => {
      const dt = (now - lastNow) / 1000;
      lastNow = now;
      if (!prefersReducedMotion) {
        accTime += dt;
      }

      gl.useProgram(program);
      gl.bindVertexArray(vao);

      gl.uniform1f(loc.u_time, accTime);
      gl.uniform2f(loc.u_resolution, canvas.width, canvas.height);
      gl.uniform1i(loc.u_blobCount, count);
      gl.uniform3fv(loc.u_colLin, colLin);
      gl.uniform3fv(loc.u_colLab, colLab);
      gl.uniform1f(loc.u_exposure, exposure);
      gl.uniform1f(loc.u_grain, grain);

      gl.uniform1f(loc.u_shape, shape);
      gl.uniform1f(loc.u_flip, flip);
      gl.uniform1f(loc.u_thick, thick);
      gl.uniform1f(loc.u_glow, glow);
      gl.uniform1f(loc.u_veil, veil);
      gl.uniform1f(loc.u_prism, prism);
      gl.uniform1f(loc.u_sparkle, sparkle);
      gl.uniform1f(loc.u_spread, spread);
      gl.uniform1f(loc.u_wobble, wobble);
      gl.uniform1f(loc.u_seed, seed);
      gl.uniform1f(loc.u_speed, speed);

      gl.drawArrays(gl.TRIANGLES, 0, 6);

      if (!prefersReducedMotion) {
        rafId = requestAnimationFrame(render);
      }
    };

    rafId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(vbo);
      gl.deleteVertexArray(vao);
    };
  }, [
    colors,
    shape,
    flip,
    thick,
    glow,
    veil,
    prism,
    sparkle,
    spread,
    wobble,
    seed,
    speed,
    exposure,
    grain,
  ]);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[#020307]"
    >
      {/* WebGL2 Light Veil Shader Canvas */}
      <canvas
        ref={canvasRef}
        className="h-full w-full block object-cover"
      />
      {/* Subtle darkening radial vignette overlay so foreground UI stays ultra-crisp */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 50% 35%, rgba(2, 4, 10, 0.18) 0%, rgba(2, 4, 10, 0.48) 100%)",
        }}
      />
    </div>
  );
}

