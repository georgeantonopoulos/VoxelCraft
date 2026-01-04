import React, { useEffect, useRef, useState, useMemo, startTransition, useLayoutEffect } from 'react';
import * as THREE from 'three';
import { useThree, useFrame } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import type { Collider } from '@dimforge/rapier3d-compat';
import { TerrainService } from '@features/terrain/logic/terrainService';
import CustomShaderMaterial from 'three-custom-shader-material';
import { metadataDB } from '@state/MetadataDB';
import { simulationManager, SimUpdate } from '@features/flora/logic/SimulationManager';
import { useInventoryStore, useInventoryStore as useGameStore } from '@state/InventoryStore';
import { useInputStore } from '@/state/InputStore';
import { useWorldStore, FloraHotspot, GroundHotspot } from '@state/WorldStore';
import { usePhysicsItemStore } from '@state/PhysicsItemStore';
import { DIG_RADIUS, DIG_STRENGTH, CHUNK_SIZE_XZ, RENDER_DISTANCE, PAD, TOTAL_SIZE_XZ, TOTAL_SIZE_Y, MESH_Y_OFFSET } from '@/constants';
import { MaterialType, ChunkState, ItemType } from '@/types';
import { RockVariant } from '@features/terrain/logic/GroundItemKinds';
import { ChunkMesh } from '@features/terrain/components/ChunkMesh';
import { RootHollow } from '@features/flora/components/RootHollow';
import { StumpLayer } from '@features/terrain/components/StumpLayer';
import { FallingTree } from '@features/flora/components/FallingTree';
import { VEGETATION_ASSETS } from '@features/terrain/logic/VegetationConfig';
import { terrainRuntime } from '@features/terrain/logic/TerrainRuntime';
import { deleteChunkFireflies, setChunkFireflies } from '@features/environment/fireflyRegistry';
import { getItemColor, getItemMetadata } from '../../interaction/logic/ItemRegistry';
import { updateSharedUniforms } from '@core/graphics/SharedUniforms';
import { WorkerPool } from '@core/workers/WorkerPool';
import { getToolCapabilities } from '../../interaction/logic/ToolCapabilities';
import { emitSpark } from '../../interaction/components/SparkSystem';
import { useEntityHistoryStore } from '@/state/EntityHistoryStore';
import { getTreeName, TreeType } from '@features/terrain/logic/VegetationConfig';
import { canUseSharedArrayBuffer } from '@features/terrain/workers/sharedBuffers';
import { frameProfiler } from '@core/utils/FrameProfiler';
import { chunkDataManager } from '@core/terrain/ChunkDataManager';

// Sounds
import dig1Url from '@/assets/sounds/Dig_1.wav?url';
import dig2Url from '@/assets/sounds/Dig_2.wav?url';
import dig3Url from '@/assets/sounds/Dig_3.wav?url';
import clunkUrl from '@/assets/sounds/clunk.wav?url';

const getMaterialColor = (matId: number) => {
  switch (matId) {
    case MaterialType.SNOW: return '#ffffff';
    case MaterialType.STONE: return '#666670';
    case MaterialType.BEDROCK: return '#222222';
    case MaterialType.SAND: return '#dcd0a0';
    case MaterialType.DIRT: return '#5d4037';
    case MaterialType.GRASS: return '#55aa33';
    case MaterialType.CLAY: return '#a67b5b';
    case MaterialType.WATER: return '#6ec2f7';
    case MaterialType.MOSSY_STONE: return '#5c8a3c';
    default: return '#888888';
  }
};

// Sample the terrain voxel material at a world-space point.
// This is used for "material-aware" feedback (particles + smart build).
const sampleMaterialAtWorldPoint = (
  chunks: Map<string, ChunkState>,
  worldPoint: THREE.Vector3
): MaterialType => {
  const cx = Math.floor(worldPoint.x / CHUNK_SIZE_XZ);
  const cz = Math.floor(worldPoint.z / CHUNK_SIZE_XZ);
  const key = `${cx},${cz}`;
  const chunk = chunks.get(key);
  if (!chunk) return MaterialType.DIRT;

  const localX = worldPoint.x - cx * CHUNK_SIZE_XZ;
  const localY = worldPoint.y;
  const localZ = worldPoint.z - cz * CHUNK_SIZE_XZ;

  // TerrainService grid mapping:
  // hx = localX + PAD
  // hy = localY - MESH_Y_OFFSET + PAD
  // hz = localZ + PAD
  const ix = THREE.MathUtils.clamp(Math.floor(localX) + PAD, 0, TOTAL_SIZE_XZ - 1);
  const iy = THREE.MathUtils.clamp(Math.floor(localY - MESH_Y_OFFSET) + PAD, 0, TOTAL_SIZE_Y - 1);
  const iz = THREE.MathUtils.clamp(Math.floor(localZ) + PAD, 0, TOTAL_SIZE_XZ - 1);

  const idx = ix + iy * TOTAL_SIZE_XZ + iz * TOTAL_SIZE_XZ * TOTAL_SIZE_Y;
  const mat = chunk.material[idx] ?? MaterialType.DIRT;
  return mat as MaterialType;
};

const isTerrainCollider = (collider: Collider): boolean => {
  const parent = collider.parent();
  const userData = parent?.userData as { type?: string } | undefined;
  return userData?.type === 'terrain';
};

const isPhysicsItemCollider = (collider: Collider): boolean => {
  const parent = collider.parent();
  const userData = parent?.userData as { type?: string } | undefined;
  // PhysicsItems have ItemType enum values in userData.type
  return Object.values(ItemType).includes(userData?.type as ItemType);
};

// Small helper to test ray vs placed flora without relying on physics colliders
const rayHitsFlora = (
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  maxDist: number,
  floraRadius = 0.6
): string | null => {
  const state = useWorldStore.getState();
  let closestId: string | null = null;
  let closestT = maxDist + 1;
  const tmp = new THREE.Vector3();
  const proj = new THREE.Vector3();

  // Iterate over placed flora
  for (const flora of state.entities.values()) {
    if (flora.type !== ItemType.FLORA) continue;

    // Use the live physics position if available, otherwise fall back to initial spawn position
    const currentPos = flora.bodyRef?.current
      ? flora.bodyRef.current.translation()
      : flora.position;

    // Rapier translation returns {x,y,z}, ensure it's Vector3-like
    tmp.set(currentPos.x, currentPos.y, currentPos.z).sub(origin);

    const t = tmp.dot(dir);
    if (t < 0 || t > maxDist) continue; // Behind camera or too far
    proj.copy(dir).multiplyScalar(t);
    tmp.sub(proj);
    const distSq = tmp.lengthSq();
    if (distSq <= floraRadius * floraRadius && t < closestT) {
      closestT = t;
      closestId = flora.id;
    }
  }

  return closestId;
};

// Small helper to test ray vs placed torches (world entities)
const rayHitsTorch = (
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  maxDist: number,
  torchRadius = 0.55
): { id: string; t: number; position: THREE.Vector3 } | null => {
  const state = useWorldStore.getState();
  let closest: { id: string; t: number; position: THREE.Vector3 } | null = null;
  let closestT = maxDist + 1;
  const tmp = new THREE.Vector3();
  const proj = new THREE.Vector3();
  const p = new THREE.Vector3();

  for (const ent of state.entities.values()) {
    if (ent.type !== ItemType.TORCH) continue;
    p.copy(ent.position);
    tmp.copy(p).sub(origin);
    const t = tmp.dot(dir);
    if (t < 0 || t > maxDist) continue;
    if (t >= closestT) continue;
    proj.copy(dir).multiplyScalar(t);
    tmp.sub(proj);
    const distSq = tmp.lengthSq();
    if (distSq <= torchRadius * torchRadius) {
      closestT = t;
      closest = { id: ent.id, t, position: p.clone() };
    }
  }

  return closest;
};

/**
 * Ray-hit test against generated lumina flora (chunk `floraPositions`).
 * Returns the closest hit along the ray (single-target pickup).
 */
const rayHitsGeneratedLuminaFlora = (
  chunks: Map<string, ChunkState>,
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  maxDist: number,
  floraRadius = 0.55
): { key: string; index: number; t: number; position: THREE.Vector3 } | null => {
  const tmp = new THREE.Vector3();
  const proj = new THREE.Vector3();
  const hitPos = new THREE.Vector3();

  const minCx = Math.floor((origin.x - maxDist) / CHUNK_SIZE_XZ);
  const maxCx = Math.floor((origin.x + maxDist) / CHUNK_SIZE_XZ);
  const minCz = Math.floor((origin.z - maxDist) / CHUNK_SIZE_XZ);
  const maxCz = Math.floor((origin.z + maxDist) / CHUNK_SIZE_XZ);

  let best: { key: string; index: number; t: number; position: THREE.Vector3 } | null = null;
  let bestT = maxDist + 1;

  for (let cx = minCx; cx <= maxCx; cx++) {
    for (let cz = minCz; cz <= maxCz; cz++) {
      const key = `${cx},${cz}`;
      const chunk = chunks.get(key);
      if (!chunk?.floraPositions || chunk.floraPositions.length === 0) continue;

      const positions = chunk.floraPositions;
      for (let i = 0; i < positions.length; i += 4) {
        // Positions are already world space; do not add chunk origin again.
        if (positions[i + 1] < -9999) continue;
        hitPos.set(positions[i], positions[i + 1], positions[i + 2]);
        tmp.copy(hitPos).sub(origin);
        const t = tmp.dot(dir);
        if (t < 0 || t > maxDist) continue;
        if (t >= bestT) continue;
        proj.copy(dir).multiplyScalar(t);
        tmp.sub(proj);
        const distSq = tmp.lengthSq();
        if (distSq <= floraRadius * floraRadius) {
          bestT = t;
          best = { key, index: i, t, position: hitPos.clone() };
        }
      }
    }
  }

  return best;
};

type GroundPickupArrayKey = 'stickPositions' | 'rockPositions';

/**
 * Ray-hit test against generated ground pickups (sticks + stones).
 * Data is chunk-local in XZ (chunk group space) but world-space in Y.
 */
const rayHitsGeneratedGroundPickup = (
  chunks: Map<string, ChunkState>,
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  maxDist: number,
  radius = 0.55
): { key: string; array: GroundPickupArrayKey; index: number; t: number; position: THREE.Vector3 } | null => {
  const tmp = new THREE.Vector3();
  const proj = new THREE.Vector3();
  const hitPos = new THREE.Vector3();

  const minCx = Math.floor((origin.x - maxDist) / CHUNK_SIZE_XZ);
  const maxCx = Math.floor((origin.x + maxDist) / CHUNK_SIZE_XZ);
  const minCz = Math.floor((origin.z - maxDist) / CHUNK_SIZE_XZ);
  const maxCz = Math.floor((origin.z + maxDist) / CHUNK_SIZE_XZ);

  let best: { key: string; array: GroundPickupArrayKey; index: number; t: number; position: THREE.Vector3 } | null = null;
  let bestT = maxDist + 1;

  const consider = (key: string, array: GroundPickupArrayKey, data: Float32Array) => {
    const chunk = chunks.get(key);
    if (!chunk) return;
    const originX = chunk.cx * CHUNK_SIZE_XZ;
    const originZ = chunk.cz * CHUNK_SIZE_XZ;

    // stride 8: x, y, z, nx, ny, nz, variant, seed
    for (let i = 0; i < data.length; i += 8) {
      const wy = data[i + 1];
      if (wy < -9999) continue;
      const wx = originX + data[i + 0];
      const wz = originZ + data[i + 2];
      hitPos.set(wx, wy, wz);
      tmp.copy(hitPos).sub(origin);
      const t = tmp.dot(dir);
      if (t < 0 || t > maxDist) continue;
      if (t >= bestT) continue;
      proj.copy(dir).multiplyScalar(t);
      tmp.sub(proj);
      const distSq = tmp.lengthSq();
      if (distSq <= radius * radius) {
        bestT = t;
        best = { key, array, index: i, t, position: hitPos.clone() };
      }
    }
  };

  for (let cx = minCx; cx <= maxCx; cx++) {
    for (let cz = minCz; cz <= maxCz; cz++) {
      const key = `${cx},${cz}`;
      const chunk = chunks.get(key);
      if (!chunk) continue;
      if (chunk.stickPositions && chunk.stickPositions.length > 0) consider(key, 'stickPositions', chunk.stickPositions);
      if (chunk.rockPositions && chunk.rockPositions.length > 0) consider(key, 'rockPositions', chunk.rockPositions);
    }
  }

  return best;
};

const buildFloraHotspots = (positions: Float32Array | undefined): FloraHotspot[] => {
  if (!positions || positions.length === 0) return [];
  const hotspots: FloraHotspot[] = [];
  for (let i = 0; i < positions.length; i += 4) {
    if (positions[i + 1] < -9999) continue;
    hotspots.push({ x: positions[i], z: positions[i + 2] });
  }
  return hotspots;
};

const buildChunkLocalHotspots = (cx: number, cz: number, positions: Float32Array | undefined): GroundHotspot[] => {
  if (!positions || positions.length === 0) return [];
  const originX = cx * CHUNK_SIZE_XZ;
  const originZ = cz * CHUNK_SIZE_XZ;
  const hotspots: GroundHotspot[] = [];
  for (let i = 0; i < positions.length; i += 8) {
    if (positions[i + 1] < -9999) continue;
    hotspots.push({ x: originX + positions[i], z: originZ + positions[i + 2] });
  }
  return hotspots;
};


const LeafPickupEffect = ({
  start,
  color = '#00FFFF',
  geometry = 'octahedron',
  item,
  onDone
}: {
  start: THREE.Vector3;
  color?: string;
  geometry?: 'octahedron' | 'sphere';
  item?: ItemType;
  onDone: () => void;
}) => {
  const { camera } = useThree();
  const meshRef = useRef<THREE.Object3D>(null);
  const velocity = useRef(new THREE.Vector3(0, 1.5, 0));
  const phase = useRef<'fall' | 'fly'>('fall');
  const elapsed = useRef(0);
  const tmpTarget = useMemo(() => new THREE.Vector3(), []);
  const pos = useRef(start.clone());

  useEffect(() => {
    if (meshRef.current) {
      meshRef.current.position.copy(start);
    }
  }, [start]);

  useFrame((_state, delta) => {
    if (!meshRef.current) return;
    elapsed.current += delta;

    if (phase.current === 'fall') {
      velocity.current.y -= 6.0 * delta; // gravity-ish
      pos.current.addScaledVector(velocity.current, delta);

      // After a short fall, start homing to camera
      if (elapsed.current > 0.35) {
        phase.current = 'fly';
      }
    } else {
      // Home toward a point slightly in front of the camera
      camera.getWorldPosition(tmpTarget);
      const forward = new THREE.Vector3();
      camera.getWorldDirection(forward);
      tmpTarget.add(forward.multiplyScalar(0.6));
      tmpTarget.y -= 0.1;

      pos.current.lerp(tmpTarget, 1 - Math.pow(0.25, delta * 10));

      if (pos.current.distanceTo(tmpTarget) < 0.05) {
        onDone();
        return;
      }
    }

    meshRef.current.position.copy(pos.current);
    meshRef.current.rotation.y += delta * 4.0;
  });

  const metadata = item ? getItemMetadata(item) : null;
  const itemColor = color || metadata?.color || '#00FFFF';

  return (
    <group ref={meshRef}>
      {item === ItemType.STICK ? (
        <mesh rotation={[Math.PI * 0.5, 0, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.05, 0.045, 0.75, 10]} />
          <meshStandardMaterial color={itemColor} roughness={0.92} metalness={0.0} toneMapped={false} />
        </mesh>
      ) : item === ItemType.STONE ? (
        <mesh castShadow receiveShadow>
          <dodecahedronGeometry args={[0.18, 0]} />
          <meshStandardMaterial color={itemColor} roughness={0.92} metalness={0.0} toneMapped={false} />
        </mesh>
      ) : item === ItemType.SHARD ? (
        <mesh castShadow receiveShadow>
          <octahedronGeometry args={[0.12, 0]} />
          <meshStandardMaterial color={itemColor} roughness={0.4} metalness={0.8} toneMapped={false} />
        </mesh>
      ) : (
        <mesh castShadow receiveShadow>
          {geometry === 'sphere' ? (
            <sphereGeometry args={[0.13, 12, 10]} />
          ) : (
            <octahedronGeometry args={[0.15, 0]} />
          )}
          <meshStandardMaterial
            color={itemColor}
            emissive={metadata?.emissive || itemColor}
            emissiveIntensity={metadata?.emissiveIntensity || 1.2}
            roughness={0.3}
            metalness={0.0}
            toneMapped={false}
          />
        </mesh>
      )}
    </group>
  );
};

type ParticleKind = 'debris' | 'spark';

const Particles = ({
  burstId,
  position,
  color,
  direction,
  kind
}: {
  burstId: number;
  active: boolean;
  position: THREE.Vector3;
  color: string;
  direction: THREE.Vector3;
  kind: ParticleKind;
}) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const count = 512;
  const nextIdx = useRef(0);

  // GPU Attributes
  const offsetsAttr = useRef<THREE.InstancedBufferAttribute>(null);
  const directionsAttr = useRef<THREE.InstancedBufferAttribute>(null);
  const paramsAttr = useRef<THREE.InstancedBufferAttribute>(null);
  const colorsAttr = useRef<THREE.InstancedBufferAttribute>(null);

  const VSHADER = `
    attribute vec3 aOffset;
    attribute vec4 aDirection; // [vx, vy, vz, startTime]
    attribute vec3 aParams;    // [life, scale, type] type 0: debris, 1: spark
    attribute vec3 aColor;
    uniform float uTime;
    varying vec3 vColor;
    varying float vType;

    void main() {
      float startTime = aDirection.w;
      float life = aParams.x;
      float age = uTime - startTime;

      if (age < 0.0 || age > life) {
          csm_Position = vec3(0.0, -9999.0, 0.0);
          return;
      }

      vColor = aColor;
      vType = aParams.z;

      float progress = age / life;
      
      // Gravity
      float gravity = mix(25.0, 32.0, vType);
      
      // Drag/Velocity dampening (fake)
      float drag = mix(3.5, 6.0, vType);
      vec3 animatedPos = aOffset + aDirection.xyz * (1.0 - exp(-drag * age)) / drag;
      animatedPos.y -= 0.5 * gravity * age * age;

      float s = aParams.y * (vType > 0.5 ? (1.0 - progress) * (1.0 - progress) : (1.0 - progress));
      
      // Rotation for debris
      if (vType < 0.5) {
          float rX = age * 10.0 + float(gl_InstanceID);
          float rZ = age * 5.0 + float(gl_InstanceID) * 1.1;
          
          // X rotation
          float sX = sin(rX);
          float cX = cos(rX);
          vec3 p = csm_Position;
          csm_Position.y = p.y * cX - p.z * sX;
          csm_Position.z = p.y * sX + p.z * cX;
          
          // Z rotation
          float sZ = sin(rZ);
          float cZ = cos(rZ);
          p = csm_Position;
          csm_Position.x = p.x * cZ - p.y * sZ;
          csm_Position.y = p.x * sZ + p.y * cZ;
      }

      csm_Position = animatedPos + csm_Position * s;
    }
  `;

  useEffect(() => {
    if (burstId === 0) return;
    const mesh = meshRef.current;
    if (!mesh || !offsetsAttr.current || !directionsAttr.current || !paramsAttr.current || !colorsAttr.current) return;

    const time = performance.now() / 1000;
    const num = 28;
    const col = new THREE.Color(color);

    for (let i = 0; i < num; i++) {
      const idx = nextIdx.current;

      // Origin with jitter
      const jitter = kind === 'spark' ? 0.10 : 0.22;
      offsetsAttr.current.setXYZ(idx,
        position.x + (Math.random() - 0.5) * jitter,
        position.y + (Math.random() - 0.5) * jitter,
        position.z + (Math.random() - 0.5) * jitter
      );

      // Velocity
      const spread = kind === 'spark' ? 0.7 : 1.1;
      const speed = kind === 'spark' ? 10.5 : 7.5;
      const vx = direction.x * speed + (Math.random() - 0.5) * spread * (kind === 'spark' ? 2.6 : 3.2);
      const vy = Math.max(direction.y * speed + (Math.random() * 1.0) * spread * (kind === 'spark' ? 2.6 : 3.2), kind === 'spark' ? 2.0 : 3.0);
      const vz = direction.z * speed + (Math.random() - 0.5) * spread * (kind === 'spark' ? 2.6 : 3.2);
      directionsAttr.current.setXYZW(idx, vx, vy, vz, time);

      // Params
      const life = (kind === 'spark' ? 0.16 : 0.28) + Math.random() * (kind === 'spark' ? 0.18 : 0.42);
      const baseScale = kind === 'spark' ? 0.06 : 0.14;
      const scaleVar = kind === 'spark' ? 0.05 : 0.18;
      const s = baseScale + Math.random() * scaleVar;
      paramsAttr.current.setXYZ(idx, life, s, kind === 'spark' ? 1 : 0);

      // Color
      colorsAttr.current.setXYZ(idx, col.r, col.g, col.b);

      nextIdx.current = (nextIdx.current + 1) % count;
    }

    offsetsAttr.current.needsUpdate = true;
    directionsAttr.current.needsUpdate = true;
    paramsAttr.current.needsUpdate = true;
    colorsAttr.current.needsUpdate = true;
  }, [burstId]);

  useFrame((state) => {
    if (!meshRef.current) return;
    const mat = meshRef.current.material as any;
    if (mat.uniforms) {
      mat.uniforms.uTime.value = state.clock.getElapsedTime();
    }
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]} frustumCulled={false}>
      <icosahedronGeometry args={[0.12, 0]}>
        <instancedBufferAttribute ref={offsetsAttr} attach="attributes-aOffset" args={[new Float32Array(count * 3), 3]} />
        <instancedBufferAttribute ref={directionsAttr} attach="attributes-aDirection" args={[new Float32Array(count * 4), 4]} />
        <instancedBufferAttribute ref={paramsAttr} attach="attributes-aParams" args={[new Float32Array(count * 3), 3]} />
        <instancedBufferAttribute ref={colorsAttr} attach="attributes-aColor" args={[new Float32Array(count * 3), 3]} />
      </icosahedronGeometry>
      <CustomShaderMaterial
        baseMaterial={THREE.MeshStandardMaterial}
        vertexShader={VSHADER}
        fragmentShader={`
            varying vec3 vColor;
            varying float vType;
            void main() {
                float emissive = vType > 0.5 ? 1.35 : 0.35;
                csm_Emissive = vColor * emissive;
                csm_DiffuseColor = vec4(vColor, 1.0);
            }
        `}
        uniforms={{
          uTime: { value: 0 }
        }}
        roughness={0.8}
        toneMapped={false}
      />
    </instancedMesh>
  );
};

interface VoxelTerrainProps {
  sunDirection?: THREE.Vector3;
  initialSpawnPos?: [number, number, number] | null;
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
  onInitialLoad?: () => void;
  worldType: string;
  heightFogEnabled?: boolean;
  heightFogStrength?: number;
  heightFogRange?: number;
  heightFogOffset?: number;
  fogNear?: number;
  fogFar?: number;
}

// --- Audio Pool Helper ---
class AudioPool {
  private pools: Map<string, HTMLAudioElement[]> = new Map();
  private index: Map<string, number> = new Map();

  constructor(urls: string[], size: number = 3) {
    urls.forEach(url => {
      const pool: HTMLAudioElement[] = [];
      for (let i = 0; i < size; i++) {
        const a = new Audio(url);
        a.volume = 0.3;
        pool.push(a);
      }
      this.pools.set(url, pool);
      this.index.set(url, 0);
    });
  }

  play(url: string, volume: number = 0.3, pitchVar: number = 0) {
    const pool = this.pools.get(url);
    if (!pool) return;

    // Round robin
    const idx = this.index.get(url) || 0;
    const audio = pool[idx];
    this.index.set(url, (idx + 1) % pool.length);

    // Reset and play
    audio.currentTime = 0;
    audio.volume = volume;
    // Simple pitch shift (speed change)
    audio.playbackRate = Math.max(0.1, 1.0 + (Math.random() * pitchVar * 2 - pitchVar));

    audio.play().catch(e => console.warn("Audio play failed", e));
  }
}

const FRAME_BUDGET_MS = 4; // ms allocated per frame for processing worker messages

export const VoxelTerrain: React.FC<VoxelTerrainProps> = React.memo(({
  sunDirection,
  initialSpawnPos,
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
  onInitialLoad,
  worldType,
  heightFogEnabled = true,
  heightFogStrength = 0.35,
  heightFogRange = 50.0,
  heightFogOffset = 4.0,
  fogNear = 40,
  fogFar = 220
}) => {
  const action = useInputStore(s => s.interactionAction);
  const isInteracting = action !== null;
  const prevProps = useRef<any>({});
  useEffect(() => {
    const changed = Object.entries({
      action, isInteracting, sunDirection, triplanarDetail,
      terrainShaderFogEnabled, terrainShaderFogStrength, terrainThreeFogEnabled,
      terrainFadeEnabled, terrainWetnessEnabled, terrainMossEnabled,
      terrainRoughnessMin, terrainPolygonOffsetEnabled, terrainPolygonOffsetFactor,
      terrainPolygonOffsetUnits, terrainChunkTintEnabled, terrainWireframeEnabled,
      terrainWeightsView, worldType
    }).filter(([k, v]) => prevProps.current[k] !== v);

    if (changed.length > 0 && typeof window !== 'undefined') {
      const diag = (window as any).__vcDiagnostics;
      if (diag) {
        diag.lastPropChange = changed.map(([k]) => k).join(', ');
        // console.log('[VoxelTerrain] Props changed:', diag.lastPropChange);
      }
    }
    prevProps.current = {
      action, isInteracting, sunDirection, triplanarDetail,
      terrainShaderFogEnabled, terrainShaderFogStrength, terrainThreeFogEnabled,
      terrainFadeEnabled, terrainWetnessEnabled, terrainMossEnabled,
      terrainRoughnessMin, terrainPolygonOffsetEnabled, terrainPolygonOffsetFactor,
      terrainPolygonOffsetUnits, terrainChunkTintEnabled, terrainWireframeEnabled,
      terrainWeightsView, worldType
    };
  });

  if (typeof window !== 'undefined') {
    const diag = (window as any).__vcDiagnostics;
    if (diag) diag.terrainRenders = (diag.terrainRenders || 0) + 1;
  }
  const { camera } = useThree();
  const { world, rapier } = useRapier();

  // Initialize Audio Pool once
  const audioPool = useMemo(() => {
    return new AudioPool([dig1Url, dig2Url, dig3Url, clunkUrl], 4);
  }, []);

  const [buildMat, setBuildMat] = useState<MaterialType>(MaterialType.STONE);
  // Track if the user manually picked a build material; when active, we don't auto-switch.
  const manualBuildMatUntilMs = useRef(0);
  const remeshQueue = useRef<Set<string>>(new Set());
  const initialLoadTriggered = useRef(false);
  // Phased initial loading: start with spawn chunk, expand outward in rings.
  // This prevents queuing all 49 chunks at once and reduces initial frame spikes.
  const initialLoadPhase = useRef(0); // Current ring distance (0 = spawn only, 1 = 3x3, etc.)
  const initialLoadPhasePending = useRef(0); // Chunks pending in current phase
  const MAX_INITIAL_PHASE = RENDER_DISTANCE; // Final ring distance

  const streamDebug = useMemo(() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    // Keep streaming logs opt-in even in debug sessions.
    return params.has('debug') && params.has('vcStreamDebug');
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Manual material selection (hotkeys). This temporarily disables smart auto-selection.
      if (e.key === '1') { setBuildMat(MaterialType.DIRT); manualBuildMatUntilMs.current = Date.now() + 15000; }
      if (e.key === '2') { setBuildMat(MaterialType.STONE); manualBuildMatUntilMs.current = Date.now() + 15000; }
      if (e.key === '3') { setBuildMat(MaterialType.WATER); manualBuildMatUntilMs.current = Date.now() + 15000; }
      if (e.key === '4') { setBuildMat(MaterialType.MOSSY_STONE); manualBuildMatUntilMs.current = Date.now() + 15000; }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const [chunkVersions, setChunkVersions] = useState<Record<string, number>>({});
  const chunkDataRef = useRef<Map<string, ChunkState>>(new Map());
  const poolRef = useRef<WorkerPool | null>(null);
  const pendingChunks = useRef<Set<string>>(new Set());
  // Queue chunk generation requests so we can throttle how many we send per frame.
  // This spreads out the worker responses and main-thread geometry/collider work.
  const generateQueue = useRef<Array<{ cx: number; cz: number; key: string }>>([]);
  // Buffer worker messages so we can apply them at a controlled cadence (reduces hitching).
  const workerMessageQueue = useRef<Array<{ type: string; payload: any }>>([]);
  const workerMessageHead = useRef(0);

  // === BATCHED VERSION UPDATES ===
  // Instead of calling setChunkVersions multiple times per frame (causing multiple React reconciliations),
  // we queue version updates and flush them once at the end of each frame in useFrame.
  // Additionally, we throttle flushes to 10Hz to reduce React reconciliation overhead.
  const pendingVersionUpdates = useRef<Set<string>>(new Set());
  const pendingVersionRemovals = useRef<Set<string>>(new Set());
  const pendingVersionAdds = useRef<Map<string, number>>(new Map());
  const lastFlushTime = useRef(0);

  // Flush all pending version updates in a single React state update
  // Throttled to 10Hz (100ms) to reduce React reconciliation overhead
  const flushVersionUpdates = (forceImmediate = false) => {
    if (pendingVersionUpdates.current.size === 0 &&
        pendingVersionRemovals.current.size === 0 &&
        pendingVersionAdds.current.size === 0) {
      return;
    }

    // Throttle to 10Hz unless forced (e.g., during initial load or critical updates)
    const now = performance.now();
    if (!forceImmediate && now - lastFlushTime.current < 100) {
      return; // Skip this flush, will catch up on next tick
    }
    lastFlushTime.current = now;

    const updates = new Set(pendingVersionUpdates.current);
    const removals = new Set(pendingVersionRemovals.current);
    const adds = new Map(pendingVersionAdds.current);

    pendingVersionUpdates.current.clear();
    pendingVersionRemovals.current.clear();
    pendingVersionAdds.current.clear();

    frameProfiler.trackOperation(`version-flush-${updates.size + removals.size + adds.size}`);

    // Safety: Don't remove chunks that are being added in the same flush
    adds.forEach((_, k) => removals.delete(k));

    if (initialLoadTriggered.current) {
      startTransition(() => {
        setChunkVersions(prev => {
          const next = { ...prev };
          removals.forEach(k => { delete next[k]; });
          adds.forEach((v, k) => { next[k] = v; });
          updates.forEach(k => { if (next[k] !== undefined) next[k]++; });
          return next;
        });
      });
    } else {
      // During initial load, apply immediately without transition
      setChunkVersions(prev => {
        const next = { ...prev };
        removals.forEach(k => { delete next[k]; });
        adds.forEach((v, k) => { next[k] = v; });
        updates.forEach(k => { if (next[k] !== undefined) next[k]++; });
        return next;
      });
    }
  };

  // Queue a version increment (will be flushed at end of useFrame)
  const queueVersionIncrement = (key: string) => {
    if (pendingVersionRemovals.current.has(key)) return;
    pendingVersionUpdates.current.add(key);
  };

  // Queue a chunk removal (will be flushed at end of useFrame)
  const queueVersionRemoval = (key: string) => {
    pendingVersionRemovals.current.add(key);
    pendingVersionUpdates.current.delete(key);
    pendingVersionAdds.current.delete(key);
  };

  // Queue a new chunk add (will be flushed at end of useFrame)
  const queueVersionAdd = (key: string) => {
    pendingVersionRemovals.current.delete(key);
    if (!pendingVersionAdds.current.has(key)) {
      pendingVersionAdds.current.set(key, 1);
    }
  };

  // === MEMORY PRESSURE & GENERATION THROTTLING ===
  // Track how many chunks are currently being generated by workers.
  // If too many are in-flight, pause dispatching new work to prevent memory exhaustion.
  const inFlightGenerations = useRef<Set<string>>(new Set());

  const setSharedArrayBufferEnabled = useGameStore(s => s.setSharedArrayBufferEnabled);

  useEffect(() => {
    const sab = canUseSharedArrayBuffer();
    setSharedArrayBufferEnabled(sab);
    if (!sab) {
      console.warn('%c⚠️ PERFORMANCE WARNING: SharedArrayBuffer unavailable. Falling back to memory copying. Check COOP/COEP headers.', 'color: #ff0000; font-weight: bold; font-size: 14px;');
    }
  }, [setSharedArrayBufferEnabled]);
  // During initial load, use fewer concurrent generations to reduce frame spikes.
  // Post-load, we can be more aggressive since chunks are processed one at a time via mountQueue.
  const MAX_IN_FLIGHT_INITIAL = 4; // Lower limit during initial load
  const MAX_IN_FLIGHT_NORMAL = 8; // Normal limit after initial load
  const getMaxInFlight = () => initialLoadTriggered.current ? MAX_IN_FLIGHT_NORMAL : MAX_IN_FLIGHT_INITIAL;

  // Memory pressure detection: pause generation if browser signals memory issues.
  // Uses the Performance Memory API where available (Chrome) and allocation failure tracking.
  const memoryPressure = useRef(false);
  const lastMemoryCheck = useRef(0);
  const allocationFailures = useRef(0);
  const MEMORY_CHECK_INTERVAL_MS = 500; // Check memory every 500ms
  const MEMORY_PRESSURE_THRESHOLD_MB = 512; // Pause if less than 512MB estimated available

  // Check if we're under memory pressure
  const checkMemoryPressure = (): boolean => {
    const now = performance.now();
    if (now - lastMemoryCheck.current < MEMORY_CHECK_INTERVAL_MS) {
      return memoryPressure.current;
    }
    lastMemoryCheck.current = now;

    // Method 1: Performance.memory API (Chrome only)
    const perfMemory = (performance as any).memory;
    if (perfMemory) {
      const usedMB = perfMemory.usedJSHeapSize / (1024 * 1024);
      const limitMB = perfMemory.jsHeapSizeLimit / (1024 * 1024);
      const availableMB = limitMB - usedMB;

      if (availableMB < MEMORY_PRESSURE_THRESHOLD_MB) {
        if (!memoryPressure.current) {
          console.warn(`[VoxelTerrain] Memory pressure detected: ${availableMB.toFixed(0)}MB available. Pausing generation.`);
        }
        memoryPressure.current = true;
        return true;
      }
    }

    // Method 2: Allocation failure tracking (cross-browser)
    // If we've seen recent allocation failures, stay in pressure mode
    if (allocationFailures.current > 0) {
      // Gradually decay the failure count
      allocationFailures.current = Math.max(0, allocationFailures.current - 1);
      if (allocationFailures.current > 3) {
        memoryPressure.current = true;
        return true;
      }
    }

    // Clear pressure if we're above threshold and no recent failures
    if (memoryPressure.current) {
      console.log('[VoxelTerrain] Memory pressure cleared. Resuming generation.');
    }
    memoryPressure.current = false;
    return false;
  };

  // Queue for throttled chunk removal to prevent frame spikes when crossing boundaries.
  const removeQueue = useRef<string[]>([]);

  const neededKeysRef = useRef<Set<string>>(new Set());

  // Streaming window: shift the active chunk window slightly in the movement direction so we
  // generate more ahead of the player without increasing total chunk count.
  const hasPrevCamPos = useRef(false);
  const prevCamPos = useRef(new THREE.Vector3());
  const tmpMoveDir = useRef(new THREE.Vector3());
  const streamForward = useRef(new THREE.Vector3(0, 0, 1));
  const streamCenter = useRef<{ cx: number; cz: number }>({ cx: 0, cz: 0 });
  const playerChunk = useRef<{ px: number; pz: number }>({ px: 0, pz: 0 });

  // Physics collider enabling is intentionally more conservative than rendering to reduce spikes.
  // Progressive collider loading: start with smaller radius during initial load, expand after.
  const COLLIDER_RADIUS_INITIAL = 0; // During initial load: only player's chunk (1x1)
  const COLLIDER_RADIUS_FULL = 1; // After initial load: 3x3 area (Chebyshev distance)
  const getColliderRadius = () => initialLoadTriggered.current ? COLLIDER_RADIUS_FULL : COLLIDER_RADIUS_INITIAL;
  const colliderEnableQueue = useRef<string[]>([]);
  const colliderEnablePending = useRef<Set<string>>(new Set());
  const lastColliderCenterKey = useRef<string>('');

  // Particle "burst" state: increment id to guarantee a re-trigger even when spamming clicks.
  const [particleState, setParticleState] = useState<{
    burstId: number;
    pos: THREE.Vector3;
    dir: THREE.Vector3;
    color: string;
    kind: ParticleKind;
    active: boolean;
  }>({
    burstId: 0,
    pos: new THREE.Vector3(),
    dir: new THREE.Vector3(0, 1, 0),
    color: '#fff',
    kind: 'debris',
    active: false
  });
  const [leafPickup, setLeafPickup] = useState<THREE.Vector3 | null>(null);
  const [floraPickups, setFloraPickups] = useState<Array<{ id: string; start: THREE.Vector3; color?: string; item?: ItemType }>>([]);

  const [fallingTrees, setFallingTrees] = useState<Array<{ id: string; position: THREE.Vector3; type: number; seed: number }>>([]);

  const lastProcessedPlayerChunk = useRef({ px: -999, pz: -999 });

  useEffect(() => {
    simulationManager.start();

    simulationManager.setCallback((updates: SimUpdate[]) => {
      updates.forEach(update => {
        const chunk = chunkDataRef.current.get(update.key);
        if (chunk) {
          chunk.material.set(update.material);
          remeshQueue.current.add(update.key);
        }
      });
    });

    // Initialize a WorkerPool for terrain generation.
    // By distributing meshing and voxel generation across multiple threads (up to 4),
    // we significantly reduce the time a single hot chunk blocks the entire pipeline.
    const pool = new WorkerPool(new URL('../workers/terrain.worker.ts', import.meta.url), 4);
    poolRef.current = pool;

    // Send configuration to all workers
    pool.postToAll({ type: 'CONFIGURE', payload: { worldType } });

    // Handle messages from any worker in the pool
    pool.addMessageListener((e) => {
      const msgStart = performance.now();
      // Guard against null messages from crashed workers
      if (!e.data) {
        allocationFailures.current += 5; // Worker crash = severe memory pressure
        console.warn('[VoxelTerrain] Received null message from worker (likely OOM crash)');
        return;
      }

      // Track if this is an error message indicating allocation failure
      if (e.data.type === 'ERROR' || (e.data.error && String(e.data.error).includes('allocation'))) {
        allocationFailures.current += 3;
        console.warn('[VoxelTerrain] Worker reported allocation error');
        return;
      }

      workerMessageQueue.current.push(e.data);
      const msgDuration = performance.now() - msgStart;
      if (msgDuration > 10) {
        console.warn(`[VoxelTerrain] Message handler took ${msgDuration.toFixed(1)}ms for ${e.data.type}`);
      }
    });

    // Listen for worker errors (uncaught exceptions)
    (pool as any).workers?.forEach?.((worker: Worker) => {
      worker.addEventListener('error', (err: ErrorEvent) => {
        if (err.message && err.message.includes('allocation')) {
          allocationFailures.current += 5;
          console.warn('[VoxelTerrain] Worker allocation error:', err.message);
        }
      });
    });

    return () => pool.terminate();
  }, [worldType]);

  // Determine a stable target for initial loading (don't chase moving camera)
  const initialLoadTarget = useMemo(() => {
    if (initialSpawnPos) return { x: initialSpawnPos[0], z: initialSpawnPos[2] };
    return { x: 16, z: 16 }; // Fallback to origin
  }, [initialSpawnPos]);

  useEffect(() => {
    if (initialLoadTriggered.current || !onInitialLoad) return;

    const px = Math.floor(initialLoadTarget.x / CHUNK_SIZE_XZ);
    const pz = Math.floor(initialLoadTarget.z / CHUNK_SIZE_XZ);
    const spawnChunkKey = `${px},${pz}`;
    const essentialKeys = [
      spawnChunkKey, `${px},${pz + 1}`, `${px},${pz - 1}`, `${px + 1},${pz}`, `${px - 1},${pz}`,
      `${px + 1},${pz + 1}`, `${px + 1},${pz - 1}`, `${px - 1},${pz + 1}`, `${px - 1},${pz - 1}`
    ];

    // All essential chunks need terrain data, but only spawn chunk needs collider
    // (progressive collider loading expands radius after initial load)
    const allReady = essentialKeys.every(key => {
      const c = chunkDataRef.current.get(key);
      if (!c || c.terrainVersion < 0) return false;
      // Only require collider for spawn chunk - player needs to stand on something
      if (key === spawnChunkKey) return c.colliderEnabled;
      return true;
    });

    if (allReady) {
      initialLoadTriggered.current = true;
      // Force collider queue re-evaluation with expanded radius
      // by resetting the last center key - next frame will queue additional colliders
      lastColliderCenterKey.current = '';
      onInitialLoad();
    }
  }, [chunkVersions, onInitialLoad, initialLoadTarget]);

  const mountQueue = useRef<any[]>([]);
  const lodUpdateQueue = useRef<string[]>([]);
  const lastTimeRef = useRef(0);
  const lastLodUpdatePos = useRef(new THREE.Vector2());
  // LOD updates should be infrequent - only when player crosses chunk boundaries
  // Plus a hysteresis buffer to prevent rapid toggling at edges
  const LOD_UPDATE_DISTANCE = CHUNK_SIZE_XZ * 0.5; // Half a chunk = ~16 units
  const LOD_UPDATE_DISTANCE_SQ = LOD_UPDATE_DISTANCE * LOD_UPDATE_DISTANCE;

  // Calculate raw Chebyshev distance in chunk-space
  const getChunkLodDistanceRaw = (cx: number, cz: number, camCx: number, camCz: number) => {
    const dx = Math.max(0, Math.abs(camCx - (cx + 0.5)) - 0.5);
    const dz = Math.max(0, Math.abs(camCz - (cz + 0.5)) - 0.5);
    return Math.max(dx, dz);
  };

  // Convert continuous distance to discrete LOD tier (0-4)
  // This matches the LOD_DISTANCE_* constants in constants.ts
  // Tier 0: < 1 chunk (full quality)
  // Tier 1: 1-2 chunks (simplified trees)
  // Tier 2: 2-3 chunks (reduced vegetation)
  // Tier 3+: beyond (minimal detail)
  const getChunkLodTier = (cx: number, cz: number, camCx: number, camCz: number): number => {
    const rawDist = getChunkLodDistanceRaw(cx, cz, camCx, camCz);
    return Math.floor(rawDist);
  };

  // 3. Process Queues (Throttled)
  useFrame((state) => {
    frameProfiler.tick();
    frameProfiler.begin('terrain-main');
    const frameStart = performance.now();
    if (!state.camera || !poolRef.current) {
      frameProfiler.end('terrain-main');
      return;
    }

    lastTimeRef.current = state.clock.getElapsedTime();

    // One chunk addition per frame to avoid hitches (post-initial-load only)
    // Note: mountQueue only receives items after initialLoadTriggered becomes true
    if (mountQueue.current.length > 0) {
      frameProfiler.trackOperation('chunk-mount');
      const mountStart = performance.now();
      const newChunk = mountQueue.current.shift()!;
      if (!chunkDataRef.current.has(newChunk.key)) {
        chunkDataRef.current.set(newChunk.key, newChunk);
      }
      queueVersionAdd(newChunk.key);
      const mountDuration = performance.now() - mountStart;
      if (mountDuration > 5) {
        console.warn(`[VoxelTerrain] Chunk mount took ${mountDuration.toFixed(1)}ms for ${newChunk.key}`);
      }
    }

    // Throttled LOD updates (process in small batches to avoid massive reconciliation hitches)
    if (lodUpdateQueue.current.length > 0) {
      frameProfiler.trackOperation('lod-batch');
      const lodBatchStart = performance.now();
      const BATCH_SIZE = 4; // Can be larger now since we batch state updates
      const keys = lodUpdateQueue.current.splice(0, BATCH_SIZE);
      const remainingInQueue = lodUpdateQueue.current.length;
      // Use batched version increment instead of direct setState
      keys.forEach(key => {
        if (chunkDataRef.current.has(key)) {
          queueVersionIncrement(key);
        }
      });
      const lodBatchDuration = performance.now() - lodBatchStart;
      if (lodBatchDuration > 5) {
        console.warn(`[VoxelTerrain] LOD batch update took ${lodBatchDuration.toFixed(1)}ms for ${keys.length} chunks (${remainingInQueue} remaining)`);
      }
    }

    // Use spawnPos for initial load to ensure we have a floor, otherwise use camera
    const streamX = (!initialLoadTriggered.current && initialSpawnPos) ? initialSpawnPos[0] : camera.position.x;
    const streamZ = (!initialLoadTriggered.current && initialSpawnPos) ? initialSpawnPos[2] : camera.position.z;
    const camCx = streamX / CHUNK_SIZE_XZ;
    const camCz = streamZ / CHUNK_SIZE_XZ;

    const px = Math.floor(streamX / CHUNK_SIZE_XZ);
    const pz = Math.floor(streamZ / CHUNK_SIZE_XZ);

    // 1. STREAMING WINDOW & QUEUE UPDATES (Only on chunk crossing)
    const moved = px !== lastProcessedPlayerChunk.current.px || pz !== lastProcessedPlayerChunk.current.pz;

    if (moved) {
      lastProcessedPlayerChunk.current = { px, pz };
      playerChunk.current.px = px;
      playerChunk.current.pz = pz;

      // Update simulation player position
      simulationManager.updatePlayerPosition(px, pz);

      // Update movement direction estimate (world-space) for forward-shifted streaming window.
      if (!hasPrevCamPos.current) {
        prevCamPos.current.copy(camera.position);
        hasPrevCamPos.current = true;
      } else {
        const dx = camera.position.x - prevCamPos.current.x;
        const dz = camera.position.z - prevCamPos.current.z;
        const speedSq = dx * dx + dz * dz;
        // Only update forward vector if we are actually moving (e.g. not in cinematic orbit)
        if (speedSq > 0.0004 && initialLoadTriggered.current) {
          tmpMoveDir.current.set(dx, 0, dz).normalize();
          streamForward.current.lerp(tmpMoveDir.current, 0.25).normalize();
        }
        prevCamPos.current.copy(camera.position);
      }

      const neededKeys = new Set<string>();
      const shift = 1;
      const axisThreshold = 0.35;
      const offsetCx = Math.abs(streamForward.current.x) > axisThreshold ? Math.sign(streamForward.current.x) * shift : 0;
      const offsetCz = Math.abs(streamForward.current.z) > axisThreshold ? Math.sign(streamForward.current.z) * shift : 0;
      const centerCx = px + offsetCx;
      const centerCz = pz + offsetCz;
      streamCenter.current.cx = centerCx;
      streamCenter.current.cz = centerCz;

      // During initial load, use phased loading: expand in rings to reduce burst.
      // After initial load, queue all needed chunks immediately.
      const currentPhase = initialLoadTriggered.current ? RENDER_DISTANCE : initialLoadPhase.current;

      for (let x = -RENDER_DISTANCE; x <= RENDER_DISTANCE; x++) {
        for (let z = -RENDER_DISTANCE; z <= RENDER_DISTANCE; z++) {
          const cx = centerCx + x;
          const cz = centerCz + z;
          const key = `${cx},${cz}`;
          neededKeys.add(key);

          // Calculate Chebyshev distance (ring distance) from center
          const ringDist = Math.max(Math.abs(x), Math.abs(z));

          // Only queue if within current phase and not already pending/loaded
          if (ringDist <= currentPhase && !chunkDataRef.current.has(key) && !pendingChunks.current.has(key)) {
            pendingChunks.current.add(key);
            generateQueue.current.push({ cx, cz, key });
            if (!initialLoadTriggered.current) {
              initialLoadPhasePending.current++;
            }
          }
        }
      }
      neededKeysRef.current = neededKeys;

      // Identify unneeded chunks and move to removeQueue
      let removalPushed = false;
      chunkDataRef.current.forEach((_, key) => {
        if (!neededKeys.has(key)) {
          // Check if already in queue to avoid duplicates
          if (!removeQueue.current.includes(key)) {
            removeQueue.current.push(key);
            removalPushed = true;
          }
        }
      });

      if (removalPushed && streamDebug) {
        console.log(`[VoxelTerrain] Pushed ${removeQueue.current.length} chunks to removal queue.`);
      }

      // Rebuild collider enable queue candidates
      const colliderCenterKey = `${px},${pz}`;
      if (colliderCenterKey !== lastColliderCenterKey.current) {
        lastColliderCenterKey.current = colliderCenterKey;
        colliderEnableQueue.current.length = 0;
        colliderEnablePending.current.clear();

        const candidates = new Set<string>();
        const addRadius = (cx: number, cz: number, r: number) => {
          for (let dx = -r; dx <= r; dx++) {
            for (let dz = -r; dz <= r; dz++) {
              candidates.add(`${cx + dx},${cz + dz}`);
            }
          }
        };
        const colliderRadius = getColliderRadius();
        addRadius(px, pz, colliderRadius);
        addRadius(px + offsetCx, pz + offsetCz, colliderRadius);

        for (const key of candidates) {
          const c = chunkDataRef.current.get(key);
          if (c && !c.colliderEnabled && !colliderEnablePending.current.has(key)) {
            colliderEnablePending.current.add(key);
            colliderEnableQueue.current.push(key);
          }
        }
      }
    }

    // LOD updates: Only recalculate when player has moved significantly (half a chunk)
    // This prevents the constant LOD thrashing that was killing performance
    const lodDx = streamX - lastLodUpdatePos.current.x;
    const lodDz = streamZ - lastLodUpdatePos.current.y;
    const lodDistSq = lodDx * lodDx + lodDz * lodDz;
    const shouldUpdateLod = lodDistSq >= LOD_UPDATE_DISTANCE_SQ;

    if (shouldUpdateLod) {
      const lodStart = performance.now();
      lastLodUpdatePos.current.set(streamX, streamZ);

      // Only update chunks whose LOD TIER actually changes (not continuous distance)
      // This massively reduces React state churn
      const toUpdate: string[] = [];

      for (const [key, chunk] of chunkDataRef.current.entries()) {
        const newTier = getChunkLodTier(chunk.cx, chunk.cz, camCx, camCz);
        // Only update if integer tier changed
        if (chunk.lodLevel !== newTier) {
          // Mutate in place to avoid object allocation - React update is batched below
          chunk.lodLevel = newTier;
          toUpdate.push(key);
        }
      }

      // Only trigger React updates if any chunk actually changed tier
      if (toUpdate.length > 0) {
        // Merge with existing queue, avoiding duplicates
        const existingSet = new Set(lodUpdateQueue.current);
        for (const key of toUpdate) {
          if (!existingSet.has(key)) {
            lodUpdateQueue.current.push(key);
          }
        }
        const lodDuration = performance.now() - lodStart;
        if (lodDuration > 2 || toUpdate.length > 4) {
          console.log(`[VoxelTerrain] LOD tier update: ${toUpdate.length} chunks queued in ${lodDuration.toFixed(1)}ms`);
        }
      }
    }

    // 2. THROTTLED GENERATION (with memory pressure awareness)
    // Only dispatch new work if:
    // - Queue has items
    // - Not under memory pressure
    // - Not too many in-flight generations
    const underPressure = checkMemoryPressure();
    const maxInFlight = getMaxInFlight();
    const canGenerate =
      generateQueue.current.length > 0 &&
      !underPressure &&
      inFlightGenerations.current.size < maxInFlight;

    if (canGenerate) {
      // Process multiple chunks per frame when queue is backed up to reduce streaming lag
      // Use adaptive drain rate: more chunks when queue is large, fewer when nearly empty
      const queueSize = generateQueue.current.length;
      const inFlightCount = inFlightGenerations.current.size;
      const availableSlots = maxInFlight - inFlightCount;
      // Drain 1-3 chunks per frame based on backlog, but never exceed available worker slots
      const maxDrain = queueSize > 6 ? 3 : queueSize > 3 ? 2 : 1;
      const chunksToDrain = Math.min(maxDrain, queueSize, availableSlots);

      const centerCx = streamCenter.current.cx;
      const centerCz = streamCenter.current.cz;

      for (let c = 0; c < chunksToDrain; c++) {
        if (generateQueue.current.length === 0) break;

        // Find closest chunk to player (prioritize nearby chunks)
        let bestIndex = 0;
        let bestDist2 = Infinity;

        for (let i = 0; i < generateQueue.current.length; i++) {
          const job = generateQueue.current[i];
          const dx = job.cx - centerCx;
          const dz = job.cz - centerCz;
          const d2 = dx * dx + dz * dz;
          if (d2 < bestDist2) {
            bestDist2 = d2;
            bestIndex = i;
          }
        }
        const job = generateQueue.current.splice(bestIndex, 1)[0];

        // Track this generation as in-flight
        inFlightGenerations.current.add(job.key);

        // Distribute generation requests round-robin across the pool
        poolRef.current.postToOne(job.cx + job.cz, { type: 'GENERATE', payload: { cx: job.cx, cz: job.cz } });
      }
    }

    // 3. THROTTLED WORKER MESSAGES (Time-budgeted loop)
    frameProfiler.begin('terrain-worker-msgs');
    const workerThrottleStartTime = performance.now();
    let appliedWorkerMessageThisFrame = false;
    const versionUpdates = new Set<string>();

    while (
      workerMessageHead.current < workerMessageQueue.current.length &&
      (performance.now() - workerThrottleStartTime) < FRAME_BUDGET_MS
    ) {
      const msg = workerMessageQueue.current[workerMessageHead.current++];
      appliedWorkerMessageThisFrame = true;

      const { type, payload } = msg as { type: string; payload: any };
      if (type === 'GENERATED') {
        const { key, cx, cz, fireflyPositions, metadata, material, density } = payload;
        pendingChunks.current.delete(key);
        inFlightGenerations.current.delete(key);

        if (neededKeysRef.current.has(key)) {
          if (metadata) {
            metadataDB.initChunk(key, metadata);
            simulationManager.addChunk(key, cx, cz, material, metadata.wetness, metadata.mossiness);
          }

          useWorldStore.getState().setChunkHotspots(
            key,
            payload.floraHotspots,
            payload.stickHotspots,
            payload.rockHotspots
          );

          const dChebyPlayer = Math.max(Math.abs(cx - px), Math.abs(cz - pz));
          const lodLevel = getChunkLodTier(cx, cz, camCx, camCz);
          const colliderEnabled = dChebyPlayer <= getColliderRadius();

          const newChunk: ChunkState = {
            ...payload,
            lodLevel,
            colliderEnabled,
            // Re-wrap collider buffers if they exist (buffers were transferred and are now neutered in worker)
            colliderPositions: payload.colliderPositions ? new Float32Array(payload.colliderPositions) : undefined,
            colliderIndices: payload.colliderIndices ? new Uint32Array(payload.colliderIndices) : undefined,
            colliderHeightfield: payload.colliderHeightfield ? new Float32Array(payload.colliderHeightfield) : undefined,
            terrainVersion: payload.terrainVersion ?? 0,
            visualVersion: payload.visualVersion ?? 0,
            spawnedAt: initialLoadTriggered.current ? (lastTimeRef.current || 0.01) : 0
          };

          setChunkFireflies(key, fireflyPositions);
          terrainRuntime.registerChunk(key, cx, cz, density, material);
          chunkDataRef.current.set(key, newChunk);

          // Phase 1: Also track in ChunkDataManager for future persistence/LRU
          chunkDataManager.addChunk(key, newChunk);

          if (!initialLoadTriggered.current) {
            // During initial load, use queueVersionAdd directly for new chunks
            // versionUpdates is only for increments - new chunks need Add, not Increment
            queueVersionAdd(key);

            // Track phase progress and advance to next ring when current phase completes
            initialLoadPhasePending.current--;
            if (initialLoadPhasePending.current <= 0 && initialLoadPhase.current < MAX_INITIAL_PHASE) {
              initialLoadPhase.current++;
              // Force streaming window re-evaluation next frame by resetting last processed position
              // This ensures the next ring of chunks gets queued
              lastProcessedPlayerChunk.current = { px: -9999, pz: -9999 };
              if (streamDebug) {
                console.log(`[VoxelTerrain] Advancing to initial load phase ${initialLoadPhase.current}`);
              }
            }
          } else {
            mountQueue.current.push(newChunk);
          }

          if (!colliderEnabled && !colliderEnablePending.current.has(key)) {
            const aheadX = px + (Math.abs(streamForward.current.x) > 0.35 ? Math.sign(streamForward.current.x) : 0);
            const aheadZ = pz + (Math.abs(streamForward.current.z) > 0.35 ? Math.sign(streamForward.current.z) : 0);
            const dChebyAhead = Math.max(Math.abs(cx - aheadX), Math.abs(cz - aheadZ));
            if (dChebyAhead <= getColliderRadius()) {
              colliderEnablePending.current.add(key);
              colliderEnableQueue.current.push(key);
            }
          }
        }
      } else if (type === 'REMESHED') {
        const { key } = payload;
        const current = chunkDataRef.current.get(key);
        if (current) {
          const updatedChunk = {
            ...current,
            ...payload,
            // Re-wrap collider buffers if they exist
            colliderPositions: payload.colliderPositions ? new Float32Array(payload.colliderPositions) : current.colliderPositions,
            colliderIndices: payload.colliderIndices ? new Uint32Array(payload.colliderIndices) : current.colliderIndices,
            colliderHeightfield: payload.colliderHeightfield ? new Float32Array(payload.colliderHeightfield) : current.colliderHeightfield,
            terrainVersion: (current.terrainVersion ?? 0) + 1,
            visualVersion: (current.visualVersion ?? 0) + 1
          };
          chunkDataRef.current.set(key, updatedChunk);
          versionUpdates.add(key);

          // Phase 1: Also update in ChunkDataManager
          chunkDataManager.addChunk(key, updatedChunk);
        }
      }
    }

    if (versionUpdates.size > 0) {
      frameProfiler.trackOperation(`version-update-${versionUpdates.size}`);
      // Use batched version increment instead of direct setState
      versionUpdates.forEach(k => queueVersionIncrement(k));
    }

    // Garbage collection for workerMessageQueue (only once per frame after the loop)
    if (workerMessageHead.current > 64 && workerMessageHead.current > workerMessageQueue.current.length / 2) {
      frameProfiler.trackOperation('msg-queue-gc');
      workerMessageQueue.current = workerMessageQueue.current.slice(workerMessageHead.current);
      workerMessageHead.current = 0;
    }
    frameProfiler.end('terrain-worker-msgs');

    // 4. THROTTLED COLLIDER ENABLES
    // Process multiple colliders per frame to reduce physics activation latency.
    // Use requestIdleCallback for non-critical colliders (distance > 0 from player)
    // to push collider BVH construction to idle time when possible.
    if (!appliedWorkerMessageThisFrame && colliderEnableQueue.current.length > 0) {
      // Enable 1 collider per frame max - BVH construction can take 20-50ms even with simplified geometry
      const MAX_COLLIDERS_PER_FRAME = 1;
      const collidersToProcess = Math.min(MAX_COLLIDERS_PER_FRAME, colliderEnableQueue.current.length);
      const keysEnabledSync: string[] = [];

      for (let i = 0; i < collidersToProcess; i++) {
        const key = colliderEnableQueue.current.shift();
        if (!key) break;

        colliderEnablePending.current.delete(key);
        const current = chunkDataRef.current.get(key);
        if (current && !current.colliderEnabled) {
          // Check if this chunk is directly under the player (critical) or adjacent (can defer)
          const [cxStr, czStr] = key.split(',');
          const cx = parseInt(cxStr);
          const cz = parseInt(czStr);
          const distToPlayer = Math.max(
            Math.abs(cx - playerChunk.current.px),
            Math.abs(cz - playerChunk.current.pz)
          );

          const enableColliderForKey = (k: string) => {
            const latest = chunkDataRef.current.get(k);
            if (latest && !latest.colliderEnabled) {
              const updated = { ...latest, colliderEnabled: true };
              chunkDataRef.current.set(k, updated);
            }
          };

          // Critical chunks (distance 0 = player is standing on it): enable immediately
          // Adjacent chunks (distance 1): defer to idle callback if available
          if (distToPlayer === 0 || !initialLoadTriggered.current) {
            // Synchronous enable for player chunk or during initial load
            enableColliderForKey(key);
            keysEnabledSync.push(key);
          } else if (typeof requestIdleCallback !== 'undefined') {
            // Defer to idle time for adjacent chunks
            const deferredKey = key;
            requestIdleCallback(() => {
              enableColliderForKey(deferredKey);
              queueVersionIncrement(deferredKey);
            }, { timeout: 100 });
          } else {
            // Fallback for browsers without requestIdleCallback
            const deferredKey = key;
            setTimeout(() => {
              enableColliderForKey(deferredKey);
              queueVersionIncrement(deferredKey);
            }, 0);
          }
        }
      }

      // Batch update for synchronously enabled colliders using the queue
      if (keysEnabledSync.length > 0) {
        keysEnabledSync.forEach(k => queueVersionIncrement(k));
      }
    }

    // 5. THROTTLED CHUNK REMOVAL (Process up to 2 per frame if not already busy)
    if (!appliedWorkerMessageThisFrame && removeQueue.current.length > 0) {
      frameProfiler.trackOperation('chunk-removal');
      const MAX_REMOVALS = 4; // Can be larger now since we batch state updates
      let removedCount = 0;

      while (removedCount < MAX_REMOVALS && removeQueue.current.length > 0) {
        const key = removeQueue.current.shift();
        if (key && chunkDataRef.current.has(key)) {
          simulationManager.removeChunk(key);
          useWorldStore.getState().clearChunkHotspots(key);
          deleteChunkFireflies(key);
          terrainRuntime.unregisterChunk(key);
          chunkDataRef.current.delete(key);
          queueVersionRemoval(key);

          // Phase 1: Notify ChunkDataManager chunk is no longer visible
          // Note: ChunkDataManager keeps data in LRU cache, doesn't delete immediately
          chunkDataManager.hideChunk(key);
          removedCount++;
        }
      }
    }

    // 6. REMESH REQUESTS
    if (remeshQueue.current.size > 0) {
      const maxPerFrame = 8;
      const iterator = remeshQueue.current.values();
      for (let i = 0; i < maxPerFrame; i++) {
        const key = iterator.next().value as string | undefined;
        if (!key) break;
        remeshQueue.current.delete(key);
        const chunk = chunkDataRef.current.get(key);
        const metadata = metadataDB.getChunk(key);
        if (chunk && metadata && poolRef.current) {
          poolRef.current.postToOne(chunk.cx + chunk.cz, {
            type: 'REMESH',
            payload: {
              key,
              cx: chunk.cx,
              cz: chunk.cz,
              density: chunk.density,
              material: chunk.material,
              wetness: metadata.wetness,
              mossiness: metadata.mossiness,
              version: chunk.terrainVersion
            }
          });
        }
      }
    }

    // --- Performance Diagnostics ---
    if (typeof window !== 'undefined') {
      const diag = (window as any).__vcDiagnostics || {};
      (window as any).__vcDiagnostics = {
        ...diag,
        chunksLoaded: chunkDataRef.current.size,
        pendingChunks: pendingChunks.current.size,
        generateQueue: generateQueue.current.length,
        workerMessages: workerMessageQueue.current.length - workerMessageHead.current,
        removeQueue: removeQueue.current.length,
        remeshQueue: remeshQueue.current.size,
        colliderQueue: colliderEnableQueue.current.length,
        activeColliders: Array.from(chunkDataRef.current.values()).filter(c => c.colliderEnabled).length,
        terrainFrameTime: Math.max(diag.terrainFrameTime || 0, performance.now() - frameStart),
      };
    }

    // Update central uniforms for instanced layers
    frameProfiler.begin('terrain-uniforms');
    updateSharedUniforms(state, {
      sunDir: sunDirection,
      fogColor: state.scene.fog instanceof THREE.Fog || state.scene.fog instanceof THREE.FogExp2 ? state.scene.fog.color : undefined,
      fogNear,
      fogFar,
      shaderFogStrength: terrainShaderFogStrength,
      heightFogEnabled,
      heightFogStrength,
      heightFogRange,
      heightFogOffset,
      triplanarDetail
    });
    frameProfiler.end('terrain-uniforms');

    // Flush all batched version updates at the end of the frame
    // Force immediate during initial load for faster terrain appearance
    flushVersionUpdates(!initialLoadTriggered.current);

    frameProfiler.end('terrain-main');
  });

  useEffect(() => {
    let lastPickupMs = 0;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'KeyQ') return;
      // Only pick up items when in gameplay (pointer lock).
      if (!document.pointerLockElement) return;
      e.preventDefault();

      const now = performance.now();
      if (now - lastPickupMs < 160) return; // Debounce to avoid repeats on key hold
      lastPickupMs = now;

      const origin = camera.position.clone();
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
      const maxDist = 10.0;

      // Pick a single closest target along the ray:
      // 1) placed flora entities (WorldStore)
      // 2) placed torches (WorldStore)
      // 3) generated lumina flora (chunk floraPositions)
      // 4) generated ground pickups (sticks + stones)
      const placedId = rayHitsFlora(origin, dir, maxDist, 0.55);
      const torchHit = rayHitsTorch(origin, dir, maxDist, 0.55);
      const luminaHit = rayHitsGeneratedLuminaFlora(chunkDataRef.current, origin, dir, maxDist, 0.55);
      const groundHit = rayHitsGeneratedGroundPickup(chunkDataRef.current, origin, dir, maxDist, 0.55);

      // Physics Item Hit (Pickaxe, Shard, Stick, Stone)
      const physicsHit = world.castRay(new rapier.Ray(origin, dir), maxDist, true, undefined, undefined, undefined, undefined, isPhysicsItemCollider);
      let physicsItemHit: { id: string, type: ItemType, position: THREE.Vector3, t: number } | null = null;

      if (physicsHit && physicsHit.collider) {
        const parent = physicsHit.collider.parent();
        const userData = parent?.userData as { type?: ItemType, id?: string };
        if (userData && userData.id && userData.type) {
          const t = physicsHit.timeOfImpact;
          const point = new rapier.Ray(origin, dir).pointAt(t);
          physicsItemHit = { id: userData.id, type: userData.type, position: new THREE.Vector3(point.x, point.y, point.z), t };
        }
      }

      const removeLumina = (hit: NonNullable<typeof luminaHit>) => {
        const key = hit.key;
        const chunk = chunkDataRef.current.get(key);
        if (!chunk?.floraPositions) return;
        const positions = chunk.floraPositions;
        if (positions.length < 4) return;

        // Keep array length stable and just "hide" the picked entry.
        // This avoids reindexing artifacts for instanced rendering.
        const next = new Float32Array(positions); // Clone
        // stride 4: x, y, z, type
        next[hit.index + 1] = -10000;

        const updatedChunk = { ...chunk, floraPositions: next };
        chunkDataRef.current.set(key, updatedChunk);
        chunkDataManager.markDirty(key); // Phase 2: Track flora pickup
        queueVersionIncrement(key);
        useWorldStore.getState().setFloraHotspots(key, buildFloraHotspots(next));
      };

      const removeGround = (hit: NonNullable<typeof groundHit>) => {
        const chunk = chunkDataRef.current.get(hit.key);
        const positions = chunk?.[hit.array];
        if (!chunk || !positions || positions.length < 8) return;
        const next = new Float32Array(positions);

        // Synchronize visuals for optimized layers
        let updatedVisuals: Partial<ChunkState> = {};
        const variant = next[hit.index + 6];
        const seed = next[hit.index + 7];

        const updateBuffer = (buf: Float32Array | undefined) => {
          if (!buf) return undefined;
          const nb = new Float32Array(buf);
          for (let i = 0; i < nb.length; i += 7) {
            // Find by seed and approximate position
            if (Math.abs(nb[i + 6] - seed) < 0.001) {
              nb[i + 1] = -10000;
              break;
            }
          }
          return nb;
        };

        if (hit.array === 'stickPositions') {
          if (variant === 0) updatedVisuals.drySticks = updateBuffer(chunk.drySticks);
          else updatedVisuals.jungleSticks = updateBuffer(chunk.jungleSticks);
        } else if (hit.array === 'rockPositions' && chunk.rockDataBuckets) {
          const v = variant as RockVariant;
          updatedVisuals.rockDataBuckets = {
            ...chunk.rockDataBuckets,
            [v]: updateBuffer(chunk.rockDataBuckets[v])!
          };
        }

        next[hit.index + 1] = -10000;
        const updatedChunk = { ...chunk, ...updatedVisuals, [hit.array]: next };
        chunkDataRef.current.set(hit.key, updatedChunk);
        chunkDataManager.markDirty(hit.key); // Phase 2: Track stick/rock pickup
        queueVersionIncrement(hit.key);

        if (hit.array === 'stickPositions') {
          useWorldStore.getState().setStickHotspots(hit.key, buildChunkLocalHotspots(chunk.cx, chunk.cz, next));
        } else {
          useWorldStore.getState().setRockHotspots(hit.key, buildChunkLocalHotspots(chunk.cx, chunk.cz, next));
        }
      };

      let pickedStart: THREE.Vector3 | null = null;
      let pickedItem: ItemType | null = null;

      // Determine closest along ray (torch vs flora vs lumina).
      const tTorch = torchHit?.t ?? Infinity;
      const tPhysics = physicsItemHit?.t ?? Infinity;

      const entPlaced = placedId ? useWorldStore.getState().entities.get(placedId) : null;
      const pPlaced = entPlaced?.bodyRef?.current ? entPlaced.bodyRef.current.translation() : entPlaced?.position;
      const placedPos = pPlaced ? new THREE.Vector3(pPlaced.x, pPlaced.y, pPlaced.z) : null;
      const tPlaced = placedPos ? placedPos.clone().sub(origin).dot(dir) : Infinity;
      const tLumina = luminaHit?.t ?? Infinity;
      const tGround = groundHit?.t ?? Infinity;

      if (tPhysics <= tTorch && tPhysics <= tPlaced && tPhysics <= tLumina && tPhysics <= tGround && physicsItemHit) {
        // Physics Item Pickup
        pickedStart = physicsItemHit.position;
        const physicsStore = usePhysicsItemStore.getState();
        const itemData = physicsStore.items.find(i => i.id === physicsItemHit!.id);

        physicsStore.removeItem(physicsItemHit.id);

        if (itemData?.customToolData) {
          useGameStore.getState().addCustomTool(itemData.customToolData);
          const effectId = `${Date.now()}-${Math.random()}`;
          setFloraPickups((prev) => [...prev, { id: effectId, start: pickedStart!, color: getItemColor(itemData.customToolData!.baseType) }]);
          return;
        } else if (physicsItemHit.type === ItemType.PICKAXE) {
          useGameStore.getState().setHasPickaxe(true);
          const effectId = `${Date.now()}-${Math.random()}`;
          setFloraPickups((prev) => [...prev, { id: effectId, start: pickedStart!, color: '#aaaaaa' }]);
          return;
        } else {
          pickedItem = physicsItemHit.type;
        }
      }
      else if (tTorch <= tPlaced && tTorch <= tLumina && tTorch <= tGround && torchHit) {
        pickedItem = ItemType.TORCH;
        pickedStart = torchHit.position;
        useWorldStore.getState().removeEntity(torchHit.id);
      } else if (tGround <= tPlaced && tGround <= tLumina && groundHit) {
        pickedStart = groundHit.position;
        pickedItem = groundHit.array === 'stickPositions' ? ItemType.STICK : ItemType.STONE;
        removeGround(groundHit);
      } else if (placedId && luminaHit) {
        if (placedPos) {
          if (tPlaced <= luminaHit.t) {
            pickedStart = placedPos;
            pickedItem = ItemType.FLORA;
            useWorldStore.getState().removeEntity(placedId);
          } else {
            pickedStart = luminaHit.position;
            pickedItem = ItemType.FLORA;
            removeLumina(luminaHit);
          }
        } else {
          // Fallback: treat as lumina if we can't read the placed entity position.
          pickedStart = luminaHit.position;
          pickedItem = ItemType.FLORA;
          removeLumina(luminaHit);
        }
      } else if (placedId) {
        const ent = useWorldStore.getState().entities.get(placedId);
        const p = ent?.bodyRef?.current ? ent.bodyRef.current.translation() : ent?.position;
        if (p) {
          pickedStart = new THREE.Vector3(p.x, p.y, p.z);
        }
        pickedItem = ItemType.FLORA;
        useWorldStore.getState().removeEntity(placedId);
      } else if (luminaHit) {
        pickedStart = luminaHit.position;
        pickedItem = ItemType.FLORA;
        removeLumina(luminaHit);
      }

      if (pickedStart && pickedItem) {
        // Add item to inventory and play a fly-to-player pickup effect.
        useGameStore.getState().addItem(pickedItem as any, 1);
        const effectId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const color = getItemColor(pickedItem);
        setFloraPickups((prev) => [...prev, { id: effectId, start: pickedStart, color, item: pickedItem! }]);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [camera]);

  useEffect(() => {
    if (!isInteracting || !action) return;

    const origin = camera.position.clone();
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const maxRayDistance = 16.0;

    const ray = new rapier.Ray(origin, direction);

    // NOTE: Flora pickup is handled by the Q hotkey (single-target ray pickup).
    // DIG should not "vacuum" multiple flora items into inventory.

    const terrainHit = world.castRay(ray, maxRayDistance, true, undefined, undefined, undefined, undefined, isTerrainCollider);

    // 0.5 CHECK FOR PHYSICS ITEM INTERACTION (TREES, STONES)
    if (action === 'DIG' || action === 'CHOP' || action === 'SMASH') {
      const physicsHit = world.castRay(ray, maxRayDistance, true);
      if (physicsHit && physicsHit.collider) {
        const parent = physicsHit.collider.parent();
        const userData = parent?.userData as any;

        if (parent && userData) {
          // --- FLORA TREE ---
          if (userData.type === 'flora_tree') {
            if (userData.part === 'leaf') {
              const hitPoint = ray.pointAt((physicsHit as any).timeOfImpact ?? 0);
              setLeafPickup(new THREE.Vector3(hitPoint.x, hitPoint.y, hitPoint.z));
              return;
            }

            // Tree Damage Logic (from physics hit)
            const { chunkKey, treeIndex } = userData;
            const chunk = chunkDataRef.current.get(chunkKey);
            if (chunk && chunk.treePositions) {
              const posIdx = treeIndex;
              const x = chunk.treePositions[posIdx] + chunk.cx * CHUNK_SIZE_XZ;
              const y = chunk.treePositions[posIdx + 1];
              const z = chunk.treePositions[posIdx + 2] + chunk.cz * CHUNK_SIZE_XZ;
              const type = chunk.treePositions[posIdx + 3];

              const { inventorySlots, selectedSlotIndex, customTools } = useInventoryStore.getState();
              const selectedItem = inventorySlots[selectedSlotIndex];
              const currentTool = (typeof selectedItem === 'string' && selectedItem.startsWith('tool_'))
                ? customTools[selectedItem as string]
                : (selectedItem as ItemType);
              const capabilities = getToolCapabilities(currentTool);

              // Seed/Scale Logic (same as terrain-hit path)
              const seed = chunk.treePositions[posIdx] * 12.9898 + chunk.treePositions[posIdx + 2] * 78.233;
              const scale = 0.8 + Math.abs(seed % 0.4);
              const radius = scale * 0.35;
              const maxHealth = Math.floor(radius * 60);
              const woodDamage = capabilities.woodDamage;
              const treeLabel = getTreeName(type as TreeType);

              const treeId = `${chunkKey}-${posIdx}`;
              const damageStore = useEntityHistoryStore.getState();
              const currentHealth = damageStore.damageEntity(treeId, woodDamage, maxHealth, treeLabel);

              // Visuals
              const woodPos = new THREE.Vector3(x, y + 1.5, z);
              const woodDir = origin.clone().sub(woodPos).normalize();
              setParticleState(prev => ({
                burstId: prev.burstId + 1,
                active: true,
                pos: woodPos,
                dir: woodDir,
                kind: 'debris',
                color: '#8B4513'
              }));
              audioPool.play(clunkUrl, 0.4, 0.5);

              if (currentHealth <= 0) {
                // Remove tree
                const positions = chunk.treePositions;
                const newCount = (positions.length / 5) - 1;
                const newPositions = new Float32Array(newCount * 5);
                let destIdx = 0;
                for (let j = 0; j < positions.length; j += 5) {
                  if (j === posIdx) continue;
                  newPositions[destIdx++] = positions[j];
                  newPositions[destIdx++] = positions[j + 1];
                  newPositions[destIdx++] = positions[j + 2];
                  newPositions[destIdx++] = positions[j + 3];
                  newPositions[destIdx++] = positions[j + 4];
                }

                const updatedChunk = { ...chunk, treePositions: newPositions, visualVersion: chunk.visualVersion + 1 };
                chunkDataRef.current.set(chunkKey, updatedChunk);
                chunkDataManager.markDirty(chunkKey); // Phase 2: Track tree removal
                queueVersionIncrement(chunkKey);

                // Spawn Falling Tree
                setFallingTrees(prev => [...prev, {
                  id: `${chunkKey}-${posIdx}-${Date.now()}`,
                  position: new THREE.Vector3(x, y, z),
                  type,
                  seed
                }]);
              }
            }
            return;
          }

          // --- STONE PHYSICS ITEM ---
          if (userData.type === ItemType.STONE) {
            const { inventorySlots, selectedSlotIndex, customTools } = useInventoryStore.getState();
            const selectedItem = inventorySlots[selectedSlotIndex];
            const currentTool = (typeof selectedItem === 'string' && selectedItem.startsWith('tool_'))
              ? customTools[selectedItem as string]
              : (selectedItem as ItemType);
            const capabilities = getToolCapabilities(currentTool);

            const hitPointRaw = ray.pointAt((physicsHit as any).timeOfImpact ?? 0);
            const hitPoint = new THREE.Vector3(hitPointRaw.x, hitPointRaw.y, hitPointRaw.z);

            // Logic: All interaction has logic
            // Sharp tools (shards) break stone into shards. 
            // Blunt tools (stones) generate sparks.
            const damage = capabilities.stoneDamage > 0 ? capabilities.stoneDamage : (selectedItem === ItemType.STONE ? 2.5 : 0);

            if (damage > 0) {
              const damageStore = useEntityHistoryStore.getState();
              const stoneId = userData.id;
              const h = damageStore.damageEntity(stoneId, damage, 10, 'Hard Stone');

              // Visuals
              if (capabilities.canSmash || selectedItem === ItemType.STONE) {
                emitSpark(hitPoint);
              }

              setParticleState(prev => ({
                burstId: prev.burstId + 1,
                active: true,
                pos: hitPoint,
                dir: direction.clone().multiplyScalar(-1),
                kind: 'debris',
                color: '#888888'
              }));
              audioPool.play(clunkUrl, 0.5, 1.2);

              if (h <= 0) {
                // Break!
                const physicsStore = usePhysicsItemStore.getState();
                physicsStore.removeItem(stoneId);
                const count = 2 + Math.floor(Math.random() * 2);
                for (let i = 0; i < count; i++) {
                  physicsStore.spawnItem(ItemType.SHARD, [hitPoint.x, hitPoint.y + 0.1, hitPoint.z], [
                    (Math.random() - 0.5) * 3,
                    2 + Math.random() * 2,
                    (Math.random() - 0.5) * 3
                  ]);
                }
              }
            }
            return;
          }
        }
      }

      // 0.7 CHECK FOR NATURAL ROCK INTERACTION (GENERATED GROUND PICKUPS)
      if (action === 'SMASH' || action === 'DIG') {
        const groundHit = rayHitsGeneratedGroundPickup(chunkDataRef.current, origin, direction, maxRayDistance, 0.55);
        if (groundHit && groundHit.array === 'rockPositions') {
          const { inventorySlots, selectedSlotIndex, customTools } = useInventoryStore.getState();
          const selectedItem = inventorySlots[selectedSlotIndex];
          const currentTool = (typeof selectedItem === 'string' && selectedItem.startsWith('tool_'))
            ? customTools[selectedItem as string]
            : (selectedItem as ItemType);
          const capabilities = getToolCapabilities(currentTool);

          if (capabilities.stoneDamage > 0) {
            const rockId = `natural-rock-${groundHit.key}-${groundHit.index}`;
            const damageStore = useEntityHistoryStore.getState();
            const h = damageStore.damageEntity(rockId, capabilities.stoneDamage, 10, 'Natural Rock');

            const hitPoint = groundHit.position;
            emitSpark(hitPoint);

            setParticleState(prev => ({
              burstId: prev.burstId + 1,
              active: true,
              pos: hitPoint,
              dir: direction.clone().multiplyScalar(-1),
              kind: 'debris',
              color: '#888888'
            }));
            audioPool.play(clunkUrl, 0.5, 1.2);

            if (h <= 0) {
              // Break Natural Rock!
              const removeGround = (hit: NonNullable<typeof groundHit>) => {
                const chunk = chunkDataRef.current.get(hit.key);
                const positions = chunk?.[hit.array];
                if (!chunk || !positions || positions.length < 8) return;
                const next = new Float32Array(positions);

                // Synchronize visuals for optimized layers
                let updatedVisuals: Partial<ChunkState> = {};
                const variant = next[hit.index + 6];
                const seed = next[hit.index + 7];

                const updateBuffer = (buf: Float32Array | undefined) => {
                  if (!buf) return undefined;
                  const nb = new Float32Array(buf);
                  for (let i = 0; i < nb.length; i += 7) {
                    if (Math.abs(nb[i + 6] - seed) < 0.001) {
                      nb[i + 1] = -10000;
                      break;
                    }
                  }
                  return nb;
                };

                if (variant as RockVariant !== undefined && chunk.rockDataBuckets) {
                  const v = variant as RockVariant;
                  updatedVisuals.rockDataBuckets = {
                    ...chunk.rockDataBuckets,
                    [v]: updateBuffer(chunk.rockDataBuckets[v])!
                  };
                }

                next[hit.index + 1] = -10000;
                const updatedChunk = { ...chunk, ...updatedVisuals, [hit.array]: next };
                chunkDataRef.current.set(hit.key, updatedChunk);
                chunkDataManager.markDirty(hit.key); // Phase 2: Track natural rock smash
                queueVersionIncrement(hit.key);
                useWorldStore.getState().setRockHotspots(hit.key, buildChunkLocalHotspots(chunk.cx, chunk.cz, next));
              };

              removeGround(groundHit);

              const physicsStore = usePhysicsItemStore.getState();
              const count = 2 + Math.floor(Math.random() * 2);
              for (let i = 0; i < count; i++) {
                physicsStore.spawnItem(ItemType.SHARD, [hitPoint.x, hitPoint.y + 0.1, hitPoint.z], [
                  (Math.random() - 0.5) * 3,
                  2 + Math.random() * 2,
                  (Math.random() - 0.5) * 3
                ]);
              }
            }
            return;
          }
        }
      }
    }

    if (terrainHit) {
      const rapierHitPoint = ray.pointAt(terrainHit.timeOfImpact);
      const impactPoint = new THREE.Vector3(rapierHitPoint.x, rapierHitPoint.y, rapierHitPoint.z);
      // Sample slightly inside the surface so particles/build reflect what we actually hit.
      const samplePoint = impactPoint.clone().addScaledVector(direction, 0.2);
      const sampledMat = sampleMaterialAtWorldPoint(chunkDataRef.current, samplePoint);

      let isNearTree = false;

      // Check for Tree/Vegetation Interaction BEFORE modifying terrain
      if (action === 'DIG' || action === 'CHOP' || action === 'SMASH') {
        const hitX = impactPoint.x;
        const hitZ = impactPoint.z;
        const cx = Math.floor(hitX / CHUNK_SIZE_XZ);
        const cz = Math.floor(hitZ / CHUNK_SIZE_XZ);

        // Check current and neighbor chunks (in case we hit near border)
        const checkKeys = [
          `${cx},${cz}`,
          `${cx + 1},${cz}`, `${cx - 1},${cz}`,
          `${cx},${cz + 1}`, `${cx},${cz - 1}`
        ];

        let anyFloraHit = false;

        for (const key of checkKeys) {
          const chunk = chunkDataRef.current.get(key);
          if (!chunk) continue;

          const chunkOriginX = chunk.cx * CHUNK_SIZE_XZ;
          const chunkOriginZ = chunk.cz * CHUNK_SIZE_XZ;

          // Use a slightly larger radius for trees to ensure we catch them
          // DIG_RADIUS is typically 2-3 units.
          const dist = origin.distanceTo(impactPoint);
          const digRadius = (dist < 3.0) ? 1.5 : DIG_RADIUS;

          // 1. Generated lumina flora pickup uses Q (single-target ray pickup).
          // Keeping DIG from deleting it avoids "vacuum" pickup and accidental multi-removals.

          // 2. Check Trees
          if (chunk.treePositions) {
            const positions = chunk.treePositions;
            const hitIndices: number[] = [];

            for (let i = 0; i < positions.length; i += 5) {
              const x = positions[i] + chunkOriginX;
              const y = positions[i + 1];
              const z = positions[i + 2] + chunkOriginZ;
              const type = positions[i + 3];

              // Check distance from impact point to tree base
              const dx = impactPoint.x - x;
              const dz = impactPoint.z - z;
              const dy = impactPoint.y - y;

              // If tree is within dig radius OR if we hit the trunk directly
              // Tree trunk radius ~0.5, Dig Radius ~2.5
              const distSq = dx * dx + dz * dz + (dy > 0 && dy < 4.0 ? 0 : dy * dy); // Ignore Y diff if within trunk height

              if (distSq < (digRadius + 0.5) ** 2) {
                // AAA FIX: ROOT ANCHORING
                // Prevent digging the ground directly under/near a tree
                if (distSq < 2.5 * 2.5) {
                  // We are close to a tree. 
                  // If we are aiming at the TREE (trunk), we chop it (handled below).
                  // If we are aiming at the GROUND (terrainHit), we should BLOCK digging if too close.
                  // But "distSq" here is distance from impact point to tree base.
                  // If impact point is on ground within radius of tree, block.
                  // However, we are inside "if (distSq < (digRadius + 0.5) ** 2)".
                  // We need to flag this to the outer scope to block terraforming.
                  // Let's use written variable.
                  isNearTree = true;
                }

                // AAA FIX: Tree Cutting Logic (All interaction has logic)
                const treeId = `${key}-${i}`;
                const { hasAxe, inventorySlots, selectedSlotIndex, customTools } = useInventoryStore.getState();
                const selectedItem = inventorySlots[selectedSlotIndex];

                // Check capabilities
                const currentTool = (typeof selectedItem === 'string' && selectedItem.startsWith('tool_'))
                  ? customTools[selectedItem as string]
                  : (selectedItem as ItemType);
                const capabilities = getToolCapabilities(currentTool);

                // Radius/Scale Logic to determine health
                const seed = positions[i] * 12.9898 + positions[i + 2] * 78.233;
                const scale = 0.8 + Math.abs(seed % 0.4);
                const radius = scale * 0.35;
                const maxHealth = Math.floor(radius * 60); // e.g. 20-40 health
                const woodDamage = capabilities.woodDamage;
                const treeLabel = getTreeName(type as TreeType);

                const damageStore = useEntityHistoryStore.getState();
                const currentHealth = damageStore.damageEntity(treeId, woodDamage, maxHealth, treeLabel);

                // Check if felled
                if (currentHealth <= 0) {
                  hitIndices.push(i);

                  // Spawn Falling Tree
                  setFallingTrees(prev => [...prev, {
                    id: `${key}-${i}-${Date.now()}`,
                    position: new THREE.Vector3(x, y, z),
                    type,
                    seed
                  }]);
                  continue;
                }

                // Not dead yet: Shake or Hit?
                const isChopAction = (hasAxe && selectedItem === ItemType.AXE) || capabilities.canChop;

                if (!isChopAction && (capabilities.canSmash || action === 'SMASH')) {
                  // SMASH/SHAKE Animation
                  const leafPos = new THREE.Vector3(x, y + 2.5 + Math.random() * 2, z);
                  setLeafPickup(leafPos);
                  setParticleState(prev => ({
                    burstId: prev.burstId + 1,
                    active: true,
                    pos: leafPos,
                    dir: new THREE.Vector3(0, -1, 0),
                    kind: 'debris',
                    color: '#4fa02a'
                  }));
                  audioPool.play(clunkUrl, 0.4, 0.85);
                  anyFloraHit = true;
                } else {
                  // CHOP Animation
                  const woodPos = new THREE.Vector3(x, y + 1, z);
                  const woodDir = origin.clone().sub(woodPos).normalize();
                  setParticleState(prev => ({
                    burstId: prev.burstId + 1,
                    active: true,
                    pos: woodPos,
                    dir: woodDir,
                    kind: 'debris',
                    color: '#8B4513'
                  }));
                  setTimeout(() => setParticleState(prev => ({ ...prev, active: false })), 120);
                  audioPool.play(clunkUrl, 0.4, 0.5);
                  anyFloraHit = true;
                }
              }
            }

            if (hitIndices.length > 0) {
              anyFloraHit = true;
              // Remove trees from chunk (filter out hit indices)
              // We need to reconstruct the array
              const newCount = (positions.length / 5) - hitIndices.length;
              const newPositions = new Float32Array(newCount * 5);
              let destIdx = 0;
              let currentHitIdx = 0;
              hitIndices.sort((a, b) => a - b); // Ensure sorted

              for (let i = 0; i < positions.length; i += 5) {
                if (currentHitIdx < hitIndices.length && i === hitIndices[currentHitIdx]) {
                  currentHitIdx++;
                  continue;
                }
                newPositions[destIdx] = positions[i];
                newPositions[destIdx + 1] = positions[i + 1];
                newPositions[destIdx + 2] = positions[i + 2];
                newPositions[destIdx + 3] = positions[i + 3];
                newPositions[destIdx + 4] = positions[i + 4];
                destIdx += 5;
              }

              const updatedChunk = { ...chunk, treePositions: newPositions, visualVersion: chunk.visualVersion + 1 };
              chunkDataRef.current.set(key, updatedChunk);
              chunkDataManager.markDirty(key); // Phase 2: Track tree removal (terrain raycast)
              queueVersionIncrement(key);
            }
          }

          // 2. Check Vegetation
          if (chunk.vegetationData) {
            let chunkModified = false;
            const newVegData = { ...chunk.vegetationData };

            for (const [typeStr, positions] of Object.entries(chunk.vegetationData)) {
              const typeId = parseInt(typeStr);
              const hitIndices: number[] = [];

              // AAA FIX: Stride is 6!
              for (let i = 0; i < positions.length; i += 6) {
                const x = positions[i] + chunkOriginX;
                const y = positions[i + 1];
                const z = positions[i + 2] + chunkOriginZ;

                const distSq = (impactPoint.x - x) ** 2 + (impactPoint.y - y) ** 2 + (impactPoint.z - z) ** 2;

                // AAA FIX: Tighter Vegetation Removal
                // Only remove vegetation that is strictly inside the dig sphere?
                // Or even smaller? User wants "directly where action is taking place".
                // AAA FIX: Tighter Vegetation Removal
                // Only remove vegetation that is strictly inside the dig sphere?
                // Or even smaller? User wants "directly where action is taking place".
                // digRadius is ~1.1 to 2.5. 
                // Let's use 0.3 * digRadius (approx 0.9 units or 1 block).
                const removalRadius = digRadius * 0.3;

                if (distSq < removalRadius ** 2) {
                  hitIndices.push(i);

                  // Particles
                  const asset = VEGETATION_ASSETS[typeId];
                  const vegPos = new THREE.Vector3(x, y + 0.5, z);
                  const vegDir = origin.clone().sub(vegPos).normalize();
                  setParticleState(prev => ({
                    burstId: prev.burstId + 1,
                    active: true,
                    pos: vegPos,
                    dir: vegDir,
                    kind: 'debris',
                    color: asset ? asset.color : '#00ff00'
                  }));
                }
              }

              if (hitIndices.length > 0) {
                chunkModified = true;
                anyFloraHit = true;

                // AAA FIX: Stride is 6, not 3! (x,y,z,nx,ny,nz)
                // AAA FIX: Flicker Prevention - "Hide" instead of "Delete"
                // To avoid reconstructing the InstancedMesh (which causes flicker),
                // we keep the array length same and just move destroyed items to infinity.
                const newArr = new Float32Array(positions); // Clone

                for (const idx of hitIndices) {
                  // Move Y to -10000 (Subterranean Oblivion)
                  // Index is start of stride. y is idx + 1.
                  newArr[idx + 1] = -10000;
                }
                newVegData[typeId] = newArr;
              }
            }

            if (chunkModified) {
              // AAA FIX: Do NOT increment visualVersion for vegetation updates!
              // This prevents the expensive terrain mesh reconstruction (flicker).
              // VegetationLayer updates purely on the 'vegetationData' prop reference change.
              const updatedChunk = { ...chunk, vegetationData: newVegData };
              chunkDataRef.current.set(key, updatedChunk);
              chunkDataManager.markDirty(key); // Phase 2: Track vegetation removal
              queueVersionIncrement(key);
            }
          }
        }

        if (anyFloraHit) {
          setTimeout(() => setParticleState(prev => ({ ...prev, active: false })), 100);
          return; // Stop processing (don't dig ground if we hit flora)
        }
      }

      const dist = origin.distanceTo(impactPoint);

      // AAA FIX: Interaction Distance limit
      if (dist > 4.5) return;

      // AAA FIX: Root Anchoring Block
      if (isNearTree && action === 'DIG') {
        // Play a "thud" to indicate blocking
        audioPool.play(clunkUrl, 0.4, 0.5);
        window.dispatchEvent(new CustomEvent('tool-impact', { detail: { action, ok: false, color: '#555555' } }));
        return;
      }

      // AAA FIX: Raycast Offset for Accuracy
      // Center the subtraction sphere deeper to ensure it "bites"
      // Use DIG_RADIUS * 0.5 (approx 0.6)
      const digOffset = 0.6;
      const offset = action === 'DIG' ? digOffset : -0.1;

      // IMPORTANT: keep impactPoint as the *surface* point (don't mutate it).
      const hitPoint = impactPoint.clone().addScaledVector(direction, offset);
      // Particles should spawn on/just above the visible surface (not at the brush center which may be inside terrain).
      const particlePos = impactPoint.clone().addScaledVector(direction, -0.08);
      const particleDir = direction.clone().multiplyScalar(-1);
      const { inventorySlots, selectedSlotIndex, customTools } = useInventoryStore.getState();
      const selectedItem = inventorySlots[selectedSlotIndex];
      const currentTool = (typeof selectedItem === 'string' && selectedItem.startsWith('tool_'))
        ? customTools[selectedItem as string]
        : (selectedItem as ItemType);
      const capabilities = getToolCapabilities(currentTool);

      const delta = (action === 'DIG' || action === 'CHOP' || action === 'SMASH') ? -DIG_STRENGTH * capabilities.digPower : (action === 'BUILD' ? DIG_STRENGTH : 0);
      const radius = (dist < 3.0) ? 1.1 : DIG_RADIUS;

      const minWx = hitPoint.x - (radius + 2);
      const maxWx = hitPoint.x + (radius + 2);
      const minWz = hitPoint.z - (radius + 2);
      const maxWz = hitPoint.z + (radius + 2);

      const minCx = Math.floor(minWx / CHUNK_SIZE_XZ);
      const maxCx = Math.floor(maxWx / CHUNK_SIZE_XZ);
      const minCz = Math.floor(minWz / CHUNK_SIZE_XZ);
      const maxCz = Math.floor(maxWz / CHUNK_SIZE_XZ);

      let anyModified = false;
      let primaryMat = MaterialType.DIRT;
      const affectedChunks: string[] = [];
      // Smart build: if user hasn't manually selected a material recently, build what you're looking at.
      const nowMs = Date.now();
      const allowAutoMat = nowMs > manualBuildMatUntilMs.current;
      const effectiveBuildMat =
        action === 'BUILD' && allowAutoMat && buildMat === MaterialType.STONE && sampledMat !== MaterialType.AIR && sampledMat !== MaterialType.WATER
          ? sampledMat
          : buildMat;

      for (let cx = minCx; cx <= maxCx; cx++) {
        for (let cz = minCz; cz <= maxCz; cz++) {
          const key = `${cx},${cz}`;
          const chunk = chunkDataRef.current.get(key);
          if (chunk) {
            const localX = hitPoint.x - (cx * CHUNK_SIZE_XZ);
            const localY = hitPoint.y;
            const localZ = hitPoint.z - (cz * CHUNK_SIZE_XZ);

            const metadata = metadataDB.getChunk(key);
            const isPlacingWater = action === 'BUILD' && effectiveBuildMat === MaterialType.WATER;

            const modified = isPlacingWater
              ? TerrainService.paintLiquid(
                chunk.density,
                chunk.material,
                metadata?.wetness,
                { x: localX, y: localY, z: localZ },
                radius,
                MaterialType.WATER
              )
              : TerrainService.modifyChunk(
                chunk.density,
                chunk.material,
                metadata?.wetness,
                { x: localX, y: localY, z: localZ },
                radius,
                delta,
                effectiveBuildMat,
                cx, // Pass World Coords
                cz
              );

            if (modified) {
              anyModified = true;
              affectedChunks.push(key);
              if (Math.abs(hitPoint.x - ((cx + 0.5) * CHUNK_SIZE_XZ)) < CHUNK_SIZE_XZ / 2 &&
                Math.abs(hitPoint.z - ((cz + 0.5) * CHUNK_SIZE_XZ)) < CHUNK_SIZE_XZ / 2) {
                if (action === 'BUILD') primaryMat = effectiveBuildMat;
                else primaryMat = sampledMat;
              }
            }
          }
        }
      }

      if (anyModified && poolRef.current) {
        // Phase 2: Mark chunks as dirty in ChunkDataManager (for future persistence)
        affectedChunks.forEach(key => chunkDataManager.markDirty(key));

        // Trigger version updates for all affected chunks to re-render
        affectedChunks.forEach(key => queueVersionIncrement(key));
        // Play Dig Sound
        if (action === 'DIG') {
          const sounds = [dig1Url, dig2Url, dig3Url];
          const selected = sounds[Math.floor(Math.random() * sounds.length)];
          audioPool.play(selected, 0.3, 0.1);
        } else {
          // Building sound - Use Dig_1 pitched down
          audioPool.play(dig1Url, 0.3, 0.0);
        }

        affectedChunks.forEach(key => {
          const chunk = chunkDataRef.current.get(key);
          const metadata = metadataDB.getChunk(key);
          if (chunk && metadata) {
            simulationManager.addChunk(key, chunk.cx, chunk.cz, chunk.material, metadata.wetness, metadata.mossiness);
            remeshQueue.current.add(key);
          }
        });

        // Auto-switch build material to whatever we just dug (unless user manually picked recently).
        // This makes BUILD feel context-sensitive without taking away manual hotkeys.
        if (action === 'DIG' && allowAutoMat && sampledMat !== MaterialType.AIR && sampledMat !== MaterialType.WATER) {
          setBuildMat(sampledMat);
        }

        setParticleState(prev => ({
          burstId: prev.burstId + 1,
          active: true,
          pos: particlePos,
          dir: particleDir,
          kind: action === 'DIG' ? 'debris' : 'debris',
          color: getMaterialColor(primaryMat)
        }));
        // Let the burst breathe a bit longer so it actually reads as impact.
        setTimeout(() => setParticleState(prev => ({ ...prev, active: false })), 140);
        window.dispatchEvent(new CustomEvent('tool-impact', { detail: { action, ok: true, color: getMaterialColor(primaryMat) } }));
      } else if (!anyModified && action === 'DIG') {
        // Tried to dig but nothing changed -> Indestructible (Bedrock)
        // Only play if we actually hit something (terrainHit exists)
        if (terrainHit) {
          const audio = new Audio(clunkUrl);
          audio.volume = 0.4;
          audio.playbackRate = 0.9 + Math.random() * 0.2;
          audio.play().catch(() => { });

          // AAA FIX: Visual Feedback for Invincible Blocks
          setParticleState(prev => ({
            burstId: prev.burstId + 1,
            active: true,
            pos: particlePos,
            dir: particleDir,
            kind: 'spark',
            color: '#bbbbbb' // Bright sparks
          }));
          setTimeout(() => setParticleState(prev => ({ ...prev, active: false })), 140);
          window.dispatchEvent(new CustomEvent('tool-impact', { detail: { action, ok: false, color: '#555555' } }));
        }
      }
    }
  }, [isInteracting, action, camera, world, rapier, buildMat]);

  // Track React render phase timing - this runs during the render,
  // so we can see when React itself is taking too long
  const renderStartTime = useRef(0);
  const chunkCount = Object.keys(chunkVersions).length;

  // Mark render start
  renderStartTime.current = performance.now();

  // Track render completion in useLayoutEffect (runs synchronously after render)
  useLayoutEffect(() => {
    const renderTime = performance.now() - renderStartTime.current;
    if (renderTime > 16 && frameProfiler.isEnabled()) {
      frameProfiler.trackOperation(`react-render-${chunkCount}chunks`);
      console.warn(`[VoxelTerrain] React render took ${renderTime.toFixed(1)}ms for ${chunkCount} chunks`);
    }
  });

  return (
    <group>
      {Object.keys(chunkVersions).map(key => {
        const chunk = chunkDataRef.current.get(key);
        if (!chunk) return null;

        return (
          <React.Fragment key={chunk.key}>
            <ChunkMesh
              key={chunk.key}
              chunk={chunk}
              lodLevel={chunk.lodLevel}
              sunDirection={sunDirection}
              triplanarDetail={triplanarDetail}
              terrainShaderFogEnabled={terrainShaderFogEnabled}
              terrainShaderFogStrength={terrainShaderFogStrength}
              terrainThreeFogEnabled={terrainThreeFogEnabled}
              terrainFadeEnabled={terrainFadeEnabled}
              terrainWetnessEnabled={terrainWetnessEnabled}
              terrainMossEnabled={terrainMossEnabled}
              terrainRoughnessMin={terrainRoughnessMin}
              terrainPolygonOffsetEnabled={terrainPolygonOffsetEnabled}
              terrainPolygonOffsetFactor={terrainPolygonOffsetFactor}
              terrainPolygonOffsetUnits={terrainPolygonOffsetUnits}
              terrainChunkTintEnabled={terrainChunkTintEnabled}
              terrainWireframeEnabled={terrainWireframeEnabled}
              terrainWeightsView={terrainWeightsView}
              heightFogEnabled={heightFogEnabled}
              heightFogStrength={heightFogStrength}
              heightFogRange={heightFogRange}
              heightFogOffset={heightFogOffset}
              fogNear={fogNear}
              fogFar={fogFar}
            />
            {chunk.rootHollowPositions && chunk.rootHollowPositions.length > 0 && (
              <>
                {/* Instanced rendering for the base meshes (chunk-local XZ, world Y). */}
                <group position={[chunk.cx * CHUNK_SIZE_XZ, 0, chunk.cz * CHUNK_SIZE_XZ]}>
                  <StumpLayer positions={chunk.rootHollowPositions} chunkKey={chunk.key} />
                </group>

                {/* Logic layer for interaction/growth (only active within physics distance) */}
                {chunk.lodLevel <= COLLIDER_RADIUS_FULL && Array.from({ length: chunk.rootHollowPositions.length / 6 }).map((_, i) => (
                  <RootHollow
                    key={`${chunk.key}-root-${i}`}
                    position={[
                      chunk.rootHollowPositions![i * 6] + chunk.cx * CHUNK_SIZE_XZ,
                      chunk.rootHollowPositions![i * 6 + 1],
                      chunk.rootHollowPositions![i * 6 + 2] + chunk.cz * CHUNK_SIZE_XZ
                    ]}
                    normal={[
                      chunk.rootHollowPositions![i * 6 + 3],
                      chunk.rootHollowPositions![i * 6 + 4],
                      chunk.rootHollowPositions![i * 6 + 5]
                    ]}
                  />
                ))}
              </>
            )}
          </React.Fragment>
        );
      })}
      <Particles
        burstId={particleState.burstId}
        active={particleState.active}
        position={particleState.pos}
        direction={particleState.dir}
        kind={particleState.kind}
        color={particleState.color}
      />
      {fallingTrees.map(tree => (
        <FallingTree key={tree.id} position={tree.position} type={tree.type} seed={tree.seed} />
      ))}
      {leafPickup && (
        <LeafPickupEffect
          start={leafPickup}
          onDone={() => {
            setLeafPickup(null);
          }}
        />
      )}
      {floraPickups.map((fx) => (
        <LeafPickupEffect
          key={fx.id}
          start={fx.start}
          color={fx.color}
          item={fx.item}
          geometry="sphere"
          onDone={() => {
            setFloraPickups((prev) => prev.filter((p) => p.id !== fx.id));
          }}
        />
      ))}
    </group>
  );
});
