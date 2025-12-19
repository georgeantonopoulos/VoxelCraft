import React, { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useInventoryStore } from '@state/InventoryStore';
import { usePhysicsItemStore } from '@state/PhysicsItemStore';
import { ItemType } from '@/types';
import { useSettingsStore } from '@state/SettingsStore';
import { useInputStore } from '@/state/InputStore';
import { useCraftingStore } from '@/state/CraftingStore';
import { useRapier } from '@react-three/rapier';
import { emitSpark } from '../components/SparkSystem';

interface InteractionHandlerProps {
  setInteracting: (v: boolean) => void;
  setAction: (a: 'DIG' | 'BUILD' | null) => void;
}

export const InteractionHandler: React.FC<InteractionHandlerProps> = ({ setInteracting, setAction }) => {
  const { camera } = useThree();
  const { world, rapier } = useRapier();
  const inputMode = useSettingsStore(s => s.inputMode);
  const hasPickaxe = useInventoryStore(state => state.hasPickaxe);
  const isDigging = useInputStore(s => s.isDigging);

  // Stores
  const inventorySlots = useInventoryStore(state => state.inventorySlots);
  const selectedSlotIndex = useInventoryStore(state => state.selectedSlotIndex);
  const removeItem = useInventoryStore(state => state.removeItem);
  const spawnPhysicsItem = usePhysicsItemStore(state => state.spawnItem);

  // Crafting Input Logic (Keyboard 'C')
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Crafting Toggle (C)
      if (e.key.toLowerCase() === 'c') {
        const invState = useInventoryStore.getState();
        const currentItem = invState.inventorySlots[invState.selectedSlotIndex];
        const craftingState = useCraftingStore.getState();

        // If closed, check for Stick and open
        if (!craftingState.isOpen) {
          if (currentItem === ItemType.STICK) {
            document.exitPointerLock(); // Vital: Release mouse for UI interaction
            craftingState.openCrafting(ItemType.STICK);
          } else {
            console.log("Must hold Stick to craft");
          }
        } else {
          // If open, close it
          craftingState.closeCrafting();
          // Optionally re-lock pointer? Better to let user click to lock.
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Touch Input Logic (Restored from InteractionLayer)
  useEffect(() => {
    if (inputMode !== 'touch') return;
    const selectedItem = inventorySlots[selectedSlotIndex];
    const pickaxeSelected = hasPickaxe && selectedItem === ItemType.PICKAXE;

    // Only DIG when the crafted pickaxe is unlocked + explicitly selected.
    // BUILD is intentionally disabled for now.
    if (isDigging && pickaxeSelected) {
      setAction('DIG');
      setInteracting(true);
    } else {
      setAction(null);
      setInteracting(false);
    }
  }, [hasPickaxe, inventorySlots, selectedSlotIndex, isDigging, inputMode, setAction, setInteracting]);

  // Mouse Input Logic
  useEffect(() => {
    const tryThrowSelected = (): boolean => {
      const selectedItem = inventorySlots[selectedSlotIndex];
      // Note: "fire" is not throwable.
      if (selectedItem !== ItemType.STICK && selectedItem !== ItemType.STONE && selectedItem !== ItemType.SHARD) return false;

      // Calculate Throw Vector
      const origin = camera.position.clone();
      const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);

      // Spawn Position: Slightly in front of camera
      const spawnPos = origin.add(direction.clone().multiplyScalar(0.5));

      // Velocity: Direction * Force + Upward Arc
      // Stone needs > 12 rel velocity to shatter.
      // Stick needs > 8 to plant.
      const force = 24.0;
      const velocity = direction.multiplyScalar(force);
      velocity.y += 2.0; // slight arc up

      // Spawn Item
      const type = selectedItem === ItemType.STICK ? ItemType.STICK : selectedItem === ItemType.STONE ? ItemType.STONE : ItemType.SHARD;
      spawnPhysicsItem(type, [spawnPos.x, spawnPos.y, spawnPos.z], [velocity.x, velocity.y, velocity.z]);

      // Remove from Inventory
      removeItem(selectedItem, 1);

      return true;
    };

    const handleMouseDown = (e: MouseEvent) => {
      // Only allow interaction if we are locked (gameplay)
      // Note: Touch users won't be pointer locked usually, but they use the effect above.
      // Desktop users click the canvas which locks the pointer.
      if (!document.pointerLockElement) return;

      const selectedItem = inventorySlots[selectedSlotIndex];
      const pickaxeSelected = hasPickaxe && selectedItem === ItemType.PICKAXE;

      // Left Click
      if (e.button === 0) {
        // 1. Pickaxe Digging
        if (pickaxeSelected) {
          setAction('DIG');
          setInteracting(true);
          return;
        }

        // 2. Fire Creation (Holding Stone)
        // 2. Fire Creation (Holding Stone)
        if (selectedItem === ItemType.STONE) {
          // OPTIMIZATION: Use Rapier Raycast instead of Three.js Scene Traversal
          const origin = camera.position;
          const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);

          const ray = new rapier.Ray(origin, direction);
          const hit = world.castRay(ray, 3.0, true, undefined, undefined, undefined, undefined, (collider: any) => {
            // Filter for Stones
            return collider.parent()?.userData?.type === ItemType.STONE;
          });

          if (hit) {
            const collider = hit.collider;
            const rigidBody = collider.parent();
            const hitPoint = origin.clone().add(direction.clone().multiplyScalar(hit.timeOfImpact));

            if (rigidBody && (rigidBody.userData as any)?.type === ItemType.STONE) {
              // Hit a stone with a stone!
              emitSpark(hitPoint);

              // Trigger "Hit" Animation
              setAction('DIG');
              setTimeout(() => setAction(null), 100);

              // Logic: Check for 4 sticks nearby
              const state = usePhysicsItemStore.getState();
              const targetItem = state.items.find(i => i.id === (rigidBody.userData as any).id);

              if (targetItem) {
                // OPTIMIZATION: Use Rapier's sphere intersection query instead of O(N) Array.filter
                const nearbySticks: any[] = [];
                const spherePos = { x: targetItem.position[0], y: targetItem.position[1], z: targetItem.position[2] };
                const sphereRadius = 1.5;

                world.intersectionsWithShape(
                  spherePos,
                  { x: 0, y: 0, z: 0, w: 1 },
                  new rapier.Ball(sphereRadius),
                  (collider) => {
                    const rigidBody = collider.parent();
                    if (rigidBody && (rigidBody.userData as any)?.type === ItemType.STICK) {
                      const id = (rigidBody.userData as any).id;
                      if (id) nearbySticks.push({ id });
                    }
                    return true; // continue search
                  }
                );

                if (nearbySticks.length >= 4) {
                  // Anchor the stone so it can't be pushed around during fire-starting
                  if (!targetItem.isAnchored) {
                    usePhysicsItemStore.getState().updateItem(targetItem.id, { isAnchored: true });
                  }

                  // Correct Ingredients Found!
                  const currentHeat = targetItem.heat || 0;

                  if (currentHeat >= 10) {
                    // IGNITE!
                    // REMOVED: Remove Stone (User request: rock stays)
                    // const removeItem = usePhysicsItemStore.getState().removeItem;
                    // removeItem(targetItem.id);

                    const removeItem = usePhysicsItemStore.getState().removeItem;

                    // Remove 4 sticks
                    for (let i = 0; i < 4; i++) {
                      removeItem(nearbySticks[i].id);
                    }

                    // Spawn Fire
                    // Place fire slightly above rock so it doesn't clip perfectly
                    spawnPhysicsItem(
                      ItemType.FIRE,
                      [targetItem.position[0], targetItem.position[1] + 0.3, targetItem.position[2]],
                      [0, 0, 0]
                    );
                  } else {
                    // Heat up
                    usePhysicsItemStore.getState().updateItem(targetItem.id, { heat: currentHeat + 1 });
                  }
                }
              }
              return;
            }
          }

          // Even if we miss, trigger animation
          setAction('DIG');
          setTimeout(() => setAction(null), 100);
          return;
        }

        // 3. Torch Collection (Holding Stick)
        if (selectedItem === ItemType.STICK) {
          const origin = camera.position;
          const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);

          const ray = new rapier.Ray(origin, direction);
          const hit = world.castRay(ray, 3.0, true, undefined, undefined, undefined, undefined, (collider: any) => {
            return collider.parent()?.userData?.type === ItemType.FIRE;
          });

          if (hit) {
            const collider = hit.collider;
            const rigidBody = collider.parent();

            if (rigidBody && (rigidBody.userData as any)?.type === ItemType.FIRE) {
              // Hit Fire with Stick!
              const inv = useInventoryStore.getState();
              inv.removeItem(ItemType.STICK, 1);
              inv.addItem(ItemType.TORCH, 1);

              // Animation
              setAction('DIG');
              setTimeout(() => setAction(null), 100);
              return;
            }
          }

          // Trigger animation even on miss
          setAction('DIG');
          setTimeout(() => setAction(null), 100);
          return;
        }

        return;
      }

      // Right Click: allow throwing held physics items; BUILD is intentionally disabled for now.
      if (e.button === 2) {
        // Throw Logic for Physics Items
        if (tryThrowSelected()) return;
      }
    };

    const handleMouseUp = () => {
      setInteracting(false);
      setAction(null);
    };

    const handleContextMenu = (e: MouseEvent) => e.preventDefault();

    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('contextmenu', handleContextMenu);

    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [setInteracting, setAction, camera, hasPickaxe, inventorySlots, selectedSlotIndex, removeItem, spawnPhysicsItem]);

  return null;
};
