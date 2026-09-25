/**
 * Procedural PBR texture synthesis for terrain materials.
 *
 * Every terrain material channel (see TriplanarShader: channel = MaterialType
 * index as mapped by the mesher) gets a tileable set of maps:
 *   - albedo (sRGB-authored RGB) + height (A)   -> texture array A
 *   - normal XY (from height) + roughness + AO  -> texture array B
 *
 * All noise here is periodic on the unit square, so textures tile seamlessly.
 * Pure functions only: this runs in a worker (terrainTextures.worker.ts) and in
 * unit tests.
 */

export const PBR_TEXTURE_SIZE = 512;
/**
 * Bump whenever synthesis output changes: generated layers are cached in
 * IndexedDB under this version (TerrainTextureArrays.ts).
 */
export const PBR_SYNTH_VERSION = 3;
export const PBR_LAYER_COUNT = 16;

/** World size (metres) covered by one repeat of each layer's texture. */
export const PBR_TILE_METERS: readonly number[] = [
  4, // 0 air (unused)
  4, // 1 bedrock
  4.5, // 2 stone
  2.5, // 3 dirt
  2.2, // 4 grass
  3, // 5 sand
  4, // 6 snow
  3, // 7 clay
  4, // 8 water (unused)
  3.5, // 9 mossy stone
  3, // 10 red sand
  5, // 11 terracotta
  4, // 12 ice
  2.2, // 13 jungle grass
  3, // 14 glow stone
  3, // 15 obsidian
];

// ---------------------------------------------------------------------------
// Periodic noise primitives
// ---------------------------------------------------------------------------

/** Integer hash -> [0, 1). */
export function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const wrap = (i: number, p: number) => ((i % p) + p) % p;

// Unit gradients on the circle (lookup instead of cos/sin per lattice corner).
const GRAD_COUNT = 256;
const GRAD_X = new Float32Array(GRAD_COUNT);
const GRAD_Y = new Float32Array(GRAD_COUNT);
for (let i = 0; i < GRAD_COUNT; i++) {
  GRAD_X[i] = Math.cos((i / GRAD_COUNT) * Math.PI * 2);
  GRAD_Y[i] = Math.sin((i / GRAD_COUNT) * Math.PI * 2);
}
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Periodic gradient noise, period `p` (and `py`) lattice cells. Returns roughly [-1, 1]. */
export function gradNoise(x: number, y: number, p: number, seed: number, py = p): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const x0 = wrap(ix, p), y0 = wrap(iy, py), x1 = wrap(ix + 1, p), y1 = wrap(iy + 1, py);
  const g = (cx: number, cy: number, dx: number, dy: number) => {
    const k = (hash2(cx, cy, seed) * GRAD_COUNT) | 0;
    return GRAD_X[k] * dx + GRAD_Y[k] * dy;
  };
  const u = fade(fx), v = fade(fy);
  const n00 = g(x0, y0, fx, fy);
  const n10 = g(x1, y0, fx - 1, fy);
  const n01 = g(x0, y1, fx, fy - 1);
  const n11 = g(x1, y1, fx - 1, fy - 1);
  const nx0 = n00 + (n10 - n00) * u;
  const nx1 = n01 + (n11 - n01) * u;
  return (nx0 + (nx1 - nx0) * v) * 1.41;
}

/** Periodic fBm on the unit square. `freq` must be an integer. Returns ~[-1, 1]. */
export function fbm(u: number, v: number, freq: number, octaves: number, seed: number, gain = 0.5): number {
  let sum = 0, amp = 1, norm = 0, f = freq;
  for (let o = 0; o < octaves; o++) {
    sum += amp * gradNoise(u * f, v * f, f, seed + o * 101);
    norm += amp;
    amp *= gain;
    f *= 2;
  }
  return sum / norm;
}

/** Periodic ridged multifractal. Returns [0, 1] (1 = ridge crest). */
export function ridged(u: number, v: number, freq: number, octaves: number, seed: number): number {
  let sum = 0, amp = 0.5, norm = 0, f = freq, prev = 1;
  for (let o = 0; o < octaves; o++) {
    let n = 1 - Math.abs(gradNoise(u * f, v * f, f, seed + o * 131));
    n *= n;
    sum += n * amp * prev;
    norm += amp;
    prev = n;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

/** Result slots for worley() (reused, no per-call allocation). */
export const W = { f1: 0, f2: 0, id: 0, cx: 0, cy: 0 };

/** Periodic Worley/cellular noise; distances in cell units. Writes into W. */
export function worley(u: number, v: number, freq: number, seed: number, jitter = 0.9): void {
  const x = u * freq, y = v * freq;
  const ix = Math.floor(x), iy = Math.floor(y);
  let f1 = 9, f2 = 9, id = 0, bx = 0, by = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = ix + i, cy = iy + j;
      const wx = wrap(cx, freq), wy = wrap(cy, freq);
      const px = cx + 0.5 + (hash2(wx, wy, seed) - 0.5) * jitter;
      const py = cy + 0.5 + (hash2(wx, wy, seed + 17) - 0.5) * jitter;
      const dx = px - x, dy = py - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < f1) { f2 = f1; f1 = d; id = hash2(wx, wy, seed + 29); bx = dx; by = dy; }
      else if (d < f2) f2 = d;
    }
  }
  W.f1 = f1; W.f2 = f2; W.id = id; W.cx = bx; W.cy = by;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

type RGB = readonly [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

// ---------------------------------------------------------------------------
// Layer synthesis
// ---------------------------------------------------------------------------

export interface LayerMaps {
  size: number;
  /** RGB, authored in sRGB space, 0..1. */
  albedo: Float32Array;
  /** 0..1, 0.5 = reference plane. */
  height: Float32Array;
  roughness: Float32Array;
  /** Normal-map strength: slope scale applied to height differences. */
  normalStrength: number;
  /** Strength of the height-derived ambient occlusion. */
  aoStrength: number;
}

type PixelFn = (u: number, v: number, out: Float32Array) => void; // out = [r,g,b,h,rough]

function synth(size: number, normalStrength: number, aoStrength: number, fn: PixelFn): LayerMaps {
  const n = size * size;
  const albedo = new Float32Array(n * 3);
  const height = new Float32Array(n);
  const roughness = new Float32Array(n);
  const px = new Float32Array(5);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      fn((x + 0.5) / size, (y + 0.5) / size, px);
      albedo[i * 3] = clamp01(px[0]);
      albedo[i * 3 + 1] = clamp01(px[1]);
      albedo[i * 3 + 2] = clamp01(px[2]);
      height[i] = clamp01(px[3]);
      roughness[i] = clamp01(px[4]);
    }
  }
  return { size, albedo, height, roughness, normalStrength, aoStrength };
}

function setRGB(out: Float32Array, c: RGB, k = 1) { out[0] = c[0] * k; out[1] = c[1] * k; out[2] = c[2] * k; }
function mixRGB(out: Float32Array, a: RGB, b: RGB, t: number) {
  out[0] = mix(a[0], b[0], t); out[1] = mix(a[1], b[1], t); out[2] = mix(a[2], b[2], t);
}
function mulRGB(out: Float32Array, k: number) { out[0] *= k; out[1] *= k; out[2] *= k; }
function blendTo(out: Float32Array, c: RGB, t: number) {
  out[0] = mix(out[0], c[0], t); out[1] = mix(out[1], c[1], t); out[2] = mix(out[2], c[2], t);
}

/**
 * Natural rock: large warped fBm mass, chipped planar facets (per-cell tilted
 * planes), thin irregular fractures at two scales (ridged-noise zero lines,
 * not a closed cell network), mineral speckle, iron staining and lichen.
 * Shared by stone, mossy stone, bedrock and glow stone.
 */
function rockPixel(u: number, v: number, out: Float32Array, seed: number, base: RGB, alt: RGB, lichen: number) {
  const wu = u + 0.08 * fbm(u, v, 2, 4, seed + 1);
  const wv = v + 0.08 * fbm(u, v, 2, 4, seed + 2);
  const mass = fbm(wu, wv, 3, 6, seed + 3);
  // Facets: each cell is a tilted plane, giving chipped, angular faces.
  worley(wu, wv, 6, seed + 4, 1);
  const tiltA = (hash2(Math.floor(W.id * 9973), 1, seed) - 0.5) * 0.9;
  const tiltB = (hash2(Math.floor(W.id * 9973), 2, seed) - 0.5) * 0.9;
  const facet = W.cx * tiltA + W.cy * tiltB;
  const facetEdge = 1 - smooth(0.0, 0.05, W.f2 - W.f1);
  // Fractures: thin lines where ridged noise peaks, masked so they break up.
  const f1 = smooth(0.93, 0.985, ridged(wu, wv, 3, 3, seed + 5)) * smooth(-0.1, 0.25, fbm(u, v, 2, 2, seed + 6));
  const f2 = smooth(0.95, 0.99, ridged(wu + 0.37, wv, 7, 2, seed + 7)) * 0.6;
  const crack = Math.max(f1, f2);
  const grit = fbm(u, v, 48, 3, seed + 8);
  const speck = hash2(Math.floor(u * 384), Math.floor(v * 384), seed + 9);

  const h = 0.5 + 0.4 * mass + 0.14 * facet + 0.04 * grit - 0.45 * crack - 0.02 * facetEdge;
  mixRGB(out, base, alt, clamp01(0.5 + 1.1 * mass + 0.25 * (W.id - 0.5)));
  mulRGB(out, 0.86 + 0.14 * grit + 0.3 * facet + 0.25 * mass);
  if (speck > 0.965) mulRGB(out, speck > 0.985 ? 1.3 : 0.8); // feldspar / mafic grains
  // Iron staining in low-frequency patches.
  const iron = smooth(0.2, 0.6, fbm(u, v, 2, 3, seed + 10)) * 0.25;
  blendTo(out, [out[0] * 1.25 + 0.05, out[1] * 0.95, out[2] * 0.75], iron);
  mulRGB(out, 1 - 0.6 * crack - 0.04 * facetEdge);
  if (lichen > 0) {
    const l = smooth(0.58, 0.72, fbm(u, v, 10, 4, seed + 11) * 0.5 + 0.5) * lichen * (1 - crack);
    blendTo(out, speck > 0.5 ? [0.66, 0.68, 0.52] : [0.78, 0.74, 0.55], l * 0.6);
  }
  out[3] = h;
  out[4] = 0.68 + 0.14 * (0.5 - mass) + 0.15 * crack + 0.05 * grit;
}

function grassPixel(u: number, v: number, out: Float32Array, seed: number, dark: RGB, light: RGB, dry: RGB, litter: number) {
  // Overlapping blade strokes: stretched noise in three orientations.
  let blades = 0;
  for (let k = 0; k < 3; k++) {
    const a = k * 2.1 + 0.3;
    const ca = Math.cos(a), sa = Math.sin(a);
    // Rotate in lattice space by integer-friendly amounts to keep tiling:
    // use sums of u/v with integer weights instead of a free rotation.
    const su = k === 0 ? u : k === 1 ? u + v : u - v;
    const sv = k === 0 ? v : k === 1 ? v - u : v + u;
    const n = ridged(su, sv, 24, 2, seed + k * 7) * 0.6 + 0.4 * (gradNoise(su * 96, sv * 12, 96, seed + k, 12) * 0.5 + 0.5);
    blades = Math.max(blades, n * (0.8 + 0.2 * ca * sa));
  }
  const patch = fbm(u, v, 3, 4, seed + 11) * 0.5 + 0.5;
  const soil = smooth(0.25, 0.05, blades);
  mixRGB(out, dark, light, clamp01(blades * 1.1));
  blendTo(out, dry, smooth(0.55, 0.85, patch) * 0.45);
  blendTo(out, [0.24, 0.18, 0.11], soil * 0.7);
  if (litter > 0) {
    // Fallen leaves: rotated ellipses with a midrib.
    worley(u, v, 12, seed + 13, 1);
    const ang = W.id * Math.PI * 2;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const lx = W.cx * ca - W.cy * sa, ly = W.cx * sa + W.cy * ca;
    const e = Math.sqrt((lx / 0.34) ** 2 + (ly / 0.13) ** 2);
    const leaf = smooth(1.0, 0.8, e) * litter * (W.id > 0.4 ? 1 : 0);
    if (leaf > 0) {
      const tone: RGB = W.id > 0.8 ? [0.58, 0.44, 0.18] : W.id > 0.6 ? [0.42, 0.28, 0.13] : [0.3, 0.33, 0.12];
      blendTo(out, tone, leaf * 0.9);
      mulRGB(out, 1 - 0.3 * smooth(0.02, 0.0, Math.abs(ly)) * leaf); // midrib
      blades = mix(blades, 0.55, leaf);
    }
  }
  out[3] = 0.25 + 0.65 * blades;
  out[4] = 0.8 + 0.15 * soil;
}

function sandPixel(u: number, v: number, out: Float32Array, seed: number, base: RGB, shade: RGB) {
  const warp = fbm(u, v, 2, 3, seed + 1);
  const ph = (v * 9 + u * 2 + warp * 0.9) % 1;
  // Asymmetric ripple profile: gentle stoss slope, steep lee.
  const p = ph < 0 ? ph + 1 : ph;
  const ripple = p < 0.75 ? p / 0.75 : (1 - p) / 0.25;
  const grain = hash2(Math.floor(u * 512), Math.floor(v * 512), seed + 3);
  const grain2 = hash2(Math.floor(u * 256), Math.floor(v * 256), seed + 4);
  const dunes = fbm(u, v, 4, 4, seed + 5);
  mixRGB(out, shade, base, clamp01(0.62 + 0.2 * ripple + 0.15 * dunes));
  mulRGB(out, 0.94 + 0.08 * grain + 0.05 * grain2);
  if (grain > 0.985) blendTo(out, [0.2, 0.18, 0.16], 0.6); // dark mineral grains
  if (grain2 > 0.99) blendTo(out, [1, 0.98, 0.92], 0.5); // quartz
  out[3] = 0.35 + 0.25 * ripple + 0.2 * dunes + 0.04 * grain;
  out[4] = 0.88 + 0.08 * grain;
}

const PAL = {
  bedrock: hex('#2c2c30'), bedrockAlt: hex('#3b3a3c'),
  stone: hex('#8a8c8a'), stoneAlt: hex('#6f6b64'),
  dirt: hex('#6b4a32'), dirtDark: hex('#3e2a1c'),
  grassDark: hex('#28501a'), grassLight: hex('#6aa83c'), grassDry: hex('#a39a52'),
  sand: hex('#dcc896'), sandShade: hex('#b59f72'),
  snow: hex('#f4f7fb'), snowShade: hex('#c9d6e8'),
  clay: hex('#a8795a'), clayDark: hex('#6e4a35'),
  moss: hex('#4f7030'), mossLight: hex('#7a9a3e'),
  redSand: hex('#c8663e'), redSandShade: hex('#8e4128'),
  ice: hex('#bfe3f7'), iceDeep: hex('#6fa9d4'),
  jungleDark: hex('#23502a'), jungleLight: hex('#4f9a38'), jungleDry: hex('#7a7832'),
  obsidian: hex('#0c0a12'), obsidianSheen: hex('#2a2238'),
} as const;

const TERRACOTTA_BANDS: RGB[] = [hex('#a4583c'), hex('#c47a4e'), hex('#8c4a36'), hex('#d8a57a'), hex('#9e5e45'), hex('#b8683f')];

/** Synthesises one layer's maps. */
export function synthesizeLayer(layer: number, size = PBR_TEXTURE_SIZE): LayerMaps {
  const s = 1000 + layer * 97;
  switch (layer) {
    case 1: // BEDROCK
      return synth(size, 5, 0.9, (u, v, o) => rockPixel(u, v, o, s, PAL.bedrock, PAL.bedrockAlt, 0));
    case 2: // STONE
      return synth(size, 6, 1.0, (u, v, o) => rockPixel(u, v, o, s, PAL.stone, PAL.stoneAlt, 0.6));
    case 3: // DIRT: clumpy soil with pebbles
      return synth(size, 4, 0.8, (u, v, o) => {
        const clump = fbm(u, v, 6, 5, s);
        const fine = fbm(u, v, 48, 2, s + 1);
        mixRGB(o, PAL.dirtDark, PAL.dirt, clamp01(0.55 + 0.6 * clump));
        mulRGB(o, 0.92 + 0.12 * fine);
        let h = 0.4 + 0.2 * clump + 0.05 * fine;
        let r = 0.93;
        // Irregular pebbles: warped cells of varied size, only some cells occupied.
        worley(u + 0.012 * fbm(u, v, 24, 2, s + 4), v + 0.012 * fbm(u, v, 24, 2, s + 5), 14, s + 2, 1);
        const radius = 0.18 + 0.2 * hash2(Math.floor(W.id * 7919), 3, s);
        const peb = smooth(radius, radius - 0.07, W.f1) * (W.id > 0.5 ? 1 : 0);
        if (peb > 0) {
          const tone = hash2(Math.floor(W.id * 7919), 4, s);
          const pc: RGB = tone > 0.7 ? [0.6, 0.57, 0.52] : tone > 0.35 ? [0.45, 0.4, 0.34] : [0.34, 0.3, 0.27];
          blendTo(o, pc, peb);
          mulRGB(o, 0.85 + 0.3 * (0.5 - W.cy / radius * 0.5)); // lit from one side
          const dome = Math.sqrt(Math.max(0, 1 - (W.f1 / radius) ** 2));
          h = mix(h, 0.55 + 0.35 * dome, peb);
          r = mix(r, 0.65, peb);
        }
        // Crumbs of soil.
        const crumb = hash2(Math.floor(u * 256), Math.floor(v * 256), s + 6);
        if (crumb > 0.9) mulRGB(o, crumb > 0.97 ? 1.2 : 0.8);
        const organic = smooth(0.6, 0.8, fbm(u, v, 20, 3, s + 3) * 0.5 + 0.5);
        mulRGB(o, 1 - 0.25 * organic);
        o[3] = h; o[4] = r;
      });
    case 4: // GRASS (ground cover under the blade layer)
      return synth(size, 3.5, 0.9, (u, v, o) => grassPixel(u, v, o, s, PAL.grassDark, PAL.grassLight, PAL.grassDry, 0));
    case 5: // SAND
      return synth(size, 2.5, 0.4, (u, v, o) => sandPixel(u, v, o, s, PAL.sand, PAL.sandShade));
    case 6: // SNOW: wind-sculpted, blue in hollows
      return synth(size, 2, 0.5, (u, v, o) => {
        const drift = fbm(u * 1 + 0.3 * fbm(u, v, 2, 2, s), v, 3, 5, s + 1);
        const sastrugi = ridged(u, v + u, 6, 3, s + 2);
        const h = 0.45 + 0.3 * drift + 0.15 * sastrugi;
        mixRGB(o, PAL.snowShade, PAL.snow, smooth(0.3, 0.75, h));
        const sparkle = hash2(Math.floor(u * 512), Math.floor(v * 512), s + 3);
        o[3] = h;
        o[4] = sparkle > 0.97 ? 0.35 : 0.72 + 0.1 * drift;
      });
    case 7: // CLAY: dried mud cracks
      return synth(size, 5, 0.9, (u, v, o) => {
        const wu = u + 0.04 * fbm(u, v, 4, 3, s), wv = v + 0.04 * fbm(u, v, 4, 3, s + 1);
        worley(wu, wv, 7, s + 2, 1);
        const edge = W.f2 - W.f1;
        const crack = 1 - smooth(0.0, 0.05, edge);
        const curl = smooth(0.25, 0.0, edge) * 0.12; // plate edges curl up
        const fine = fbm(u, v, 32, 3, s + 3);
        mixRGB(o, PAL.clayDark, PAL.clay, clamp01(0.75 + 0.3 * W.id - 0.2 + 0.2 * fine));
        mulRGB(o, 1 - 0.6 * crack);
        o[3] = (0.55 + curl + 0.05 * fine) * (1 - 0.85 * crack);
        o[4] = 0.8 + 0.12 * crack;
      });
    case 8: // WATER (not rendered by terrain)
      return synth(size, 0, 0, (_u, _v, o) => { setRGB(o, [0.1, 0.35, 0.55]); o[3] = 0.5; o[4] = 0.1; });
    case 9: // MOSSY STONE
      return synth(size, 5, 1.0, (u, v, o) => {
        rockPixel(u, v, o, s, PAL.stone, PAL.stoneAlt, 0.3);
        const cover = smooth(0.42, 0.6, fbm(u, v, 4, 5, s + 7) * 0.5 + 0.5 + (o[3] - 0.5) * -0.4);
        if (cover > 0) {
          const fuzz = fbm(u, v, 64, 2, s + 8) * 0.5 + 0.5;
          blendTo(o, [mix(PAL.moss[0], PAL.mossLight[0], fuzz), mix(PAL.moss[1], PAL.mossLight[1], fuzz), mix(PAL.moss[2], PAL.mossLight[2], fuzz)], cover);
          o[3] = mix(o[3], 0.62 + 0.1 * fuzz, cover);
          o[4] = mix(o[4], 0.95, cover);
        }
      });
    case 10: // RED SAND
      return synth(size, 2.5, 0.4, (u, v, o) => sandPixel(u, v, o, s, PAL.redSand, PAL.redSandShade));
    case 11: // TERRACOTTA: horizontal strata (v = world up on side projections)
      return synth(size, 4.5, 0.9, (u, v, o) => {
        const warp = 0.02 * fbm(u, v, 3, 3, s);
        const band = (v + warp) * 11;
        const bi = Math.floor(band);
        const bf = band - bi;
        const bw = wrap(bi, 11); // band index must wrap with the tile
        const c = TERRACOTTA_BANDS[(bw * 7 + 3) % TERRACOTTA_BANDS.length];
        const hard = hash2(bw, 0, s + 1); // harder bands stick out
        setRGB(o, c);
        const grit = fbm(u, v, 40, 3, s + 2);
        mulRGB(o, 0.9 + 0.12 * grit);
        const lip = smooth(0.0, 0.12, bf) * smooth(1.0, 0.8, bf);
        o[3] = 0.3 + 0.45 * hard * lip + 0.06 * grit;
        o[4] = 0.88 - 0.1 * hard;
      });
    case 12: // ICE: cloudy with fracture planes
      return synth(size, 1.5, 0.3, (u, v, o) => {
        const cloud = fbm(u, v, 3, 5, s) * 0.5 + 0.5;
        worley(u + 0.05 * cloud, v, 4, s + 1, 1);
        const frac = 1 - smooth(0.0, 0.03, W.f2 - W.f1);
        mixRGB(o, PAL.iceDeep, PAL.ice, clamp01(cloud * 1.2));
        blendTo(o, [0.95, 0.98, 1], frac * 0.6);
        o[3] = 0.5 + 0.1 * cloud - 0.1 * frac;
        o[4] = 0.06 + 0.1 * cloud + 0.2 * frac;
      });
    case 13: // JUNGLE GRASS with leaf litter
      return synth(size, 3.5, 0.9, (u, v, o) => grassPixel(u, v, o, s, PAL.jungleDark, PAL.jungleLight, PAL.jungleDry, 1));
    case 14: // GLOW STONE: dark rock with luminous veins (bright albedo = emission mask)
      return synth(size, 5, 0.9, (u, v, o) => {
        rockPixel(u, v, o, s, [0.12, 0.13, 0.15], [0.18, 0.18, 0.2], 0);
        const vein = smooth(0.82, 0.95, ridged(u, v, 5, 4, s + 9));
        blendTo(o, [0.3, 0.95, 1.0], vein);
        o[3] = mix(o[3], 0.7, vein);
        o[4] = mix(o[4], 0.3, vein);
      });
    case 15: // OBSIDIAN: glassy conchoidal fractures
      return synth(size, 3, 0.5, (u, v, o) => {
        worley(u + 0.05 * fbm(u, v, 3, 3, s + 2), v + 0.05 * fbm(u, v, 3, 3, s + 3), 4, s, 1);
        // Conchoidal shells: warped, fading ripples around each fracture origin.
        const ring = (0.5 + 0.5 * Math.cos(W.f1 * (18 + 14 * W.id) + W.id * 6)) * smooth(0.9, 0.2, W.f1);
        const flow = fbm(u, v * 3, 3, 4, s + 1);
        mixRGB(o, PAL.obsidian, PAL.obsidianSheen, clamp01(0.25 * ring + 0.35 * (flow * 0.5 + 0.5)));
        const edge = 1 - smooth(0.0, 0.04, W.f2 - W.f1);
        blendTo(o, [0.35, 0.33, 0.4], edge * 0.5);
        o[3] = 0.5 + 0.12 * ring * (1 - W.f1) - 0.2 * edge;
        o[4] = 0.05 + 0.1 * edge + 0.05 * ring;
      });
    default: // AIR and unknown
      return synth(size, 0, 0, (_u, _v, o) => { setRGB(o, PAL.stone); o[3] = 0.5; o[4] = 0.9; });
  }
}

// ---------------------------------------------------------------------------
// Post-processing: normals, AO, packing
// ---------------------------------------------------------------------------

/** Separable wrap-around box blur. */
function boxBlur(src: Float32Array, size: number, radius: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const dst = new Float32Array(src.length);
  const inv = 1 / (radius * 2 + 1);
  for (let y = 0; y < size; y++) {
    let acc = 0;
    for (let k = -radius; k <= radius; k++) acc += src[y * size + wrap(k, size)];
    for (let x = 0; x < size; x++) {
      tmp[y * size + x] = acc * inv;
      acc += src[y * size + wrap(x + radius + 1, size)] - src[y * size + wrap(x - radius, size)];
    }
  }
  for (let x = 0; x < size; x++) {
    let acc = 0;
    for (let k = -radius; k <= radius; k++) acc += tmp[wrap(k, size) * size + x];
    for (let y = 0; y < size; y++) {
      dst[y * size + x] = acc * inv;
      acc += tmp[wrap(y + radius + 1, size) * size + x] - tmp[wrap(y - radius, size) * size + x];
    }
  }
  return dst;
}

export interface PackedLayer {
  /** RGBA8: albedo sRGB RGB + height. */
  a: Uint8Array;
  /** RGBA8: normal X, normal Y (tangent space, 0.5 = flat), roughness, AO. */
  b: Uint8Array;
}

/** Derives normals + AO from height and packs the layer into two RGBA8 buffers. */
export function packLayer(maps: LayerMaps): PackedLayer {
  const { size, albedo, height, roughness, normalStrength, aoStrength } = maps;
  const n = size * size;
  const a = new Uint8Array(n * 4);
  const b = new Uint8Array(n * 4);
  const blurred = boxBlur(height, size, Math.max(2, Math.round(size / 64)));
  const to8 = (x: number) => Math.round(clamp01(x) * 255);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const hl = height[y * size + wrap(x - 1, size)];
      const hr = height[y * size + wrap(x + 1, size)];
      const hd = height[wrap(y - 1, size) * size + x];
      const hu = height[wrap(y + 1, size) * size + x];
      // Height is in "texture units"; scale slopes by resolution so strength is size-independent.
      const k = normalStrength * size / 256;
      let nx = -(hr - hl) * 0.5 * k;
      let ny = -(hu - hd) * 0.5 * k;
      let nz = 1;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= len; ny /= len; nz /= len;
      const cavity = Math.max(0, blurred[i] - height[i]);
      const ao = clamp01(1 - cavity * 4 * aoStrength);
      a[i * 4] = to8(albedo[i * 3]);
      a[i * 4 + 1] = to8(albedo[i * 3 + 1]);
      a[i * 4 + 2] = to8(albedo[i * 3 + 2]);
      a[i * 4 + 3] = to8(height[i]);
      b[i * 4] = to8(nx * 0.5 + 0.5);
      b[i * 4 + 1] = to8(ny * 0.5 + 0.5);
      b[i * 4 + 2] = to8(roughness[i]);
      b[i * 4 + 3] = to8(ao);
    }
  }
  return { a, b };
}
