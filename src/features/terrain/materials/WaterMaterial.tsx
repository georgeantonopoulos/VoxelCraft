import * as THREE from 'three';
import React, { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { getNoiseTexture } from '@core/memory/sharedResources';
import { CHUNK_SIZE_XZ, WATER_LEVEL } from '@/constants';
import { sharedUniforms } from '@core/graphics/SharedUniforms';
import { MAX_WATER_RIPPLES, waterRippleUniform } from '@core/graphics/waterRipples';
import { computeRiverFlow, FLOW_GRID, FLOW_STEP } from '@features/terrain/logic/waterFlow';
import { frameProfiler } from '@core/utils/FrameProfiler';

/**
 * Water surface material.
 *
 * One material per water chunk (all clones share one compiled program). Each
 * chunk gets its own seabed height texture, so the shader knows the water
 * depth at every pixel:
 *  - the shoreline is where depth reaches 0 (follows the real terrain curve,
 *    not the voxel grid),
 *  - colour goes from turquoise shallows to deep blue,
 *  - an animated foam line runs along the shore,
 *  - it reflects the real sky gradient and clouds (dim toward the horizon,
 *    where real lakes mirror the far shore), glitters in the sun, ripples in
 *    wind gusts, rings under rain, and hides the bed more at low angles,
 *  - under a cave roof or on land the depth is negative, so nothing is drawn.
 *
 * (The previous shared material set a per-object shore mask in onBeforeRender,
 * which three.js does not upload per draw, so the mask had been disabled.)
 */

const SEABED_SIZE = CHUNK_SIZE_XZ;
/** Heightmap sentinel for columns without a surface (treated as deep water). */
const NO_SURFACE = -900;

const WATER_VERTEX = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec3 vNormalW;
  varying vec2 vLocal;

  void main() {
    vNormalW = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
    vLocal = position.xz;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const WATER_FRAGMENT = /* glsl */ `
  precision highp float;
  precision highp sampler3D;

  uniform float uTime;
  uniform vec3 uSunDir;
  uniform vec3 uCamPos;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform sampler3D uNoiseTexture;
  uniform sampler2D uSeabed;
  uniform float uHasSeabed;
  uniform float uWaterLevel;
  uniform float uChunkSize;
  uniform vec3 uColorShallow;
  uniform vec3 uColorDeep;
  uniform vec3 uSkyTop;
  uniform vec3 uSkyBottom;
  uniform float uOvercast;
  uniform float uRain;
  uniform vec4 uRipples[${MAX_WATER_RIPPLES}];
  uniform sampler2D uFlow; // rg: river direction (0..1 encoded), b: strength
  uniform float uHasFlow;
  uniform int uDebugMode;

  varying vec3 vWorldPos;
  varying vec3 vNormalW;
  varying vec2 vLocal;

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  // Slope (d height / dx, dz) of the surface: long swells, then wind ripples
  // that fade with distance (far water reads as a calm mirror, and fine
  // ripples would only shimmer there).
  vec2 waveSlope(vec3 pos, float t, float fine) {
    vec3 p1 = pos * 0.02 + vec3(t * 0.010, t * 0.005, t * 0.020);
    vec3 p2 = pos * 0.05 - vec3(t * 0.016, 0.0, t * 0.012);
    vec3 p3 = pos * 0.13 + vec3(0.0, t * 0.03, t * 0.025);
    float a = texture(uNoiseTexture, p1).r - 0.5;
    float b = texture(uNoiseTexture, p2).g - 0.5;
    float c = texture(uNoiseTexture, p3).b - 0.5;
    vec2 g = vec2(a * 0.55 + c * 0.25, b * 0.55 + c * 0.25);
    if (fine > 0.001) {
      vec3 p4 = vec3(pos.xz * 0.55, 0.0).xzy + vec3(t * 0.09, t * 0.05, -t * 0.07);
      vec3 p5 = vec3(pos.xz * 1.6, 0.0).xzy + vec3(-t * 0.16, t * 0.08, t * 0.13);
      vec2 r4 = vec2(texture(uNoiseTexture, p4).r, texture(uNoiseTexture, p4 + 0.37).g) - 0.5;
      vec2 r5 = vec2(texture(uNoiseTexture, p5).b, texture(uNoiseTexture, p5 + 0.61).r) - 0.5;
      // Gusts: ripples come and go in patches that drift with the wind.
      float gust = smoothstep(0.35, 0.75, texture(uNoiseTexture, vec3(pos.xz * 0.018 + t * 0.012, t * 0.004).xzy).g);
      g += (r4 * 0.14 + r5 * 0.08) * fine * (0.35 + 0.65 * gust + 0.6 * uOvercast);
    }
    return g;
  }

  // Rain rings: each cell gets a drop at its own time; the ring runs out and fades.
  vec2 rainSlope(vec2 p, float t) {
    vec2 g = vec2(0.0);
    for (int l = 0; l < 2; l++) {
      vec2 q = p * (l == 0 ? 1.7 : 2.6) + float(l) * 7.31;
      vec2 cell = floor(q);
      vec2 f = fract(q) - 0.5;
      float h = hash12(cell + float(l) * 13.1);
      vec2 off = (vec2(hash12(cell + 3.7), hash12(cell + 9.2)) - 0.5) * 0.5;
      float phase = fract(t * 0.9 + h);
      vec2 d = f - off;
      float r = length(d);
      float w = r - phase * 0.42;
      float ring = sin(w * 42.0) * exp(-w * w * 300.0) * (1.0 - phase) * (1.0 - phase);
      g += d / max(r, 1e-4) * ring;
    }
    return g * 0.35;
  }

  // River current: ripples stretched along the flow and carried downstream.
  // Two copies half a cycle apart, each advected for one period then reset
  // while the other takes over, so the drift never visibly jumps back.
  // Returns slope in xy, and drifting foam flecks in z.
  vec3 currentSlope(vec2 p, vec2 dir, float t) {
    const float PERIOD = 3.2;
    const float SPEED = 0.8;
    vec2 perp = vec2(-dir.y, dir.x);
    vec2 q = vec2(dot(p, dir), dot(p, perp));
    vec3 acc = vec3(0.0);
    for (int k = 0; k < 2; k++) {
      float ph = fract(t / PERIOD + float(k) * 0.5);
      float w = 1.0 - abs(2.0 * ph - 1.0);
      vec2 qq = q - vec2(SPEED * PERIOD * ph, 0.0) + float(k) * vec2(3.7, 1.9);
      // Long along the flow, tight across it: streaks.
      vec3 uvw = vec3(qq.x * 0.28, 0.61 + float(k) * 0.23, qq.y * 0.95);
      vec2 sl = vec2(texture(uNoiseTexture, uvw).r, texture(uNoiseTexture, uvw * 2.1 + 0.4).g) - 0.5;
      float fleck = smoothstep(0.66, 0.74, texture(uNoiseTexture, vec3(qq.x * 0.9, 0.17 + float(k) * 0.31, qq.y * 1.6)).b);
      acc += vec3(sl, fleck) * w;
    }
    vec2 slope = dir * acc.x * 0.5 + perp * acc.y;
    return vec3(slope, acc.z);
  }

  // Rings from things touching the water: x, z, start time, strength.
  vec2 touchSlope(vec2 p, float t) {
    vec2 g = vec2(0.0);
    for (int i = 0; i < ${MAX_WATER_RIPPLES}; i++) {
      vec4 s = uRipples[i];
      float age = t - s.z;
      if (age > 0.0 && age < 4.0) {
        vec2 d = p - s.xy;
        float r = length(d);
        float w = r - age * 0.9;
        float ring = sin(w * 11.0) * exp(-w * w * 4.0) * exp(-age * 0.7) / (1.0 + r * 0.5);
        g += d / max(r, 1e-3) * ring * s.w * 1.2;
      }
    }
    // Overlapping rings never tilt the surface into a flat bright band.
    float m = length(g);
    return m > 0.35 ? g * (0.35 / m) : g;
  }

  // The sky dome seen in direction r (same gradient and a soft cloud layer).
  vec3 skyColor(vec3 r) {
    float p = pow(max(0.0, (r.y + 0.2) / 1.2), 0.6);
    vec3 sky = mix(uSkyBottom, uSkyTop, p);
    if (r.y > 0.0) {
      vec2 cuv = r.xz / (r.y + 0.12) * 0.09 + vec2(uTime * 0.0007, uTime * 0.0003);
      float shape = texture(uNoiseTexture, vec3(cuv, 0.31)).r;
      float density = smoothstep(0.45 - 0.3 * uOvercast, 0.85 - 0.2 * uOvercast, shape) * smoothstep(0.0, 0.25, r.y);
      vec3 cloud = mix(uSkyBottom * 1.08, mix(uSkyTop, uSkyBottom, 0.5) * 0.85, uOvercast * 0.6);
      sky = mix(sky, cloud, density * 0.45);
    }
    // Grazing reflections pick up the far shore (hills and trees), not open
    // sky: a dim band at the horizon keeps lakes from glowing like mirrors.
    float shore = 1.0 - smoothstep(0.0, 0.14, r.y);
    return mix(sky, uFogColor * vec3(0.52, 0.58, 0.54), shore * 0.7);
  }

  void main() {
    // Seabed height (world Y) at this pixel; texel i sits at local x = i.
    float depth = 40.0;
    if (uHasSeabed > 0.5) {
      vec2 uv = (vLocal + 0.5) / uChunkSize;
      float seabed = texture2D(uSeabed, uv).r;
      depth = uWaterLevel - seabed;
    }
    if (depth <= 0.0) discard; // land, or a roofed cave/pit: no water sheet

    if (uDebugMode == 1) { gl_FragColor = vec4(vec3(clamp(depth / 8.0, 0.0, 1.0)), 1.0); return; }
    if (uDebugMode == 3) { float sb = uWaterLevel - depth; gl_FragColor = vec4(fract(sb * 0.5), fract(depth * 0.25), 0.0, 1.0); return; }
    if (uDebugMode == 2) { gl_FragColor = vec4(uHasSeabed > 0.5 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), 1.0); return; }

    vec3 toCam = uCamPos - vWorldPos;
    float dist = length(toCam);
    vec3 viewDir = toCam / max(dist, 1e-4);
    bool below = uCamPos.y < vWorldPos.y;

    float fine = 1.0 - smoothstep(10.0, 38.0, dist);
    vec2 slope = waveSlope(vWorldPos, uTime, fine);
    if (uRain > 0.01) slope += rainSlope(vWorldPos.xz, uTime) * uRain * fine;
    slope += touchSlope(vWorldPos.xz, uTime);
    // River current (none in the open sea or deep water).
    float current = 0.0;
    float flecks = 0.0;
    if (uHasFlow > 0.5) {
      vec3 fl = texture2D(uFlow, (vLocal / ${FLOW_STEP.toFixed(1)} + 0.5) / ${FLOW_GRID.toFixed(1)}).rgb;
      vec2 fdir = fl.rg * 2.0 - 1.0;
      float flen = length(fdir);
      current = fl.b * smoothstep(0.2, 0.6, flen) * (1.0 - smoothstep(3.5, 6.0, depth));
      if (current > 0.01) {
        vec3 cs = currentSlope(vWorldPos.xz, fdir / flen, uTime);
        slope = mix(slope, slope * 0.5 + cs.xy * 0.55, current);
        flecks = cs.z * current;
      }
    }
    if (uDebugMode == 4) {
      // Current: hue = direction, brightness = strength (grey = none).
      vec3 fl = uHasFlow > 0.5 ? texture2D(uFlow, (vLocal / ${FLOW_STEP.toFixed(1)} + 0.5) / ${FLOW_GRID.toFixed(1)}).rgb : vec3(0.5, 0.5, 0.0);
      gl_FragColor = vec4(mix(vec3(0.3), vec3(fl.r, fl.g, 1.0 - fl.r), current), 1.0);
      return;
    }
    // Calm the surface in the shallows (short fetch, less chop).
    slope *= smoothstep(0.0, 2.0, depth) * 0.7 + 0.3;
    vec3 n = normalize(vec3(slope.x, 1.0, slope.y));

    // Light reaching the water: sunlit by day, dim under cloud and at night.
    vec3 lightDir = normalize(uSunDir);
    float sunUp = smoothstep(-0.05, 0.15, lightDir.y);
    float skyLum = dot(uSkyBottom, vec3(0.2126, 0.7152, 0.0722));
    float ambient = clamp(skyLum * 1.3, 0.06, 1.0);

    if (below) {
      // From under the surface: a dim, rippled ceiling, brighter looking up.
      float up = clamp(-viewDir.y, 0.0, 1.0);
      vec3 col = mix(uColorDeep, uColorShallow * 1.2, up) * ambient;
      gl_FragColor = vec4(col, mix(0.95, 0.55, up));
      return;
    }

    float cosI = max(dot(viewDir, n), 0.0);
    // Near the shore the sheet thins to nothing: fade reflection with it too.
    float shoreFade = smoothstep(0.0, 0.3, depth);
    float fresnel = (0.02 + 0.98 * pow(1.0 - cosI, 5.0)) * shoreFade;

    vec3 r = reflect(-viewDir, n);
    r.y = abs(r.y); // ripples can tip the reflection under the horizon
    vec3 refl = skyColor(r);
    // Sun: tight glitter on the ripples plus a softer path on the swell.
    vec3 halfVec = normalize(lightDir + viewDir);
    float nh = max(dot(n, halfVec), 0.0);
    float clear = 1.0 - 0.85 * uOvercast;
    vec3 sunCol = vec3(1.0, 0.96, 0.88);
    vec3 spec = sunCol * (pow(nh, 900.0) * 3.0 + pow(nh, 120.0) * 0.18) * sunUp * clear;

    // Light travels through the water to the bed and back: the longer the
    // path (deeper, or seen at a low angle), the less of the bed shows.
    float cosT = sqrt(1.0 - (1.0 - cosI * cosI) / 1.77);
    float path = depth / max(cosT, 0.2);
    float trans = exp(-path * 0.34);
    vec3 body = mix(uColorShallow, uColorDeep, 1.0 - exp(-depth * 0.28)) * ambient;

    // Shore foam: an animated line where the water gets thin.
    float foamNoise = texture(uNoiseTexture, vec3(vWorldPos.xz * 0.25, uTime * 0.05)).r;
    float foamBand = 1.0 - smoothstep(0.03, 0.22, depth);
    float foamWave = 0.55 + 0.45 * sin(uTime * 1.6 - depth * 18.0 + foamNoise * 6.0);
    float foam = foamBand * foamWave * smoothstep(0.45, 0.7, foamNoise + foamBand * 0.3);
    // Bits of foam riding the current.
    foam = max(foam, flecks * 0.45);

    // Blend over the scene behind: dst * (1 - a) is the bed seen through the
    // water, so a and colour are chosen to give
    //   fresnel * sky + (1 - fresnel) * (scattered body + bed * transmittance).
    float a = 1.0 - (1.0 - fresnel) * trans;
    vec3 lit = fresnel * refl + (1.0 - fresnel) * (1.0 - trans) * body;
    vec3 col = lit / max(a, 1e-3) + spec / max(a, 0.25);
    a = clamp(a + foam * 0.45, 0.0, 0.97);
    col = mix(col, vec3(0.9, 0.93, 0.92) * ambient, foam * 0.6);

    // Fog
    float fog = clamp((dist - uFogNear) / max(uFogFar - uFogNear, 0.0001), 0.0, 1.0);
    col = mix(col, uFogColor, pow(fog, 1.25) * 0.6);

    gl_FragColor = vec4(col, a);
  }
`;

// Shared (not cloned) uniform objects: updated once per frame for every chunk.
const sharedCamPos = { value: new THREE.Vector3() };
const sharedFogColor = { value: new THREE.Color('#87CEEB') };
const sharedDebugMode = { value: 0 };
let lastUpdateFrame = -1;

let template: THREE.ShaderMaterial | null = null;
const getTemplate = (): THREE.ShaderMaterial => {
  if (template) return template;
  template = new THREE.ShaderMaterial({
    vertexShader: WATER_VERTEX,
    fragmentShader: WATER_FRAGMENT,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    uniforms: {
      uSeabed: { value: null },
      uHasSeabed: { value: 0 },
      uWaterLevel: { value: WATER_LEVEL },
      uChunkSize: { value: CHUNK_SIZE_XZ },
      uColorShallow: { value: new THREE.Color('#5a978d') }, // muted teal, not tropical turquoise
      uColorDeep: { value: new THREE.Color('#16303b') },
      uNoiseTexture: { value: null },
    },
  });
  return template;
};

/** Build a per-chunk material that shares the compiled program and frame uniforms. */
const createChunkWaterMaterial = (seabed: THREE.Texture | null, flow: THREE.Texture | null): THREE.ShaderMaterial => {
  const mat = getTemplate().clone();
  const u = mat.uniforms;
  u.uTime = sharedUniforms.uTime;
  u.uSunDir = sharedUniforms.uSunDir;
  u.uFogNear = sharedUniforms.uFogNear;
  u.uFogFar = sharedUniforms.uFogFar;
  u.uCamPos = sharedCamPos;
  u.uFogColor = sharedFogColor;
  u.uDebugMode = sharedDebugMode;
  u.uSkyTop = sharedUniforms.uSkyTop;
  u.uSkyBottom = sharedUniforms.uSkyBottom;
  u.uOvercast = sharedUniforms.uOvercast;
  u.uRain = sharedUniforms.uRain;
  u.uRipples = waterRippleUniform;
  u.uFlow = { value: flow };
  u.uHasFlow = { value: flow ? 1 : 0 };
  u.uNoiseTexture = { value: getNoiseTexture() };
  u.uSeabed = { value: seabed };
  u.uHasSeabed = { value: seabed ? 1 : 0 };
  return mat;
};

/** Seabed (surface height, world Y) texture from the chunk's 32x32 height map. */
export const createSeabedTexture = (heights: Float32Array | undefined): THREE.DataTexture | null => {
  if (!heights || heights.length !== SEABED_SIZE * SEABED_SIZE) return null;
  const half = new Uint16Array(heights.length);
  for (let i = 0; i < heights.length; i++) {
    // Columns without a surface count as deep water (keeps filtering sane).
    const h = heights[i] < NO_SURFACE ? WATER_LEVEL - 40 : heights[i];
    half[i] = THREE.DataUtils.toHalfFloat(h);
  }
  // Half float: linear filtering is core in WebGL2 (32-bit float needs an extension).
  const tex = new THREE.DataTexture(half, SEABED_SIZE, SEABED_SIZE, THREE.RedFormat, THREE.HalfFloatType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
};

/** River current texture for a chunk, or null when no river runs through it. */
export const createFlowTexture = (cx: number, cz: number): THREE.DataTexture | null => {
  const flow = computeRiverFlow(cx, cz);
  const data = new Uint8Array(FLOW_GRID * FLOW_GRID * 4);
  let any = false;
  for (let i = 0; i < FLOW_GRID * FLOW_GRID; i++) {
    const strength = flow[i * 3 + 2];
    if (strength > 0.01) any = true;
    data[i * 4] = Math.round((flow[i * 3] * 0.5 + 0.5) * 255);
    data[i * 4 + 1] = Math.round((flow[i * 3 + 1] * 0.5 + 0.5) * 255);
    data[i * 4 + 2] = Math.round(strength * 255);
    data[i * 4 + 3] = 255;
  }
  if (!any) return null;
  const tex = new THREE.DataTexture(data, FLOW_GRID, FLOW_GRID, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
};

// Debug: window.__waterDebug(1) shows water depth as greyscale, 4 the river current, 0 = normal.
if (typeof window !== 'undefined') {
  (window as unknown as { __waterDebug?: (mode: number) => void }).__waterDebug = (mode: number) => {
    sharedDebugMode.value = mode;
  };
}

export interface WaterMaterialProps {
  /** Chunk surface heights (world Y, 32x32), i.e. chunk.grassHeightTex. */
  seabedHeights?: Float32Array;
  /** Chunk coordinates, for the river current. */
  cx: number;
  cz: number;
}

export const WaterMaterial: React.FC<WaterMaterialProps> = React.memo(({ seabedHeights, cx, cz }) => {
  const seabed = useMemo(() => createSeabedTexture(seabedHeights), [seabedHeights]);
  const flow = useMemo(() => createFlowTexture(cx, cz), [cx, cz]);
  const material = useMemo(() => createChunkWaterMaterial(seabed, flow), [seabed, flow]);

  useEffect(() => () => {
    material.dispose();
  }, [material]);
  useEffect(() => () => { seabed?.dispose(); }, [seabed]);
  useEffect(() => () => { flow?.dispose(); }, [flow]);

  useFrame((state) => {
    if (lastUpdateFrame === state.gl.info.render.frame) return;
    lastUpdateFrame = state.gl.info.render.frame;
    frameProfiler.begin('water-material');
    sharedCamPos.value.copy(state.camera.position);
    const fog = state.scene.fog as THREE.Fog | null;
    if (fog?.color) sharedFogColor.value.copy(fog.color);
    frameProfiler.end('water-material');
  });

  return <primitive object={material} attach="material" />;
});
