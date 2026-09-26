import React, { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useInventoryStore } from '@state/InventoryStore';
import { usePhysicsItemStore } from '@state/PhysicsItemStore';
import { useWorldStore } from '@state/WorldStore';
import { Vector3 } from 'three';
import { ItemType } from '@/types';
import { useInputStore } from '@/state/InputStore';
import { openCraftingForSelected } from '@features/crafting/openCrafting';
import { useSettingsStore } from '@state/SettingsStore';
import { useRapier } from '@react-three/rapier';
import { emitSpark } from '../components/SparkSystem';
import { emitImpact } from '../components/ImpactFX';
import { useEntityHistoryStore } from '@/state/EntityHistoryStore';
import { useLogStore } from '@/state/LogStore';

/** Horizontal distance from the eye at which thrown items spawn (capsule radius 0.4 + item size). */
const THROW_SPAWN_CLEARANCE = 0.8;
import { getToolCapabilities } from './ToolCapabilities';
import { STRIKE_CONTACT_MS } from '@features/terrain/hooks/useTerrainInteraction';

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
      // Only open crafting from active gameplay (not while typing or in menus).
      if (e.key.toLowerCase() === 'c' && !e.repeat && !useSettingsStore.getState().isSettingsOpen) {
        openCraftingForSelected();
        // Closing is handled by CraftingInterface, which cancels transactionally.
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

      // The hand flicks forward (FirstPersonTools) and the item leaves it at
      // the flick's release, aimed where the player looks at that moment.
      window.dispatchEvent(new CustomEvent('vc-throw'));
      window.setTimeout(() => {
      // A quick double press schedules two releases: only throw what is still held.
      if (useInventoryStore.getState().getItemCount(selectedItem) < 1) return;
      // Calculate Throw Vector
      const origin = camera.position.clone();
      const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      // Spawn clear of the player's capsule (radius 0.4): push forward along the
      // horizontal view direction first. 0.5m along the view ray put downward
      // throws inside the capsule, which then kicked the item or the player.
      const flat = new THREE.Vector3(direction.x, 0, direction.z);
      // Looking straight down: the screen's "up" axis points where the player faces.
      if (flat.lengthSq() < 1e-6) flat.set(0, 1, 0).applyQuaternion(camera.quaternion).setY(0);
      if (flat.lengthSq() < 1e-6) flat.set(0, 0, -1);
      flat.normalize();
      const spawnPos = origin.addScaledVector(flat, THROW_SPAWN_CLEARANCE).addScaledVector(direction, 0.25);
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
      }, STRIKE_CONTACT_MS);

      return true;
    };

    // `fromTouch` marks presses from the on-screen touch buttons (no pointer lock on touch).
    const handleMouseDown = (e: MouseEvent | { button: number; fromTouch: true }) => {
      if (!('fromTouch' in e) && !document.pointerLockElement) return;

      // Hands full: a carried log can only be set in place (right click).
      if (useLogStore.getState().carriedId) {
        if (e.button === 2) window.dispatchEvent(new CustomEvent('vc-log-place-request'));
        return;
      }

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
                const kindlingId = `kindling-${targetItem.id}`;
                if (nearbySticks.length > 0 && nearbySticks.length < 4) {
                  // A stone with sticks around it is a hearth: teach the recipe
                  // and never knap it (players broke their hearth stone into
                  // flakes while trying to light it).
                  const need = 4 - nearbySticks.length;
                  emitSpark(hitPoint);
                  useEntityHistoryStore.getState().setProgress(kindlingId, 0, 10, `Kindling: ${need} more stick${need === 1 ? '' : 's'} around the stone`);
                  return;
                }
                if (nearbySticks.length >= 4) {
                  // Only emit spark for fire-starting (knapping sparks are in useTerrainInteraction)
                  emitSpark(hitPoint);
                  // Heat builds: the bar fills and the kindling smokes more with every strike.
                  const heatNow = Math.min(10, (targetItem.heat || 0) + 1);
                  useEntityHistoryStore.getState().setProgress(kindlingId, heatNow, 10, 'Kindling');
                  emitImpact({
                    position: new THREE.Vector3(livePosition.x, livePosition.y + 0.15, livePosition.z),
                    direction: new THREE.Vector3(0, 1, 0),
                    kind: 'sand', color: '#8c877e', strength: 0.4 + heatNow * 0.12,
                    floorY: livePosition.y - 0.1,
                  });
                  if (!targetItem.isAnchored) {
                    usePhysicsItemStore.getState().updateItem(targetItem.id, { isAnchored: true });
                  }
                  const currentHeat = targetItem.heat || 0;
                  if (currentHeat >= 10) {
                    // Use bulk removal to avoid 5+ separate React reconciliation cycles
                    // This prevents the 3-second freeze when fire starts
                    useEntityHistoryStore.getState().setTargetEntity(null);
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
        if (capabilities && (capabilities.canChop || capabilities.canSmash || capabilities.canDig || capabilities.canSaw)) {
          if (capabilities.canSaw && !capabilities.canChop && !capabilities.canDig) {
            setInteractionAction('SAW');
          } else if (capabilities.canChop) {
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

      // Right Click: BUILD or Throw
      if (e.button === 2) {
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

    // Touch action buttons (TouchControls) dispatch vc-touch-action {button, pressed}.
    const handleTouchAction = (e: Event) => {
      const detail = (e as CustomEvent<{ button: number; pressed: boolean }>).detail;
      if (!detail) return;
      if (detail.pressed) handleMouseDown({ button: detail.button, fromTouch: true });
      else handleMouseUp();
    };

    window.addEventListener('vc-touch-action', handleTouchAction);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('contextmenu', handleContextMenu);

    return () => {
      window.removeEventListener('vc-touch-action', handleTouchAction);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [setInteractionAction, camera, hasPickaxe, inventorySlots, selectedSlotIndex, removeItem, spawnPhysicsItem, customTools, world, rapier]);

  return null;
};
