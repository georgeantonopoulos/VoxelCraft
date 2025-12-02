import React, { useRef, useState, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { RigidBody } from '@react-three/rapier';
import { TriplanarMaterial } from '@core/graphics/TriplanarMaterial';
import { WaterMaterial } from '@features/terrain/materials/WaterMaterial';
import { useInventoryStore as useGameStore } from '@state/InventoryStore';
import { VOXEL_SCALE, CHUNK_SIZE_XZ } from '@/constants';
import { ChunkState } from '@/types';
import { VegetationLayer } from './VegetationLayer';
import { TreeLayer } from './TreeLayer';



export const ChunkMesh: React.FC<{ chunk: ChunkState; sunDirection?: THREE.Vector3 }> = React.memo(({ chunk, sunDirection }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const [opacity, setOpacity] = useState(0);
  const debugMode = useMemo(() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return params.has('debug');
  }, []);

  useFrame((_, delta) => {
    if (opacity < 1) setOpacity(prev => Math.min(prev + delta * 2, 1));
  });

  const terrainGeometry = useMemo(() => {
    if (!chunk.meshPositions?.length || !chunk.meshIndices?.length) return null;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(chunk.meshPositions, 3));
    const vertexCount = chunk.meshPositions.length / 3;
    const ensureAttribute = (data: Float32Array | undefined, name: string, itemSize: number) => {
      if (data && data.length === vertexCount * itemSize) geom.setAttribute(name, new THREE.BufferAttribute(data, itemSize));
      else geom.setAttribute(name, new THREE.BufferAttribute(new Float32Array(vertexCount * itemSize), itemSize));
    };
    ensureAttribute(chunk.meshMatWeightsA, 'aMatWeightsA', 4);
    ensureAttribute(chunk.meshMatWeightsB, 'aMatWeightsB', 4);
    ensureAttribute(chunk.meshMatWeightsC, 'aMatWeightsC', 4);
    ensureAttribute(chunk.meshMatWeightsD, 'aMatWeightsD', 4);
    ensureAttribute(chunk.meshWetness, 'aVoxelWetness', 1);
    ensureAttribute(chunk.meshMossiness, 'aVoxelMossiness', 1);
    if (chunk.meshNormals?.length > 0) geom.setAttribute('normal', new THREE.BufferAttribute(chunk.meshNormals, 3));
    else geom.computeVertexNormals();
    geom.setIndex(new THREE.BufferAttribute(chunk.meshIndices, 1));
    geom.computeBoundingBox();
    geom.computeBoundingSphere();
    return geom;
  }, [chunk.meshPositions, chunk.visualVersion]);

  const waterGeometry = useMemo(() => {
    if (!chunk.meshWaterPositions?.length || !chunk.meshWaterIndices?.length) return null;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(chunk.meshWaterPositions, 3));
    if (chunk.meshWaterNormals?.length > 0) geom.setAttribute('normal', new THREE.BufferAttribute(chunk.meshWaterNormals, 3));
    else geom.computeVertexNormals();
    geom.setIndex(new THREE.BufferAttribute(chunk.meshWaterIndices, 1));
    return geom;
  }, [chunk.meshWaterPositions, chunk.visualVersion]);

  if (!terrainGeometry && !waterGeometry) return null;
  const colliderKey = `${chunk.key}-${chunk.terrainVersion}`;

  return (
    <group position={[chunk.cx * CHUNK_SIZE_XZ, 0, chunk.cz * CHUNK_SIZE_XZ]}>
      {terrainGeometry && (
        <RigidBody key={colliderKey} type="fixed" colliders="trimesh" userData={{ type: 'terrain', key: chunk.key }}>
          <mesh ref={meshRef} scale={[VOXEL_SCALE, VOXEL_SCALE, VOXEL_SCALE]} castShadow receiveShadow frustumCulled geometry={terrainGeometry}>
            {debugMode ? <meshNormalMaterial /> : <TriplanarMaterial sunDirection={sunDirection} opacity={opacity} />}
          </mesh>
        </RigidBody>
      )}
      {waterGeometry && (
        <mesh geometry={waterGeometry} scale={[VOXEL_SCALE, VOXEL_SCALE, VOXEL_SCALE]}>
          <WaterMaterial sunDirection={sunDirection} fade={opacity} />
        </mesh>
      )}

      {chunk.vegetationData && (
        <VegetationLayer data={chunk.vegetationData} />
      )}

      {chunk.floraPositions && chunk.floraPositions.length > 0 && (
        <TreeLayer data={chunk.floraPositions} />
      )}

      {/* REMOVED: RootHollow Loop - This was the cause of the duplication/offset bug */}
    </group>
  );
});

