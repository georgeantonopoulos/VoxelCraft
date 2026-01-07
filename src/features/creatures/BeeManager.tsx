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

/**
 * BeeManager - Spawns and manages Lumabees around grown FractalTrees
 *
 * Features:
 * - Automatic spawning when trees finish growing
 * - LOD system (despawn bees far from player)
 * - Tree association (bees patrol specific trees)
 * - Population limits (prevent performance issues)
 * - Staggered spawning for natural appearance
 */
export const BeeManager: React.FC<BeeManagerProps> = ({
  enabled = true,
  maxBeesPerTree = 3,
  spawnRadius = 60.0,
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
    spawnHeight: 4.0,    // Initial spawn height above tree
  }), [spawnRadius]);

  // Pseudo-random generator
  const random = useMemo(() => {
    let seed = 424242;
    return () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
  }, []);

  // Spawn a new bee for a specific tree
  const spawnBee = (tree: { x: number; z: number; grownAt: number }, treeId: string) => {
    if (bees.length >= maxTotalBees) return;

    const currentCount = treeBeeCounts.current.get(treeId) || 0;
    if (currentCount >= maxBeesPerTree) return;

    const angle = random() * Math.PI * 2;
    const distance = 2.0 + random() * 3.0;
    const treePos = new THREE.Vector3(tree.x, config.spawnHeight, tree.z);

    const newBee: BeeInstance = {
      id: `bee-${nextBeeIdRef.current++}`,
      position: new THREE.Vector3(
        tree.x + Math.cos(angle) * distance,
        config.spawnHeight + random() * 2.0,
        tree.z + Math.sin(angle) * distance
      ),
      treeId,
      treePosition: treePos,
      seed: random() * 1000,
      spawnedAt: Date.now(),
      state: BeeState.IDLE
    };

    setBees(prev => [...prev, newBee]);
    treeBeeCounts.current.set(treeId, currentCount + 1);
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

      // Spawn bees gradually
      if (currentCount < maxBeesPerTree && bees.length < maxTotalBees) {
        if (random() > 0.7) { // Staggered spawning
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

    // Could trigger additional VFX here
    console.log(`[BeeManager] Bee ${beeId} harvested nectar at`, position);
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
          seed={bee.seed}
          onHarvest={(pos) => handleHarvest(bee.id, pos)}
          onStateChange={(state) => handleBeeStateChange(bee.id, state)}
        />
      ))}
    </group>
  );
};
