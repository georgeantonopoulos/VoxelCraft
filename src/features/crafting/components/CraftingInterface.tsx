import React, { useEffect, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Environment, ContactShadows } from '@react-three/drei';
import { Vector2 } from 'three';

import { useCraftingStore } from '@/state/CraftingStore';
import { useInventoryStore } from '@/state/InventoryStore';
import { STICK_SLOTS } from '../CraftingData';
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

const StoneMesh = () => (
  <mesh castShadow receiveShadow>
    <icosahedronGeometry args={[0.08, 1]} />
    <meshStandardMaterial color="#888888" roughness={0.8} />
  </mesh>
);

const SmallStickMesh = () => (
  <mesh castShadow receiveShadow>
    <cylinderGeometry args={[0.02, 0.02, 0.4, 8]} />
    <meshStandardMaterial color="#5c4033" roughness={0.9} />
  </mesh>
);


// The "Ghost" Slot
const SlotIndicator = ({ slot, isFilled, onInteract, draggedItem }: any) => {
  const [hovered, setHover] = useState(false);

  // Is the current dragged item allowed in this slot?
  const isCompatible = draggedItem && slot.allowedItems.includes(draggedItem);
  const isIncompatible = draggedItem && !isCompatible;

  // Don't render ghost if slot is filled
  if (isFilled) return null;

  return (
    <group position={slot.position} rotation={slot.rotation}>
      <mesh
        userData={{ slotId: slot.id }}
        onPointerOver={() => setHover(true)}
        onPointerOut={() => setHover(false)}
        onPointerUp={() => isCompatible && onInteract(slot.id, draggedItem)}
      >
        <sphereGeometry args={[0.1, 16, 16]} />
        <meshBasicMaterial
          color={isCompatible ? (hovered ? "#4ade80" : "#22c55e") : (isIncompatible ? (hovered ? "#ef4444" : "#f97316") : "#ffffff")}
          transparent
          opacity={(hovered || isIncompatible) ? 0.6 : 0.2}
          wireframe={!hovered && !isCompatible && !isIncompatible}
        />
      </mesh>
      {/* Visual guide for compatibility */}
      {isCompatible && (
        <mesh scale={hovered ? 1.1 : 1.0}>
          <sphereGeometry args={[0.12, 16, 16]} />
          <meshBasicMaterial color="#4ade80" transparent opacity={0.1} />
        </mesh>
      )}
    </group>
  );
};

// Internal component to handle native drops via raycasting
const DropManager = ({ onDrop }: { onDrop: (slotId: string, itemType: ItemType) => void }) => {
  const { raycaster, camera, scene } = useThree();
  const draggedItem = useCraftingStore(state => state.draggedItem);

  useEffect(() => {
    const handleDrop = (e: DragEvent) => {
      if (!draggedItem) return;

      const x = (e.clientX / window.innerWidth) * 2 - 1;
      const y = -(e.clientY / window.innerHeight) * 2 + 1;
      raycaster.setFromCamera(new Vector2(x, y), camera);

      const intersects = raycaster.intersectObjects(scene.children, true);
      const slotHit = intersects.find(hit => hit.object.userData?.slotId);

      if (slotHit) {
        onDrop(slotHit.object.userData.slotId, draggedItem);
      }
    };

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault(); // Necessary to allow dropping
    };

    window.addEventListener('drop', handleDrop);
    window.addEventListener('dragover', handleDragOver);
    return () => {
      window.removeEventListener('drop', handleDrop);
      window.removeEventListener('dragover', handleDragOver);
    };
  }, [draggedItem, camera, raycaster, scene, onDrop]);

  return null;
};

export const CraftingInterface: React.FC = () => {
  const { isOpen, closeCrafting, attachedItems, attach, draggedItem, baseItem } = useCraftingStore();
  const { removeItem, addCustomTool } = useInventoryStore();

  // Keyboard Exit (C)
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'c' || e.key === 'Escape') {
        closeCrafting();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, closeCrafting]);

  // Interaction Logic
  const handleSlotDrop = (slotId: string, itemType: ItemType) => {
    const slot = STICK_SLOTS.find(s => s.id === slotId);
    if (!slot || !slot.allowedItems.includes(itemType)) return;

    removeItem(itemType, 1);
    attach(slotId, itemType);
  };

  const handleFinish = () => {
    if (Object.keys(attachedItems).length === 0) {
      closeCrafting();
      return;
    }

    addCustomTool({
      id: `tool_${Date.now()}`,
      baseType: baseItem || ItemType.STICK,
      attachments: { ...attachedItems }
    });
    closeCrafting();
  };

  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 z-[55] pointer-events-none">
      {/* Semi-transparent blur background only in a central vignette to keep inventory clear */}
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" />

      {/* UI Overlay */}
      <div className="absolute top-12 left-0 right-0 text-center pointer-events-none">
        <h2 className="text-4xl font-black text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.5)] tracking-tight">CRAFTING</h2>
        <p className="text-emerald-400 font-bold text-sm uppercase tracking-widest mt-1">Combine materials into a unique tool</p>
      </div>

      {/* 3D Scene */}
      <div className="w-full h-full pointer-events-auto">
        <Canvas shadows camera={{ position: [0, 0, 2], fov: 45 }}>
          <DropManager onDrop={handleSlotDrop} />
          <OrbitControls
            enablePan={false}
            minDistance={1.2}
            maxDistance={3}
            makeDefault
            autoRotate={!draggedItem}
            autoRotateSpeed={0.5}
          />

          <Environment preset="forest" />
          <ambientLight intensity={0.5} />
          <pointLight position={[5, 10, 5]} intensity={1.5} castShadow />
          <pointLight position={[-5, 5, -5]} intensity={0.5} color="#4ade80" />

          <group position={[0, -0.2, 0]}>
            {/* Base Item */}
            <StickMesh />

            {/* Slots & Attachments */}
            {STICK_SLOTS.map(slot => (
              <group key={slot.id}>
                {/* Render Item if attached */}
                {attachedItems[slot.id] && (
                  <group position={slot.position} rotation={slot.rotation}>
                    {attachedItems[slot.id] === ItemType.SHARD && <ShardMesh />}
                    {attachedItems[slot.id] === ItemType.STONE && <StoneMesh />}
                    {attachedItems[slot.id] === ItemType.STICK && <SmallStickMesh />}
                  </group>
                )}

                {/* Render Drop-able Hotspot if empty */}
                <SlotIndicator
                  slot={slot}
                  isFilled={!!attachedItems[slot.id]}
                  onInteract={handleSlotDrop}
                  draggedItem={draggedItem}
                />
              </group>
            ))}
          </group>

          <ContactShadows opacity={0.6} scale={5} blur={2.4} far={2} />
        </Canvas>
      </div>

      {/* Action Buttons */}
      <div className="absolute bottom-12 left-0 right-0 flex justify-center gap-6 pointer-events-auto">
        <button
          onClick={() => closeCrafting()}
          className="px-8 py-3 bg-white/10 hover:bg-white/20 text-white rounded-full font-bold transition-all border border-white/20 backdrop-blur-md"
        >
          CANCEL
        </button>
        <button
          onClick={handleFinish}
          className="px-10 py-3 bg-emerald-500 hover:bg-emerald-400 text-white rounded-full font-black tracking-widest transition-all shadow-lg shadow-emerald-500/20"
        >
          FINISH & SAVE
        </button>
      </div>

      <button
        onClick={() => closeCrafting()}
        className="absolute top-8 right-8 w-12 h-12 flex items-center justify-center bg-white/10 hover:bg-red-500/80 text-white rounded-full transition-all duration-200 pointer-events-auto group border border-white/20 z-[70]"
        title="Close (C)"
      >
        <span className="text-2xl font-bold group-hover:scale-110 transition-transform">×</span>
      </button>
    </div>
  );
};
