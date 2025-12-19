import React, { useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Environment, ContactShadows } from '@react-three/drei';
import * as THREE from 'three';

import { useCraftingStore } from '@/state/CraftingStore';
import { useInventoryStore } from '@/state/InventoryStore';
import { STICK_SLOTS, RECIPES } from '../CraftingData';
import { ItemType } from '@/types';

// Placeholder meshes
const ShardMesh = () => (
  <mesh castShadow receiveShadow>
    <coneGeometry args={[0.06, 0.25, 4]} />
    <meshStandardMaterial color="#00ffff" emissive="#008888" emissiveIntensity={0.5} roughness={0.2} />
  </mesh>
);

const StickMesh = () => (
  <mesh castShadow receiveShadow>
    <cylinderGeometry args={[0.03, 0.03, 1, 8]} />
    <meshStandardMaterial color="#5c4033" roughness={0.9} />
  </mesh>
);

// The "Ghost" Slot
const SlotIndicator = ({ slot, isFilled, onInteract }: any) => {
  const [hovered, setHover] = useState(false);

  // Don't render ghost if slot is filled
  if (isFilled) return null;

  return (
    <group position={slot.position} rotation={slot.rotation}>
      <mesh
        onPointerOver={() => setHover(true)}
        onPointerOut={() => setHover(false)}
        onClick={() => onInteract(slot.id)}
      >
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshBasicMaterial
          color={hovered ? "#4ade80" : "#ffffff"}
          transparent
          opacity={hovered ? 0.4 : 0.1}
          wireframe={!hovered}
        />
      </mesh>
    </group>
  );
};

export const CraftingInterface: React.FC = () => {
  const { isOpen, closeCrafting, attachedItems, attach } = useCraftingStore();
  const { removeItem, setHasPickaxe, setHasAxe } = useInventoryStore();

  // Interaction Logic
  const handleSlotClick = (slotId: string) => {
    // Find the slot definition to see allowed items
    const slotDef = STICK_SLOTS.find(s => s.id === slotId);
    if (!slotDef) return;

    const inventoryState = useInventoryStore.getState();

    // Check which allowed item the user has
    // We iterate through allowedItems in order of preference (defined in CraftingData)
    const itemToAttach = slotDef.allowedItems.find(item => {
      // Use helper to check count of specific item type
      // Note: InventoryStore might need a generic getItemCount, but we can access state directly via mapped keys or manually check
      // Currently inventory uses specific counts like shardCount, stoneCount.
      // We'll use the generic getItemCount helper from the store.
      return inventoryState.getItemCount(item) > 0;
    });

    if (itemToAttach) {
      removeItem(itemToAttach, 1);
      attach(slotId, itemToAttach);
      // Play a small "clink" sound here if you have an audio manager
    } else {
      console.log("No compatible items to attach!");
    }
  };

  // Recipe Check Effect
  useEffect(() => {
    const currentSlots = Object.keys(attachedItems);

    for (const recipe of RECIPES) {
      // Check if all ingredients are present
      const match = recipe.ingredients.every(slot => attachedItems[slot]);
      const exactCount = currentSlots.length === recipe.ingredients.length;

      if (match && exactCount) {
        // CRAFTED!
        setTimeout(() => {
          if (recipe.result === ItemType.PICKAXE) {
             setHasPickaxe(true);
          } else if (recipe.result === ItemType.AXE) {
             setHasAxe(true);
          }
          closeCrafting();
        }, 600); // 600ms delay to admire your work
        break;
      }
    }
  }, [attachedItems, closeCrafting, setHasPickaxe, setHasAxe]);

  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 z-50 bg-slate-900/80 backdrop-blur-sm transition-opacity duration-200">
      {/* UI Overlay */}
      <div className="absolute top-8 left-0 right-0 text-center pointer-events-none">
        <h2 className="text-3xl font-bold text-white drop-shadow-md">Workbench</h2>
        <p className="text-white/60 text-sm">Click slots to attach Shards</p>
      </div>

      <button
        onClick={closeCrafting}
        className="absolute top-8 right-8 text-white/50 hover:text-white font-bold text-xl transition-colors pointer-events-auto"
      >
        ESC
      </button>

      {/* 3D Scene */}
      <Canvas shadows>
        <PerspectiveCamera makeDefault position={[0, 0, 2.5]} fov={50} />
        <OrbitControls enablePan={false} minDistance={1.5} maxDistance={4} />

        <Environment preset="city" />
        <ambientLight intensity={0.5} />
        <pointLight position={[5, 5, 5]} intensity={1} castShadow />

        <group position={[0, -0.2, 0]}>
          {/* Base Item */}
          <StickMesh />

          {/* Slots & Attachments */}
          {STICK_SLOTS.map(slot => (
            <group key={slot.id}>
              {/* Render Item if attached */}
              {attachedItems[slot.id] === ItemType.SHARD && (
                <group position={slot.position} rotation={slot.rotation}>
                  <ShardMesh />
                </group>
              )}

              {/* Render Clickable Ghost if empty */}
              <SlotIndicator
                slot={slot}
                isFilled={!!attachedItems[slot.id]}
                onInteract={handleSlotClick}
              />
            </group>
          ))}
        </group>

        <ContactShadows opacity={0.4} scale={10} blur={2.5} far={4} />
      </Canvas>
    </div>
  );
};
