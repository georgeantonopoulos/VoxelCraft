import React, { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useInventoryStore } from '@state/InventoryStore';
import { usePhysicsItemStore } from '@state/PhysicsItemStore';
import { ItemType } from '@/types';
import { useInputStore } from '@/state/InputStore';
import { useCraftingStore } from '@/state/CraftingStore';
import { useRapier } from '@react-three/rapier';
import { emitSpark } from '../components/SparkSystem';

interface InteractionHandlerProps {
}

import { getToolCapabilities } from './ToolCapabilities';

export const InteractionHandler: React.FC<InteractionHandlerProps> = () => {
  const { camera } = useThree();
  const { world, rapier } = useRapier();
  const { setInteractionAction } = useInputStore();

  // Stores
  const inventorySlots = useInventoryStore(state => state.inventorySlots);
  const selectedSlotIndex = useInventoryStore(state => state.selectedSlotIndex);
  const customTools = useInventoryStore(state => state.customTools);
  const hasPickaxe = useInventoryStore(state => state.hasPickaxe);
  const removeItem = useInventoryStore(state => state.removeItem);
  const spawnPhysicsItem = usePhysicsItemStore(state => state.spawnItem);


  // Keyboard Input Logic
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'c') {
        const invState = useInventoryStore.getState();
        const currentItem = invState.inventorySlots[invState.selectedSlotIndex];
        const craftingState = useCraftingStore.getState();

        if (!craftingState.isOpen) {
          if (currentItem === ItemType.STICK) {
            document.exitPointerLock();
            craftingState.openCrafting(ItemType.STICK);
          }
        } else {
          craftingState.closeCrafting();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Mouse Input Logic
  useEffect(() => {
    const tryThrowSelected = (): boolean => {
      const selectedItem = inventorySlots[selectedSlotIndex];
      if (!selectedItem) return false;

      const isCustom = typeof selectedItem === 'string' && selectedItem.startsWith('tool_');
      const isStandard = selectedItem === ItemType.STICK || selectedItem === ItemType.STONE || selectedItem === ItemType.SHARD;

      if (!isCustom && !isStandard) return false;

      // Calculate Throw Vector
      const origin = camera.position.clone();
      const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      const spawnPos = origin.add(direction.clone().multiplyScalar(0.5));
      const force = 24.0;
      const velocity = direction.multiplyScalar(force);
      velocity.y += 2.0;

      // For custom tools, we just spawn a stick for now (placeholder for drop logic)
      const type = isCustom ? ItemType.STICK : (selectedItem === ItemType.STICK ? ItemType.STICK : selectedItem === ItemType.STONE ? ItemType.STONE : ItemType.SHARD);
      spawnPhysicsItem(type as ItemType, [spawnPos.x, spawnPos.y, spawnPos.z], [velocity.x, velocity.y, velocity.z]);

      const removeCustomTool = useInventoryStore.getState().removeCustomTool;

      // Remove from Inventory
      if (isCustom) {
        removeCustomTool(selectedItem as string);
      } else {
        removeItem(selectedItem as ItemType, 1);
      }

      return true;
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (!document.pointerLockElement) return;

      const selectedItem = inventorySlots[selectedSlotIndex];
      const activeCustomTool = typeof selectedItem === 'string' ? customTools[selectedItem] : null;

      const pickaxeSelected = hasPickaxe && selectedItem === ItemType.PICKAXE;
      const capabilities = activeCustomTool ? getToolCapabilities(activeCustomTool) : null;

      // Left Click
      if (e.button === 0) {
        // 1. Tool Interaction (Pickaxe or Custom Tool)
        if (capabilities && capabilities.canChop) {
          setInteractionAction('CHOP');
          return;
        }

        if (pickaxeSelected || (capabilities && capabilities.canDig)) {
          setInteractionAction('DIG');
          return;
        }

        // 2. Fire Creation (Holding Stone)
        if (selectedItem === ItemType.STONE) {
          const origin = camera.position;
          const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);

          const ray = new rapier.Ray(origin, direction);
          const hit = world.castRay(ray, 3.0, true, undefined, undefined, undefined, undefined, (collider: any) => {
            return collider.parent()?.userData?.type === ItemType.STONE;
          });

          if (hit) {
            const collider = hit.collider;
            const rigidBody = collider.parent();
            const hitPoint = origin.clone().add(direction.clone().multiplyScalar(hit.timeOfImpact));

            if (rigidBody && (rigidBody.userData as any)?.type === ItemType.STONE) {
              emitSpark(hitPoint);
              const state = usePhysicsItemStore.getState();
              const targetItem = state.items.find(i => i.id === (rigidBody.userData as any).id);

              if (targetItem) {
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
                    return true;
                  }
                );

                if (nearbySticks.length >= 4) {
                  if (!targetItem.isAnchored) {
                    usePhysicsItemStore.getState().updateItem(targetItem.id, { isAnchored: true });
                  }
                  const currentHeat = targetItem.heat || 0;
                  if (currentHeat >= 10) {
                    const removeItem = usePhysicsItemStore.getState().removeItem;
                    for (let i = 0; i < 4; i++) {
                      removeItem(nearbySticks[i].id);
                    }
                    spawnPhysicsItem(
                      ItemType.FIRE,
                      [targetItem.position[0], targetItem.position[1] + 0.3, targetItem.position[2]],
                      [0, 0, 0]
                    );
                  } else {
                    usePhysicsItemStore.getState().updateItem(targetItem.id, { heat: currentHeat + 1 });
                  }
                }
              }
              return;
            }
          }
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
              const inv = useInventoryStore.getState();
              inv.removeItem(ItemType.STICK, 1);
              inv.addItem(ItemType.TORCH, 1);
              return;
            }
          }
          return;
        }

        return;
      }

      // Right Click: Throw
      if (e.button === 2) {
        if (tryThrowSelected()) return;
      }
    };

    const handleMouseUp = () => {
      setInteractionAction(null);
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
  }, [setInteractionAction, camera, hasPickaxe, inventorySlots, selectedSlotIndex, removeItem, spawnPhysicsItem, customTools, world, rapier]);

  return null;
};
