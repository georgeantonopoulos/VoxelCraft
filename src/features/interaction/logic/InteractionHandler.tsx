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
  const { camera } = useThree();
  const inputMode = useSettingsStore(s => s.inputMode);
  const isDigging = useInputStore(s => s.isDigging);
  const isBuilding = useInputStore(s => s.isBuilding);

  // Stores
  const inventorySlots = useInventoryStore(state => state.inventorySlots);
  const selectedSlotIndex = useInventoryStore(state => state.selectedSlotIndex);
  const removeItem = useInventoryStore(state => state.removeItem);
  const spawnPhysicsItem = usePhysicsItemStore(state => state.spawnItem);

  // Touch Input Logic (Restored from InteractionLayer)
  useEffect(() => {
    if (inputMode !== 'touch') return;
    if (isDigging) {
      setAction('DIG');
      setInteracting(true);
    } else if (isBuilding) {
      setAction('BUILD');
      setInteracting(true);
    } else {
      setAction(null);
      setInteracting(false);
    }
  }, [isDigging, isBuilding, inputMode, setAction, setInteracting]);

  // Mouse Input Logic
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      // Only allow interaction if we are locked (gameplay)
      // Note: Touch users won't be pointer locked usually, but they use the effect above.
      // Desktop users click the canvas which locks the pointer.
      if (!document.pointerLockElement) return;

      const selectedItem = inventorySlots[selectedSlotIndex];

      // Left Click: Always DIG/Interact
      if (e.button === 0) {
        setAction('DIG');
        setInteracting(true);
        return;
      }

      // Right Click: Action depends on held item
      if (e.button === 2) {
        // Throw Logic for Physics Items
        if (selectedItem === 'stick' || selectedItem === 'stone' || selectedItem === 'shard') {
            // Calculate Throw Vector
            const origin = camera.position.clone();
            const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);

            // Spawn Position: Slightly in front of camera
            const spawnPos = origin.add(direction.clone().multiplyScalar(0.5));

            // Velocity: Direction * Force + Upward Arc
            // Force depends on item? Stick=20, Stone=25?
            // Stone needs > 12 rel velocity to shatter.
            // Stick needs > 8 to plant.
            // Let's give them a good hard throw.
            const force = 24.0;
            const velocity = direction.multiplyScalar(force);
            velocity.y += 2.0; // slight arc up

            // Spawn Item
            const type = selectedItem === 'stick' ? ItemType.STICK
                       : selectedItem === 'stone' ? ItemType.STONE
                       : ItemType.SHARD;

            spawnPhysicsItem(type, [spawnPos.x, spawnPos.y, spawnPos.z], [velocity.x, velocity.y, velocity.z]);

            // Remove from Inventory
            removeItem(selectedItem, 1);

            // Do NOT trigger VoxelTerrain BUILD action
            return;
        }

        // Default Build Logic (Blocks/Torches/Flora)
        setAction('BUILD');
        setInteracting(true);
      }
    };

    const handleMouseUp = () => {
      setInteracting(false);
      setAction(null);
    };

    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('contextmenu', (e) => e.preventDefault());

    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('contextmenu', (e) => e.preventDefault());
    };
  }, [setInteracting, setAction, camera, inventorySlots, selectedSlotIndex, removeItem, spawnPhysicsItem]);

  return null;
};
