import React, { useRef, useState, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useWorldStore } from '@state/WorldStore';
import { LumabeeCharacter, BeeState } from './LumabeeCharacter';
// TODO: Import and integrate NectarVFX when bees harvest
// import { NectarVFX } from './NectarVFX';

/*
 * ===========================================================================
 * BEE MANAGER - CONNECTION MAP & ASSUMPTIONS
 * ===========================================================================
 *
 * CONNECTIONS TO OTHER FILES:
 * ----------------------------
 * 1. LumabeeCharacter.tsx (src/features/creatures/LumabeeCharacter.tsx)
 *    - Spawned as child components
 *    - Receives: id, position, treePosition, treeHeight, seed, onHarvest
 *
 * 2. NectarVFX.tsx (src/features/creatures/NectarVFX.tsx)
 *    - TODO: NOT YET INTEGRATED - handleHarvest exists but doesn't spawn VFX
 *
 * 3. WorldStore.ts (src/state/WorldStore.ts)
 *    - getGrownTrees() returns all GROWN_TREE entities with x, z, grownAt
 *    - playerParams provides player position for LOD culling
 *
 * 4. FractalTree.tsx (src/features/flora/components/FractalTree.tsx)
 *    - Registers GROWN_TREE entities when tree finishes growing
 *    - TODO: Should also provide actual tree height and canopy radius
 *
 * ASSUMPTIONS:
 * ------------
 * - estimateTreeHeight() uses seed-based approximation (12-18 units)
 *   TODO: FractalTree should pass actual height when registering GROWN_TREE
 * - Tree ground level (y=0) is assumed
 *   TODO: Trees on hills/slopes may have different base Y
 *
 * ===========================================================================
 */

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

// Profile mode check - gate debug logs behind ?profile to avoid dev perf overhead
const shouldProfile = () =>
  import.meta.env.DEV &&
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).has('profile');

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
  // CONCURRENCY-SAFE: All side effects (random(), ref increments, logging) happen
  // OUTSIDE the setState updater to ensure pure state transitions
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

    // PHASE 1: Pre-compute which bees to despawn (read current state from ref)
    // We use bees from the last render to identify despawns
    const currentBees = bees;
    const despawnedBeeIds = new Set<string>();

    currentBees.forEach(bee => {
      const distToPlayer = bee.position.distanceTo(playerPos);
      if (distToPlayer > config.despawnDistance) {
        despawnedBeeIds.add(bee.id);
        if (shouldProfile()) {
          console.log(`[BeeManager] Despawned bee ${bee.id} (distance: ${distToPlayer.toFixed(1)}m)`);
        }
      }
    });

    // PHASE 2: Pre-compute new bees to spawn BEFORE setState
    // All random() calls and ref increments happen here (outside updater)
    const newBeesToSpawn: BeeInstance[] = [];
    const currentBeeCount = currentBees.length - despawnedBeeIds.size;

    grownTrees.forEach((tree) => {
      // Check if we've hit max total bees (accounting for pending spawns)
      if (currentBeeCount + newBeesToSpawn.length >= maxTotalBees) return;

      // Reuse cached vector
      treePosRef.current.set(tree.x, 0, tree.z);
      const distToPlayer = treePosRef.current.distanceTo(playerPos);

      if (distToPlayer > spawnRadius) return;

      const treeAge = (currentTime - tree.grownAt) / 1000; // seconds
      if (treeAge < config.minTreeAge) return;

      const treeId = `tree-${tree.x.toFixed(1)}-${tree.z.toFixed(1)}`;
      const currentCount = treeBeeCounts.current.get(treeId) || 0;

      // Spawn bees gradually (staggered)
      if (currentCount < maxBeesPerTree) {
        // Random check happens OUTSIDE setState updater
        if (random() > 0.7) { // 30% chance per check = gradual spawning
          // All random() calls and ref increments happen here
          const angle = random() * Math.PI * 2;
          const distance = config.minSpawnDistance + random() * (config.maxSpawnDistance - config.minSpawnDistance);
          const spawnHeight = config.spawnHeightMin + random() * (config.spawnHeightMax - config.spawnHeightMin);
          const treeHeight = estimateTreeHeight(tree.x + tree.z);
          const treePos = new THREE.Vector3(tree.x, 0, tree.z);
          const beeSeed = random() * 1000;
          const beeId = `bee-${nextBeeIdRef.current++}`;

          const newBee: BeeInstance = {
            id: beeId,
            position: new THREE.Vector3(
              tree.x + Math.cos(angle) * distance,
              spawnHeight,
              tree.z + Math.sin(angle) * distance
            ),
            treeId,
            treePosition: treePos,
            treeHeight,
            seed: beeSeed,
            spawnedAt: Date.now(),
            state: BeeState.APPROACH
          };

          newBeesToSpawn.push(newBee);

          if (shouldProfile()) {
            console.log(`[BeeManager] Spawned bee ${newBee.id} at distance ${distance.toFixed(1)}m from tree`);
          }
        }
      }
    });

    // PHASE 3: Apply all changes with PURE updater (no side effects)
    // The updater only returns a new array - no mutations, no side effects
    if (despawnedBeeIds.size > 0 || newBeesToSpawn.length > 0) {
      setBees(prev => {
        const filtered = prev.filter(bee => !despawnedBeeIds.has(bee.id));
        return [...filtered, ...newBeesToSpawn];
      });
    }

    // PHASE 4: Update tree counts (after state is scheduled)
    despawnedBeeIds.forEach((beeId) => {
      const bee = currentBees.find(b => b.id === beeId);
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
  // TODO: MISSING INTEGRATION - This should spawn a NectarVFX instance
  // TODO: Need to:
  //   1. Add state: const [vfxInstances, setVfxInstances] = useState<VFXInstance[]>([])
  //   2. Find the bee's treePosition to use as VFX source
  //   3. Spawn NectarVFX with position=treePos, target=beePos, active=true
  //   4. Remove VFX instance when onComplete fires
  const handleHarvest = (beeId: string, position: THREE.Vector3) => {
    // TODO: Dispatch event for audio when bee sound files are available
    // window.dispatchEvent(new CustomEvent('vc-audio-play', {
    //   detail: { soundId: 'bee_harvest', options: { volume: 0.3 } }
    // }));

    if (shouldProfile()) {
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
