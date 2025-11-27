import React, { useRef, useState, useMemo, useLayoutEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { RigidBody } from '@react-three/rapier';
import CustomShaderMaterial from 'three-custom-shader-material';
import { TriplanarMaterial } from './TriplanarMaterial';
import { WaterMaterial } from './WaterMaterial';
import { useGameStore } from '../services/GameManager';
import { VOXEL_SCALE, CHUNK_SIZE_XZ } from '../constants';

// --- Types ---
// Ideally move this to types.ts, but keeping it here ensures immediate compilation
export interface ChunkState {
  key: string;
  cx: number;
  cz: number;
  density: Float32Array;
  material: Uint8Array;
  terrainVersion: number;
  visualVersion: number;

  meshPositions: Float32Array;
  meshIndices: Uint32Array;
  meshMaterials: Float32Array;
  meshMaterials2: Float32Array;
  meshMaterials3: Float32Array;
  meshWeights: Float32Array;
  meshNormals: Float32Array;
  meshWetness: Float32Array;
  meshMossiness: Float32Array;

  floraPositions?: Float32Array;

  meshWaterPositions: Float32Array;
  meshWaterIndices: Uint32Array;
  meshWaterNormals: Float32Array;
}

// --- Sub-Component: FloraMesh ---
const FloraMesh: React.FC<{ positions: Float32Array; chunkKey: string; onHarvest: (index: number) => void }> = React.memo(({ positions, chunkKey, onHarvest }) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const count = positions.length / 3;
  const dummy = useMemo(() => new THREE.Object3D(), []);

  // Track removed instances visually until remesh
  const [removedIndices, setRemovedIndices] = useState<Set<number>>(new Set());

  const handleClick = (e: any) => {
      // e.instanceId is the index
      if (e.button === 0 && e.instanceId !== undefined && !removedIndices.has(e.instanceId)) {
           e.stopPropagation();
           setRemovedIndices(prev => new Set(prev).add(e.instanceId));
           onHarvest(e.instanceId);

           // Hide instance immediately by scaling to zero
           if (meshRef.current) {
               meshRef.current.getMatrixAt(e.instanceId, dummy.matrix);
               dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);
               dummy.scale.set(0, 0, 0);
               dummy.updateMatrix();
               meshRef.current.setMatrixAt(e.instanceId, dummy.matrix);
               meshRef.current.instanceMatrix.needsUpdate = true;
           }
      }
  };

  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uColor: { value: new THREE.Color('#00FFFF') },
    uSeed: { value: Math.random() * 100 }
  }), []);

  useLayoutEffect(() => {
    if (!meshRef.current) return;
    for (let i = 0; i < count; i++) {
        dummy.position.set(positions[i*3], positions[i*3+1], positions[i*3+2]);
        // Random rotation and scale for organic variety
        dummy.rotation.y = Math.random() * Math.PI * 2;
        dummy.rotation.x = (Math.random() - 0.5) * 0.5;
        dummy.scale.setScalar(0.5 + Math.random() * 0.5);
        dummy.updateMatrix();
        meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  }, [positions, count, dummy]);

  useFrame(({ clock }) => {
    if (meshRef.current && meshRef.current.material) {
        // @ts-ignore
        const mat = meshRef.current.material as THREE.ShaderMaterial;
        if(mat.uniforms && mat.uniforms.uTime) {
            mat.uniforms.uTime.value = clock.getElapsedTime();
        }
    }
  });

  return (
    <instancedMesh
        ref={meshRef}
        args={[undefined, undefined, count]}
        frustumCulled={false}
        onClick={handleClick}
        onPointerOver={() => document.body.style.cursor = 'pointer'}
        onPointerOut={() => document.body.style.cursor = 'auto'}
    >
       <sphereGeometry args={[0.25, 16, 16]} />
       <CustomShaderMaterial
         baseMaterial={THREE.MeshStandardMaterial}
         vertexShader={`
            varying vec3 vPosition;
            void main() {
               vPosition = position;
            }
         `}
         fragmentShader={`
            uniform float uTime;
            uniform vec3 uColor;
            uniform float uSeed;
            varying vec3 vPosition;
            void main() {
                float pulse = sin(uTime * 2.0 + uSeed + vPosition.x * 4.0) * 0.5 + 1.5;
                csm_Emissive = uColor * pulse;
            }
         `}
         uniforms={uniforms}
         color="#222"
         roughness={0.4}
         toneMapped={false}
       />
    </instancedMesh>
  );
});

// --- Main Component: ChunkMesh ---
export const ChunkMesh: React.FC<{ chunk: ChunkState; sunDirection?: THREE.Vector3 }> = React.memo(({ chunk, sunDirection }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const [opacity, setOpacity] = useState(0);
  const addFlora = useGameStore(s => s.addFlora);

  const debugMode = useMemo(() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return params.has('debug');
  }, []);

  // Fade-in animation for new chunks
  useFrame((_, delta) => {
    if (opacity < 1) {
      setOpacity(prev => Math.min(prev + delta * 2, 1));
    }
  });

  const terrainGeometry = useMemo(() => {
    if (!chunk.meshPositions?.length || !chunk.meshIndices?.length) return null;

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(chunk.meshPositions, 3));

    const vertexCount = chunk.meshPositions.length / 3;

    // Helper to ensure attributes exist
    const ensureAttribute = (data: Float32Array | undefined, name: string, itemSize: number) => {
        if (data && data.length === vertexCount * itemSize) {
            geom.setAttribute(name, new THREE.BufferAttribute(data, itemSize));
        } else {
            geom.setAttribute(name, new THREE.BufferAttribute(new Float32Array(vertexCount * itemSize), itemSize));
        }
    };

    ensureAttribute(chunk.meshMaterials, 'aVoxelMat', 1);
    ensureAttribute(chunk.meshMaterials2, 'aVoxelMat2', 1);
    ensureAttribute(chunk.meshMaterials3, 'aVoxelMat3', 1);
    ensureAttribute(chunk.meshWeights, 'aWeight', 3);
    ensureAttribute(chunk.meshWetness, 'aVoxelWetness', 1);
    ensureAttribute(chunk.meshMossiness, 'aVoxelMossiness', 1);

    if (chunk.meshNormals?.length > 0) {
      geom.setAttribute('normal', new THREE.BufferAttribute(chunk.meshNormals, 3));
    } else {
      geom.computeVertexNormals();
    }

    geom.setIndex(new THREE.BufferAttribute(chunk.meshIndices, 1));
    geom.computeBoundingBox();
    geom.computeBoundingSphere();

    return geom;
  }, [
      chunk.meshPositions, chunk.meshIndices, chunk.meshMaterials,
      chunk.meshMaterials2, chunk.meshMaterials3, chunk.meshWeights,
      chunk.meshNormals, chunk.meshWetness, chunk.meshMossiness,
      chunk.visualVersion
  ]);

  const waterGeometry = useMemo(() => {
    if (!chunk.meshWaterPositions?.length || !chunk.meshWaterIndices?.length) return null;

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(chunk.meshWaterPositions, 3));
    if (chunk.meshWaterNormals?.length > 0) {
      geom.setAttribute('normal', new THREE.BufferAttribute(chunk.meshWaterNormals, 3));
    } else {
      geom.computeVertexNormals();
    }
    geom.setIndex(new THREE.BufferAttribute(chunk.meshWaterIndices, 1));
    return geom;
  }, [chunk.meshWaterPositions, chunk.meshWaterIndices, chunk.meshWaterNormals, chunk.visualVersion]);

  if (!terrainGeometry && !waterGeometry) return null;

  // Physics key: Only updates when terrain geometry changes (mining/building)
  const colliderKey = `${chunk.key}-${chunk.terrainVersion}`;

  return (
    <group position={[chunk.cx * CHUNK_SIZE_XZ, 0, chunk.cz * CHUNK_SIZE_XZ]}>
      {terrainGeometry && (
        <RigidBody
          key={colliderKey}
          type="fixed"
          colliders="trimesh"
          userData={{ type: 'terrain', key: chunk.key }}
        >
          <mesh
            ref={meshRef}
            scale={[VOXEL_SCALE, VOXEL_SCALE, VOXEL_SCALE]}
            castShadow
            receiveShadow
            frustumCulled
            geometry={terrainGeometry}
          >
            {debugMode ? (
              <meshNormalMaterial fog={true} />
            ) : (
              <TriplanarMaterial sunDirection={sunDirection} opacity={opacity} />
            )}
          </mesh>
        </RigidBody>
      )}

      {waterGeometry && (
        <mesh geometry={waterGeometry} scale={[VOXEL_SCALE, VOXEL_SCALE, VOXEL_SCALE]}>
          <WaterMaterial sunDirection={sunDirection} fade={opacity} />
        </mesh>
      )}

      {chunk.floraPositions && chunk.floraPositions.length > 0 && (
          <FloraMesh
              positions={chunk.floraPositions}
              chunkKey={chunk.key}
              onHarvest={(index) => {
                  addFlora();
                  // Note: Logic to permanently remove from chunk data would go here
              }}
          />
      )}
    </group>
  );
});