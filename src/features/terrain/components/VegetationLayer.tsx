import React, { useMemo, useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import CustomShaderMaterial from 'three-custom-shader-material';
import { VEGETATION_ASSETS } from '../logic/VegetationConfig';

// The "Life" Shader: Wind sway and subtle color variation
const VEGETATION_SHADER = {
  vertex: `
    uniform float uTime;
    varying vec2 vUv;
    varying vec3 vWorldPos;

    void main() {
      vUv = uv;
      vec3 pos = position;

      // Wind Simulation
      // Sway based on height (pos.y), Time, and World Position (for wave effect)
      float windFreq = 1.5;
      float windAmp = 0.1 * pos.y * pos.y; // Curve: stiff at bottom, loose at top

      // Instance matrix contains the world position offset in [3][0], [3][2]
      float worldX = instanceMatrix[3][0];
      float worldZ = instanceMatrix[3][2];

      float swayX = sin(uTime * windFreq + worldX * 0.5) * windAmp;
      float swayZ = cos(uTime * (windFreq * 0.8) + worldZ * 0.5) * windAmp;

      pos.x += swayX;
      pos.z += swayZ;

      csm_Position = pos;
      vWorldPos = vec3(worldX, 0.0, worldZ);
    }
  `,
  fragment: `
    varying vec3 vWorldPos;
    // Add subtle variation to color based on position to break uniformity
    void main() {
       float noise = sin(vWorldPos.x * 0.1) * cos(vWorldPos.z * 0.1) * 0.1;
       csm_DiffuseColor.rgb += noise;
    }
  `
};

interface VegetationLayerProps {
  data: Record<string, Float32Array>; // vegetationData from worker
}

export const VegetationLayer: React.FC<VegetationLayerProps> = React.memo(({ data }) => {
  const materials = useRef<THREE.ShaderMaterial[]>([]);

  // Update time uniform every frame
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    materials.current.forEach(mat => {
      if (mat && mat.uniforms?.uTime) mat.uniforms.uTime.value = t;
    });
  });

  // Construct standard geometries once
  const geometries = useMemo(() => {
    const geoMap = new Map();

    // Cross Geometry (Classic Grass)
    // Actually using PlaneGeometry as requested for performance/style
    // We can render two planes for a cross, but InstancedMesh only supports ONE geometry.
    // So if we want a cross, we should merge two planes into one BufferGeometry.

    const plane1 = new THREE.PlaneGeometry(1, 1);
    plane1.translate(0, 0.5, 0); // Pivot at bottom

    const plane2 = plane1.clone();
    plane2.rotateY(Math.PI / 2);

    // Merge manually since BufferGeometryUtils might not be available or complicates imports
    // Actually, simple Plane usually faces +Z.
    // To make a cross without utilities, let's just use TWO InstancedMeshes?
    // No, batching efficiency suggests one.
    // Let's create a custom BufferGeometry that contains both quads.

    const crossGeo = new THREE.BufferGeometry();
    const pPos = plane1.attributes.position.array;
    const pUv = plane1.attributes.uv.array;
    const pInd = plane1.index!.array;

    const p2Pos = plane2.attributes.position.array;
    const p2Uv = plane2.attributes.uv.array;
    const p2Ind = plane2.index!.array;

    // Combine
    const pos = new Float32Array([...pPos, ...p2Pos]);
    const uv = new Float32Array([...pUv, ...p2Uv]);
    const indices = [];
    for(let i=0; i<pInd.length; i++) indices.push(pInd[i]);
    const offset = pPos.length / 3;
    for(let i=0; i<p2Ind.length; i++) indices.push(p2Ind[i] + offset);

    crossGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    crossGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    crossGeo.setIndex(indices);
    crossGeo.computeVertexNormals();

    geoMap.set('cross', crossGeo);

    // VOXEL STYLE GEOMETRY
    const box = new THREE.BoxGeometry(0.15, 1, 0.15); // Thin stalk
    box.translate(0, 0.5, 0);
    geoMap.set('box', box);

    return geoMap;
  }, []);

  // Process batches
  const batches = useMemo(() => {
    if (!data) return [];
    return Object.entries(data).map(([typeStr, positions]) => {
      const typeId = parseInt(typeStr);
      const asset = VEGETATION_ASSETS[typeId];
      if (!asset) return null;

      return {
        id: typeId,
        asset,
        positions, // Float32Array
        count: positions.length / 3,
        geometry: geometries.get(asset.geometry) || geometries.get('box')
      };
    }).filter(Boolean);
  }, [data, geometries]);

  return (
    <group>
      {batches.map((batch, i) => (
        <instancedMesh
          key={batch!.id}
          args={[batch!.geometry, undefined, batch!.count]}
          castShadow
          receiveShadow
        >
          <CustomShaderMaterial
            ref={(ref: any) => (materials.current[i] = ref)}
            baseMaterial={THREE.MeshStandardMaterial}
            vertexShader={VEGETATION_SHADER.vertex}
            fragmentShader={VEGETATION_SHADER.fragment}
            uniforms={{ uTime: { value: 0 } }}
            color={batch!.asset.color}
            roughness={0.8}
            toneMapped={false}
            side={THREE.DoubleSide} // Important for 'cross' geometry
            alphaTest={0.5} // Just in case, though we are using geometry
          />
          <InstanceMatrixSetter positions={batch!.positions} scale={batch!.asset.scale} />
        </instancedMesh>
      ))}
    </group>
  );
});

// Helper component to set matrices layout-effect style
const InstanceMatrixSetter = ({ positions, scale }: { positions: Float32Array, scale: number[] }) => {
  const anchorRef = useRef<THREE.Object3D>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const anchorObject = useMemo(() => new THREE.Object3D(), []);

  useLayoutEffect(() => {
    const parent = anchorRef.current?.parent as THREE.InstancedMesh | undefined;
    if (!parent) return;

    const count = positions.length / 3;
    for (let i = 0; i < count; i++) {
      dummy.position.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      dummy.rotation.y = Math.random() * Math.PI * 2;
      const s = Math.random() * 0.3 + 0.85; // Slight size variance
      dummy.scale.set(scale[0] * s, scale[1] * s, scale[2] * s);
      dummy.updateMatrix();
      parent.setMatrixAt(i, dummy.matrix);
    }
    parent.instanceMatrix.needsUpdate = true;
  }, [positions, scale, dummy]);

  // Attach a tiny helper object so we can grab the InstancedMesh parent reliably
  return <primitive ref={anchorRef} object={anchorObject} />;
};
