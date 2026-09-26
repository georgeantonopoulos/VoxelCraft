import { useEffect } from 'react';
import type * as THREE from 'three';
import { useGroveStore } from '@state/GroveStore';
import { useInventoryStore } from '@state/InventoryStore';
import { playerState } from '@core/player/PlayerState';
import { BiomeManager } from '@features/terrain/logic/BiomeManager';
import { onGroveEvent } from './groveEvents';
import { CHUNK_SIZE_XZ } from '@/constants';
import { chunkDataManager } from '@core/terrain/ChunkDataManager';
import { bearingTo, findNearestGroveCenter, nearestInPacked, type SenseHit } from './hollowSense';
import { questAt } from './questLine';

/** Within this distance a dormant hollow counts as "found". */
const HOLLOW_FOUND_RADIUS = 9;
/** Loaded hollows farther than this defer to the long-range grove scan. */
const NEAR_SENSE_RADIUS = 160;
/** Restored hollows suppress grove centres within this radius. */
const RESTORED_GROVE_EXCLUSION = 48;

/** Nearest dormant Root Hollow among currently loaded chunks. */
const findNearestLoadedHollow = (
  px: number,
  pz: number,
  isRestored: (id: string) => boolean
): SenseHit | null => {
  let best: SenseHit | null = null;
  for (const key of chunkDataManager.getLoadedKeys()) {
    const chunk = chunkDataManager.getChunk(key);
    const packed = chunk?.rootHollowPositions;
    if (!chunk || !packed || packed.length === 0) continue;
    best = nearestInPacked(
      packed,
      chunk.cx * CHUNK_SIZE_XZ,
      chunk.cz * CHUNK_SIZE_XZ,
      px,
      pz,
      isRestored,
      best
    );
  }
  return best;
};

/**
 * GroveDirector — headless orchestrator for Keeper progression.
 *
 * Translates raw gameplay signals (inventory deltas, grove events, player
 * position, time of day) into GroveStore stats, and keeps the Lumina Sense
 * compass pointed at the next Root Hollow. Runs on slow timers only; nothing
 * here executes per frame.
 */
export const GroveDirector: React.FC<{ seed: number; sunDirection: THREE.Vector3 }> = ({ seed, sunDirection }) => {
  // Bind persisted progression for this world and greet the Keeper.
  useEffect(() => {
    const store = useGroveStore.getState();
    store.bindWorld(seed);
    const { progression } = useGroveStore.getState();
    const quest = questAt(progression.questIndex);
    useGroveStore.getState().announce({ kind: 'quest-start', title: quest.title, hint: quest.hint });
  }, [seed]);

  // Inventory deltas -> gathering / crafting stats.
  useEffect(() => {
    let prev = useInventoryStore.getState();
    return useInventoryStore.subscribe((next) => {
      const grove = useGroveStore.getState();
      if (next.stickCount > prev.stickCount) grove.record('sticksGathered', next.stickCount - prev.stickCount);
      if (next.stoneCount > prev.stoneCount) grove.record('stonesGathered', next.stoneCount - prev.stoneCount);
      if (next.inventoryCount > prev.inventoryCount) grove.record('floraGathered', next.inventoryCount - prev.inventoryCount);
      if (next.customToolIds.length > prev.customToolIds.length) {
        grove.record('toolsCrafted', next.customToolIds.length - prev.customToolIds.length);
      }
      prev = next;
    });
  }, []);

  // Discrete gameplay events.
  useEffect(() => onGroveEvent((event) => {
    const grove = useGroveStore.getState();
    switch (event.type) {
      case 'hollow-found': grove.markHollowFound(event.hollowId); break;
      case 'hollow-awakened': grove.markHollowFound(event.hollowId); break;
      case 'hollow-restored':
        if (!grove.restoredHollows[event.hollowId]) {
          grove.announce({ kind: 'discovery', title: 'A hollow wakes', detail: 'Its tree remembers the light' });
        }
        grove.markHollowRestored(event.hollowId);
        window.dispatchEvent(new CustomEvent('vc-music-cue', { detail: { kind: 'hollow-restored' } }));
        break;
      case 'tree-felled': grove.record('treesFelled'); break;
      case 'torch-placed': grove.record('torchesPlaced'); break;
    }
  }), []);

  // Biome discovery + night cycle (1 Hz).
  useEffect(() => {
    let wasNight = sunDirection.y < -0.08;
    const handle = window.setInterval(() => {
      const biome = BiomeManager.getBiomeAt(playerState.x, playerState.z);
      useGroveStore.getState().discoverBiome(biome);

      const y = sunDirection.y;
      if (y < -0.08) wasNight = true;
      else if (wasNight && y > 0.12) {
        wasNight = false;
        useGroveStore.getState().record('nightsEndured');
        useGroveStore.getState().announce({ kind: 'discovery', title: 'Dawn', detail: 'The night is endured' });
      }
    }, 1000);
    return () => window.clearInterval(handle);
  }, [sunDirection]);

  // Lumina Sense compass.
  useEffect(() => {
    let lastScanX = Infinity;
    let lastScanZ = Infinity;
    let groveHit: { x: number; z: number } | null = null;
    let lastRestoredCount = -1;

    const tick = () => {
      const grove = useGroveStore.getState();
      const restored = grove.restoredHollows;
      const px = playerState.x;
      const pz = playerState.z;

      const near = findNearestLoadedHollow(px, pz, (id) => !!restored[id]);
      if (near && near.id && near.distSq < HOLLOW_FOUND_RADIUS * HOLLOW_FOUND_RADIUS) {
        grove.markHollowFound(near.id);
      }

      if (near && near.distSq < NEAR_SENSE_RADIUS * NEAR_SENSE_RADIUS) {
        grove.setCompass({
          kind: 'hollow',
          x: near.x,
          z: near.z,
          distance: Math.sqrt(near.distSq),
          bearing: bearingTo(px, pz, near.x, near.z),
        });
        return;
      }

      // Long range: rescan only after meaningful travel or a new restoration.
      const restoredCount = Object.keys(restored).length;
      const movedSq = (px - lastScanX) ** 2 + (pz - lastScanZ) ** 2;
      if (movedSq > 40 * 40 || restoredCount !== lastRestoredCount) {
        lastScanX = px;
        lastScanZ = pz;
        lastRestoredCount = restoredCount;
        const restoredPts = Object.keys(restored).map((id) => id.split(',').map(Number));
        const hit = findNearestGroveCenter(px, pz, 384, 24, (x, z) =>
          restoredPts.some(([rx, rz]) => (rx - x) ** 2 + (rz - z) ** 2 < RESTORED_GROVE_EXCLUSION ** 2)
        );
        groveHit = hit ? { x: hit.x, z: hit.z } : null;
      }

      if (groveHit) {
        const d = Math.hypot(groveHit.x - px, groveHit.z - pz);
        grove.setCompass({
          kind: 'grove',
          x: groveHit.x,
          z: groveHit.z,
          distance: d,
          bearing: bearingTo(px, pz, groveHit.x, groveHit.z),
        });
      } else {
        grove.setCompass(null);
      }
    };

    const handle = window.setInterval(tick, 400);
    tick();
    return () => window.clearInterval(handle);
  }, []);

  return null;
};

