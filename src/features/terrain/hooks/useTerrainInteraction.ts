/**
 * useTerrainInteraction.ts
 *
 * Hook that handles all terrain interaction logic (dig, build, chop, smash).
 * Extracted from VoxelTerrain.tsx to improve maintainability and reduce
 * the main component's complexity.
 *
 * This hook:
 * - Listens to interaction state from InputStore
 * - Performs raycasts against terrain and entities
 * - Modifies chunk data for terrain deformation
 * - Triggers visual effects (particles, falling trees)
 * - Handles tree damage and destruction
 */

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';

import { useInputStore } from '@/state/InputStore';
import { useInventoryStore } from '@state/InventoryStore';
import { useWorldStore } from '@state/WorldStore';
import { usePhysicsItemStore } from '@state/PhysicsItemStore';
import { useEntityHistoryStore } from '@/state/EntityHistoryStore';

import { TerrainService } from '@features/terrain/logic/terrainService';
import { metadataDB } from '@state/MetadataDB';
import { simulationManager } from '@features/flora/logic/SimulationManager';
import { chunkDataManager } from '@core/terrain/ChunkDataManager';
import { getToolCapabilities } from '@features/interaction/logic/ToolCapabilities';
import { emitSpark } from '@features/interaction/components/SparkSystem';
import { getTreeName, TreeType, VEGETATION_ASSETS } from '@features/terrain/logic/VegetationConfig';
import { RockVariant } from '@features/terrain/logic/GroundItemKinds';
import { fallingTreeRegistry, fallingTreeColliderRegistry } from '@features/flora/components/FallingTree';

import {
  getMaterialColor,
  sampleMaterialAtWorldPoint,
  isTerrainCollider,
  rayHitsGeneratedGroundPickup,
  buildChunkLocalHotspots,
} from '@features/terrain/logic/raycastUtils';

import { DIG_RADIUS, DIG_STRENGTH, CHUNK_SIZE_XZ } from '@/constants';
import { MaterialType, ChunkState, ItemType } from '@/types';

// Audio System
import { getRandomDigSound } from '@core/audio';

// Helper to get leaf color for tree type (matches TreeLayer.tsx colors)
function getLeafColorForTreeType(treeType: number): string {
  switch (treeType) {
    case TreeType.OAK: return '#4CAF50';
    case TreeType.PINE: return '#1B5E20';
    case TreeType.PALM: return '#8BC34A';
    case TreeType.ACACIA: return '#CDDC39';
    case TreeType.CACTUS: return '#43A047';
    case TreeType.JUNGLE: return '#2E7D32';
    default: return '#4CAF50'; // Default green
  }
}

// ============================================================================
// Types
// ============================================================================

export type ParticleKind = 'debris' | 'spark';

export interface ParticleState {
  burstId: number;
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  color: string;
  kind: ParticleKind;
  active: boolean;
}

export interface FallingTreeData {
  id: string;
  position: THREE.Vector3;
  type: number;
  seed: number;
}

export interface LogSpawnData {
  position: THREE.Vector3;
  treeType: number;
  seed: number;
}

export interface InteractionCallbacks {
  /** Called to trigger particle effects */
  onParticle: (state: Partial<ParticleState> & { burstId?: number | 'increment' }) => void;
  /** Called when a tree is felled */
  onTreeFall: (tree: FallingTreeData) => void;
  /** Called when a leaf is hit (for pickup effect) */
  onLeafHit: (position: THREE.Vector3, color?: string) => void;
  /** Called to queue a chunk version increment for re-render */
  queueVersionIncrement: (key: string) => void;
  /** Called to queue a chunk remesh */
  queueRemesh: (key: string) => void;
  /** Reference to chunk data map for raycasting */
  chunkDataRef: React.RefObject<Map<string, ChunkState>>;
  /** Called when logs are spawned from sawing a fallen tree */
  onLogSpawn?: (treeId: string, logs: LogSpawnData[]) => void;
  /** Called to remove a falling tree (e.g., after sawing) */
  onFallingTreeRemove?: (treeId: string) => void;
}

export interface InteractionConfig {
  /** Current build material */
  buildMat: MaterialType;
  /** Setter for build material (auto-switch on dig) */
  setBuildMat: (mat: MaterialType) => void;
  /** Ref to track manual material selection timeout */
  manualBuildMatUntilMs: React.RefObject<number>;
}

// ============================================================================
// Hook
// ============================================================================

export function useTerrainInteraction(
  callbacks: InteractionCallbacks,
  config: InteractionConfig
): void {
  const { camera } = useThree();
  const { world, rapier } = useRapier();

  const action = useInputStore(s => s.interactionAction);
  const isInteracting = action !== null;

  const { buildMat, setBuildMat, manualBuildMatUntilMs } = config;
  const {
    onParticle,
    onTreeFall,
    onLeafHit,
    queueVersionIncrement,
    queueRemesh,
    chunkDataRef,
  } = callbacks;

  // Track particle burst ID internally to ensure increment
  const particleBurstId = useRef(0);

  // Track last sound timestamp to prevent duplicate sounds
  const lastSoundTimestamp = useRef<number>(0);

  const emitParticle = (opts: Omit<ParticleState, 'burstId' | 'active'>) => {
    particleBurstId.current++;
    onParticle({
      ...opts,
      burstId: particleBurstId.current,
      active: true,
    });
  };

  // Helper to play sounds via AudioManager with throttling
  // Note: pitch is playbackRate (1.0 = normal, 0.5 = half speed, 2.0 = double speed)
  const playSound = (soundId: string, options?: { pitch?: number; volume?: number }) => {
    const now = performance.now();
    const timeSinceLastSound = now - lastSoundTimestamp.current;

    // Throttle: only play if more than 100ms has passed since last sound
    if (timeSinceLastSound < 100) {
      return;
    }

    lastSoundTimestamp.current = now;
    window.dispatchEvent(new CustomEvent('vc-audio-play', {
      detail: { soundId, options }
    }));
  };

  useEffect(() => {
    if (!isInteracting || !action) {
      return;
    }

    const origin = camera.position.clone();
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const maxRayDistance = 16.0;

    const ray = new rapier.Ray(origin, direction);

    // NOTE: Flora pickup is handled by the Q hotkey (single-target ray pickup).
    // DIG should not "vacuum" multiple flora items into inventory.

    const terrainHit = world.castRay(ray, maxRayDistance, true, undefined, undefined, undefined, undefined, isTerrainCollider);

    // 0.5 CHECK FOR PHYSICS ITEM INTERACTION (TREES, STONES)
    if (action === 'DIG' || action === 'CHOP' || action === 'SMASH') {
      // Filter out terrain and player colliders - we want to hit physics items (trees, stones, etc.)
      const physicsHit = world.castRay(ray, maxRayDistance, true, undefined, undefined, undefined, undefined, (collider) => {
        const userData = collider.parent()?.userData as any;
        // Include physics items and flora trees, exclude terrain and player
        return userData?.type !== 'terrain' && userData?.type !== 'player';
      });
      if (physicsHit && physicsHit.collider) {
        const parent = physicsHit.collider.parent();
        let userData = parent?.userData as any;

        // Check fallingTreeColliderRegistry if userData is not available via collider.parent()
        // This works around @react-three/rapier's userData not being accessible in raycasts
        // We use the COLLIDER handle directly since that's what raycast returns
        const colliderHandle = physicsHit.collider.handle;

        if (!userData) {
          // First try collider registry (most reliable - direct match)
          const colliderRegistryData = fallingTreeColliderRegistry.get(colliderHandle);
          if (colliderRegistryData) {
            userData = colliderRegistryData;
          } else {
            // Fallback: try parent handle in rigid body registry
            const parentHandle = parent?.handle;
            if (parentHandle !== undefined) {
              const rbRegistryData = fallingTreeRegistry.get(parentHandle);
              if (rbRegistryData) {
                userData = rbRegistryData;
              }
            }
          }
        }

        // Note: parent may be null for fallen trees when userData came from registry
        if (userData) {
          // --- FLORA TREE ---
          if (userData.type === 'flora_tree') {
            // Skip physics tree hit if terrain is closer - let terrain-based proximity detection
            // find the correct nearest tree instead of hitting background trees
            const physicsDistance = (physicsHit as any).timeOfImpact ?? Infinity;
            if (terrainHit && terrainHit.timeOfImpact < physicsDistance) {
              // Terrain is closer, skip physics path and fall through to terrain-based tree check
            } else {
              if (userData.part === 'leaf') {
                const hitPoint = ray.pointAt((physicsHit as any).timeOfImpact ?? 0);
                // Get tree type from chunk data for proper leaf color
                const { chunkKey: leafChunkKey, treeIndex: leafTreeIndex } = userData;
                const leafChunk = chunkDataManager.getChunk(leafChunkKey);
                const leafTreeType = leafChunk?.treePositions?.[leafTreeIndex + 3] ?? 0;
                onLeafHit(new THREE.Vector3(hitPoint.x, hitPoint.y, hitPoint.z), getLeafColorForTreeType(leafTreeType));
                return;
              }

              // Tree Damage Logic (from physics hit)
            const { chunkKey, treeIndex } = userData;
            const chunk = chunkDataManager.getChunk(chunkKey);
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

              // Guard: Only tools with canChop capability can damage standing trees
              // SAW cannot chop standing trees - it only works on fallen trees
              if (!capabilities.canChop) {
                playSound('wood_hit', { pitch: 1.5 });
                return;
              }

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
              emitParticle({
                pos: woodPos,
                dir: woodDir,
                kind: 'debris',
                color: '#8B4513'
              });
              playSound('wood_hit', { pitch: 0.5 });

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

                // Clear treeInstanceBatches to force TreeLayer to recompute from treePositions
                const updatedChunk = { ...chunk, treePositions: newPositions, treeInstanceBatches: undefined, visualVersion: chunk.visualVersion + 1 };
                chunkDataRef.current?.set(chunkKey, updatedChunk);
                chunkDataManager.replaceChunk(chunkKey, updatedChunk);
                chunkDataManager.markDirty(chunkKey);
                queueVersionIncrement(chunkKey);

                // Spawn Falling Tree
                onTreeFall({
                  id: `${chunkKey}-${posIdx}-${Date.now()}`,
                  position: new THREE.Vector3(x, y, z),
                  type,
                  seed
                });
              }
            }
            return;
            } // end else (physics tree is closer)
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

              // Play rock-on-rock impact sound (NEW: using stone_hit.mp3)
              playSound('rock_hit', { pitch: 1.2 });

              emitParticle({
                pos: hitPoint,
                dir: direction.clone().multiplyScalar(-1),
                kind: 'debris',
                color: '#888888'
              });

              if (h <= 0) {
                // Break!
                const physicsStore = usePhysicsItemStore.getState();
                physicsStore.removeItem(stoneId);
                const count = 2 + Math.floor(Math.random() * 2);
                for (let i = 0; i < count; i++) {
                  // Spawn shards higher up (0.4 units above hit point) to prevent
                  // them from falling through terrain when stone is on ground
                  physicsStore.spawnItem(ItemType.SHARD, [hitPoint.x, hitPoint.y + 0.4, hitPoint.z], [
                    (Math.random() - 0.5) * 3,
                    2 + Math.random() * 2,
                    (Math.random() - 0.5) * 3
                  ]);
                }
              }
            }
            return;
          }

          // --- FALLEN TREE (for sawing into logs) ---
          if (userData.type === 'fallen_tree') {
            const { inventorySlots, selectedSlotIndex, customTools } = useInventoryStore.getState();
            const selectedItem = inventorySlots[selectedSlotIndex];
            const currentTool = (typeof selectedItem === 'string' && selectedItem.startsWith('tool_'))
              ? customTools[selectedItem as string]
              : (selectedItem as ItemType);
            const capabilities = getToolCapabilities(currentTool);

            // Only SAW can cut fallen trees into logs
            if (!capabilities.canSaw) {
              playSound('wood_hit', { volume: 0.3, pitch: 1.5 });
              return;
            }

            const hitPointRaw = ray.pointAt((physicsHit as any).timeOfImpact ?? 0);
            const hitPoint = new THREE.Vector3(hitPointRaw.x, hitPointRaw.y, hitPointRaw.z);
            const { id: fallenTreeId, treeType, seed, scale } = userData;

            // Calculate max health based on tree scale (larger trees need more sawing)
            const maxHealth = Math.floor((scale || 1) * 30); // ~24-36 HP depending on scale
            const sawDamage = capabilities.woodDamage; // SAW has 8.0 woodDamage

            // Apply damage and track health
            const damageStore = useEntityHistoryStore.getState();
            const currentHealth = damageStore.damageEntity(fallenTreeId, sawDamage, maxHealth, 'Fallen Tree');

            // Particle and sound for sawing
            emitParticle({
              pos: hitPoint,
              dir: direction.clone().multiplyScalar(-1),
              kind: 'debris',
              color: '#D2691E' // Wood sawdust color
            });
            playSound('wood_hit', { volume: 0.4, pitch: 0.7 });

            // Only convert to logs when health reaches 0
            if (currentHealth <= 0) {
              // Convert to logs (2-3 logs depending on tree scale)
              const logCount = Math.floor(2 + (scale || 1) * 0.5);
              const spawnedLogs: LogSpawnData[] = [];

              // Get the fallen tree's physics position (may have moved from original)
              // Use parent.translation() if available, otherwise use hit point as fallback
              let treeBasePos: THREE.Vector3;
              if (parent) {
                const treePos = parent.translation();
                treeBasePos = new THREE.Vector3(treePos.x, treePos.y, treePos.z);
              } else {
                // Fallback to hit point (less accurate but functional)
                treeBasePos = hitPoint.clone();
              }

              for (let i = 0; i < logCount; i++) {
                // Offset logs along the tree's length
                const offset = (i - (logCount - 1) / 2) * 1.5;
                spawnedLogs.push({
                  position: treeBasePos.clone().add(new THREE.Vector3(offset * 0.3, 0.5 + i * 0.2, offset * 0.3)),
                  treeType: treeType,
                  seed: seed + i
                });
              }

              // Call the interaction callbacks to spawn logs and remove the fallen tree
              if (callbacks.onLogSpawn) {
                callbacks.onLogSpawn(fallenTreeId, spawnedLogs);
              }
              if (callbacks.onFallingTreeRemove) {
                callbacks.onFallingTreeRemove(fallenTreeId);
              }
            }

            return;
          }
        }
      }

      // 0.7 CHECK FOR NATURAL ROCK INTERACTION (GENERATED GROUND PICKUPS)
      if (action === 'SMASH' || action === 'DIG') {
        const groundHit = rayHitsGeneratedGroundPickup(chunkDataRef.current!, origin, direction, maxRayDistance, 0.55);
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

            // Play rock-on-rock impact sound (NEW: using stone_hit.mp3)
            playSound('rock_hit', { pitch: 1.2 });

            emitParticle({
              pos: hitPoint,
              dir: direction.clone().multiplyScalar(-1),
              kind: 'debris',
              color: '#888888'
            });

            if (h <= 0) {
              // Break Natural Rock!
              const removeGround = (hit: typeof groundHit) => {
                const chunk = chunkDataManager.getChunk(hit.key);
                const positions = chunk?.[hit.array];
                if (!chunk || !positions || positions.length < 8) return;
                const next = new Float32Array(positions);

                // Synchronize visuals for optimized layers
                let updatedVisuals: Partial<ChunkState> = {};
                const variant = next[hit.index + 6];
                const seed = next[hit.index + 7];
                // Also store the local position for more reliable matching
                const hitX = next[hit.index + 0];
                const hitY = next[hit.index + 1];
                const hitZ = next[hit.index + 2];

                const updateBuffer = (buf: Float32Array | undefined) => {
                  if (!buf) return undefined;
                  const nb = new Float32Array(buf);
                  // Visual buffer has stride 7: x, y, z, nx, ny, nz, seed
                  for (let i = 0; i < nb.length; i += 7) {
                    // Match by both seed AND position for reliability
                    const seedMatch = Math.abs(nb[i + 6] - seed) < 0.001;
                    const posMatch = Math.abs(nb[i] - hitX) < 0.1 &&
                                     Math.abs(nb[i + 1] - hitY) < 0.1 &&
                                     Math.abs(nb[i + 2] - hitZ) < 0.1;
                    if (seedMatch && posMatch) {
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
                const updatedChunk = { ...chunk, ...updatedVisuals, [hit.array]: next, visualVersion: (chunk.visualVersion ?? 0) + 1 };
                chunkDataRef.current?.set(hit.key, updatedChunk);
                chunkDataManager.replaceChunk(hit.key, updatedChunk);
                chunkDataManager.markDirty(hit.key);
                queueVersionIncrement(hit.key);
                useWorldStore.getState().setRockHotspots(hit.key, buildChunkLocalHotspots(chunk.cx, chunk.cz, next));
              };

              removeGround(groundHit);

              const physicsStore = usePhysicsItemStore.getState();
              const count = 2 + Math.floor(Math.random() * 2);
              for (let i = 0; i < count; i++) {
                // Spawn shards higher up (0.4 units above hit point) to prevent
                // them from falling through terrain
                physicsStore.spawnItem(ItemType.SHARD, [hitPoint.x, hitPoint.y + 0.4, hitPoint.z], [
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
      const sampledMat = sampleMaterialAtWorldPoint(chunkDataRef.current!, samplePoint);

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
          const chunk = chunkDataManager.getChunk(key);
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
            let treeSoundPlayed = false; // Prevent multiple tree hit sounds per interaction

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

                // Guard: Only tools with canChop capability can damage standing trees
                // SAW cannot chop standing trees - it only works on fallen trees
                // Non-chopping tools can still shake/interact but deal no damage
                if (!capabilities.canChop) {
                  // SMASH/SHAKE Animation for non-chopping tools
                  const leafPos = new THREE.Vector3(x, y + 2.5 + Math.random() * 2, z);
                  const leafColor = getLeafColorForTreeType(type);
                  onLeafHit(leafPos, leafColor);
                  emitParticle({
                    pos: leafPos,
                    dir: new THREE.Vector3(0, -1, 0),
                    kind: 'debris',
                    color: leafColor
                  });
                  if (!treeSoundPlayed) {
                    playSound('wood_hit', { pitch: 0.85 });
                    treeSoundPlayed = true;
                  }
                  anyFloraHit = true;
                  continue;
                }

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
                  onTreeFall({
                    id: `${key}-${i}-${Date.now()}`,
                    position: new THREE.Vector3(x, y, z),
                    type,
                    seed
                  });
                  continue;
                }

                // Not dead yet: Shake or Hit?
                const isChopAction = (hasAxe && selectedItem === ItemType.AXE) || capabilities.canChop;

                if (!isChopAction && (capabilities.canSmash || action === 'SMASH')) {
                  // SMASH/SHAKE Animation
                  const leafPos = new THREE.Vector3(x, y + 2.5 + Math.random() * 2, z);
                  const leafColor = getLeafColorForTreeType(type);
                  onLeafHit(leafPos, leafColor);
                  emitParticle({
                    pos: leafPos,
                    dir: new THREE.Vector3(0, -1, 0),
                    kind: 'debris',
                    color: leafColor
                  });
                  if (!treeSoundPlayed) {
                    playSound('wood_hit', { pitch: 0.85 });
                    treeSoundPlayed = true;
                  }
                  anyFloraHit = true;
                } else {
                  // CHOP Animation
                  const woodPos = new THREE.Vector3(x, y + 1, z);
                  const woodDir = origin.clone().sub(woodPos).normalize();
                  emitParticle({
                    pos: woodPos,
                    dir: woodDir,
                    kind: 'debris',
                    color: '#8B4513'
                  });
                  setTimeout(() => onParticle({ active: false }), 120);
                  if (!treeSoundPlayed) {
                    playSound('wood_hit', { pitch: 0.5 });
                    treeSoundPlayed = true;
                  }
                  anyFloraHit = true;
                }
              }
            }

            if (hitIndices.length > 0) {
              anyFloraHit = true;
              // Remove trees from chunk (filter out hit indices)
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

              // Clear treeInstanceBatches to force TreeLayer to recompute from treePositions
              const updatedChunk = { ...chunk, treePositions: newPositions, treeInstanceBatches: undefined, visualVersion: chunk.visualVersion + 1 };
              chunkDataRef.current?.set(key, updatedChunk);
              chunkDataManager.replaceChunk(key, updatedChunk);
              chunkDataManager.markDirty(key);
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

                const dist = origin.distanceTo(impactPoint);
                const digRadius = (dist < 3.0) ? 1.5 : DIG_RADIUS;
                const removalRadius = digRadius * 0.3;

                if (distSq < removalRadius ** 2) {
                  hitIndices.push(i);

                  // Particles
                  const asset = VEGETATION_ASSETS[typeId];
                  const vegPos = new THREE.Vector3(x, y + 0.5, z);
                  const vegDir = origin.clone().sub(vegPos).normalize();
                  emitParticle({
                    pos: vegPos,
                    dir: vegDir,
                    kind: 'debris',
                    color: asset ? asset.color : '#00ff00'
                  });
                }
              }

              if (hitIndices.length > 0) {
                chunkModified = true;
                anyFloraHit = true;

                const newArr = new Float32Array(positions); // Clone
                for (const idx of hitIndices) {
                  // Move Y to -10000 (Subterranean Oblivion)
                  newArr[idx + 1] = -10000;
                }
                newVegData[typeId] = newArr;
              }
            }

            if (chunkModified) {
              const updatedChunk = { ...chunk, vegetationData: newVegData };
              chunkDataRef.current?.set(key, updatedChunk);
              chunkDataManager.replaceChunk(key, updatedChunk);
              chunkDataManager.markDirty(key);
              queueVersionIncrement(key);
            }
          }
        }

        if (anyFloraHit) {
          setTimeout(() => onParticle({ active: false }), 100);
          return; // Stop processing (don't dig ground if we hit flora)
        }
      }

      const dist = origin.distanceTo(impactPoint);

      // AAA FIX: Interaction Distance limit
      if (dist > 4.5) return;

      // AAA FIX: Root Anchoring Block
      if (isNearTree && action === 'DIG') {
        // Play a "thud" to indicate blocking
        playSound('wood_hit', { pitch: 0.5 });
        window.dispatchEvent(new CustomEvent('tool-impact', { detail: { action, ok: false, color: '#555555' } }));
        return;
      }

      // AAA FIX: Raycast Offset for Accuracy
      const digOffset = 0.6;
      const buildOffset = 0.3;
      const offset = action === 'DIG' ? digOffset : (action === 'BUILD' ? buildOffset : -0.1);

      const hitPoint = impactPoint.clone().addScaledVector(direction, offset);
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
          const chunk = chunkDataManager.getChunk(key);
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
                cx,
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

      if (anyModified) {
        // Mark chunks as dirty in ChunkDataManager (for future persistence)
        affectedChunks.forEach(key => chunkDataManager.markDirty(key));

        // Trigger version updates for all affected chunks to re-render
        affectedChunks.forEach(key => queueVersionIncrement(key));
        // Play Dig Sound
        if (action === 'DIG') {
          playSound(getRandomDigSound());
        } else {
          // Building sound - Use random dig sound pitched down
          playSound(getRandomDigSound(), { pitch: 0.85 });
        }

        affectedChunks.forEach(key => {
          const chunk = chunkDataManager.getChunk(key);
          const metadata = metadataDB.getChunk(key);
          if (chunk && metadata) {
            // Increment terrainVersion BEFORE queueing remesh so the version check works
            chunk.terrainVersion = (chunk.terrainVersion ?? 0) + 1;

            simulationManager.addChunk(key, chunk.cx, chunk.cz, chunk.material, metadata.wetness, metadata.mossiness);
            queueRemesh(key);
          }
        });

        // Auto-switch build material to whatever we just dug (unless user manually picked recently).
        if (action === 'DIG' && allowAutoMat && sampledMat !== MaterialType.AIR && sampledMat !== MaterialType.WATER) {
          setBuildMat(sampledMat);
        }

        emitParticle({
          pos: particlePos,
          dir: particleDir,
          kind: 'debris',
          color: getMaterialColor(primaryMat)
        });
        // Let the burst breathe a bit longer so it actually reads as impact.
        setTimeout(() => onParticle({ active: false }), 140);
        window.dispatchEvent(new CustomEvent('tool-impact', { detail: { action, ok: true, color: getMaterialColor(primaryMat) } }));
      } else if (!anyModified && action === 'DIG') {
        // Tried to dig but nothing changed -> Indestructible (Bedrock)
        if (terrainHit) {
          // Play rock hit sound with random pitch variation
          playSound('rock_hit', { pitch: 0.9 + Math.random() * 0.2 });

          // AAA FIX: Visual Feedback for Invincible Blocks
          emitParticle({
            pos: particlePos,
            dir: particleDir,
            kind: 'spark',
            color: '#bbbbbb'
          });
          setTimeout(() => onParticle({ active: false }), 140);
          window.dispatchEvent(new CustomEvent('tool-impact', { detail: { action, ok: false, color: '#555555' } }));
        }
      }
    }
  }, [isInteracting, action, camera, world, rapier, buildMat]);
}
