import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as THREE from 'three';
import { useThree, useFrame } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import type { Collider } from '@dimforge/rapier3d-compat';
import { TerrainService } from '@features/terrain/logic/terrainService';
import { metadataDB } from '@state/MetadataDB';
import { simulationManager, SimUpdate } from '@features/flora/logic/SimulationManager';
import { useInventoryStore, useInventoryStore as useGameStore } from '@state/InventoryStore';
import { useWorldStore, FloraHotspot } from '@state/WorldStore';
import { DIG_RADIUS, DIG_STRENGTH, CHUNK_SIZE_XZ, RENDER_DISTANCE, PAD, TOTAL_SIZE_XZ, TOTAL_SIZE_Y, MESH_Y_OFFSET } from '@/constants';
import { MaterialType, ChunkState } from '@/types';
import { ChunkMesh } from '@features/terrain/components/ChunkMesh';
import { RootHollow } from '@features/flora/components/RootHollow';
import { FallingTree } from '@features/flora/components/FallingTree';
import { VEGETATION_ASSETS } from '@features/terrain/logic/VegetationConfig';
import { terrainRuntime } from '@features/terrain/logic/TerrainRuntime';


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

/**
 * Convert chunk-local flora positions into world-space hotspots for UI overlays.
 */
const buildFloraHotspots = (
  positions: Float32Array | undefined
): FloraHotspot[] => {
  if (!positions || positions.length === 0) return [];

  const hotspots: FloraHotspot[] = [];

  for (let i = 0; i < positions.length; i += 4) {
    hotspots.push({
      x: positions[i],
      z: positions[i + 2]
    });
  }

  return hotspots;
};

const LeafPickupEffect = ({
  start,
  color = '#00FFFF',
  onDone
}: {
  start: THREE.Vector3;
  color?: string;
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
      <octahedronGeometry args={[0.15, 0]} />
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

    const worker = new Worker(new URL('../workers/terrain.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    // Send Configuration immediately
    worker.postMessage({ type: 'CONFIGURE', payload: { worldType } });

    worker.onmessage = (e) => {
      const { type, payload } = e.data;

      if (type === 'GENERATED') {
        const { key, metadata, material, floraPositions, treePositions, rootHollowPositions } = payload;
        pendingChunks.current.delete(key);

        // Log flora positions for debugging
        if (floraPositions && floraPositions.length > 0) {
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

        const newChunk: ChunkState = {
          ...payload,
          floraPositions, // Lumina flora (for hotspots)
          treePositions,  // Surface trees
          rootHollowPositions, // Persist root hollow positions
          terrainVersion: 0,
          visualVersion: 0
        };
        // Register chunk arrays for runtime queries (water, interaction probes, etc).
        terrainRuntime.registerChunk(key, payload.cx, payload.cz, payload.density, payload.material);
        chunksRef.current[key] = newChunk;
        setChunks(prev => ({ ...prev, [key]: newChunk }));
      } else if (type === 'REMESHED') {
        const { key, meshPositions, meshIndices, meshMatWeightsA, meshMatWeightsB, meshMatWeightsC, meshMatWeightsD, meshNormals, meshWetness, meshMossiness, meshCavity, meshWaterPositions, meshWaterIndices, meshWaterNormals } = payload;
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
            meshWaterNormals
          };
          chunksRef.current[key] = updatedChunk;
          setChunks(prev => ({ ...prev, [key]: updatedChunk }));
        }
      }
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

    // Update simulation player position
    simulationManager.updatePlayerPosition(px, pz);

    const neededKeys = new Set<string>();
    let changed = false;

    for (let x = -RENDER_DISTANCE; x <= RENDER_DISTANCE; x++) {
      for (let z = -RENDER_DISTANCE; z <= RENDER_DISTANCE; z++) {
        const cx = px + x;
        const cz = pz + z;
        const key = `${cx},${cz}`;
        neededKeys.add(key);

        if (!chunksRef.current[key] && !pendingChunks.current.has(key)) {
          pendingChunks.current.add(key);
          workerRef.current.postMessage({ type: 'GENERATE', payload: { cx, cz } });
        }
      }
    }

    const newChunks = { ...chunksRef.current };
    Object.keys(newChunks).forEach(key => {
      if (!neededKeys.has(key)) {
        simulationManager.removeChunk(key);
        useWorldStore.getState().clearFloraHotspots(key);
        terrainRuntime.unregisterChunk(key);
        delete newChunks[key];
        changed = true;
      }
    });

    if (changed) {
      chunksRef.current = newChunks;
      setChunks(newChunks);
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
    if (!isInteracting || !action) return;

    const origin = camera.position.clone();
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const maxRayDistance = 16.0;

    const ray = new rapier.Ray(origin, direction);

    // 0. CHECK FOR PLACED FLORA INTERACTION (HARVEST) — stop if we hit flora first (physics-free check)
    if (action === 'DIG') {
      const floraId = rayHitsFlora(origin, direction, maxRayDistance);
      if (floraId) {
        useWorldStore.getState().removeEntity(floraId);
        useGameStore.getState().harvestFlora();
        return;
      }
    }

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
        let anyLuminaHit = false;

        for (const key of checkKeys) {
          const chunk = chunksRef.current[key];
          if (!chunk) continue;

          const chunkOriginX = chunk.cx * CHUNK_SIZE_XZ;
          const chunkOriginZ = chunk.cz * CHUNK_SIZE_XZ;

          // Use a slightly larger radius for trees to ensure we catch them
          // DIG_RADIUS is typically 2-3 units.
          const dist = origin.distanceTo(impactPoint);
          const digRadius = (dist < 3.0) ? 1.5 : DIG_RADIUS;

          // 1. Check Lumina Flora (generated caverns) via chunk data (no physics bodies)
          if (chunk.floraPositions) {
            const positions = chunk.floraPositions;
            const hitIndices: number[] = [];

            for (let i = 0; i < positions.length; i += 4) {
              // POSITIONS ARE ALREADY WORLD SPACE
              // Do NOT add chunkOriginX/Z again!
              const x = positions[i];
              const y = positions[i + 1];
              const z = positions[i + 2];

              const dx = impactPoint.x - x;
              const dz = impactPoint.z - z;
              const dy = impactPoint.y - y;

              // Lumina bulbs are small; allow a bit more Y tolerance
              // AAA FIX: Tighter Radius for Flora Removal
              // Was (digRadius + 0.6), which is huge. Reduced to digRadius * 0.7 to only remove what we touch.
              const removalRadius = digRadius * 0.7;
              const distSq = dx * dx + dz * dz + (dy > 0 && dy < 2.0 ? 0 : dy * dy);
              if (distSq < removalRadius * removalRadius) {
                hitIndices.push(i);
              }
            }

            if (hitIndices.length > 0) {
              anyFloraHit = true;
              anyLuminaHit = true;

              const newCount = (positions.length / 4) - hitIndices.length;
              const newPositions = new Float32Array(newCount * 4);
              let destIdx = 0;
              let currentHitIdx = 0;
              hitIndices.sort((a, b) => a - b);

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

              const updatedChunk = { ...chunk, floraPositions: newPositions, visualVersion: chunk.visualVersion + 1 };
              chunksRef.current[key] = updatedChunk;
              setChunks(prev => ({ ...prev, [key]: updatedChunk }));
            }
          }

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

        if (anyLuminaHit) {
          useGameStore.getState().harvestFlora();
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
            workerRef.current!.postMessage({
              type: 'REMESH',
              payload: {
                key,
                cx: chunk.cx,
                cz: chunk.cz,
                density: chunk.density,
                material: chunk.material,
                wetness: metadata.wetness,
                mossiness: metadata.mossiness,
                version: chunk.terrainVersion // Pass version (ignored on return)
              }
            });
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
    </group>
  );
};
