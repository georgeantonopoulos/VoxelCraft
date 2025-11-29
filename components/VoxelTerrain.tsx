import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as THREE from 'three';
import { useThree, useFrame } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import type { Collider } from '@dimforge/rapier3d-compat';
import { TerrainService } from '../services/terrainService';
import { metadataDB } from '../services/MetadataDB';
import { simulationManager, SimUpdate } from '../services/SimulationManager';
import { useGameStore } from '../services/GameManager';
import { DIG_RADIUS, DIG_STRENGTH, VOXEL_SCALE, CHUNK_SIZE_XZ, RENDER_DISTANCE } from '../constants';
import { MaterialType, ChunkState, ChunkKey } from '../types';
import { ChunkMesh } from './ChunkMesh';
import { RootHollow } from './RootHollow';

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
  const state = useGameStore.getState();
  let closestId: string | null = null;
  let closestT = maxDist + 1;
  const tmp = new THREE.Vector3();
  const proj = new THREE.Vector3();

  // Iterate over placed flora
  for (const flora of state.placedFloras) {
    // Use the live physics position if available, otherwise fall back to initial spawn position
    const floraWithRef = flora as { id: string; position: THREE.Vector3; bodyRef: React.RefObject<any> };
    const currentPos = floraWithRef.bodyRef?.current 
      ? floraWithRef.bodyRef.current.translation() 
      : floraWithRef.position;

    // Rapier translation returns {x,y,z}, ensure it's Vector3-like
    tmp.set(currentPos.x, currentPos.y, currentPos.z).sub(origin);
    
    const t = tmp.dot(dir);
    if (t < 0 || t > maxDist) continue; // Behind camera or too far
    proj.copy(dir).multiplyScalar(t);
    tmp.sub(proj);
    const distSq = tmp.lengthSq();
    if (distSq <= floraRadius * floraRadius && t < closestT) {
      closestT = t;
      closestId = floraWithRef.id;
    }
  }

  return closestId;
};

const Particles = ({ active, position, color }: { active: boolean; position: THREE.Vector3; color: string }) => {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const count = 20;
  const lifetimes = useRef<number[]>(new Array(count).fill(0));
  const velocities = useRef<THREE.Vector3[]>(new Array(count).fill(new THREE.Vector3()));
  const meshMatRef = useRef<THREE.MeshStandardMaterial>(null);

  useEffect(() => {
    if (active && mesh.current && meshMatRef.current) {
      mesh.current.visible = true;
      meshMatRef.current.color.set(color);
      meshMatRef.current.emissive.set(color);
      meshMatRef.current.emissiveIntensity = 0.2;
      for (let i = 0; i < count; i++) {
        dummy.position.copy(position);
        dummy.position.x += (Math.random() - 0.5);
        dummy.position.y += (Math.random() - 0.5);
        dummy.position.z += (Math.random() - 0.5);
        dummy.scale.setScalar(Math.random() * 0.3 + 0.1);
        dummy.updateMatrix();
        mesh.current.setMatrixAt(i, dummy.matrix);
        lifetimes.current[i] = 0.3 + Math.random() * 0.4;
        velocities.current[i] = new THREE.Vector3(
          (Math.random() - 0.5) * 8,
          Math.random() * 8 + 4,
          (Math.random() - 0.5) * 8
        );
      }
      mesh.current.instanceMatrix.needsUpdate = true;
    }
  }, [active, position, color, dummy]);

  useFrame((_, delta) => {
    if (!mesh.current || !mesh.current.visible) return;
    let activeCount = 0;
    for (let i = 0; i < count; i++) {
      if (lifetimes.current[i] > 0) {
        lifetimes.current[i] -= delta;
        mesh.current.getMatrixAt(i, dummy.matrix);
        dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);
        velocities.current[i].y -= 25.0 * delta;
        dummy.position.addScaledVector(velocities.current[i], delta);
        dummy.rotation.x += delta * 10;
        dummy.rotation.z += delta * 5;
        dummy.scale.setScalar(Math.max(0, lifetimes.current[i]));
        dummy.updateMatrix();
        mesh.current.setMatrixAt(i, dummy.matrix);
        activeCount++;
      }
    }
    mesh.current.instanceMatrix.needsUpdate = true;
    if (activeCount === 0 && !active) mesh.current.visible = false;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]} visible={false}>
      <boxGeometry args={[0.15, 0.15, 0.15]} />
      <meshStandardMaterial ref={meshMatRef} color="#fff" roughness={0.8} toneMapped={false} />
    </instancedMesh>
  );
};

interface VoxelTerrainProps {
  action: 'DIG' | 'BUILD' | null;
  isInteracting: boolean;
  sunDirection?: THREE.Vector3;
  onInitialLoad?: () => void;
}

export const VoxelTerrain: React.FC<VoxelTerrainProps> = ({ action, isInteracting, sunDirection, onInitialLoad }) => {
  const { camera } = useThree();
  const { world, rapier } = useRapier();

  const [buildMat, setBuildMat] = useState<MaterialType>(MaterialType.STONE);
  const remeshQueue = useRef<Set<string>>(new Set());
  const initialLoadTriggered = useRef(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '1') setBuildMat(MaterialType.DIRT);
      if (e.key === '2') setBuildMat(MaterialType.STONE);
      if (e.key === '3') setBuildMat(MaterialType.WATER);
      if (e.key === '4') setBuildMat(MaterialType.MOSSY_STONE);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const [chunks, setChunks] = useState<Record<string, ChunkState>>({});
  const chunksRef = useRef<Record<string, ChunkState>>({});
  const workerRef = useRef<Worker | null>(null);
  const pendingChunks = useRef<Set<string>>(new Set());

  const [particleState, setParticleState] = useState<{ active: boolean; pos: THREE.Vector3; color: string }>({
    active: false,
    pos: new THREE.Vector3(),
    color: '#fff'
  });

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

    worker.onmessage = (e) => {
      const { type, payload } = e.data;

      if (type === 'GENERATED') {
        const { key, metadata, material, floraPositions, rootHollowPositions } = payload;
        pendingChunks.current.delete(key);
        
        // Log flora positions for debugging
        if (floraPositions && floraPositions.length > 0) {
            console.log('[VoxelTerrain] Chunk', key, 'has', floraPositions.length / 3, 'flora positions');
        }
        
        // Check if metadata exists before initializing
        if (metadata) {
            metadataDB.initChunk(key, metadata);
            simulationManager.addChunk(key, payload.cx, payload.cz, material, metadata.wetness, metadata.mossiness);
        } else {
            // Fallback if worker didn't send metadata structure
            console.warn('[VoxelTerrain] Received chunk without metadata', key);
        }

        const newChunk: ChunkState = {
            ...payload,
            floraPositions, // Persist flora positions
            rootHollowPositions, // Persist root hollow positions
            terrainVersion: 0,
            visualVersion: 0
        };
        chunksRef.current[key] = newChunk;
        setChunks(prev => ({ ...prev, [key]: newChunk }));
      } else if (type === 'REMESHED') {
        const { key, meshPositions, meshIndices, meshMaterials, meshMaterials2, meshMaterials3, meshWeights, meshNormals, meshWetness, meshMossiness, meshWaterPositions, meshWaterIndices, meshWaterNormals } = payload;
        const current = chunksRef.current[key];
        if (current) {
          const updatedChunk = {
            ...current,
            terrainVersion: current.terrainVersion + 1, // Assume geometry change for remesh
            visualVersion: current.visualVersion + 1,
            meshPositions,
            meshIndices,
            meshMaterials,
            meshMaterials2,
            meshMaterials3,
            meshWeights,
            meshNormals,
            meshWetness: meshWetness || current.meshWetness, // Fallback if missing
            meshMossiness: meshMossiness || current.meshMossiness, // Fallback if missing
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

    // 0. CHECK FOR FLORA INTERACTION (HARVEST) — stop if we hit flora first (physics-free check)
    if (action === 'DIG') {
      const floraId = rayHitsFlora(origin, direction, maxRayDistance);
      if (floraId) {
        useGameStore.getState().harvestFlora(floraId);
        return;
      }
    }

    const terrainHit = world.castRay(ray, maxRayDistance, true, undefined, undefined, undefined, undefined, isTerrainCollider);

    if (terrainHit) {
      const rapierHitPoint = ray.pointAt(terrainHit.timeOfImpact);
      const impactPoint = new THREE.Vector3(rapierHitPoint.x, rapierHitPoint.y, rapierHitPoint.z);
      const dist = origin.distanceTo(impactPoint);

      const offset = action === 'DIG' ? 0.1 : -0.1;
      const hitPoint = impactPoint.addScaledVector(direction, offset);
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

      for (let cx = minCx; cx <= maxCx; cx++) {
        for (let cz = minCz; cz <= maxCz; cz++) {
          const key = `${cx},${cz}`;
          const chunk = chunksRef.current[key];
          if (chunk) {
            const localX = hitPoint.x - (cx * CHUNK_SIZE_XZ);
            const localY = hitPoint.y;
            const localZ = hitPoint.z - (cz * CHUNK_SIZE_XZ);

            const modified = TerrainService.modifyChunk(
              chunk.density,
              chunk.material,
              { x: localX, y: localY, z: localZ },
              radius,
              delta,
              buildMat
            );

            if (modified) {
              anyModified = true;
              affectedChunks.push(key);
              if (Math.abs(hitPoint.x - ((cx + 0.5) * CHUNK_SIZE_XZ)) < CHUNK_SIZE_XZ / 2 &&
                Math.abs(hitPoint.z - ((cz + 0.5) * CHUNK_SIZE_XZ)) < CHUNK_SIZE_XZ / 2) {
                if (action === 'BUILD') primaryMat = buildMat;
                else primaryMat = MaterialType.DIRT;
              }
            }
          }
        }
      }

      if (anyModified && workerRef.current) {
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

        setParticleState({ active: true, pos: hitPoint, color: getMaterialColor(primaryMat) });
        setTimeout(() => setParticleState(prev => ({ ...prev, active: false })), 50);
      }
    }
  }, [isInteracting, action, camera, world, rapier, buildMat]);

  return (
    <group>
      {Object.values(chunks).map(chunk => (
        <React.Fragment key={chunk.key}>
          <ChunkMesh chunk={chunk} sunDirection={sunDirection} />
          {chunk.rootHollowPositions && chunk.rootHollowPositions.length > 0 && (
             // STRIDE IS NOW 6 (x, y, z, nx, ny, nz)
             Array.from({ length: chunk.rootHollowPositions.length / 6 }).map((_, i) => (
                <RootHollow
                    key={`${chunk.key}-root-${i}`}
                    position={[
                        chunk.rootHollowPositions![i*6] + chunk.cx * CHUNK_SIZE_XZ,
                        chunk.rootHollowPositions![i*6+1],
                        chunk.rootHollowPositions![i*6+2] + chunk.cz * CHUNK_SIZE_XZ
                    ]}
                    normal={[
                        chunk.rootHollowPositions![i*6+3],
                        chunk.rootHollowPositions![i*6+4],
                        chunk.rootHollowPositions![i*6+5]
                    ]}
                />
             ))
          )}
        </React.Fragment>
      ))}
      <Particles active={particleState.active} position={particleState.pos} color={particleState.color} />
    </group>
  );
};
