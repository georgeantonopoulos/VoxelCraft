import React, { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useInventoryStore } from '@state/InventoryStore';
import { usePhysicsItemStore } from '@state/PhysicsItemStore';
import { ItemType } from '@/types';
import { useSettingsStore } from '@state/SettingsStore';
import { useInputStore } from '@/state/InputStore';

interface InteractionHandlerProps {
  setInteracting: (v: boolean) => void;
  setAction: (a: 'DIG' | 'BUILD' | null) => void;
}

export const InteractionHandler: React.FC<InteractionHandlerProps> = ({ setInteracting, setAction }) => {
  const { camera, scene } = useThree();
  const inputMode = useSettingsStore(s => s.inputMode);
  const hasPickaxe = useInventoryStore(state => state.hasPickaxe);
  const isDigging = useInputStore(s => s.isDigging);

  // Stores
  const inventorySlots = useInventoryStore(state => state.inventorySlots);
  const selectedSlotIndex = useInventoryStore(state => state.selectedSlotIndex);
  const removeItem = useInventoryStore(state => state.removeItem);
  const spawnPhysicsItem = usePhysicsItemStore(state => state.spawnItem);

  // Touch Input Logic (Restored from InteractionLayer)
  useEffect(() => {
    if (inputMode !== 'touch') return;
    const selectedItem = inventorySlots[selectedSlotIndex];
    const pickaxeSelected = hasPickaxe && selectedItem === 'pickaxe';

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
      if (selectedItem !== 'stick' && selectedItem !== 'stone' && selectedItem !== 'shard') return false;

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
      const type = selectedItem === 'stick' ? ItemType.STICK : selectedItem === 'stone' ? ItemType.STONE : ItemType.SHARD;
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
      const pickaxeSelected = hasPickaxe && selectedItem === 'pickaxe';

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
        if (selectedItem === 'stone') {
          // Raycast to find target PhysicsItem
          const raycaster = new THREE.Raycaster();
          raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);

          // We need to access the scene to intersect objects.
          // InteractionHandler doesn't have direct access to the physics objects list meshes easily
          // unless we traverse the scene.
          // Best way: Traverse scene children and find RigidBody meshes with userData.type
          const intersects = raycaster.intersectObjects(scene.children, true);

          for (const hit of intersects) {
            if (hit.distance > 3.0) continue; // Reach distance

            // Traverse up to find object with userData
            let obj: THREE.Object3D | null = hit.object;
            while (obj && (!obj.userData || !obj.userData.type)) {
              obj = obj.parent;
            }

            if (obj && obj.userData && obj.userData.type === ItemType.STONE) {
              // Hit a stone with a stone!
              // Visuals
              import('../components/SparkSystem').then(mod => {
                mod.emitSpark(hit.point);
              });

              // Trigger "Hit" Animation
              setAction('DIG'); // Reuse DIG animation trigger for now
              setTimeout(() => setAction(null), 100);

              // Helper to get distance between two points
              const distSq = (p1: [number, number, number], p2: [number, number, number]) => {
                const dx = p1[0] - p2[0];
                const dy = p1[1] - p2[1];
                const dz = p1[2] - p2[2];
                return dx * dx + dy * dy + dz * dz;
              };

              // Logic: Check for 4 sticks nearby
              const state = usePhysicsItemStore.getState();
              const targetItem = state.items.find(i => i.id === obj!.userData.id);

              if (targetItem) {
                // Find sticks nearby (radius 1.5)
                const nearbySticks = state.items.filter(i =>
                  i.type === ItemType.STICK &&
                  distSq(i.position, targetItem.position) < 2.25 // 1.5^2
                );

                if (nearbySticks.length >= 4) {
                  // Correct Ingredients Found!
                  const currentHeat = targetItem.heat || 0;

                  if (currentHeat >= 10) {
                    // IGNITE!
                    // Remove Stone
                    const removeItem = usePhysicsItemStore.getState().removeItem;

                    removeItem(targetItem.id);
                    // Remove 4 sticks
                    for (let i = 0; i < 4; i++) {
                      removeItem(nearbySticks[i].id);
                    }

                    // Spawn Fire
                    spawnPhysicsItem(
                      ItemType.FIRE,
                      targetItem.position,
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
        if (selectedItem === 'stick') {
          const raycaster = new THREE.Raycaster();
          raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
          const intersects = raycaster.intersectObjects(scene.children, true);

          for (const hit of intersects) {
            if (hit.distance > 3.0) continue;
            let obj: THREE.Object3D | null = hit.object;
            while (obj && (!obj.userData || !obj.userData.type)) {
              obj = obj.parent;
            }

            if (obj && obj.userData && obj.userData.type === ItemType.FIRE) {
              // Hit Fire with Stick!
              // Remove Stick from inventory? Actually we are holding it.
              // Just convert one stick + remove fire -> +1 Torch (or replace stick).
              // User requirement: "converts into a torch in the inventory"

              const removeItem = usePhysicsItemStore.getState().removeItem;

              // Remove Fire
              removeItem(obj.userData.id);

              // Update Inventory: Remove 1 stick, Add 1 torch
              const inv = useInventoryStore.getState();
              inv.removeItem('stick', 1);
              inv.addItem('torch', 1);

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
