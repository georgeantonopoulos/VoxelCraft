import React, { useRef, useState, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { RigidBody } from '@react-three/rapier';
import { TriplanarMaterial } from '@core/graphics/TriplanarMaterial';
import { WaterMaterial } from '@features/terrain/materials/WaterMaterial';
import { VOXEL_SCALE, CHUNK_SIZE_XZ } from '@/constants';
import { ChunkState } from '@/types';
import { VegetationLayer } from './VegetationLayer';
import { TreeLayer } from './TreeLayer';
import { LuminaLayer } from './LuminaLayer';



export const ChunkMesh: React.FC<{
  chunk: ChunkState;
  sunDirection?: THREE.Vector3;
  triplanarDetail?: number;
  terrainShaderFogEnabled?: boolean;
  terrainShaderFogStrength?: number;
  terrainThreeFogEnabled?: boolean;
  terrainFadeEnabled?: boolean;
  terrainWetnessEnabled?: boolean;
  terrainMossEnabled?: boolean;
  terrainRoughnessMin?: number;
  terrainPolygonOffsetEnabled?: boolean;
  terrainPolygonOffsetFactor?: number;
  terrainPolygonOffsetUnits?: number;
  terrainChunkTintEnabled?: boolean;
  terrainWireframeEnabled?: boolean;
  terrainWeightsView?: string;
}> = React.memo(({
  chunk,
  sunDirection,
  triplanarDetail = 1.0,
  terrainShaderFogEnabled = true,
  terrainShaderFogStrength = 0.9,
  terrainThreeFogEnabled = true,
  terrainFadeEnabled = true,
  terrainWetnessEnabled = true,
  terrainMossEnabled = true,
  terrainRoughnessMin = 0.0,
  terrainPolygonOffsetEnabled = false,
  terrainPolygonOffsetFactor = -1.0,
  terrainPolygonOffsetUnits = -1.0,
  terrainChunkTintEnabled = false,
  terrainWireframeEnabled = false,
  terrainWeightsView = 'off'
}) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const [opacity, setOpacity] = useState(0);
  // Debug rendering modes are split:
  // - `?debug` enables Leva/UI debug without changing materials.
  // - `?normals` swaps terrain to normal material for geometry inspection.
  const normalsMode = useMemo(() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return params.has('normals');
  }, []);

  useFrame((_, delta) => {
    // Chunk fade-in can produce seam-like hard edges due to transparency sorting/depthWrite toggling.
    // Allow disabling in debug to confirm whether artifacts come from this path.
    if (!terrainFadeEnabled) return;
    if (opacity < 1) setOpacity(prev => Math.min(prev + delta * 2, 1));
  });

  // If fade is disabled, force fully-opaque terrain.
  useEffect(() => {
    if (!terrainFadeEnabled) setOpacity(1);
  }, [terrainFadeEnabled]);

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
  const chunkTintColor = useMemo(() => {
    // Deterministic color per chunk to expose overlap/z-fighting (you'll see both colors).
    const h = ((chunk.cx * 73856093) ^ (chunk.cz * 19349663)) >>> 0;
    const hue = (h % 360) / 360;
    const c = new THREE.Color();
    c.setHSL(hue, 0.65, 0.55);
    return c;
  }, [chunk.cx, chunk.cz]);

  return (
    <group position={[chunk.cx * CHUNK_SIZE_XZ, 0, chunk.cz * CHUNK_SIZE_XZ]}>
      {terrainGeometry && (
        <RigidBody key={colliderKey} type="fixed" colliders="trimesh" userData={{ type: 'terrain', key: chunk.key }}>
          <mesh ref={meshRef} scale={[VOXEL_SCALE, VOXEL_SCALE, VOXEL_SCALE]} castShadow receiveShadow frustumCulled geometry={terrainGeometry}>
            {normalsMode ? (
              <meshNormalMaterial />
            ) : terrainChunkTintEnabled ? (
              <meshBasicMaterial color={chunkTintColor} wireframe={terrainWireframeEnabled} />
            ) : (
              <TriplanarMaterial
                sunDirection={sunDirection}
                opacity={terrainFadeEnabled ? opacity : 1.0}
                triplanarDetail={triplanarDetail}
                shaderFogEnabled={terrainShaderFogEnabled}
                shaderFogStrength={terrainShaderFogStrength}
                threeFogEnabled={terrainThreeFogEnabled}
                wetnessEnabled={terrainWetnessEnabled}
                mossEnabled={terrainMossEnabled}
                roughnessMin={terrainRoughnessMin}
                polygonOffsetEnabled={terrainPolygonOffsetEnabled}
                polygonOffsetFactor={terrainPolygonOffsetFactor}
                polygonOffsetUnits={terrainPolygonOffsetUnits}
                weightsView={terrainWeightsView}
                wireframe={terrainWireframeEnabled}
              />
            )}
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

      {chunk.treePositions && chunk.treePositions.length > 0 && (
        <TreeLayer data={chunk.treePositions} />
      )}

      {chunk.floraPositions && chunk.floraPositions.length > 0 && (
        <LuminaLayer data={chunk.floraPositions} lightPositions={chunk.lightPositions} cx={chunk.cx} cz={chunk.cz} />
      )}

      {/* REMOVED: RootHollow Loop - This was the cause of the duplication/offset bug */}
    </group>
  );
});
