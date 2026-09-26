import * as THREE from 'three';
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';

/**
 * Custom post-processing effects for The Grove.
 *
 * Both effects are plain `postprocessing` Effects whose uniforms are mutated
 * every frame from `useFrame` — they are never re-created by React, which
 * avoids the shader recompiles the previous prop-driven ToneMapping caused
 * whenever the underground/underwater blend changed.
 */

// ---------------------------------------------------------------------------
// Grove Grade: exposure + AgX tone mapping + world-vitality colour grade,
// restoration pulse, underwater absorption, vignette and film grain in one pass.
// ---------------------------------------------------------------------------

const GRADE_FRAGMENT = /* glsl */ `
uniform float uExposure;
uniform float uVitality;
uniform float uUnderwater;
uniform float uNight;
uniform float uPulse;
uniform float uPulseRadius;
uniform float uVignette;
uniform float uGrain;
uniform float uAspect;
uniform float uSeed;

// AgX (Troy Sobotka), polynomial fit by bwrensch — matches three.js AgX.
const mat3 AGX_IN = mat3(
  0.842479062253094, 0.0423282422610123, 0.0423756549057051,
  0.0784335999999992, 0.878468636469772, 0.0784336,
  0.0792237451477643, 0.0791661274605434, 0.879142973793104);
const mat3 AGX_OUT = mat3(
  1.19687900512017, -0.0528968517574562, -0.0529716355144438,
  -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
  -0.0990297440797205, -0.0989611768448433, 1.15107367264116);

vec3 agxContrast(vec3 x) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}

vec3 agx(vec3 c) {
  const float minEv = -12.47393;
  const float maxEv = 4.026069;
  c = AGX_IN * max(c, vec3(1e-10));
  c = clamp(log2(c), minEv, maxEv);
  c = (c - minEv) / (maxEv - minEv);
  c = agxContrast(c);
  return AGX_OUT * c; // display-referred (sRGB-encoded)
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
#ifdef NAN_DEBUG
  // ?nandebug: paint NaN/Inf scene pixels magenta to locate the offending material.
  vec3 probe = inputColor.rgb;
  if (any(isnan(probe)) || any(isinf(probe))) { outputColor = vec4(1.0, 0.0, 1.0, 1.0); return; }
#endif
  vec3 c = inputColor.rgb * uExposure;

  // Restoration pulse: a Lumina-coloured ring sweeping outward from the centre.
  vec2 centered = (uv - 0.5) * vec2(uAspect, 1.0);
  float r = length(centered);
  float ring = exp(-pow((r - uPulseRadius) * 6.0, 2.0)) * uPulse;
  c += c * vec3(0.4, 1.6, 1.4) * ring + vec3(0.04, 0.22, 0.2) * ring;
  // Whole-frame lift while the pulse is alive: the world "breathes in".
  c *= 1.0 + uPulse * 0.18 * vec3(0.8, 1.1, 1.05);

  // Underwater: depth absorption (reds die first) and a touch of in-scatter.
  c = mix(c, c * vec3(0.32, 0.72, 0.82) + vec3(0.0, 0.015, 0.025), uUnderwater);

  c = agx(c);
  c = clamp(c, 0.0, 1.0);

  // --- Display-space grade ---
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));

  // A fading world is muted and a little eerie; restoration brings colour back.
  float sat = mix(0.86, 1.06, uVitality);
  c = mix(vec3(luma), c, sat);

  // Split toning: cool shadows, highlights warm up as the world heals.
  vec3 shadowTint = vec3(0.94, 0.99, 1.07);
  vec3 highlightTint = mix(vec3(1.0, 1.0, 0.99), vec3(1.07, 1.02, 0.91), uVitality);
  c *= mix(shadowTint, highlightTint, smoothstep(0.08, 0.75, luma));

  // Moonlit nights: push low-mids toward blue.
  c = mix(c, c * vec3(0.84, 0.94, 1.18), uNight * (1.0 - smoothstep(0.15, 0.6, luma)));

  // Gentle filmic S-curve.
  c = mix(c, c * c * (3.0 - 2.0 * c), 0.12);

  // Vignette (aspect-correct, soft).
  float vig = 1.0 - uVignette * smoothstep(0.25, 1.05, r * 1.25);
  c *= vig;

  // Luminance-weighted grain doubles as dithering against banding.
  float n = hash12(uv * vec2(1920.0, 1080.0) + uSeed) - 0.5;
  c += n * uGrain * (1.0 - luma * 0.5);

  c = clamp(c, 0.0, 1.0);
  outputColor = vec4(pow(c, vec3(2.2)), inputColor.a);
}
`;

/**
 * ?nandebug: every pass that scrubs NaN/Inf paints it magenta instead of black.
 * (The first scrubbing pass, usually SunShafts, would otherwise hide NaNs from
 * later passes.)
 */
function nanDebugDefines(): Array<[string, string]> {
  const on = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('nandebug');
  return on ? [['NAN_DEBUG', '1']] : [];
}

export class GroveGradeEffect extends Effect {
  constructor() {
    super('GroveGradeEffect', GRADE_FRAGMENT, {
      blendFunction: BlendFunction.SRC,
      defines: new Map(nanDebugDefines()),
      uniforms: new Map<string, THREE.Uniform>([
        ['uExposure', new THREE.Uniform(1.0)],
        ['uVitality', new THREE.Uniform(0.3)],
        ['uUnderwater', new THREE.Uniform(0.0)],
        ['uNight', new THREE.Uniform(0.0)],
        ['uPulse', new THREE.Uniform(0.0)],
        ['uPulseRadius', new THREE.Uniform(0.0)],
        ['uVignette', new THREE.Uniform(0.5)],
        ['uGrain', new THREE.Uniform(0.025)],
        ['uAspect', new THREE.Uniform(1.0)],
        ['uSeed', new THREE.Uniform(0.0)],
      ]),
    });
  }

  setUniform(name: GradeUniform, value: number): void {
    const u = this.uniforms.get(name);
    if (u) u.value = value;
  }
}

export type GradeUniform =
  | 'uExposure' | 'uVitality' | 'uUnderwater' | 'uNight' | 'uPulse'
  | 'uPulseRadius' | 'uVignette' | 'uGrain' | 'uAspect' | 'uSeed';

// ---------------------------------------------------------------------------
// Sun Shafts: screen-space crepuscular rays. Marches from each pixel toward
// the sun, accumulating unoccluded sky (depth == far) and bright sun-disk
// texels. Terrain and trees naturally carve dark shafts through the glow.
// ---------------------------------------------------------------------------

const SHAFT_FRAGMENT = /* glsl */ `
uniform vec2 uSunUv;
uniform float uStrength;
uniform vec3 uShaftColor;
uniform float uAspect;

#ifndef SHAFT_STEPS
#define SHAFT_STEPS 24
#endif

float shaftHash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

vec3 scrub(vec3 c) {
  // NaN/Inf from any material would be smeared across the whole frame by bloom.
#ifdef NAN_DEBUG
  return (any(isnan(c)) || any(isinf(c))) ? vec3(1.0, 0.0, 1.0) : min(c, vec3(65000.0));
#else
  return (any(isnan(c)) || any(isinf(c))) ? vec3(0.0) : min(c, vec3(65000.0));
#endif
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  vec3 base = scrub(inputColor.rgb);
  if (uStrength < 0.001) {
    outputColor = vec4(base, inputColor.a);
    return;
  }

  vec2 delta = uSunUv - uv;
  vec2 stepv = delta * (0.85 / float(SHAFT_STEPS));
  vec2 p = uv + stepv * shaftHash(uv * 731.0);

  float acc = 0.0;
  float weight = 1.0;
  for (int i = 0; i < SHAFT_STEPS; i++) {
    float sky = step(0.99999, readDepth(p));
    vec3 texel = scrub(texture2D(inputBuffer, p).rgb);
    float bright = smoothstep(1.2, 4.0, dot(texel, vec3(0.2126, 0.7152, 0.0722)));
    // Source is the sky close to the sun only: a wide source smeared a milky
    // veil over half the frame instead of rays breaking through trees.
    float nearSun = exp(-length((p - uSunUv) * vec2(uAspect, 1.0)) * 7.0);
    acc += max(sky * 0.45, bright) * nearSun * weight;
    weight *= 0.955;
    p += stepv;
  }
  acc /= float(SHAFT_STEPS);

  float falloff = exp(-length(delta * vec2(uAspect, 1.0)) * 1.1);
  vec3 shafts = uShaftColor * acc * falloff * uStrength;
  outputColor = vec4(base + shafts, inputColor.a);
}
`;

export class SunShaftsEffect extends Effect {
  constructor(steps = 24) {
    super('SunShaftsEffect', SHAFT_FRAGMENT, {
      blendFunction: BlendFunction.SRC,
      attributes: EffectAttribute.DEPTH | EffectAttribute.CONVOLUTION,
      defines: new Map([['SHAFT_STEPS', String(Math.max(8, Math.round(steps)))], ...nanDebugDefines()]),
      uniforms: new Map<string, THREE.Uniform>([
        ['uSunUv', new THREE.Uniform(new THREE.Vector2(0.5, 0.5))],
        ['uStrength', new THREE.Uniform(0.0)],
        ['uShaftColor', new THREE.Uniform(new THREE.Color(1.0, 0.86, 0.62))],
        ['uAspect', new THREE.Uniform(1.0)],
      ]),
    });
  }

  get sunUv(): THREE.Vector2 {
    return this.uniforms.get('uSunUv')!.value as THREE.Vector2;
  }

  get shaftColor(): THREE.Color {
    return this.uniforms.get('uShaftColor')!.value as THREE.Color;
  }

  set strength(v: number) {
    this.uniforms.get('uStrength')!.value = v;
  }

  set aspect(v: number) {
    this.uniforms.get('uAspect')!.value = v;
  }
}

// ---------------------------------------------------------------------------
// Scrub: replaces NaN/Inf pixels before bloom. A single NaN pixel (e.g. an
// undefined atan at a branch tip) otherwise spreads through bloom's blur and
// blacks out the entire frame. Marked CONVOLUTION so it gets its own pass
// ahead of Bloom; only used when SunShafts (which scrubs too) is disabled.
// ---------------------------------------------------------------------------

const SCRUB_FRAGMENT = /* glsl */ `
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  bool bad = any(isnan(c)) || any(isinf(c));
#ifdef NAN_DEBUG
  outputColor = vec4(bad ? vec3(1.0, 0.0, 1.0) : min(c, vec3(65000.0)), inputColor.a);
#else
  outputColor = vec4(bad ? vec3(0.0) : min(c, vec3(65000.0)), inputColor.a);
#endif
}
`;

export class ScrubEffect extends Effect {
  constructor() {
    super('ScrubEffect', SCRUB_FRAGMENT, {
      blendFunction: BlendFunction.SRC,
      defines: new Map(nanDebugDefines()),
      attributes: EffectAttribute.CONVOLUTION,
    });
  }
}
