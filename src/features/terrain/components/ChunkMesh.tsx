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
import { BladeGrassLayer } from './BladeGrassLayer';
import { TreeLayer } from './TreeLayer';
import { LuminaLayer } from './LuminaLayer';
import { GroundItemsLayer } from './GroundItemsLayer';

// Profiling flag - enable via ?profile URL param or console: window.__vcChunkProfile = true
const shouldProfile = () => typeof window !== 'undefined' && (
  (window as any).__vcChunkProfile ||
  new URLSearchParams(window.location.search).has('profile')
);

// Debug flag to completely disable terrain colliders - use ?nocolliders URL param
const collidersDisabled = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('nocolliders');

// Wrapper component to profile Rapier collider creation
const ProfiledRigidBody: React.FC<{
  colliderKey: string;
  chunkKey: string;
  useHeightfield: boolean;
  colliderHeightfield?: Float32Array;
  colliderPositions?: Float32Array;
  colliderIndices?: Uint32Array;
}> = React.memo(({ colliderKey, chunkKey, useHeightfield, colliderHeightfield, colliderPositions, colliderIndices }) => {

  // Log creation timing (only in profile mode)
  const mountStart = useRef(performance.now());
  useEffect(() => {
    if (!shouldProfile()) return;
    const duration = performance.now() - mountStart.current;
    if (duration > 15) {
      console.warn(`[ChunkMesh] Collider mount took ${duration.toFixed(1)}ms for ${chunkKey} (${useHeightfield ? 'heightfield' : 'trimesh'})`);
    }
  }, [chunkKey, useHeightfield]);

  return (
    <RigidBody
      key={colliderKey}
      type="fixed"
      colliders={false}
      userData={{ type: 'terrain', key: chunkKey }}
    >
      {useHeightfield ? (
        colliderHeightfield ? (
          <HeightfieldCollider
            args={[
              CHUNK_SIZE_XZ + 1,
              CHUNK_SIZE_XZ + 1,
              colliderHeightfield as any,
              { x: CHUNK_SIZE_XZ, y: 1, z: CHUNK_SIZE_XZ }
            ]}
            position={[CHUNK_SIZE_XZ * 0.5, 0, CHUNK_SIZE_XZ * 0.5]}
          />
        ) : null
      ) : (
        colliderPositions && colliderIndices && (
          <TrimeshCollider args={[colliderPositions, colliderIndices]} />
        )
      )}
    </RigidBody>
  );
});

/**
 * ChunkMesh props - simplified after sharedUniforms refactor.
 *
 * Most terrain material settings (fog, wetness, moss, triplanar detail, etc.) are now
 * controlled via sharedUniforms in SharedUniforms.ts, updated once per frame by VoxelTerrain.
 * This eliminates prop drilling for ~15 uniform-related settings.
 *
 * Remaining props are either:
 * - Chunk-specific data (chunk, terrainVersion, lodLevel)
 * - Material properties that can't be uniforms (wireframe, polygonOffset, threeFog)
 * - Debug modes (chunkTint)
 */
export interface ChunkMeshProps {
  chunk: ChunkState;
  terrainVersion: number; // Passed as primitive to bypass object reference mutation issues
  lodLevel?: number;
  // Material properties (not uniforms - must be passed to TriplanarMaterial)
  terrainThreeFogEnabled?: boolean;
  terrainPolygonOffsetEnabled?: boolean;
  terrainPolygonOffsetFactor?: number;
  terrainPolygonOffsetUnits?: number;
  terrainWireframeEnabled?: boolean;
  // Debug modes
  terrainChunkTintEnabled?: boolean;
}

export const ChunkMesh: React.FC<ChunkMeshProps> = React.memo(({
  chunk,
  terrainVersion,
  lodLevel = 0,
  // Material properties (passed to TriplanarMaterial)
  terrainThreeFogEnabled = true,
  terrainPolygonOffsetEnabled = false,
  terrainPolygonOffsetFactor = -1.0,
  terrainPolygonOffsetUnits = -1.0,
  terrainWireframeEnabled = false,
  // Debug modes
  terrainChunkTintEnabled = false,
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

  // Track if this is an update (for debug logging)
  const prevVersion = useRef(chunk.terrainVersion);
  prevVersion.current = chunk.terrainVersion;

  const terrainGeometry = useMemo(() => {
    if (!chunk.meshPositions?.length || !chunk.meshIndices?.length) return null;
    const start = performance.now();

    // DEBUG: Log when geometry is recreated due to terrain modification
    // if (chunk.terrainVersion && chunk.terrainVersion > 1) {
    //   console.log(`[ChunkMesh] Recreating geometry for ${chunk.key}: ${chunk.meshPositions.length / 3} verts, ver=${chunk.terrainVersion}`);
    // }

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
    ensureAttribute(chunk.meshLightColors, 'aLightColor', 3);  // Per-vertex GI light
    ensureAttribute(chunk.meshBaseHumidity, 'aBaseHumidity', 1);  // Per-vertex base humidity
    ensureAttribute(chunk.meshTreeHumidityBoost, 'aTreeHumidityBoost', 1);  // Per-vertex tree boost

    geom.setIndex(new THREE.BufferAttribute(chunk.meshIndices, 1));
    geom.computeBoundingSphere();

    if (geom.boundingSphere) {
      // Center at middle of chunk volume: XZ center is 16, Y center is (MESH_Y_OFFSET + CHUNK_SIZE_Y/2)
      // With MESH_Y_OFFSET=-35 and CHUNK_SIZE_Y=128: Y center = -35 + 64 = 29
      // Radius must reach from center (16, 29, 16) to farthest corner (0, 93, 0) or (0, -35, 0)
      // Distance to (0, 93, 0): √(16² + 64² + 16²) ≈ 68, so use 70 with margin
      geom.boundingSphere.center.set(16, 29, 16);
      geom.boundingSphere.radius = 70;
    }

    const duration = performance.now() - start;
    if (duration > 10) {
      console.warn(`[ChunkMesh] Geometry creation took ${duration.toFixed(1)}ms for ${chunk.key}`);
    }

    return geom;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chunk, chunk.visualVersion, terrainVersion]);

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
  const colliderEnabled = !collidersDisabled && lodLevel <= LOD_DISTANCE_PHYSICS && (chunk.colliderEnabled ?? true);

  useEffect(() => {
    if (colliderEnabled) {
      // Initial load chunks (spawnedAt === 0) need immediate colliders so player doesn't fall through
      const isInitialLoadChunk = chunk.spawnedAt === 0;
      if (isInitialLoadChunk) {
        setDeferredColliderEnabled(true);
        return;
      }
      // LOD 0 chunks (player is standing in them) need colliders ASAP to prevent falling through
      // LOD 1 chunks can have a small delay since player isn't there yet
      if (lodLevel === 0) {
        // Player chunk - enable immediately
        setDeferredColliderEnabled(true);
        return;
      }
      // Adjacent chunks: short delay to stagger BVH construction but not so long player falls through
      const baseDelay = 100 + lodLevel * 100;
      const jitter = Math.random() * 100;
      const handle = setTimeout(() => setDeferredColliderEnabled(true), baseDelay + jitter);
      return () => clearTimeout(handle);
    } else {
      setDeferredColliderEnabled(false);
    }
  }, [colliderEnabled, lodLevel, chunk.spawnedAt]);

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
        <ProfiledRigidBody
          colliderKey={colliderKey}
          chunkKey={chunk.key}
          useHeightfield={useHeightfield}
          colliderHeightfield={chunk.colliderHeightfield}
          colliderPositions={chunk.colliderPositions}
          colliderIndices={chunk.colliderIndices}
        />
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
              threeFogEnabled={terrainThreeFogEnabled}
              polygonOffsetEnabled={terrainPolygonOffsetEnabled}
              polygonOffsetFactor={terrainPolygonOffsetFactor}
              polygonOffsetUnits={terrainPolygonOffsetUnits}
              wireframe={terrainWireframeEnabled}
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
            shoreEdge={0.07}
            alphaBase={0.58}
            texStrength={0.12}
            foamStrength={0.22}
          />
        </mesh>
      )}

      {showLayers && (
        <>
          {/* Blade grass layer - high quality single draw call grass */}
          {lodLevel <= LOD_DISTANCE_VEGETATION_ANY && chunk.grassHeightTex && (
            <BladeGrassLayer
              heightTex={chunk.grassHeightTex}
              materialTex={chunk.grassMaterialTex!}
              normalTex={chunk.grassNormalTex!}
              biomeTex={chunk.grassBiomeTex!}
              caveTex={chunk.grassCaveTex!}
              lightGrid={chunk.lightGrid}
              chunkX={chunk.cx}
              chunkZ={chunk.cz}
              lodLevel={lodLevel}
            />
          )}

          {/* Legacy vegetation layer - fallback if procedural textures not available */}
          {lodLevel <= LOD_DISTANCE_VEGETATION_ANY && !chunk.grassHeightTex && chunk.vegetationData && (
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
}, (prevProps, nextProps) => {
  // Custom comparison for React.memo
  // Must return true if props are EQUAL (skip re-render), false if DIFFERENT (re-render)

  // Always re-render if terrain version changed (terrain modification)
  // CRITICAL: Compare the PRIMITIVE terrainVersion prop, not chunk.terrainVersion!
  // When chunk objects are mutated in-place, prevProps.chunk and nextProps.chunk
  // point to the same memory location, so chunk.terrainVersion would compare equal.
  // The primitive prop captures the value at render time, avoiding this issue.
  if (prevProps.terrainVersion !== nextProps.terrainVersion) return false;
  if (prevProps.chunk.visualVersion !== nextProps.chunk.visualVersion) return false;

  // Check other important props
  if (prevProps.lodLevel !== nextProps.lodLevel) return false;
  if (prevProps.chunk.key !== nextProps.chunk.key) return false;

  // Material property changes (these are the only remaining props that affect rendering)
  return prevProps.terrainWireframeEnabled === nextProps.terrainWireframeEnabled &&
    prevProps.terrainChunkTintEnabled === nextProps.terrainChunkTintEnabled &&
    prevProps.terrainThreeFogEnabled === nextProps.terrainThreeFogEnabled &&
    prevProps.terrainPolygonOffsetEnabled === nextProps.terrainPolygonOffsetEnabled;
});
