import React, { useMemo, useRef, useLayoutEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import CustomShaderMaterial from 'three-custom-shader-material';
import { VEGETATION_ASSETS } from '../logic/VegetationConfig';
import { noiseTexture } from '@core/memory/sharedResources';
import { VEGETATION_GEOMETRIES } from '../logic/VegetationGeometries';

// The "Life" Shader: Wind sway and subtle color variation
const VEGETATION_SHADER = {
  vertex: `
  attribute vec3 aInstancePos;
  attribute vec3 aInstanceNormal;

  uniform float uTime;
  uniform float uSway;
  uniform vec2 uWindDir;
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vViewDir;

  void main() {
    vUv = uv;
    vec3 pos = position;

    // --- Deterministic Instance Placement (GPU Side) ---
    // Extract seed from position for stable per-instance variations
    float seed = (aInstancePos.x * 12.9898 + aInstancePos.z * 78.233);
    float randRot = fract(sin(seed) * 43758.5453) * 6.28318;
    float randScale = 0.85 + fract(sin(seed + 1.0) * 43758.5453) * 0.3;

    // 1. Build Alignment Matrix (Look-At Up)
    vec3 up = aInstanceNormal;
    vec3 helper = abs(up.y) > 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
    vec3 tangent = normalize(cross(helper, up));
    vec3 bitangent = cross(up, tangent);
    mat3 alignMat = mat3(tangent, up, bitangent);

    // 2. Build Random Y Rotation Matrix
    float cRot = cos(randRot);
    float sRot = sin(randRot);
    mat3 rotY = mat3(cRot, 0.0, sRot, 0.0, 1.0, 0.0, -sRot, 0.0, cRot);

    // 3. Apply Transform Chain
    pos *= randScale;
    pos = alignMat * (rotY * pos);
    
    // Final World-ish Position (local to chunk group)
    vec3 finalPos = aInstancePos + pos;

    // --- Wind Simulation ---
    float t = uTime * 0.8;
    float wind1 = sin(t * 1.5 + aInstancePos.x * 0.4 + aInstancePos.z * 0.2);
    float wind2 = sin(t * 4.0 + aInstancePos.x * 2.0 + aInstancePos.z * 1.5) * 0.3;
    float gust = sin(t * 2.0 - (aInstancePos.x * uWindDir.x + aInstancePos.z * uWindDir.y) * 0.3);
    float wind = wind1 + wind2 + (gust * 0.5);
    
    float swayStrength = uSway * pow(uv.y, 1.5) * 0.12; 
    
    finalPos.x += wind * swayStrength * uWindDir.x;
    finalPos.z += wind * swayStrength * uWindDir.y;

    csm_Position = finalPos; 
    vWorldPos = aInstancePos;
    
    // View dir for SSS
    vec4 worldPos = modelMatrix * vec4(finalPos, 1.0);
    vViewDir = normalize(cameraPosition - worldPos.xyz);
    
    // Transform normal for lighting
    csm_Normal = normalize(mix(alignMat * normal, up, 0.7));
  }
`,
  fragment: `
    uniform float uOpacity;
    uniform vec3 uSunDir;
    uniform sampler3D uNoiseTexture;
    varying vec3 vWorldPos;
    varying vec2 vUv;
    varying vec3 vViewDir;
    
    void main() {
       vec3 noiseCoord = vWorldPos * 0.08;
       float noise = texture(uNoiseTexture, noiseCoord).r;
       float noise2 = texture(uNoiseTexture, noiseCoord * 2.5).g;
       
       vec3 col = csm_DiffuseColor.rgb;
       col *= (0.9 + noise * 0.2); 
       
       vec3 warmShift = vec3(1.05, 1.0, 0.9);
       vec3 coolShift = vec3(0.9, 1.0, 1.05);
       col = mix(col * coolShift, col * warmShift, noise2);
       
       float gradient = smoothstep(0.0, 1.0, vUv.y);
       float ao = smoothstep(0.0, 0.7, vUv.y);
       col *= mix(0.7, 1.0, ao);
       
       vec3 tipCol = col * 1.25;
       col = mix(col, tipCol, gradient);

       float sss = pow(clamp(dot(vViewDir, -uSunDir), 0.0, 1.0), 3.0) * gradient;
       col += csm_DiffuseColor.rgb * sss * 0.6;

       float translucency = pow(gradient, 2.0) * 0.15;
       col += vec3(0.8, 1.0, 0.6) * translucency;

       csm_DiffuseColor = vec4(col, clamp(uOpacity, 0.0, 1.0));
    }
  `
};

interface VegetationLayerProps {
  data: Record<string, Float32Array>; // vegetationData from worker
  sunDirection?: THREE.Vector3;
}

export const VegetationLayer: React.FC<VegetationLayerProps> = React.memo(({ data, sunDirection }) => {
  const materials = useRef<THREE.ShaderMaterial[]>([]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    materials.current.forEach(mat => {
      if (!mat) return;
      mat.uniforms.uTime.value = t;
      if (sunDirection) mat.uniforms.uSunDir.value.copy(sunDirection);
    });
  });

  const batches = useMemo(() => {
    if (!data) return [];
    return Object.entries(data).map(([typeStr, positions]) => {
      const typeId = parseInt(typeStr);
      const asset = VEGETATION_ASSETS[typeId];
      if (!asset) return null;

      let geoName: keyof typeof VEGETATION_GEOMETRIES = 'box';
      switch (typeId) {
        case 0: geoName = 'grass_low'; break;
        case 1: geoName = 'grass_tall'; break;
        case 2: geoName = 'flower'; break;
        case 3: geoName = 'shrub'; break;
        case 4: geoName = 'grass_low'; break;
        case 5: geoName = 'fern'; break;
        case 6: geoName = 'grass_low'; break;
        case 7: geoName = 'grass_carpet'; break;
        case 8: geoName = 'broadleaf'; break;
        case 9: geoName = 'flower'; break;
        case 10: geoName = 'grass_tall'; break;
      }

      const count = positions.length / 6;
      const geometry = VEGETATION_GEOMETRIES[geoName];

      return {
        id: typeId,
        asset,
        positions,
        count,
        geometry
      };
    }).filter(Boolean);
  }, [data]);

  return (
    <group>
      {batches.map((batch, i) => (
        <VegetationBatch
          key={batch!.id}
          batch={batch!}
          sunDirection={sunDirection}
          registerMaterial={(ref) => (materials.current[i] = ref)}
        />
      ))}
    </group>
  );
});

const VegetationBatch: React.FC<{
  batch: any;
  sunDirection?: THREE.Vector3;
  registerMaterial: (ref: THREE.ShaderMaterial) => void;
}> = ({ batch, sunDirection, registerMaterial }) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  // Use InstancedBufferGeometry to share buffers without cloning the massive attribute arrays.
  const geometry = useMemo(() => {
    const instGeo = new THREE.InstancedBufferGeometry();
    instGeo.index = batch.geometry.index;
    instGeo.attributes.position = batch.geometry.attributes.position;
    instGeo.attributes.normal = batch.geometry.attributes.normal;
    instGeo.attributes.uv = batch.geometry.attributes.uv;

    // Set a manual bounding box for the entire batch so frustum culling works.
    // Chunks are roughly 32x32 in XZ. Y range is roughly -35 to +25.
    // Overestimating slightly is fine and cheaper than precise compute.
    instGeo.boundingBox = new THREE.Box3(
      new THREE.Vector3(-2, -40, -2),
      new THREE.Vector3(34, 40, 34)
    );
    instGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(16, 0, 16), 45);

    return instGeo;
  }, [batch.geometry]);

  useLayoutEffect(() => {
    if (!meshRef.current) return;

    // Stride 6 (x,y,z, nx,ny,nz)
    const interleaved = new THREE.InstancedInterleavedBuffer(batch.positions, 6);
    geometry.setAttribute('aInstancePos', new THREE.InterleavedBufferAttribute(interleaved, 3, 0));
    geometry.setAttribute('aInstanceNormal', new THREE.InterleavedBufferAttribute(interleaved, 3, 3));
  }, [batch.positions, geometry]);

  React.useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, undefined, batch.count]}
      castShadow={false}
      receiveShadow
      frustumCulled={true}
    >
      <CustomShaderMaterial
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ref={(ref: any) => registerMaterial(ref)}
        baseMaterial={THREE.MeshStandardMaterial}
        vertexShader={VEGETATION_SHADER.vertex}
        fragmentShader={VEGETATION_SHADER.fragment}
        uniforms={{
          uTime: { value: 0 },
          uSway: { value: batch.asset.sway },
          uWindDir: { value: new THREE.Vector2(0.85, 0.25) },
          uSunDir: { value: sunDirection || new THREE.Vector3(0, 1, 0) },
          uNoiseTexture: { value: noiseTexture },
          uOpacity: { value: 1.0 },
        }}
        color={batch.asset.color}
        roughness={batch.asset.roughness}
        toneMapped={false}
        side={THREE.DoubleSide}
      />
    </instancedMesh>
  );
};
