import React, { useRef, useState, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { RigidBody } from '@react-three/rapier';
import { TriplanarMaterial } from '@core/graphics/TriplanarMaterial';
import { WaterMaterial } from '@features/terrain/materials/WaterMaterial';
import { VOXEL_SCALE, CHUNK_SIZE_XZ, PAD, TOTAL_SIZE_XZ, TOTAL_SIZE_Y, MESH_Y_OFFSET, ISO_LEVEL, WATER_LEVEL } from '@/constants';
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
    // Smoother reveal (slower than the old 0.5s snap) to hide far-chunk pop-in.
    if (opacity < 1) setOpacity(prev => Math.min(prev + delta * 0.8, 1));
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
    ensureAttribute(chunk.meshCavity, 'aVoxelCavity', 1);
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

  const waterShoreMask = useMemo(() => {
    if (!chunk.material?.length || !chunk.density?.length) return null;

    // Shore mask encodes signed distance to shoreline in [0..1], where 0.5 is the boundary.
    // We compute it on the CPU once per chunk update and sample it in the water shader to avoid blocky edges.
    const w = CHUNK_SIZE_XZ;
    const h = CHUNK_SIZE_XZ;
    const mask = new Uint8Array(w * h);

    const sizeX = TOTAL_SIZE_XZ;
    const sizeY = TOTAL_SIZE_Y;
    const sizeZ = TOTAL_SIZE_XZ;

    const seaGridYRaw = Math.floor(WATER_LEVEL - MESH_Y_OFFSET) + PAD;
    const seaGridY = Math.max(0, Math.min(sizeY - 2, seaGridYRaw));

    const idx3 = (x: number, y: number, z: number) => x + y * sizeX + z * sizeX * sizeY;
    const isLiquidCell = (x: number, y: number, z: number) => {
      if (x < 0 || y < 0 || z < 0 || x >= sizeX || y >= sizeY || z >= sizeZ) return false;
      const mat = chunk.material[idx3(x, y, z)];
      // WATER or ICE (match MaterialType enum values without importing to keep ChunkMesh light).
      if (mat !== 8 && mat !== 13) return false;
      return chunk.density[idx3(x, y, z)] <= ISO_LEVEL;
    };

    // Binary water-present mask at sea level (same rule as water mesher).
    const waterBin = new Uint8Array(w * h);
    let any = false;
    for (let z = 0; z < h; z++) {
      const gz = PAD + z;
      for (let x = 0; x < w; x++) {
        const gx = PAD + x;
        const hasLiquid = isLiquidCell(gx, seaGridY, gz);
        const hasLiquidAbove = isLiquidCell(gx, seaGridY + 1, gz);
        const v = hasLiquid && !hasLiquidAbove ? 1 : 0;
        waterBin[x + z * w] = v;
        if (v) any = true;
      }
    }
    if (!any) return null;

    // Identify boundary water/land cells (4-neighborhood).
    const INF = 0x3fff;
    const insideDist = new Int16Array(w * h);
    const outsideDist = new Int16Array(w * h);
    insideDist.fill(INF);
    outsideDist.fill(INF);

    const qx: number[] = [];
    const qz: number[] = [];
    let qh = 0;
    const push = (x: number, z: number) => { qx.push(x); qz.push(z); };

    const isWater = (x: number, z: number) => waterBin[x + z * w] === 1;
    const hasDiffNeighbor = (x: number, z: number) => {
      const v = isWater(x, z);
      if (x > 0 && isWater(x - 1, z) !== v) return true;
      if (x < w - 1 && isWater(x + 1, z) !== v) return true;
      if (z > 0 && isWater(x, z - 1) !== v) return true;
      if (z < h - 1 && isWater(x, z + 1) !== v) return true;
      return false;
    };

    // Seed boundary queues: distance 0 at shoreline on each side.
    for (let z = 0; z < h; z++) {
      for (let x = 0; x < w; x++) {
        if (!hasDiffNeighbor(x, z)) continue;
        if (isWater(x, z)) {
          insideDist[x + z * w] = 0;
          push(x, z);
        }
      }
    }

    // BFS inside water
    while (qh < qx.length) {
      const x = qx[qh];
      const z = qz[qh];
      qh++;
      const d = insideDist[x + z * w];
      const nd = d + 1;
      const step = (nx: number, nz: number) => {
        if (nx < 0 || nz < 0 || nx >= w || nz >= h) return;
        if (!isWater(nx, nz)) return;
        const i = nx + nz * w;
        if (insideDist[i] <= nd) return;
        insideDist[i] = nd;
        push(nx, nz);
      };
      step(x - 1, z);
      step(x + 1, z);
      step(x, z - 1);
      step(x, z + 1);
    }

    // Reset queue for outside
    qx.length = 0; qz.length = 0; qh = 0;
    for (let z = 0; z < h; z++) {
      for (let x = 0; x < w; x++) {
        if (!hasDiffNeighbor(x, z)) continue;
        if (!isWater(x, z)) {
          outsideDist[x + z * w] = 0;
          push(x, z);
        }
      }
    }

    // BFS outside water (land)
    while (qh < qx.length) {
      const x = qx[qh];
      const z = qz[qh];
      qh++;
      const d = outsideDist[x + z * w];
      const nd = d + 1;
      const step = (nx: number, nz: number) => {
        if (nx < 0 || nz < 0 || nx >= w || nz >= h) return;
        if (isWater(nx, nz)) return;
        const i = nx + nz * w;
        if (outsideDist[i] <= nd) return;
        outsideDist[i] = nd;
        push(nx, nz);
      };
      step(x - 1, z);
      step(x + 1, z);
      step(x, z - 1);
      step(x, z + 1);
    }

    // Encode signed distance: water cells positive, land negative. Boundary = 0.
    const maxDist = 10.0;
    for (let z = 0; z < h; z++) {
      for (let x = 0; x < w; x++) {
        const i = x + z * w;
        const sdf = isWater(x, z)
          ? Math.min(maxDist, insideDist[i])
          : -Math.min(maxDist, outsideDist[i]);
        const n = THREE.MathUtils.clamp(0.5 + (sdf / maxDist) * 0.5, 0, 1);
        mask[i] = Math.floor(n * 255);
      }
    }

    const tex = new THREE.DataTexture(mask, w, h, THREE.RedFormat, THREE.UnsignedByteType);
    tex.needsUpdate = true;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  }, [chunk.visualVersion]);

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
          <WaterMaterial
            sunDirection={sunDirection}
            fade={opacity}
            shoreMask={waterShoreMask}
            shoreEdge={0.07}
            alphaBase={0.58}
            texStrength={0.12}
            foamStrength={0.22}
          />
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
