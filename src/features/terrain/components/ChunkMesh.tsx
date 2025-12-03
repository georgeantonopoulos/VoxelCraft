import React, { useRef, useState, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { RigidBody } from '@react-three/rapier';
// Import BVH tools
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { TriplanarMaterial } from '@core/graphics/TriplanarMaterial';
import { WaterMaterial } from '@features/terrain/materials/WaterMaterial';
import { VOXEL_SCALE, CHUNK_SIZE_XZ } from '@/constants';
import { ChunkState } from '@/types';
import { VegetationLayer } from './VegetationLayer';
import { TreeLayer } from './TreeLayer';
import { LuminaLayer } from './LuminaLayer';

// 1. Enable BVH on Geometry Prototype ONCE (Safe to call multiple times)
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export const ChunkMesh: React.FC<{ chunk: ChunkState; sunDirection?: THREE.Vector3 }> = React.memo(({ chunk, sunDirection }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const [opacity, setOpacity] = useState(0);

  useFrame((_, delta) => {
    if (opacity < 1) setOpacity(prev => Math.min(prev + delta * 2, 1));
  });

  const terrainGeometry = useMemo(() => {
    // Safety check for data existence
    if (!chunk.meshPositions?.length || !chunk.meshIndices?.length) return null;
    
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(chunk.meshPositions, 3));
    
    // 2. CRITICAL FIX: Bind the NEW Optimized Attributes (Indices + Weights)
    // NOTE: Ensure your mesher.worker is sending 'meshMatIndices' and 'meshMatWeights'
    // If your worker sends different names, update these keys.
    if (chunk.meshMatIndices && chunk.meshMatWeights) {
        // Use float attribute to match shader (vec4)
        const indicesAttr = new THREE.BufferAttribute(
          new Float32Array(chunk.meshMatIndices), // Convert once per geometry
          4
        );
        geom.setAttribute('aMaterialIndices', indicesAttr);
        
        // Weights are floats
        geom.setAttribute('aMaterialWeights', new THREE.BufferAttribute(chunk.meshMatWeights, 4));
    } else {
        // Fallback or Log Error if data is missing (prevents invisible mesh silent fail)
        console.warn(`Chunk ${chunk.key} missing optimized material attributes!`);
    }

    // Bind Metadata (Wetness/Moss)
    if (chunk.meshWetness) geom.setAttribute('aVoxelWetness', new THREE.BufferAttribute(chunk.meshWetness, 1));
    if (chunk.meshMossiness) geom.setAttribute('aVoxelMossiness', new THREE.BufferAttribute(chunk.meshMossiness, 1));

    if (chunk.meshNormals?.length > 0) geom.setAttribute('normal', new THREE.BufferAttribute(chunk.meshNormals, 3));
    else geom.computeVertexNormals();

    geom.setIndex(new THREE.BufferAttribute(chunk.meshIndices, 1));
    
    // 3. BVH & Bounds Generation (Fixes Visibility & Raycasting)
    geom.computeBoundingBox();
    geom.computeBoundingSphere();
    
    // Dispose old BVH if exists (Memory Safety)
    if (geom.boundsTree) geom.disposeBoundsTree();
    // Compute new BVH (Fixes 'E' key raycast failing)
    geom.computeBoundsTree();

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
        // Note: 'trimesh' is heavy. If lag persists, consider 'heightfield' for terrain if possible.
        <RigidBody key={colliderKey} type="fixed" colliders="trimesh" userData={{ type: 'terrain', key: chunk.key }}>
          <mesh 
            ref={meshRef} 
            scale={[VOXEL_SCALE, VOXEL_SCALE, VOXEL_SCALE]} 
            castShadow 
            receiveShadow 
            frustumCulled 
            geometry={terrainGeometry}
          >
            {/* Pass the optimized texture array uniforms via the material */}
            <TriplanarMaterial sunDirection={sunDirection} opacity={opacity} />
          </mesh>
        </RigidBody>
      )}
      
      {waterGeometry && (
         <mesh geometry={waterGeometry} scale={[VOXEL_SCALE, VOXEL_SCALE, VOXEL_SCALE]}>
            <WaterMaterial sunDirection={sunDirection} fade={opacity} />
         </mesh>
      )}

      {/* Layers */}
      {chunk.vegetationData && <VegetationLayer data={chunk.vegetationData} />}
      {chunk.treePositions?.length > 0 && <TreeLayer data={chunk.treePositions} />}
      {chunk.floraPositions?.length > 0 && <LuminaLayer data={chunk.floraPositions} />}
    </group>
  );
});
