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

  // Spawn a new bee for a specific tree - OFF SCREEN for dramatic entrance
  const spawnBee = (tree: { x: number; z: number; grownAt: number }, treeId: string) => {
    if (bees.length >= maxTotalBees) return;

    const currentCount = treeBeeCounts.current.get(treeId) || 0;
    if (currentCount >= maxBeesPerTree) return;

    // Spawn 40-80 units away in a random direction (OFF-SCREEN)
    const angle = random() * Math.PI * 2;
    const distance = config.minSpawnDistance + random() * (config.maxSpawnDistance - config.minSpawnDistance);
    const spawnHeight = config.spawnHeightMin + random() * (config.spawnHeightMax - config.spawnHeightMin);

    // Estimate tree height for canopy targeting
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
      state: BeeState.APPROACH  // Start in APPROACH for dramatic entrance
    };

    setBees(prev => [...prev, newBee]);
    treeBeeCounts.current.set(treeId, currentCount + 1);

    if (isDev()) {
      console.log(`[BeeManager] Spawned bee ${newBee.id} at distance ${distance.toFixed(1)}m from tree`);
    }
  };

  // Update bee populations based on tree state
  useFrame((state) => {
    if (!enabled) return;

    const now = state.clock.elapsedTime;
    if (now - lastUpdateRef.current < config.updateInterval) return;
    lastUpdateRef.current = now;

    const grownTrees = getGrownTrees();
    const playerPos = new THREE.Vector3(playerParams.x, playerParams.y, playerParams.z);
    const currentTime = Date.now();

    // Despawn bees far from player (LOD)
    setBees(prev => {
      const filtered = prev.filter(bee => {
        const distToPlayer = bee.position.distanceTo(playerPos);
        if (distToPlayer > config.despawnDistance) {
          // Update tree count
          const treeCount = treeBeeCounts.current.get(bee.treeId) || 0;
          treeBeeCounts.current.set(bee.treeId, Math.max(0, treeCount - 1));

          if (isDev()) {
            console.log(`[BeeManager] Despawned bee ${bee.id} (distance: ${distToPlayer.toFixed(1)}m)`);
          }
          return false;
        }
        return true;
      });
      return filtered;
    });

    // Spawn bees for nearby trees
    grownTrees.forEach((tree) => {
      const treePos = new THREE.Vector3(tree.x, 0, tree.z);
      const distToPlayer = treePos.distanceTo(playerPos);

      if (distToPlayer > spawnRadius) return;

      const treeAge = (currentTime - tree.grownAt) / 1000; // seconds
      if (treeAge < config.minTreeAge) return;

      const treeId = `tree-${tree.x.toFixed(1)}-${tree.z.toFixed(1)}`;
      const currentCount = treeBeeCounts.current.get(treeId) || 0;

      // Spawn bees gradually (staggered)
      if (currentCount < maxBeesPerTree && bees.length < maxTotalBees) {
        if (random() > 0.7) { // 30% chance per check = gradual spawning
          spawnBee(tree, treeId);
        }
      }
    });
  });

  // Bee state change handler
  const handleBeeStateChange = (beeId: string, newState: BeeState) => {
    setBees(prev => prev.map(bee =>
      bee.id === beeId ? { ...bee, state: newState } : bee
    ));
  };

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
          onStateChange={(state) => handleBeeStateChange(bee.id, state)}
        />
      ))}
    </group>
  );
};
