import React, { useRef, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { RigidBody } from '@react-three/rapier';
import { TriplanarMaterial } from '@core/graphics/TriplanarMaterial';
import { WaterMaterial } from '@features/terrain/materials/WaterMaterial';
import { VOXEL_SCALE, CHUNK_SIZE_XZ, CHUNK_SIZE_Y, PAD, MESH_Y_OFFSET } from '@/constants';
import { ChunkState } from '@/types';
import { VegetationLayer } from './VegetationLayer';
import { TreeLayer } from './TreeLayer';
import { LuminaLayer } from './LuminaLayer';
import { GroundItemsLayer } from './GroundItemsLayer';



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
  // NOTE:
  // Chunk opacity fade was removed because the transparent render path can introduce
  // noticeable hitches (sorting + depthWrite toggling) while streaming in new terrain.
  // We now rely on fog + a shorter effective view distance to hide chunk generation.
  // `terrainFadeEnabled` remains as a debug flag, but is intentionally a no-op.
  // Debug rendering modes are split:
  // - `?debug` enables Leva/UI debug without changing materials.
  // - `?normals` swaps terrain to normal material for geometry inspection.
  const normalsMode = useMemo(() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return params.has('normals');
  }, []);
  useEffect(() => {
    void terrainFadeEnabled;
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
    ensureAttribute(chunk.meshCavity, 'aVoxelCavity', 1);
    if (chunk.meshNormals?.length > 0) geom.setAttribute('normal', new THREE.BufferAttribute(chunk.meshNormals, 3));
    else geom.computeVertexNormals();
    geom.setIndex(new THREE.BufferAttribute(chunk.meshIndices, 1));
    // Avoid per-chunk bounding volume scans on the main thread when streaming.
    // Use a conservative, constant local-space bound that covers chunk extents.
    const r = Math.sqrt(
      (CHUNK_SIZE_XZ + PAD * 2) ** 2 * 2 +
      (CHUNK_SIZE_Y + PAD * 2) ** 2
    ) * 0.5;
    geom.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(CHUNK_SIZE_XZ * 0.5 - PAD, MESH_Y_OFFSET + CHUNK_SIZE_Y * 0.5, CHUNK_SIZE_XZ * 0.5 - PAD),
      r
    );
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

  // The shoreline SDF mask is now pre-computed in the worker (mesher.ts) to avoid
  // running the expensive BFS on the main thread when chunks arrive.
  const waterShoreMask = useMemo(() => {
    const mask = chunk.meshWaterShoreMask;
    if (!mask || mask.length === 0) return null;

    const w = CHUNK_SIZE_XZ;
    const h = CHUNK_SIZE_XZ;
    const tex = new THREE.DataTexture(mask, w, h, THREE.RedFormat, THREE.UnsignedByteType);
    tex.needsUpdate = true;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  }, [chunk.meshWaterShoreMask, chunk.visualVersion]);

  const chunkTintColor = useMemo(() => {
    // Deterministic color per chunk to expose overlap/z-fighting (you'll see both colors).
    const h = ((chunk.cx * 73856093) ^ (chunk.cz * 19349663)) >>> 0;
    const hue = (h % 360) / 360;
    const c = new THREE.Color();
    c.setHSL(hue, 0.65, 0.55);
    return c;
  }, [chunk.cx, chunk.cz]);

  if (!terrainGeometry && !waterGeometry) return null;
  const colliderKey = `${chunk.key}-${chunk.terrainVersion}`;
  const colliderEnabled = chunk.colliderEnabled ?? true;

  return (
    <group position={[chunk.cx * CHUNK_SIZE_XZ, 0, chunk.cz * CHUNK_SIZE_XZ]}>
      {terrainGeometry && (colliderEnabled ? (
        <RigidBody key={colliderKey} type="fixed" colliders="trimesh" userData={{ type: 'terrain', key: chunk.key }}>
          <mesh
            ref={meshRef}
            // Tag the actual render mesh so non-physics raycasters (e.g. placement tools) can reliably detect terrain hits.
            userData={{ type: 'terrain', key: chunk.key }}
            scale={[VOXEL_SCALE, VOXEL_SCALE, VOXEL_SCALE]}
            castShadow
            receiveShadow
            frustumCulled
            geometry={terrainGeometry}
          >
            {normalsMode ? (
              <meshNormalMaterial />
            ) : terrainChunkTintEnabled ? (
              <meshBasicMaterial color={chunkTintColor} wireframe={terrainWireframeEnabled} />
            ) : (
              <TriplanarMaterial
                sunDirection={sunDirection}
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
      ) : (
        <mesh
          ref={meshRef}
          // Tag the actual render mesh so non-physics raycasters (e.g. placement tools) can reliably detect terrain hits.
          userData={{ type: 'terrain', key: chunk.key }}
          scale={[VOXEL_SCALE, VOXEL_SCALE, VOXEL_SCALE]}
          castShadow
          receiveShadow
          frustumCulled
          geometry={terrainGeometry}
        >
          {normalsMode ? (
            <meshNormalMaterial />
          ) : terrainChunkTintEnabled ? (
            <meshBasicMaterial color={chunkTintColor} wireframe={terrainWireframeEnabled} />
          ) : (
            <TriplanarMaterial
              sunDirection={sunDirection}
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
      ))}
      {waterGeometry && (
        <mesh geometry={waterGeometry} scale={[VOXEL_SCALE, VOXEL_SCALE, VOXEL_SCALE]}>
          <WaterMaterial
            sunDirection={sunDirection}
            shoreMask={waterShoreMask}
            shoreEdge={0.07}
            alphaBase={0.58}
            texStrength={0.12}
            foamStrength={0.22}
          />
        </mesh>
      )}

      {chunk.vegetationData && (
        <VegetationLayer data={chunk.vegetationData} sunDirection={sunDirection} />
      )}

      {chunk.treePositions && chunk.treePositions.length > 0 && (
        <TreeLayer data={chunk.treePositions} />
      )}

      {(chunk.stickPositions?.length || chunk.rockPositions?.length || chunk.largeRockPositions?.length) ? (
        <GroundItemsLayer
          stickData={chunk.stickPositions}
          rockData={chunk.rockPositions}
          largeRockData={chunk.largeRockPositions}
        />
      ) : null}

      {chunk.floraPositions && chunk.floraPositions.length > 0 && (
        <LuminaLayer data={chunk.floraPositions} lightPositions={chunk.lightPositions} cx={chunk.cx} cz={chunk.cz} />
      )}

      {/* REMOVED: RootHollow Loop - This was the cause of the duplication/offset bug */}
    </group>
  );
});
