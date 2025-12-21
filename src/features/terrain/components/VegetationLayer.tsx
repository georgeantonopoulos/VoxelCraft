import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import CustomShaderMaterial from 'three-custom-shader-material/vanilla';
import { VEGETATION_ASSETS } from '../logic/VegetationConfig';
import { getNoiseTexture } from '@core/memory/sharedResources';
import { VEGETATION_GEOMETRIES } from '../logic/VegetationGeometries';
import { sharedUniforms } from '@core/graphics/SharedUniforms';

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

// Pool for vegetation materials to avoid per-chunk material creation overhead.
// Keyed by Asset ID.
const vegetationMaterialPool: Record<number, THREE.Material> = {};

const getVegetationMaterial = (asset: any) => {
  if (vegetationMaterialPool[asset.id]) return vegetationMaterialPool[asset.id];

  vegetationMaterialPool[asset.id] = new (CustomShaderMaterial as any)({
    baseMaterial: THREE.MeshStandardMaterial,
    vertexShader: VEGETATION_SHADER.vertex,
    fragmentShader: VEGETATION_SHADER.fragment,
    uniforms: {
      ...sharedUniforms,
      uSway: { value: asset.sway },
      uWindDir: { value: new THREE.Vector2(0.85, 0.25) },
      uNoiseTexture: { value: getNoiseTexture() },
      uOpacity: { value: 1.0 },
    },
    color: asset.color,
    roughness: asset.roughness,
    toneMapped: false,
    side: THREE.DoubleSide,
  });

  return vegetationMaterialPool[asset.id];
};

interface VegetationLayerProps {
  data: Record<string, Float32Array>; // vegetationData from worker
  sunDirection?: THREE.Vector3;
  lodLevel?: number;
}

export const VegetationLayer: React.FC<VegetationLayerProps> = React.memo(({ data, lodLevel = 0 }) => {

  const batches = useMemo(() => {
    if (!data) return [];

    let densityFactor = 1.0;
    if (lodLevel === 2) densityFactor = 0.5;
    else if (lodLevel === 3) densityFactor = 0.1;
    else if (lodLevel >= 4) densityFactor = 0.0;

    return Object.entries(data).map(([typeStr, positions]) => {
      const posArray = positions as Float32Array;
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
        case 11: geoName = 'giant_fern'; break;
      }

      const count = Math.floor((posArray.length / 6) * densityFactor);
      if (count === 0) return null;
      const geometry = VEGETATION_GEOMETRIES[geoName];

      return {
        id: typeId,
        asset: { ...asset, id: typeId }, // Ensure ID is present for pooling
        positions: posArray,
        count,
        geometry
      };
    }).filter(Boolean);
  }, [data]);

  return (
    <group>
      {batches.map((batch) => (
        <VegetationBatch
          key={batch!.id}
          batch={batch!}
        />
      ))}
    </group>
  );
});

const VegetationBatch: React.FC<{
  batch: any;
}> = ({ batch }) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  // Clone the source geometry to avoid sharing attribute references across multiple
  // InstancedBufferGeometry instances. Sharing references caused crashes because
  // WebGL's internal attribute update/removal tracking got confused when the same
  // BufferAttribute was attached to multiple geometries.
  const geometry = useMemo(() => {
    const sourceGeo = batch.geometry as THREE.BufferGeometry;
    const instGeo = new THREE.InstancedBufferGeometry();

    // Clone index if present
    if (sourceGeo.index) {
      instGeo.setIndex(sourceGeo.index.clone());
    }

    // Clone position (required)
    if (sourceGeo.attributes.position) {
      instGeo.setAttribute('position', sourceGeo.attributes.position.clone());
    }

    // Clone normal (required)
    if (sourceGeo.attributes.normal) {
      instGeo.setAttribute('normal', sourceGeo.attributes.normal.clone());
    }

    // Clone UV if present, otherwise create a dummy one (some geometries may lack UVs)
    if (sourceGeo.attributes.uv) {
      instGeo.setAttribute('uv', sourceGeo.attributes.uv.clone());
    } else {
      // Create dummy UVs based on position count
      const posCount = sourceGeo.attributes.position?.count || 0;
      const dummyUvs = new Float32Array(posCount * 2);
      instGeo.setAttribute('uv', new THREE.BufferAttribute(dummyUvs, 2));
    }

    // Stride 6 (x,y,z, nx,ny,nz)
    // Create and attach instance attributes
    const interleaved = new THREE.InstancedInterleavedBuffer(batch.positions, 6);
    instGeo.setAttribute('aInstancePos', new THREE.InterleavedBufferAttribute(interleaved, 3, 0));
    instGeo.setAttribute('aInstanceNormal', new THREE.InterleavedBufferAttribute(interleaved, 3, 3));

    instGeo.boundingBox = new THREE.Box3(
      new THREE.Vector3(-2, -40, -2),
      new THREE.Vector3(34, 40, 34)
    );
    instGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(16, 0, 16), 45);

    return instGeo;
  }, [batch.geometry, batch.positions]);

  // Clean up the cloned geometry when component unmounts
  React.useEffect(() => {
    const geo = geometry;
    return () => {
      geo.dispose();
    };
  }, [geometry]);

  const material = useMemo(() => getVegetationMaterial(batch.asset), [batch.asset]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, undefined, batch.count]}
      castShadow={false}
      receiveShadow
      frustumCulled={true}
      material={material}
    />
  );
};
