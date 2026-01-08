import React, { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useInventoryStore } from '@state/InventoryStore';
import { usePhysicsItemStore } from '@state/PhysicsItemStore';
import { useWorldStore } from '@state/WorldStore';
import { Vector3 } from 'three';
import { ItemType } from '@/types';
import { useInputStore } from '@/state/InputStore';
import { useCraftingStore } from '@/state/CraftingStore';
import { useCarryingStore } from '@/state/CarryingStore';
import { useRapier } from '@react-three/rapier';
import { emitSpark } from '../components/SparkSystem';
import { getToolCapabilities } from './ToolCapabilities';

interface InteractionHandlerProps {
}

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

  const luminaClickCount = useRef(0);
  const lastLuminaClickTime = useRef(0);

  // Keyboard Input Logic
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // C key: Open crafting
      if (e.key.toLowerCase() === 'c') {
        const invState = useInventoryStore.getState();
        const currentItem = invState.inventorySlots[invState.selectedSlotIndex];
        const craftingState = useCraftingStore.getState();

        if (!craftingState.isOpen) {
          const isCustom = typeof currentItem === 'string' && currentItem.startsWith('tool_');
          if (currentItem === ItemType.STICK || isCustom) {
            document.exitPointerLock();
            if (isCustom) {
              const tool = invState.customTools[currentItem as string];
              craftingState.openCrafting(tool.baseType, tool.id, { ...tool.attachments });
            } else {
              craftingState.openCrafting(ItemType.STICK);
            }
          }
        } else {
          craftingState.closeCrafting();
        }
      }

      // Q key: Pick up / drop log
      if (e.key.toLowerCase() === 'q') {
        if (!document.pointerLockElement) return;

        const carryingState = useCarryingStore.getState();

        if (carryingState.isCarrying()) {
          // Drop the carried log - dispatch event for VoxelTerrain to handle
          const droppedLog = carryingState.drop();
          if (droppedLog) {
            const origin = camera.position.clone();
            const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
            // Drop position: slightly in front of player, at player's feet level
            const dropPos = origin.clone().add(direction.multiplyScalar(1.5));
            dropPos.y = origin.y - 0.5; // Drop at feet level

            window.dispatchEvent(new CustomEvent('vc-log-drop', {
              detail: {
                log: droppedLog,
                position: [dropPos.x, dropPos.y, dropPos.z]
              }
            }));
          }
        } else {
          // Try to pick up a nearby log - raycast for logs
          const origin = camera.position.clone();
          const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
          const ray = new rapier.Ray(origin, direction);

          const hit = world.castRay(ray, 4.0, true, undefined, undefined, undefined, undefined, (collider: any) => {
            return collider.parent()?.userData?.type === 'log';
          });

          if (hit && hit.collider) {
            const rigidBody = hit.collider.parent();
            if (rigidBody) {
              const userData = rigidBody.userData as any;
              if (userData?.type === 'log') {
                // Pick up the log into CarryingStore (no sphere animation)
                carryingState.pickUp({
                  id: userData.id,
                  treeType: userData.treeType,
                  seed: userData.seed || 0
                });

                // Dispatch event to remove log from world
                window.dispatchEvent(new CustomEvent('vc-log-pickup', {
                  detail: { logId: userData.id }
                }));
              }
            }
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [camera, world, rapier]);

  // Mouse wheel rotation toggle for building placement
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      // Only handle wheel when carrying a log (prevents inventory switching)
      const carryingState = useCarryingStore.getState();
      if (!carryingState.isCarrying()) return;
      if (!document.pointerLockElement) return;

      // Prevent default to stop inventory scrolling
      e.preventDefault();

      // Dispatch rotation toggle event (wheel direction doesn't matter, just toggles)
      window.dispatchEvent(new CustomEvent('vc-building-rotation-toggle'));
    };

    // Use passive: false to allow preventDefault
    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => window.removeEventListener('wheel', handleWheel);
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

      // Spawn Physics Item
      if (isCustom) {
        // Find base type if possible, or default to STICK for visualization base
        const toolData = useInventoryStore.getState().customTools[selectedItem as string];
        const baseType = toolData?.baseType || ItemType.STICK;
        spawnPhysicsItem(baseType, [spawnPos.x, spawnPos.y, spawnPos.z], [velocity.x, velocity.y, velocity.z], toolData);

        // Remove from Inventory
        const removeCustomTool = useInventoryStore.getState().removeCustomTool;
        removeCustomTool(selectedItem as string);
      } else {
        spawnPhysicsItem(selectedItem as ItemType, [spawnPos.x, spawnPos.y, spawnPos.z], [velocity.x, velocity.y, velocity.z]);
        removeItem(selectedItem as ItemType, 1);
      }

      return true;
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (!document.pointerLockElement) return;

      const selectedItem = inventorySlots[selectedSlotIndex];
      // Resolve CustomTool object if the item is a tool ID string
      const resolvedItem = (typeof selectedItem === 'string' && selectedItem.startsWith('tool_'))
        ? customTools[selectedItem]
        : selectedItem as ItemType;

      const capabilities = getToolCapabilities(resolvedItem);
      const pickaxeSelected = hasPickaxe && selectedItem === ItemType.PICKAXE;

      // Left Click
      if (e.button === 0) {
        // Lumina Tool Logic
        if (capabilities.isLuminaTool) {
          const now = Date.now();
          if (now - lastLuminaClickTime.current > 1000) {
            luminaClickCount.current = 0;
          }
          luminaClickCount.current++;
          lastLuminaClickTime.current = now;

          if (luminaClickCount.current >= 3) {
            luminaClickCount.current = 0;
            // Trigger Special Action: Find Cave Exit
            window.dispatchEvent(new CustomEvent('lumina-special-action', {
              detail: { luminaCount: capabilities.luminaCount }
            }));
          }
        }

        // 1. Fire Creation (Holding Stone) - Check FIRST to prevent SMASH action when fire-starting
        // FIX: Fire creation must be checked before setting SMASH action to prevent damage
        // from being applied to the target rock during fire-starting attempts
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
              const state = usePhysicsItemStore.getState();
              const targetItem = state.items.find(i => i.id === (rigidBody.userData as any).id);

              if (targetItem) {
                // FIX: Use live rigidBody position instead of stale store position
                // The store position is only updated when items are planted, not during physics simulation
                const rbTranslation = rigidBody.translation();
                const livePosition = { x: rbTranslation.x, y: rbTranslation.y, z: rbTranslation.z };

                const nearbySticks: any[] = [];
                const spherePos = livePosition;
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

                // FIX: Only proceed with fire logic if there are enough sticks nearby
                // If not enough sticks, fall through to normal SMASH behavior
                if (nearbySticks.length >= 4) {
                  // Only emit spark for fire-starting (knapping sparks are in useTerrainInteraction)
                  emitSpark(hitPoint);
                  if (!targetItem.isAnchored) {
                    usePhysicsItemStore.getState().updateItem(targetItem.id, { isAnchored: true });
                  }
                  const currentHeat = targetItem.heat || 0;
                  if (currentHeat >= 10) {
                    // Use bulk removal to avoid 5+ separate React reconciliation cycles
                    // This prevents the 3-second freeze when fire starts
                    const idsToRemove = nearbySticks.slice(0, 4).map(s => s.id);
                    idsToRemove.push(targetItem.id); // Also remove the rock
                    usePhysicsItemStore.getState().bulkRemoveItems(idsToRemove);

                    // FIX: Use stable ID for both physics and world entity to ensure persistence
                    const fireId = Math.random().toString(36).substring(2, 9);

                    // FIX: Use live position for fire spawn location
                    spawnPhysicsItem(
                      ItemType.FIRE,
                      [livePosition.x, livePosition.y + 0.3, livePosition.z],
                      [0, 0, 0],
                      undefined,
                      fireId
                    );

                    // Register with WorldStore for persistence
                    useWorldStore.getState().addEntity({
                      id: fireId,
                      type: ItemType.FIRE,
                      position: new Vector3(livePosition.x, livePosition.y + 0.3, livePosition.z)
                    });
                  } else {
                    usePhysicsItemStore.getState().updateItem(targetItem.id, { heat: currentHeat + 1 });
                  }
                  // FIX: Return early WITHOUT setting SMASH action - prevents damage to target rock
                  return;
                }
                // Not enough sticks for fire - set SMASH action to trigger knapping in useTerrainInteraction
                // The spark and audio will be handled there to avoid duplicate effects
              }
              // No sticks nearby - fall through to SMASH action below
            }
          }
          // No stone hit - fall through to SMASH action below
        }

        // 2. Tool Interaction (Standard or Custom Tool)
        if (capabilities && (capabilities.canChop || capabilities.canSaw || capabilities.canSmash || capabilities.canDig)) {
          if (capabilities.canChop || capabilities.canSaw) {
            // SAW and AXE both use CHOP action for tree interactions
            setInteractionAction('CHOP');
          } else if (capabilities.canSmash) {
            setInteractionAction('SMASH');
          } else if (capabilities.canDig) {
            setInteractionAction('DIG');
          }
        }

        if (pickaxeSelected) {
          setInteractionAction('DIG');
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

      // Right Click: BUILD or Throw or Place Log
      if (e.button === 2) {
        // If carrying a log, attempt to place it
        const carryingState = useCarryingStore.getState();
        if (carryingState.isCarrying()) {
          // Dispatch placement request event - VoxelTerrain handles the actual placement
          window.dispatchEvent(new CustomEvent('vc-log-place-request'));
          return;
        }

        // BUILD with pickaxe or digging tools
        if (pickaxeSelected || capabilities.canDig) {
          setInteractionAction('BUILD');
          return;
        }
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
