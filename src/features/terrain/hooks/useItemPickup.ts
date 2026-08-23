import { useEffect } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';

import { chunkDataManager } from '@core/terrain/ChunkDataManager';
import { useInventoryStore } from '@state/InventoryStore';
import { usePhysicsItemStore } from '@state/PhysicsItemStore';
import { useWorldStore } from '@state/WorldStore';
import { saveGroundPickup, GroundItemType } from '@state/WorldDB';
import { getItemColor, getItemMetadata } from '@features/interaction/logic/ItemRegistry';
import { RockVariant } from '@features/terrain/logic/GroundItemKinds';
import {
  buildChunkLocalHotspots,
  buildFloraHotspots,
  isPhysicsItemCollider,
  rayHitsFlora,
  rayHitsGeneratedGroundPickup,
  rayHitsGeneratedLuminaFlora,
  rayHitsTorch,
} from '@features/terrain/logic/raycastUtils';
import { ChunkState, ItemType } from '@/types';

export interface PickupEffect {
  id: string;
  start: THREE.Vector3;
  color?: string;
  item?: ItemType;
}

interface UseItemPickupArgs {
  chunkDataRef: MutableRefObject<Map<string, ChunkState>>;
  queueVersionIncrement: (key: string) => void;
  setPickupEffects: Dispatch<SetStateAction<PickupEffect[]>>;
}

/**
 * Owns the complete Q-pickup transaction: targeting, world mutation,
 * persistence, inventory updates, and player feedback.
 */
export function useItemPickup({
  chunkDataRef,
  queueVersionIncrement,
  setPickupEffects,
}: UseItemPickupArgs): void {
  const { camera } = useThree();
  const { world, rapier } = useRapier();

  useEffect(() => {
    let lastPickupMs = 0;

    const attemptPickup = () => {
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
      let physicsItemHit: { id: string; type: ItemType; position: THREE.Vector3; t: number } | null = null;

      if (physicsHit && physicsHit.collider) {
        const parent = physicsHit.collider.parent();
        const userData = parent?.userData as { type?: ItemType; id?: string };
        if (userData && userData.id && userData.type) {
          const t = physicsHit.timeOfImpact;
          const point = new rapier.Ray(origin, dir).pointAt(t);
          physicsItemHit = { id: userData.id, type: userData.type, position: new THREE.Vector3(point.x, point.y, point.z), t };
        }
      }

      const removeLumina = (hit: NonNullable<typeof luminaHit>) => {
        const key = hit.key;
        const chunk = chunkDataManager.getChunk(key);
        if (!chunk?.floraPositions) return;
        const positions = chunk.floraPositions;
        if (positions.length < 4) return;

        // Keep array length stable and just "hide" the picked entry.
        // This avoids reindexing artifacts for instanced rendering.
        const next = new Float32Array(positions); // Clone
        // stride 4: x, y, z, type
        next[hit.index + 1] = -10000;

        const updatedChunk = { ...chunk, floraPositions: next, visualVersion: (chunk.visualVersion ?? 0) + 1 };
        chunkDataRef.current.set(key, updatedChunk);
        chunkDataManager.replaceChunk(key, updatedChunk); // Replace entirely (don't merge)
        chunkDataManager.markDirty(key); // Phase 2: Track flora pickup
        queueVersionIncrement(key);
        useWorldStore.getState().setFloraHotspots(key, buildFloraHotspots(next));

        // Persist pickup to IndexedDB so it survives chunk reload
        saveGroundPickup(chunk.cx, chunk.cz, 'flora', hit.index);
      };

      const removeGround = (hit: NonNullable<typeof groundHit>) => {
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
            // (seed alone may have floating-point issues or duplicates)
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
        const updatedChunk = { ...chunk, ...updatedVisuals, [hit.array]: next, visualVersion: (chunk.visualVersion ?? 0) + 1 };
        chunkDataRef.current.set(hit.key, updatedChunk);
        chunkDataManager.replaceChunk(hit.key, updatedChunk); // Replace entirely (don't merge)
        chunkDataManager.markDirty(hit.key); // Phase 2: Track stick/rock pickup
        queueVersionIncrement(hit.key);

        if (hit.array === 'stickPositions') {
          useWorldStore.getState().setStickHotspots(hit.key, buildChunkLocalHotspots(chunk.cx, chunk.cz, next));
        } else {
          useWorldStore.getState().setRockHotspots(hit.key, buildChunkLocalHotspots(chunk.cx, chunk.cz, next));
        }

        // Persist pickup to IndexedDB so it survives chunk reload
        const itemType: GroundItemType = hit.array === 'stickPositions' ? 'stick' : 'rock';
        saveGroundPickup(chunk.cx, chunk.cz, itemType, hit.index);
      };

      const emitPickupFeedback = (name: string, color: string) => {
        window.dispatchEvent(new CustomEvent('vc-audio-play', {
          detail: { soundId: 'pickup_item', options: { volume: 0.24, pitch: 1.15 } }
        }));
        window.dispatchEvent(new CustomEvent('vc-item-picked-up', {
          detail: { name, color, amount: 1 }
        }));
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
          useInventoryStore.getState().addCustomTool(itemData.customToolData);
          const effectId = `${Date.now()}-${Math.random()}`;
          const color = getItemColor(itemData.customToolData.baseType);
          setPickupEffects((prev) => [...prev, { id: effectId, start: pickedStart!, color }]);
          emitPickupFeedback('Custom Tool', color);
          return;
        } else if (physicsItemHit.type === ItemType.PICKAXE) {
          useInventoryStore.getState().setHasPickaxe(true);
          const effectId = `${Date.now()}-${Math.random()}`;
          const metadata = getItemMetadata(ItemType.PICKAXE);
          const color = metadata?.color ?? '#aaaaaa';
          setPickupEffects((prev) => [...prev, { id: effectId, start: pickedStart!, color }]);
          emitPickupFeedback(metadata?.name ?? 'Pickaxe', color);
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
        useInventoryStore.getState().addItem(pickedItem, 1);
        const metadata = getItemMetadata(pickedItem);
        emitPickupFeedback(metadata?.name ?? 'Item', metadata?.color ?? '#ffffff');
        const effectId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const color = getItemColor(pickedItem);
        setPickupEffects((prev) => [...prev, { id: effectId, start: pickedStart, color, item: pickedItem }]);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'KeyQ') return;
      // Keyboard pickup is only active during pointer-locked gameplay.
      if (!document.pointerLockElement) return;
      e.preventDefault();
      attemptPickup();
    };

    const handleTouchPickup = () => attemptPickup();

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('vc-item-pickup-request', handleTouchPickup);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('vc-item-pickup-request', handleTouchPickup);
    };
  }, [camera, chunkDataRef, queueVersionIncrement, rapier, setPickupEffects, world]);
}
