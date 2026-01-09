import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useWorldStore } from '@state/WorldStore';
import { LumabeeCharacter, BeeState } from './LumabeeCharacter';

/**
 * Bee instance data
 */
interface BeeInstance {
  id: string;
  position: THREE.Vector3;
  treeId: string;  // Which tree this bee belongs to
  treePosition: THREE.Vector3;
  treeHeight: number;  // Height of the tree for canopy targeting
  seed: number;
  spawnedAt: number;
  state: BeeState;
}

interface BeeManagerProps {
  enabled?: boolean;
  maxBeesPerTree?: number;
  spawnRadius?: number;
  maxTotalBees?: number;
}

// Dev mode check
const isDev = () => import.meta.env.DEV;

// Estimate tree height based on growth time (approximation)
// FractalTrees grow with varying heights - we estimate 12-18 units
const estimateTreeHeight = (seed: number): number => {
  // Use seed for deterministic height variation
  return 12.0 + Math.abs(Math.sin(seed * 100)) * 6.0;
};

/**
 * BeeManager - Spawns and manages Lumabees around grown FractalTrees
 *
 * Features:
 * - Automatic spawning when trees finish growing
 * - LOD system (despawn bees far from player)
 * - Tree association (bees patrol specific trees)
 * - Population limits (prevent performance issues)
 * - Staggered spawning for natural appearance
 * - OFF-SCREEN spawning (40-80 units away) for dramatic entrance
 * - Tree height support for canopy targeting
 * - Atomic state updates to prevent race conditions
 * - Cached vectors to prevent GC pressure
 */
export const BeeManager: React.FC<BeeManagerProps> = ({
  enabled = true,
  maxBeesPerTree = 3,
  spawnRadius = 100.0,  // Increased from 60 to spawn beyond visible range
  maxTotalBees = 30
}) => {
  const [bees, setBees] = useState<BeeInstance[]>([]);
  const getGrownTrees = useWorldStore(s => s.getGrownTrees);
  const playerParams = useWorldStore(s => s.playerParams);

  // Refs for stable logic
  const nextBeeIdRef = useRef(0);
  const lastUpdateRef = useRef(0);
  const treeBeeCounts = useRef<Map<string, number>>(new Map());

  // Cached vectors to prevent allocations
  const playerPosRef = useRef(new THREE.Vector3());
  const treePosRef = useRef(new THREE.Vector3());

  // Spawn configuration
  const config = useMemo(() => ({
    updateInterval: 2.0, // Check for new trees every 2 seconds
    spawnDelay: 1.0,     // Delay between bee spawns
    minTreeAge: 5.0,     // Only spawn bees on trees older than 5 seconds
    despawnDistance: spawnRadius * 1.5, // Despawn bees far from player
    minSpawnDistance: 40.0,  // Minimum spawn distance (off-screen)
    maxSpawnDistance: 80.0,  // Maximum spawn distance (way off-screen)
    spawnHeightMin: 10.0,    // Spawn high up
    spawnHeightMax: 30.0,    // Vary spawn height
  }), [spawnRadius]);

  // Pseudo-random generator
  const random = useMemo(() => {
    let seed = 424242;
    return () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
  }, []);

  // Update bee populations based on tree state
  // BATCHED UPDATE: Collect all spawns and despawns, apply in single setState
  useFrame((state) => {
    if (!enabled) return;

    const now = state.clock.elapsedTime;
    if (now - lastUpdateRef.current < config.updateInterval) return;
    lastUpdateRef.current = now;

    const grownTrees = getGrownTrees();
    // Reuse cached vector instead of allocating
    playerPosRef.current.set(playerParams.x, playerParams.y, playerParams.z);
    const playerPos = playerPosRef.current;
    const currentTime = Date.now();

    // Track despawned bees and new bees to spawn
    const despawnedBeeIds = new Set<string>();
    const newBeesToSpawn: BeeInstance[] = [];

    // PHASE 1: Identify bees to despawn (LOD)
    setBees(prev => {
      // Check which bees are too far
      prev.forEach(bee => {
        const distToPlayer = bee.position.distanceTo(playerPos);
        if (distToPlayer > config.despawnDistance) {
          despawnedBeeIds.add(bee.id);
          if (isDev()) {
            console.log(`[BeeManager] Despawned bee ${bee.id} (distance: ${distToPlayer.toFixed(1)}m)`);
          }
        }
      });

      // PHASE 2: Identify new bees to spawn
      grownTrees.forEach((tree) => {
        // Reuse cached vector
        treePosRef.current.set(tree.x, 0, tree.z);
        const distToPlayer = treePosRef.current.distanceTo(playerPos);

        if (distToPlayer > spawnRadius) return;

        const treeAge = (currentTime - tree.grownAt) / 1000; // seconds
        if (treeAge < config.minTreeAge) return;

        const treeId = `tree-${tree.x.toFixed(1)}-${tree.z.toFixed(1)}`;
        const currentCount = treeBeeCounts.current.get(treeId) || 0;

        // Spawn bees gradually (staggered)
        if (currentCount < maxBeesPerTree && prev.length < maxTotalBees) {
          if (random() > 0.7) { // 30% chance per check = gradual spawning
            // Create new bee instance
            const angle = random() * Math.PI * 2;
            const distance = config.minSpawnDistance + random() * (config.maxSpawnDistance - config.minSpawnDistance);
            const spawnHeight = config.spawnHeightMin + random() * (config.spawnHeightMax - config.spawnHeightMin);
            const treeHeight = estimateTreeHeight(tree.x + tree.z);
            const treePos = new THREE.Vector3(tree.x, 0, tree.z);

            const newBee: BeeInstance = {
              id: `bee-${nextBeeIdRef.current++}`,
              position: new THREE.Vector3(
                tree.x + Math.cos(angle) * distance,
                spawnHeight,
                tree.z + Math.sin(angle) * distance
              ),
              treeId,
              treePosition: treePos,
              treeHeight,
              seed: random() * 1000,
              spawnedAt: Date.now(),
              state: BeeState.APPROACH
            };

            newBeesToSpawn.push(newBee);

            if (isDev()) {
              console.log(`[BeeManager] Spawned bee ${newBee.id} at distance ${distance.toFixed(1)}m from tree`);
            }
          }
        }
      });

      // PHASE 3: Apply all changes atomically
      // Filter out despawned bees and add new bees
      const filtered = prev.filter(bee => !despawnedBeeIds.has(bee.id));
      return [...filtered, ...newBeesToSpawn];
    });

    // Update tree counts outside setState (after state commits)
    despawnedBeeIds.forEach((beeId) => {
      // Find the tree this bee belonged to
      const bee = bees.find(b => b.id === beeId);
      if (bee) {
        const treeCount = treeBeeCounts.current.get(bee.treeId) || 0;
        treeBeeCounts.current.set(bee.treeId, Math.max(0, treeCount - 1));
      }
    });
    newBeesToSpawn.forEach(bee => {
      const currentCount = treeBeeCounts.current.get(bee.treeId) || 0;
      treeBeeCounts.current.set(bee.treeId, currentCount + 1);
    });
  });

  // Harvest handler - triggers nectar VFX
  const handleHarvest = (beeId: string, position: THREE.Vector3) => {
    // TODO: Dispatch event for audio when bee sound files are available
    // window.dispatchEvent(new CustomEvent('vc-audio-play', {
    //   detail: { soundId: 'bee_harvest', options: { volume: 0.3 } }
    // }));

    if (isDev()) {
      console.log(`[BeeManager] Bee ${beeId} harvested nectar at`, position);
    }
  };

  if (!enabled) return null;

  return (
    <group name="bee-manager">
      {bees.map((bee) => (
        <LumabeeCharacter
          key={bee.id}
          id={bee.id}
          position={bee.position}
          treePosition={bee.treePosition}
          treeHeight={bee.treeHeight}
          seed={bee.seed}
          onHarvest={(pos) => handleHarvest(bee.id, pos)}
        />
      ))}
    </group>
  );
};
