import React, { useEffect, useRef, useState, useMemo, startTransition } from 'react';
import * as THREE from 'three';
import { useThree, useFrame } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import type { Collider } from '@dimforge/rapier3d-compat';
import { TerrainService } from '@features/terrain/logic/terrainService';
import { metadataDB } from '@state/MetadataDB';
import { simulationManager, SimUpdate } from '@features/flora/logic/SimulationManager';
import { useInventoryStore, useInventoryStore as useGameStore } from '@state/InventoryStore';
import { useWorldStore, FloraHotspot } from '@state/WorldStore';
import { usePhysicsItemStore } from '@state/PhysicsItemStore';
import { DIG_RADIUS, DIG_STRENGTH, CHUNK_SIZE_XZ, RENDER_DISTANCE, PAD, TOTAL_SIZE_XZ, TOTAL_SIZE_Y, MESH_Y_OFFSET } from '@/constants';
import { MaterialType, ChunkState, ItemType } from '@/types';
import { ChunkMesh } from '@features/terrain/components/ChunkMesh';
import { RootHollow } from '@features/flora/components/RootHollow';
import { FallingTree } from '@features/flora/components/FallingTree';
import { VEGETATION_ASSETS } from '@features/terrain/logic/VegetationConfig';
import { terrainRuntime } from '@features/terrain/logic/TerrainRuntime';
import { deleteChunkFireflies, setChunkFireflies } from '@features/environment/fireflyRegistry';


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
  chunks: Record<string, ChunkState>,
  worldPoint: THREE.Vector3
): MaterialType => {
  const cx = Math.floor(worldPoint.x / CHUNK_SIZE_XZ);
  const cz = Math.floor(worldPoint.z / CHUNK_SIZE_XZ);
  const key = `${cx},${cz}`;
  const chunk = chunks[key];
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
    if (flora.type !== 'FLORA') continue;

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
    if (ent.type !== 'TORCH') continue;
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
  chunks: Record<string, ChunkState>,
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
      const chunk = chunks[key];
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
  chunks: Record<string, ChunkState>,
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
    const chunk = chunks[key];
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
      const chunk = chunks[key];
      if (!chunk) continue;
      if (chunk.stickPositions && chunk.stickPositions.length > 0) consider(key, 'stickPositions', chunk.stickPositions);
      if (chunk.rockPositions && chunk.rockPositions.length > 0) consider(key, 'rockPositions', chunk.rockPositions);
    }
  }

  return best;
};

/**
 * Convert chunk-local flora positions into world-space hotspots for UI overlays.
 */
const buildFloraHotspots = (
  positions: Float32Array | undefined
): FloraHotspot[] => {
  if (!positions || positions.length === 0) return [];

  const hotspots: FloraHotspot[] = [];

  for (let i = 0; i < positions.length; i += 4) {
    // Picked/removed lumina flora is "hidden" by sending it far below the world.
    // Skip those entries so UI hotspots remain accurate.
    if (positions[i + 1] < -9999) continue;
    hotspots.push({
      x: positions[i],
      z: positions[i + 2]
    });
  }

  return hotspots;
};

const buildChunkLocalHotspots = (
  cx: number,
  cz: number,
  positions: Float32Array | undefined
): FloraHotspot[] => {
  if (!positions || positions.length === 0) return [];

  const originX = cx * CHUNK_SIZE_XZ;
  const originZ = cz * CHUNK_SIZE_XZ;
  const hotspots: FloraHotspot[] = [];

  // stride 8: x, y, z, nx, ny, nz, variant, seed
  for (let i = 0; i < positions.length; i += 8) {
    if (positions[i + 1] < -9999) continue;
    hotspots.push({
      x: originX + positions[i + 0],
      z: originZ + positions[i + 2]
    });
  }

  return hotspots;
};

const LeafPickupEffect = ({
  start,
  color = '#00FFFF',
  geometry = 'octahedron',
  onDone
}: {
  start: THREE.Vector3;
  color?: string;
  geometry?: 'octahedron' | 'sphere';
  onDone: () => void;
}) => {
  const { camera } = useThree();
  const meshRef = useRef<THREE.Mesh>(null);
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

  return (
    <mesh ref={meshRef} castShadow receiveShadow>
      {geometry === 'sphere' ? (
        <sphereGeometry args={[0.13, 12, 10]} />
      ) : (
        <octahedronGeometry args={[0.15, 0]} />
      )}
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={1.2}
        roughness={0.3}
        metalness={0.0}
        toneMapped={false}
      />
    </mesh>
  );
};

type ParticleKind = 'debris' | 'spark';

const Particles = ({
  burstId,
  active,
  position,
  color,
  direction,
  kind
}: {
  burstId: number;
  active: boolean;
  position: THREE.Vector3;
  color: string;
  // Direction of ejection (usually from the surface toward the camera).
  direction: THREE.Vector3;
  kind: ParticleKind;
}) => {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const count = 28;
  const lifetimes = useRef<number[]>(new Array(count).fill(0));
  // IMPORTANT: Do not use fill(new Vector3()) because it creates shared references.
  const velocities = useRef<THREE.Vector3[]>(Array.from({ length: count }, () => new THREE.Vector3()));
  const baseScales = useRef<number[]>(new Array(count).fill(1));
  const meshMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const tmpDir = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    // Ignore the initial mount (burstId starts at 0).
    if (burstId === 0) return;
    if (mesh.current && meshMatRef.current) {
      mesh.current.visible = true;
      meshMatRef.current.color.set(color);
      meshMatRef.current.emissive.set(color);
      // Make sparks read clearly even in bright scenes.
      meshMatRef.current.emissiveIntensity = kind === 'spark' ? 1.35 : 0.35;
      meshMatRef.current.transparent = kind === 'spark';
      meshMatRef.current.opacity = kind === 'spark' ? 0.95 : 1.0;
      meshMatRef.current.depthWrite = kind !== 'spark';
      meshMatRef.current.blending = kind === 'spark' ? THREE.AdditiveBlending : THREE.NormalBlending;
      meshMatRef.current.roughness = kind === 'spark' ? 0.15 : 0.8;
      meshMatRef.current.metalness = kind === 'spark' ? 0.25 : 0.0;
      meshMatRef.current.needsUpdate = true;

      // Normalize direction once per burst.
      tmpDir.copy(direction);
      if (tmpDir.lengthSq() < 1e-6) tmpDir.set(0, 1, 0);
      tmpDir.normalize();

      for (let i = 0; i < count; i++) {
        dummy.position.copy(position);
        // Small spatial jitter so the burst isn't a single point.
        const jitter = kind === 'spark' ? 0.10 : 0.22;
        dummy.position.x += (Math.random() - 0.5) * jitter;
        dummy.position.y += (Math.random() - 0.5) * jitter;
        dummy.position.z += (Math.random() - 0.5) * jitter;
        // Sparks are thinner; debris are chunkier.
        const baseScale = kind === 'spark' ? 0.06 : 0.14;
        const scaleVar = kind === 'spark' ? 0.05 : 0.18;
        const s = baseScale + Math.random() * scaleVar;
        baseScales.current[i] = s;
        dummy.scale.setScalar(s);
        dummy.updateMatrix();
        mesh.current.setMatrixAt(i, dummy.matrix);
        lifetimes.current[i] = (kind === 'spark' ? 0.16 : 0.28) + Math.random() * (kind === 'spark' ? 0.18 : 0.42);

        // Reuse velocity objects to avoid per-burst GC.
        const v = velocities.current[i];
        // Burst mostly outward from the hit point with some spread.
        const spread = kind === 'spark' ? 0.7 : 1.1;
        v.copy(tmpDir).multiplyScalar(kind === 'spark' ? 10.5 : 7.5);
        // Avoid per-particle allocations in hot paths.
        const randX = (Math.random() - 0.5) * spread * (kind === 'spark' ? 2.6 : 3.2);
        const randY = (Math.random() * 1.0) * spread * (kind === 'spark' ? 2.6 : 3.2);
        const randZ = (Math.random() - 0.5) * spread * (kind === 'spark' ? 2.6 : 3.2);
        v.x += randX;
        v.y += randY;
        v.z += randZ;
        // Ensure some upward lift so debris doesn't immediately vanish into the surface.
        v.y = Math.max(v.y, kind === 'spark' ? 2.0 : 3.0);
      }
      mesh.current.instanceMatrix.needsUpdate = true;
    }
    // NOTE: We intentionally key this effect off burstId so repeated clicks always re-trigger the burst.
  }, [burstId, position, color, direction, kind, dummy, tmpDir]);

  useFrame((_, delta) => {
    if (!mesh.current || !mesh.current.visible) return;
    let activeCount = 0;
    for (let i = 0; i < count; i++) {
      if (lifetimes.current[i] > 0) {
        lifetimes.current[i] -= delta;
        mesh.current.getMatrixAt(i, dummy.matrix);
        dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);
        const v = velocities.current[i];
        // Gravity + simple drag. Sparks fall faster and damp quicker.
        const gravity = kind === 'spark' ? 32.0 : 25.0;
        v.y -= gravity * delta;
        const drag = kind === 'spark' ? 6.0 : 3.5;
        v.multiplyScalar(Math.max(0, 1.0 - drag * delta));

        dummy.position.addScaledVector(v, delta);

        // Spin debris more; sparks can be subtle.
        if (kind !== 'spark') {
          dummy.rotation.x += delta * 10;
          dummy.rotation.z += delta * 5;
        }

        // Fade out via scale to avoid per-instance opacity.
        const t = Math.max(0, lifetimes.current[i]);
        const fade = kind === 'spark' ? t * t : t;
        dummy.scale.setScalar(baseScales.current[i] * Math.max(0.0, Math.min(1.0, fade)));
        dummy.updateMatrix();
        mesh.current.setMatrixAt(i, dummy.matrix);
        activeCount++;
      }
    }
    mesh.current.instanceMatrix.needsUpdate = true;
    if (activeCount === 0 && !active) mesh.current.visible = false;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]} visible={false} frustumCulled={false}>
      {/* Slightly more organic than cubes (better read at small sizes). */}
      <icosahedronGeometry args={[0.12, 0]} />
      <meshStandardMaterial ref={meshMatRef} color="#fff" roughness={0.8} toneMapped={false} />
    </instancedMesh>
  );
};

interface VoxelTerrainProps {
  action: 'DIG' | 'BUILD' | null;
  isInteracting: boolean;
  sunDirection?: THREE.Vector3;
  // Debug: 0..1 slider to reduce high-frequency triplanar noise contribution in the shader.
  triplanarDetail?: number;
  // Debug: independently toggle the terrain's fog paths.
  // - "Shader fog" is the custom fog mix inside TriplanarMaterial.
  // - "Three fog" is the base MeshStandardMaterial fog (can stack with shader fog).
  terrainShaderFogEnabled?: boolean;
  terrainShaderFogStrength?: number;
  terrainThreeFogEnabled?: boolean;
  // Debug: disable chunk fade-in to isolate transparency/depth sorting seam artifacts.
  terrainFadeEnabled?: boolean;
  // Debug: isolate shading overlays and specular shimmer sources.
  terrainWetnessEnabled?: boolean;
  terrainMossEnabled?: boolean;
  terrainRoughnessMin?: number;
  // Debug: Z-fighting probe.
  terrainPolygonOffsetEnabled?: boolean;
  terrainPolygonOffsetFactor?: number;
  terrainPolygonOffsetUnits?: number;
  // Debug: visualize chunk overlap/material weights.
  terrainChunkTintEnabled?: boolean;
  terrainWireframeEnabled?: boolean;
  terrainWeightsView?: string;
  onInitialLoad?: () => void;
  worldType: string;
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
    audio.playbackRate = 1.0 + (Math.random() * pitchVar * 2 - pitchVar);

    audio.play().catch(e => console.warn("Audio play failed", e));
  }
}

export const VoxelTerrain: React.FC<VoxelTerrainProps> = ({
  action,
  isInteracting,
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
  onInitialLoad,
  worldType
}) => {
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
  const treeDamageRef = useRef<Map<string, number>>(new Map());

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

  const [chunks, setChunks] = useState<Record<string, ChunkState>>({});
  const chunksRef = useRef<Record<string, ChunkState>>({});
  const workerRef = useRef<Worker | null>(null);
  const pendingChunks = useRef<Set<string>>(new Set());
  // Queue chunk generation requests so we can throttle how many we send per frame.
  // This spreads out the worker responses and main-thread geometry/collider work.
  const generateQueue = useRef<Array<{ cx: number; cz: number; key: string }>>([]);
  // Buffer worker messages so we can apply them at a controlled cadence (reduces hitching).
  const workerMessageQueue = useRef<Array<{ type: string; payload: any }>>([]);
  const workerMessageHead = useRef(0);

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
  const COLLIDER_RADIUS = 1; // Chebyshev distance (0 => current chunk only; 1 => 3x3)
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
  const [floraPickups, setFloraPickups] = useState<Array<{ id: string; start: THREE.Vector3; color?: string }>>([]);

  const [fallingTrees, setFallingTrees] = useState<Array<{ id: string; position: THREE.Vector3; type: number; seed: number }>>([]);

  useEffect(() => {
    simulationManager.start();

    simulationManager.setCallback((updates: SimUpdate[]) => {
      updates.forEach(update => {
        const chunk = chunksRef.current[update.key];
        if (chunk) {
          chunk.material.set(update.material);
          remeshQueue.current.add(update.key);
        }
      });
    });

    // Restore the simpler worker model (as of 8d1ef30): a single `terrain.worker.ts`
    // generates voxel fields + meshes. This avoids chunk-boundary React rerenders introduced by
    // collider-gating and reduces pipeline complexity while we chase streaming hitches.
    const worker = new Worker(new URL('../workers/terrain.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    // Send configuration immediately
    worker.postMessage({ type: 'CONFIGURE', payload: { worldType } });

    worker.onmessage = (e) => {
      // Buffer all messages; we apply them in `useFrame` to control cadence and reduce hitches.
      workerMessageQueue.current.push(e.data);
    };

    return () => worker.terminate();
  }, []);

  useEffect(() => {
    if (initialLoadTriggered.current || !onInitialLoad) return;

    // Check if central chunks are ready (3x3 grid around 0,0)
    // 3x3 is enough to cover the immediate view so player doesn't see void
    const essentialKeys = [
      '0,0', '0,1', '0,-1', '1,0', '-1,0',
      '1,1', '1,-1', '-1,1', '-1,-1'
    ];

    const allLoaded = essentialKeys.every(key => chunks[key]);

    if (allLoaded) {
      initialLoadTriggered.current = true;
      onInitialLoad();
    }
  }, [chunks, onInitialLoad]);

  useFrame(() => {
    if (!camera || !workerRef.current) return;

    const px = Math.floor(camera.position.x / CHUNK_SIZE_XZ);
    const pz = Math.floor(camera.position.z / CHUNK_SIZE_XZ);
    playerChunk.current.px = px;
    playerChunk.current.pz = pz;

    // Drive initial load from the authoritative ref, not React state: during streaming we may
    // intentionally deprioritize state updates to reduce hitches.
    if (!initialLoadTriggered.current && onInitialLoad) {
      const essentialKeys = [
        `${px},${pz}`, `${px},${pz + 1}`, `${px},${pz - 1}`, `${px + 1},${pz}`, `${px - 1},${pz}`,
        `${px + 1},${pz + 1}`, `${px + 1},${pz - 1}`, `${px - 1},${pz + 1}`, `${px - 1},${pz - 1}`
      ];
      const allLoaded = essentialKeys.every(key => chunksRef.current[key]);
      if (allLoaded) {
        initialLoadTriggered.current = true;
        onInitialLoad();
      }
    }

    // Update movement direction estimate (world-space) for forward-shifted streaming window.
    if (!hasPrevCamPos.current) {
      prevCamPos.current.copy(camera.position);
      hasPrevCamPos.current = true;
    } else {
      const dx = camera.position.x - prevCamPos.current.x;
      const dz = camera.position.z - prevCamPos.current.z;
      const speedSq = dx * dx + dz * dz;
      // Only update direction when we are actually moving (prevents churn when rotating in place).
      if (speedSq > 0.0004) {
        tmpMoveDir.current.set(dx, 0, dz).normalize();
        // Smooth direction so tiny jitter doesn't thrash the streaming center.
        streamForward.current.lerp(tmpMoveDir.current, 0.25).normalize();
      }
      prevCamPos.current.copy(camera.position);
    }

    // Update simulation player position
    simulationManager.updatePlayerPosition(px, pz);

    const neededKeys = new Set<string>();
    let changed = false;

    const shift = 1;
    const axisThreshold = 0.35;
    const offsetCx = Math.abs(streamForward.current.x) > axisThreshold ? Math.sign(streamForward.current.x) * shift : 0;
    const offsetCz = Math.abs(streamForward.current.z) > axisThreshold ? Math.sign(streamForward.current.z) * shift : 0;
    const centerCx = px + offsetCx;
    const centerCz = pz + offsetCz;
    streamCenter.current.cx = centerCx;
    streamCenter.current.cz = centerCz;

    for (let x = -RENDER_DISTANCE; x <= RENDER_DISTANCE; x++) {
      for (let z = -RENDER_DISTANCE; z <= RENDER_DISTANCE; z++) {
        const cx = centerCx + x;
        const cz = centerCz + z;
        const key = `${cx},${cz}`;
        neededKeys.add(key);

        if (!chunksRef.current[key] && !pendingChunks.current.has(key)) {
          pendingChunks.current.add(key);
          generateQueue.current.push({ cx, cz, key });
        }
      }
    }
    neededKeysRef.current = neededKeys;

    // Throttle chunk generation: only send 1 request per frame to spread out
    // worker responses and main-thread geometry/collider build work.
    // Prefer nearest-to-player chunks first.
    if (generateQueue.current.length > 0) {
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
      workerRef.current.postMessage({ type: 'GENERATE', payload: { cx: job.cx, cz: job.cz } });
    }

    // Apply at most 1 worker message per frame (chunk mount / remesh is the main-thread hitch source).
    // Messages are FIFO, but we can safely drop generated chunks that are no longer needed.
    const msg = workerMessageHead.current < workerMessageQueue.current.length
      ? workerMessageQueue.current[workerMessageHead.current++]
      : null;
    let appliedWorkerMessageThisFrame = false;
    if (msg) {
      appliedWorkerMessageThisFrame = true;
      // Compact queue periodically to avoid unbounded growth when head advances.
      if (workerMessageHead.current > 64 && workerMessageHead.current > workerMessageQueue.current.length / 2) {
        workerMessageQueue.current = workerMessageQueue.current.slice(workerMessageHead.current);
        workerMessageHead.current = 0;
      }

      const { type, payload } = msg as { type: string; payload: any };
      if (type === 'GENERATED') {
        const { key, metadata, material, floraPositions, treePositions, stickPositions, rockPositions, largeRockPositions, rootHollowPositions, fireflyPositions } = payload;
        pendingChunks.current.delete(key);

        // If the chunk is already out of the active window, drop it instead of mounting it.
        if (!neededKeysRef.current.has(key)) {
          if (streamDebug) console.log('[VoxelTerrain] Drop generated chunk (not needed):', key);
        } else {
          // Log flora positions for debugging
          if (streamDebug && floraPositions && floraPositions.length > 0) {
            console.log('[VoxelTerrain] Chunk', key, 'has', floraPositions.length / 4, 'lumina flora positions');
          }

          // Check if metadata exists before initializing
          if (metadata) {
            metadataDB.initChunk(key, metadata);
            simulationManager.addChunk(key, payload.cx, payload.cz, material, metadata.wetness, metadata.mossiness);
          } else {
            // Fallback if worker didn't send metadata structure
            console.warn('[VoxelTerrain] Received chunk without metadata', key);
          }

          useWorldStore.getState().setFloraHotspots(
            key,
            buildFloraHotspots(floraPositions)
          );
          useWorldStore.getState().setStickHotspots(
            key,
            buildChunkLocalHotspots(payload.cx, payload.cz, stickPositions)
          );
          useWorldStore.getState().setRockHotspots(
            key,
            buildChunkLocalHotspots(payload.cx, payload.cz, rockPositions)
          );

          // Defer collider creation to a later frame (reduces "chunk arrived" hitches).
          // Exception: during initial boot, keep physics in a 3x3 so the player can immediately move.
          const dCheby = Math.max(Math.abs(payload.cx - px), Math.abs(payload.cz - pz));
          const colliderEnabled = !initialLoadTriggered.current
            ? dCheby <= COLLIDER_RADIUS
            : (payload.cx === px && payload.cz === pz);

          const newChunk: ChunkState = {
            ...payload,
            colliderEnabled,
            floraPositions, // Lumina flora (for hotspots)
            treePositions,  // Surface trees
            stickPositions, // Surface sticks (forage)
            rockPositions, // Stones (forage)
            largeRockPositions, // Large rocks (obstacles)
            rootHollowPositions, // Persist root hollow positions
            fireflyPositions, // Ambient fireflies (persisted per chunk)
            terrainVersion: 0,
            visualVersion: 0,
            // Used to time-fade chunks into view (hides render-distance pop-in).
            spawnedAt: performance.now() / 1000
          };

          // Register ambient fireflies for renderers (AmbientLife) without tightly coupling
          // that system to the terrain chunk state shape.
          setChunkFireflies(key, fireflyPositions);

          // Register chunk arrays for runtime queries (water, interaction probes, etc).
          terrainRuntime.registerChunk(key, payload.cx, payload.cz, payload.density, payload.material);
          chunksRef.current[key] = newChunk;
          if (initialLoadTriggered.current) {
            startTransition(() => {
              setChunks(prev => ({ ...prev, [key]: newChunk }));
            });
          } else {
            setChunks(prev => ({ ...prev, [key]: newChunk }));
          }
        }
      } else if (type === 'REMESHED') {
        const {
          key,
          meshPositions,
          meshIndices,
          meshMatWeightsA,
          meshMatWeightsB,
          meshMatWeightsC,
          meshMatWeightsD,
          meshNormals,
          meshWetness,
          meshMossiness,
          meshCavity,
          meshWaterPositions,
          meshWaterIndices,
          meshWaterNormals,
          meshWaterShoreMask
        } = payload;

        const current = chunksRef.current[key];
        if (current) {
          const updatedChunk = {
            ...current,
            terrainVersion: current.terrainVersion + 1, // Assume geometry change for remesh
            visualVersion: current.visualVersion + 1,
            meshPositions,
            meshIndices,
            meshMatWeightsA,
            meshMatWeightsB,
            meshMatWeightsC,
            meshMatWeightsD,
            meshNormals,
            meshWetness: meshWetness || current.meshWetness, // Fallback if missing
            meshMossiness: meshMossiness || current.meshMossiness, // Fallback if missing
            meshCavity: meshCavity || current.meshCavity, // Fallback if missing
            meshWaterPositions,
            meshWaterIndices,
            meshWaterNormals,
            meshWaterShoreMask: meshWaterShoreMask || current.meshWaterShoreMask
          };
          chunksRef.current[key] = updatedChunk;
          if (initialLoadTriggered.current) {
            startTransition(() => {
              setChunks(prev => ({ ...prev, [key]: updatedChunk }));
            });
          } else {
            setChunks(prev => ({ ...prev, [key]: updatedChunk }));
          }
        }
      }
    }

    const newChunks = { ...chunksRef.current };
    Object.keys(newChunks).forEach(key => {
      if (!neededKeys.has(key)) {
        simulationManager.removeChunk(key);
        useWorldStore.getState().clearFloraHotspots(key);
        useWorldStore.getState().clearStickHotspots(key);
        useWorldStore.getState().clearRockHotspots(key);
        deleteChunkFireflies(key);
        terrainRuntime.unregisterChunk(key);
        delete newChunks[key];
        changed = true;
      }
    });

    if (changed) {
      chunksRef.current = newChunks;
      if (initialLoadTriggered.current) {
        startTransition(() => {
          setChunks(newChunks);
        });
      } else {
        setChunks(newChunks);
      }
    }

    // Queue collider enables for nearby chunks, then enable at most 1 per frame.
    // This reduces the chance of a single frame doing both "new chunk mount" AND "collider build".
    const colliderCenterKey = `${px},${pz}`;
    if (colliderCenterKey !== lastColliderCenterKey.current) {
      lastColliderCenterKey.current = colliderCenterKey;
      colliderEnableQueue.current.length = 0;
      colliderEnablePending.current.clear();
    }
    {
      const candidates = new Set<string>();
      const addRadius = (cx: number, cz: number, r: number) => {
        for (let dx = -r; dx <= r; dx++) {
          for (let dz = -r; dz <= r; dz++) {
            candidates.add(`${cx + dx},${cz + dz}`);
          }
        }
      };
      // Always keep physics around the player.
      addRadius(px, pz, COLLIDER_RADIUS);
      // Pre-build colliders slightly ahead in the movement direction.
      addRadius(px + offsetCx, pz + offsetCz, COLLIDER_RADIUS);

      for (const key of candidates) {
        const c = chunksRef.current[key];
        if (!c) continue;
        if (c.colliderEnabled) continue;
        if (colliderEnablePending.current.has(key)) continue;
        colliderEnablePending.current.add(key);
        colliderEnableQueue.current.push(key);
      }
    }

    // Only enable a collider on frames where we didn't also apply a worker chunk/remesh.
    if (!appliedWorkerMessageThisFrame && colliderEnableQueue.current.length > 0) {
      const key = colliderEnableQueue.current.shift();
      if (key) {
        colliderEnablePending.current.delete(key);
        const current = chunksRef.current[key];
        if (current && !current.colliderEnabled) {
          const updated = { ...current, colliderEnabled: true };
          chunksRef.current[key] = updated;
          if (initialLoadTriggered.current) {
            startTransition(() => {
              setChunks(prev => ({ ...prev, [key]: updated }));
            });
          } else {
            setChunks(prev => ({ ...prev, [key]: updated }));
          }
        }
      }
    }

    if (remeshQueue.current.size > 0) {
      const maxPerFrame = 8;
      const iterator = remeshQueue.current.values();
      for (let i = 0; i < maxPerFrame; i++) {
        const key = iterator.next().value as string | undefined;
        if (!key) break;
        remeshQueue.current.delete(key);

        const chunk = chunksRef.current[key];
        const metadata = metadataDB.getChunk(key);

        if (chunk && metadata) {
          workerRef.current.postMessage({
            type: 'REMESH',
            payload: {
              key,
              cx: chunk.cx,
              cz: chunk.cz,
              density: chunk.density,
              material: chunk.material,
              wetness: metadata['wetness'],
              mossiness: metadata['mossiness'],
              version: chunk.terrainVersion // Pass current version (will be echoed but we ignore it)
            }
          });
        }
      }
    }
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
      const luminaHit = rayHitsGeneratedLuminaFlora(chunksRef.current, origin, dir, maxDist, 0.55);
      const groundHit = rayHitsGeneratedGroundPickup(chunksRef.current, origin, dir, maxDist, 0.55);

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
        const chunk = chunksRef.current[key];
        if (!chunk?.floraPositions) return;
        const positions = chunk.floraPositions;
        if (positions.length < 4) return;

        // Keep array length stable and just "hide" the picked entry.
        // This avoids reindexing artifacts for instanced rendering.
        const next = new Float32Array(positions); // Clone
        // stride 4: x, y, z, type
        next[hit.index + 1] = -10000;

        const updatedChunk = { ...chunk, floraPositions: next };
        chunksRef.current[key] = updatedChunk;
        setChunks((prev) => ({ ...prev, [key]: updatedChunk }));
        useWorldStore.getState().setFloraHotspots(key, buildFloraHotspots(next));
      };

      const removeGround = (hit: NonNullable<typeof groundHit>) => {
        const chunk = chunksRef.current[hit.key];
        const positions = chunk?.[hit.array];
        if (!chunk || !positions || positions.length < 8) return;
        const next = new Float32Array(positions);
        next[hit.index + 1] = -10000;
        const updatedChunk = { ...chunk, [hit.array]: next };
        chunksRef.current[hit.key] = updatedChunk;
        setChunks((prev) => ({ ...prev, [hit.key]: updatedChunk }));
        if (hit.array === 'stickPositions') {
          useWorldStore.getState().setStickHotspots(hit.key, buildChunkLocalHotspots(chunk.cx, chunk.cz, next));
        } else {
          useWorldStore.getState().setRockHotspots(hit.key, buildChunkLocalHotspots(chunk.cx, chunk.cz, next));
        }
      };

      let pickedStart: THREE.Vector3 | null = null;
      let pickedItem: 'torch' | 'flora' | 'stick' | 'stone' | null = null;

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
          usePhysicsItemStore.getState().removeItem(physicsItemHit.id);

          if (physicsItemHit.type === ItemType.PICKAXE) {
              useGameStore.getState().setHasPickaxe(true);
              // Pickaxe doesn't go into inventory count, it just unlocks the tool
              // But we can show a pickup effect
              const effectId = `${Date.now()}-${Math.random()}`;
              setFloraPickups((prev) => [...prev, { id: effectId, start: pickedStart!, color: '#aaaaaa' }]);
              return; // Special case, return early or handle below?
              // Logic below expects 'pickedItem' to add to inventory count.
              // Let's just handle it here and return or set null.
          } else {
              pickedItem = physicsItemHit.type === ItemType.STICK ? 'stick'
                         : physicsItemHit.type === ItemType.STONE ? 'stone'
                         : physicsItemHit.type === ItemType.SHARD ? 'shard'
                         : null;
          }
      } else if (tTorch <= tPlaced && tTorch <= tLumina && tTorch <= tGround && torchHit) {
        pickedItem = 'torch';
        pickedStart = torchHit.position;
        useWorldStore.getState().removeEntity(torchHit.id);
      } else if (tGround <= tPlaced && tGround <= tLumina && groundHit) {
        pickedStart = groundHit.position;
        pickedItem = groundHit.array === 'stickPositions' ? 'stick' : 'stone';
        removeGround(groundHit);
      } else if (placedId && luminaHit) {
        if (placedPos) {
          if (tPlaced <= luminaHit.t) {
            pickedStart = placedPos;
            pickedItem = 'flora';
            useWorldStore.getState().removeEntity(placedId);
          } else {
            pickedStart = luminaHit.position;
            pickedItem = 'flora';
            removeLumina(luminaHit);
          }
        } else {
          // Fallback: treat as lumina if we can't read the placed entity position.
          pickedStart = luminaHit.position;
          pickedItem = 'flora';
          removeLumina(luminaHit);
        }
      } else if (placedId) {
        const ent = useWorldStore.getState().entities.get(placedId);
        const p = ent?.bodyRef?.current ? ent.bodyRef.current.translation() : ent?.position;
        if (p) {
          pickedStart = new THREE.Vector3(p.x, p.y, p.z);
        }
        pickedItem = 'flora';
        useWorldStore.getState().removeEntity(placedId);
      } else if (luminaHit) {
        pickedStart = luminaHit.position;
        pickedItem = 'flora';
        removeLumina(luminaHit);
      }

      if (pickedStart && pickedItem) {
        // Add item to inventory and play a fly-to-player pickup effect.
        useGameStore.getState().addItem(pickedItem, 1);
        const effectId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const color =
          pickedItem === 'torch' ? '#ffdbb1' :
            pickedItem === 'stick' ? '#c99a63' :
              pickedItem === 'stone' ? '#cfcfd6' :
                pickedItem === 'shard' ? '#aaaaaa' :
                '#00FFFF';
        setFloraPickups((prev) => [...prev, { id: effectId, start: pickedStart, color }]);
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

    // 0.5 CHECK FOR FLORA TREE INTERACTION (GET AXE)
    if (action === 'DIG') {
      const physicsHit = world.castRay(ray, maxRayDistance, true);
      if (physicsHit && physicsHit.collider) {
        const parent = physicsHit.collider.parent();
        // DEBUG LOGGING
        // console.log("Ray Hit:", parent?.userData); 

        if (parent && parent.userData && (parent.userData as any).type === 'flora_tree') {
          // If we hit a leaf, spawn a pickup animation from the hit point toward the camera
          if ((parent.userData as any).part === 'leaf') {
            const hitPoint = ray.pointAt((physicsHit as any).timeOfImpact ?? 0);
            setLeafPickup(new THREE.Vector3(hitPoint.x, hitPoint.y, hitPoint.z));
          }
          // Give Axe!
          console.log("Interacted with Flora Tree! Granting Axe.");
          useInventoryStore.getState().setHasAxe(true);
          return;
        }
      }
    }

    if (terrainHit) {
      const rapierHitPoint = ray.pointAt(terrainHit.timeOfImpact);
      const impactPoint = new THREE.Vector3(rapierHitPoint.x, rapierHitPoint.y, rapierHitPoint.z);
      // Sample slightly inside the surface so particles/build reflect what we actually hit.
      const samplePoint = impactPoint.clone().addScaledVector(direction, 0.2);
      const sampledMat = sampleMaterialAtWorldPoint(chunksRef.current, samplePoint);

      let isNearTree = false;

      // Check for Tree/Vegetation Interaction BEFORE modifying terrain
      if (action === 'DIG') {
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
          const chunk = chunksRef.current[key];
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

            for (let i = 0; i < positions.length; i += 4) {
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

                // AAA FIX: Tree Cutting Logic
                const treeId = `${key}-${i}`;
                const { hasAxe, currentTool } = useInventoryStore.getState();

                // Only cut if we have an axe AND it is the current tool
                const canCut = hasAxe && currentTool === 'axe';

                if (!canCut) {
                  // Play "clunk" sound via pool
                  audioPool.play(clunkUrl, 0.4, 0.4);
                  continue;
                }

                // Track damage
                // We use a static map on the component or ref? 
                // Since this is inside the loop, we need access to the ref.
                // Assuming treeDamageRef is defined in the component scope (I will add it).
                const currentDamage = (treeDamageRef.current.get(treeId) || 0) + 1;
                treeDamageRef.current.set(treeId, currentDamage);

                // Particles for hit
                const woodPos = new THREE.Vector3(x, y + 1, z);
                const woodDir = origin.clone().sub(woodPos).normalize();
                setParticleState(prev => ({
                  burstId: prev.burstId + 1,
                  active: true,
                  pos: woodPos,
                  dir: woodDir,
                  kind: 'debris',
                  color: '#8B4513' // Wood color
                }));
                setTimeout(() => setParticleState(prev => ({ ...prev, active: false })), 120);

                if (currentDamage >= 5) {
                  hitIndices.push(i);
                  treeDamageRef.current.delete(treeId);

                  // Spawn Falling Tree
                  const seed = positions[i] * 12.9898 + positions[i + 2] * 78.233;
                  setFallingTrees(prev => [...prev, {
                    id: `${key}-${i}-${Date.now()}`, // Unique ID
                    position: new THREE.Vector3(x, y, z),
                    type,
                    seed
                  }]);
                }
              }
            }

            if (hitIndices.length > 0) {
              anyFloraHit = true;
              // Remove trees from chunk (filter out hit indices)
              // We need to reconstruct the array
              const newCount = (positions.length / 4) - hitIndices.length;
              const newPositions = new Float32Array(newCount * 4);
              let destIdx = 0;
              let currentHitIdx = 0;
              hitIndices.sort((a, b) => a - b); // Ensure sorted

              for (let i = 0; i < positions.length; i += 4) {
                if (currentHitIdx < hitIndices.length && i === hitIndices[currentHitIdx]) {
                  currentHitIdx++;
                  continue;
                }
                newPositions[destIdx] = positions[i];
                newPositions[destIdx + 1] = positions[i + 1];
                newPositions[destIdx + 2] = positions[i + 2];
                newPositions[destIdx + 3] = positions[i + 3];
                destIdx += 4;
              }

              const updatedChunk = { ...chunk, treePositions: newPositions, visualVersion: chunk.visualVersion + 1 };
              chunksRef.current[key] = updatedChunk;
              setChunks(prev => ({ ...prev, [key]: updatedChunk }));
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
              chunksRef.current[key] = updatedChunk;
              setChunks(prev => ({ ...prev, [key]: updatedChunk }));
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
      const delta = action === 'DIG' ? -DIG_STRENGTH : DIG_STRENGTH;
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
          const chunk = chunksRef.current[key];
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

      if (anyModified && workerRef.current) {
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
          const chunk = chunksRef.current[key];
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

  return (
    <group>
      {Object.values(chunks).map(chunk => (
        <React.Fragment key={chunk.key}>
          <ChunkMesh
            chunk={chunk}
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
          />
          {chunk.rootHollowPositions && chunk.rootHollowPositions.length > 0 && (
            // STRIDE IS NOW 6 (x, y, z, nx, ny, nz)
            Array.from({ length: chunk.rootHollowPositions.length / 6 }).map((_, i) => (
              (
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
              )
            ))
          )}
        </React.Fragment>
      ))}
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
          geometry="sphere"
          onDone={() => {
            setFloraPickups((prev) => prev.filter((p) => p.id !== fx.id));
          }}
        />
      ))}
    </group>
  );
};
