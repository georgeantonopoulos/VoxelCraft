import React, { useRef, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { RigidBody, HeightfieldCollider, TrimeshCollider } from '@react-three/rapier';
import { TriplanarMaterial } from '@core/graphics/TriplanarMaterial';
import { WaterMaterial } from '@features/terrain/materials/WaterMaterial';
import {
  VOXEL_SCALE, CHUNK_SIZE_XZ,
  LOD_DISTANCE_VEGETATION_ANY, LOD_DISTANCE_PHYSICS, LOD_DISTANCE_TREES_ANY
} from '@/constants';
import { ChunkState } from '@/types';
import { VegetationLayer } from './VegetationLayer';
import { TreeLayer } from './TreeLayer';
import { LuminaLayer } from './LuminaLayer';
import { GroundItemsLayer } from './GroundItemsLayer';

export interface ChunkMeshProps {
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
  lodLevel?: number;
  heightFogEnabled?: boolean;
  heightFogStrength?: number;
  heightFogRange?: number;
  heightFogOffset?: number;
  fogNear?: number;
  fogFar?: number;
}

export const ChunkMesh: React.FC<ChunkMeshProps> = React.memo(({
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
  terrainWeightsView = 'off',
  lodLevel = 0,
  heightFogEnabled = true,
  heightFogStrength = 0.35,
  heightFogRange = 50.0,
  heightFogOffset = 4.0,
  fogNear = 40,
  fogFar = 220
}) => {
  const meshRef = useRef<THREE.Mesh>(null);

  const normalsMode = useMemo(() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return params.has('normals');
  }, []);

  const [showLayers, setShowLayers] = React.useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setShowLayers(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  // Suppress unused warnings for debug-only props
  useEffect(() => {
    void terrainFadeEnabled;
  }, [terrainFadeEnabled]);

  const terrainGeometry = useMemo(() => {
    if (!chunk.meshPositions?.length || !chunk.meshIndices?.length) return null;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(chunk.meshPositions, 3));

    if (chunk.meshNormals) geom.setAttribute('normal', new THREE.BufferAttribute(chunk.meshNormals, 3));

    const ensureAttribute = (data: Float32Array | undefined, name: string, itemSize: number) => {
      if (data && data.length > 0) {
        geom.setAttribute(name, new THREE.BufferAttribute(data, itemSize));
      }
    };

    ensureAttribute(chunk.meshMatWeightsA, 'aMatWeightsA', 4);
    ensureAttribute(chunk.meshMatWeightsB, 'aMatWeightsB', 4);
    ensureAttribute(chunk.meshMatWeightsC, 'aMatWeightsC', 4);
    ensureAttribute(chunk.meshMatWeightsD, 'aMatWeightsD', 4);
    ensureAttribute(chunk.meshWetness, 'aVoxelWetness', 1);
    ensureAttribute(chunk.meshMossiness, 'aVoxelMossiness', 1);
    ensureAttribute(chunk.meshCavity, 'aVoxelCavity', 1);

    geom.setIndex(new THREE.BufferAttribute(chunk.meshIndices, 1));
    geom.computeBoundingSphere();

    if (geom.boundingSphere) {
      geom.boundingSphere.center.set(16, 0, 16);
      geom.boundingSphere.radius = 45;
    }

    return geom;
  }, [chunk]);

  const waterGeometry = useMemo(() => {
    if (!chunk.meshWaterPositions?.length || !chunk.meshWaterIndices?.length) return null;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(chunk.meshWaterPositions, 3));
    geom.setIndex(new THREE.BufferAttribute(chunk.meshWaterIndices, 1));
    geom.computeVertexNormals();

    // Set an infinitely large bounding sphere to completely bypass frustum culling
    // The mesh also has frustumCulled={false}, but this is a belt-and-suspenders approach
    geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(16, 4.5, 16), Infinity);

    return geom;
  }, [chunk.meshWaterPositions, chunk.meshWaterIndices]);

  const chunkTintColor = useMemo(() => {
    const c = new THREE.Color();
    const hash = (chunk.cx * 391 + chunk.cz * 727) % 360;
    const hue = hash / 360;
    c.setHSL(hue, 0.65, 0.55);
    return c;
  }, [chunk.cx, chunk.cz]);

  const waterShoreMaskTexture = useMemo(() => {
    if (!chunk.meshWaterShoreMask || chunk.meshWaterShoreMask.length === 0) return null;
    const tex = new THREE.DataTexture(
      chunk.meshWaterShoreMask,
      CHUNK_SIZE_XZ,
      CHUNK_SIZE_XZ,
      THREE.RedFormat,
      THREE.UnsignedByteType
    );
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }, [chunk.meshWaterShoreMask]);

  const [deferredColliderEnabled, setDeferredColliderEnabled] = React.useState(false);
  const colliderEnabled = lodLevel <= LOD_DISTANCE_PHYSICS && (chunk.colliderEnabled ?? true);

  useEffect(() => {
    if (colliderEnabled) {
      if (lodLevel === 0) {
        setDeferredColliderEnabled(true);
      } else {
        // Defer distant colliders to avoid hitching during LOD transitions
        if ((window as any).requestIdleCallback) {
          const handle = (window as any).requestIdleCallback(() => setDeferredColliderEnabled(true), { timeout: 200 });
          return () => (window as any).cancelIdleCallback(handle);
        } else {
          const handle = setTimeout(() => setDeferredColliderEnabled(true), 1);
          return () => clearTimeout(handle);
        }
      }
    } else {
      setDeferredColliderEnabled(false);
    }
  }, [colliderEnabled, lodLevel]);

  useEffect(() => {
    return () => {
      terrainGeometry?.dispose();
      waterGeometry?.dispose();
      waterShoreMaskTexture?.dispose();
    };
  }, [terrainGeometry, waterGeometry, waterShoreMaskTexture]);

  if (!terrainGeometry && !waterGeometry) return null;
  const colliderKey = `${chunk.key}-${chunk.terrainVersion}`;
  const useHeightfield = chunk.isHeightfield && chunk.colliderHeightfield && chunk.colliderHeightfield.length > 0;

  return (
    <group position={[chunk.cx * CHUNK_SIZE_XZ, 0, chunk.cz * CHUNK_SIZE_XZ]} frustumCulled={false}>
      {deferredColliderEnabled && (
        <RigidBody
          key={colliderKey}
          type="fixed"
          colliders={false}
          userData={{ type: 'terrain', key: chunk.key }}
        >
          {useHeightfield ? (
            chunk.colliderHeightfield ? (
              <HeightfieldCollider
                args={[
                  CHUNK_SIZE_XZ + 1,
                  CHUNK_SIZE_XZ + 1,
                  chunk.colliderHeightfield as any,
                  { x: CHUNK_SIZE_XZ, y: 1, z: CHUNK_SIZE_XZ }
                ]}
                position={[CHUNK_SIZE_XZ * 0.5, 0, CHUNK_SIZE_XZ * 0.5]}
              />
            ) : null
          ) : (
            chunk.colliderPositions && chunk.colliderIndices && (
              <TrimeshCollider args={[chunk.colliderPositions, chunk.colliderIndices]} />
            )
          )}
        </RigidBody>
      )}

      {terrainGeometry && (
        <mesh
          ref={meshRef}
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
              heightFogEnabled={heightFogEnabled}
              heightFogStrength={heightFogStrength}
              heightFogRange={heightFogRange}
              heightFogOffset={heightFogOffset}
              fogNear={fogNear}
              fogFar={fogFar}
            />
          )}
        </mesh>
      )}

      {waterGeometry && (
        <mesh
          geometry={waterGeometry}
          scale={[VOXEL_SCALE, VOXEL_SCALE, VOXEL_SCALE]}
          userData={{ shoreMask: waterShoreMaskTexture }}
          frustumCulled={false}
          renderOrder={1}
        >
          <WaterMaterial
            sunDirection={sunDirection}
            shoreEdge={0.07}
            alphaBase={0.58}
            texStrength={0.12}
            foamStrength={0.22}
          />
        </mesh>
      )}

      {showLayers && (
        <>
          {lodLevel <= LOD_DISTANCE_VEGETATION_ANY && chunk.vegetationData && (
            <VegetationLayer
              data={chunk.vegetationData}
              lodLevel={lodLevel}
            />
          )}

          {lodLevel <= LOD_DISTANCE_TREES_ANY && chunk.treePositions && chunk.treePositions.length > 0 && (
            <TreeLayer
              data={chunk.treePositions}
              treeInstanceBatches={chunk.treeInstanceBatches}
              collidersEnabled={colliderEnabled}
              chunkKey={chunk.key}
              simplified={lodLevel > 1}
              lodLevel={lodLevel}
            />
          )}

          {lodLevel <= LOD_DISTANCE_VEGETATION_ANY && (chunk.drySticks?.length || chunk.jungleSticks?.length || chunk.rockDataBuckets || chunk.largeRockPositions?.length) ? (
            <GroundItemsLayer
              drySticks={chunk.drySticks}
              jungleSticks={chunk.jungleSticks}
              rockDataBuckets={chunk.rockDataBuckets}
              largeRockData={chunk.largeRockPositions}
              collidersEnabled={colliderEnabled}
            />
          ) : null}

          {chunk.floraPositions && chunk.floraPositions.length > 0 && (
            <LuminaLayer
              data={chunk.floraPositions}
              lightPositions={chunk.lightPositions}
              cx={chunk.cx}
              cz={chunk.cz}
              collidersEnabled={colliderEnabled}
              simplified={lodLevel > 1}
            />
          )}
        </>
      )}
    </group>
  );
});
