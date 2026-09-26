import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { RigidBody, CylinderCollider } from '@react-three/rapier';
import CustomShaderMaterial from 'three-custom-shader-material/vanilla';
import { TreeGeometryFactory } from '@features/flora/logic/TreeGeometryFactory';
import { TreeType } from '@features/terrain/logic/VegetationConfig';
import { getLeafTexture } from '@features/flora/trees/leafAtlas';
import { getNoiseTexture } from '@core/memory/sharedResources';
import { sharedUniforms } from '@core/graphics/SharedUniforms';
import { PooledPointLight, type VirtualPointLight } from '@core/graphics/PointLightPool';

/**
 * LuminaTree: the tree a restored Root Hollow grows.
 *
 * The same procedural oak as the rest of the world (TreeGeometryFactory), a
 * little grander, grown in front of the player: trunk first, then limbs, then
 * twigs (by branch depth and height). Leaves unfurl as Lumina teal and settle
 * to living green, keeping a scatter of softly glowing cards so a restored
 * hollow reads as a landmark. Faint teal veins run in the bark while it grows.
 */

const GROW_SECONDS = 12;
const TREE_SCALE = 1.4;
const LUMINA = new THREE.Color('#62e6d8');

const WOOD_VERT = /* glsl */ `
  attribute float aBranchDepth;
  attribute vec3 aBranchAxis;
  attribute vec3 aBranchOrigin;
  uniform float uGrowth;
  uniform float uHeight;
  varying float vDepth;
  varying vec3 vPos;
  varying float vVein;
  void main() {
    vDepth = aBranchDepth;
    vPos = position;
    // Each part grows once the tree has reached it: deeper branches and
    // higher parts later. It extends from its segment origin.
    float h = clamp(position.y / max(uHeight, 0.001), 0.0, 1.0);
    float start = aBranchDepth * 0.55 + h * 0.2;
    float t = smoothstep(start, start + 0.22, uGrowth);
    vec3 p = aBranchOrigin + (position - aBranchOrigin) * t;
    // Girth fills out over the whole growth.
    vec3 axis = normalize(aBranchAxis);
    vec3 rel = p - aBranchOrigin;
    vec3 along = axis * dot(rel, axis);
    p = aBranchOrigin + along + (rel - along) * mix(0.6, 1.0, smoothstep(0.0, 0.9, uGrowth));
    vVein = 1.0 - t; // freshly grown wood glows most
    csm_Position = p;
  }
`;

const WOOD_FRAG = /* glsl */ `
  precision highp sampler3D;
  uniform sampler3D uNoiseTexture;
  uniform vec3 uBark;
  uniform vec3 uLumina;
  uniform float uGrowth;
  uniform float uTime;
  varying float vDepth;
  varying vec3 vPos;
  varying float vVein;
  void main() {
    float n = texture(uNoiseTexture, vPos * vec3(3.0, 0.8, 3.0)).r;
    float fine = texture(uNoiseTexture, vPos * 9.0).g;
    vec3 col = uBark * (0.8 + 0.35 * n) * (0.92 + 0.12 * fine);
    csm_DiffuseColor = vec4(col, 1.0);
    // Veins: thin teal lines in the furrows, bright while growing, then a
    // slow faint pulse that marks a restored tree.
    // Thin lines only: a narrow band of the bark noise (a wide band lit the
    // whole young trunk, which bloomed into a pale white spike).
    float vein = smoothstep(0.64, 0.68, n) * (1.0 - smoothstep(0.68, 0.72, n));
    float settle = 1.0 - smoothstep(0.85, 1.0, uGrowth);
    float pulse = 0.5 + 0.5 * sin(uTime * 0.8 + vPos.y * 1.3);
    csm_Emissive = uLumina * vein * (0.45 * max(settle, vVein) + 0.08 * pulse);
    csm_Roughness = 0.85;
  }
`;

const LEAF_VERT = /* glsl */ `
  attribute float aLeafRand;
  uniform float uGrowth;
  uniform float uTime;
  varying vec2 vLeafUv;
  varying float vRand;
  varying float vOpen;
  void main() {
    vLeafUv = uv;
    vRand = aLeafRand;
    // Cards open from the inside of the crown outward.
    float start = 0.55 + aLeafRand * 0.3;
    vOpen = smoothstep(start, start + 0.15, uGrowth);
    vec3 p = position;
    p.x += sin(uTime * 1.3 + position.y * 0.7 + aLeafRand * 6.2831) * 0.05;
    csm_Position = p;
  }
`;

const LEAF_FRAG = /* glsl */ `
  uniform sampler2D uLeafMap;
  uniform vec3 uLumina;
  uniform float uGrowth;
  uniform float uTime;
  varying vec2 vLeafUv;
  varying float vRand;
  varying float vOpen;
  void main() {
    vec4 tex = texture2D(uLeafMap, vLeafUv);
    float cover = (tex.a - 0.45) / max(fwidth(tex.a), 1e-4) + 0.5;
    // Unopened cards and cut-outs are discarded (no early return: CSM inlines main).
    if (cover < 0.5 || vOpen < 0.02 || fract(vRand * 13.7) > vOpen) discard;
    // Newly opened cards are Lumina teal and settle to living green; about
    // one in six keeps a soft glow.
    float keep = step(0.83, fract(vRand * 7.31));
    float fresh = 1.0 - smoothstep(0.0, 0.25, vOpen - 0.75 + (uGrowth - 0.85) * 3.0);
    vec3 green = tex.rgb * vec3(0.92, 1.02, 0.94);
    vec3 col = mix(green, uLumina * 0.9, clamp(fresh + keep * 0.55, 0.0, 1.0));
    csm_DiffuseColor = vec4(col, 1.0);
    float glow = fresh * 0.8 + keep * (0.35 + 0.15 * sin(uTime * 1.1 + vRand * 20.0));
    csm_Emissive = uLumina * glow * 0.6;
    csm_Roughness = 0.8;
  }
`;

export const LuminaTree: React.FC<{
  seed: number;
  /** Grow instantly (hollow was already restored when it loaded). */
  grown?: boolean;
  userData?: Record<string, unknown>;
}> = ({ seed, grown = false, userData }) => {
  const variant = Math.abs(Math.floor(seed)) % 4;
  const geo = useMemo(() => TreeGeometryFactory.getTreeGeometry(TreeType.OAK, variant, false), [variant]);
  const height = useMemo(() => {
    const g = geo.wood;
    if (!g.boundingBox) g.computeBoundingBox();
    return g.boundingBox ? g.boundingBox.max.y : 8;
  }, [geo]);

  const growth = useRef(grown ? 1 : 0);
  const lightRef = useRef<VirtualPointLight>(null);

  const woodMat = useMemo(() => new (CustomShaderMaterial as unknown as new (o: object) => THREE.Material)({
    baseMaterial: THREE.MeshStandardMaterial,
    vertexShader: WOOD_VERT,
    fragmentShader: WOOD_FRAG,
    uniforms: {
      uGrowth: { value: growth.current },
      uHeight: { value: height },
      uBark: { value: new THREE.Color('#5b4a38') },
      uLumina: { value: LUMINA },
      uNoiseTexture: { value: getNoiseTexture() },
      uTime: sharedUniforms.uTime,
    },
    roughness: 0.85,
  }), [height]);

  const leafMat = useMemo(() => new (CustomShaderMaterial as unknown as new (o: object) => THREE.Material)({
    baseMaterial: THREE.MeshStandardMaterial,
    vertexShader: LEAF_VERT,
    fragmentShader: LEAF_FRAG,
    uniforms: {
      uGrowth: { value: growth.current },
      uLumina: { value: LUMINA },
      uLeafMap: { value: getLeafTexture(TreeType.OAK) },
      uTime: sharedUniforms.uTime,
    },
    side: THREE.DoubleSide,
    toneMapped: false,
  }), []);

  useFrame((_s, delta) => {
    if (growth.current < 1) {
      growth.current = Math.min(1, growth.current + delta / GROW_SECONDS);
    }
    // Ease out: fast start, gentle settle.
    const g = 1 - Math.pow(1 - growth.current, 2.2);
    (woodMat as unknown as { uniforms: Record<string, { value: number }> }).uniforms.uGrowth.value = g;
    (leafMat as unknown as { uniforms: Record<string, { value: number }> }).uniforms.uGrowth.value = g;
    if (lightRef.current) lightRef.current.intensity = 0.3 + 0.9 * g * (1 - 0.5 * g);
  });

  return (
    <group scale={TREE_SCALE}>
      <mesh geometry={geo.wood} material={woodMat} castShadow receiveShadow />
      <mesh geometry={geo.leaves} material={leafMat} />
      <PooledPointLight ref={lightRef} position={[0, height * 0.7, 0]} color="#62e6d8" intensity={0} distance={16} decay={1.6} />
      <RigidBody type="fixed" colliders={false} userData={userData}>
        <CylinderCollider args={[height * 0.35, 0.45]} position={[0, height * 0.35, 0]} />
      </RigidBody>
    </group>
  );
};
