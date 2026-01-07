import React, { useEffect, useState, useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Environment, ContactShadows } from '@react-three/drei';
import { Vector2 } from 'three';

import { useCraftingStore } from '@/state/CraftingStore';
import { useInventoryStore } from '@/state/InventoryStore';
import { STICK_SLOTS, RECIPES } from '../CraftingData';
import { ItemType, CustomTool } from '@/types';
import { getToolCapabilities } from '@/features/interaction/logic/ToolCapabilities';

import { StickMesh, StoneMesh, ShardMesh, FloraMesh, LashingMesh } from '@/features/interaction/components/UniversalTool';

/**
 * ToolStatsPanel - Shows preview of tool capabilities before crafting is complete.
 * Helps players understand what they're building.
 */
const ToolStatsPanel: React.FC<{ attachedItems: Record<string, ItemType> }> = ({ attachedItems }) => {
  // Create a mock tool to compute capabilities
  const previewTool: CustomTool = useMemo(() => ({
    id: 'preview',
    baseType: ItemType.STICK,
    attachments: attachedItems
  }), [attachedItems]);

  const caps = useMemo(() => getToolCapabilities(previewTool), [previewTool]);
  const attachmentCount = Object.keys(attachedItems).length;

  // Check for matching recipes
  const matchedRecipe = useMemo(() => {
    const filledSlots = Object.keys(attachedItems).sort();
    for (const recipe of RECIPES) {
      const recipeSlots = [...recipe.ingredients].sort();
      if (filledSlots.length === recipeSlots.length &&
          filledSlots.every((slot, i) => slot === recipeSlots[i])) {
        // Check if all ingredients are shards (for pickaxe/axe recognition)
        const allShards = Object.values(attachedItems).every(t => t === ItemType.SHARD);
        if (allShards) return recipe.result;
      }
    }
    return null;
  }, [attachedItems]);

  if (attachmentCount === 0) {
    return (
      <div className="absolute left-8 top-1/2 -translate-y-1/2 bg-black/40 backdrop-blur-md rounded-xl p-4 border border-white/10 pointer-events-none">
        <p className="text-white/50 text-sm italic">Drag items to attachment slots</p>
      </div>
    );
  }

  return (
    <div className="absolute left-8 top-1/2 -translate-y-1/2 bg-black/40 backdrop-blur-md rounded-xl p-4 border border-white/10 pointer-events-none min-w-[180px]">
      {/* Recipe Recognition */}
      {matchedRecipe && (
        <div className="mb-3 pb-3 border-b border-white/10">
          <span className="text-xs uppercase tracking-wider text-emerald-400 font-bold">Recipe Matched</span>
          <p className="text-white font-bold text-lg">{matchedRecipe}</p>
        </div>
      )}

      <h3 className="text-xs uppercase tracking-wider text-white/60 mb-2 font-bold">Tool Stats</h3>

      {/* Capabilities */}
      <div className="space-y-2 text-sm">
        {caps.canDig && (
          <div className="flex items-center gap-2">
            <span className="text-amber-400">⛏</span>
            <span className="text-white">Mining</span>
            <span className="ml-auto text-amber-300 font-mono">{caps.digPower.toFixed(1)}</span>
          </div>
        )}
        {caps.canChop && (
          <div className="flex items-center gap-2">
            <span className="text-green-400">🪓</span>
            <span className="text-white">Chopping</span>
            <span className="ml-auto text-green-300 font-mono">{caps.woodDamage.toFixed(1)}</span>
          </div>
        )}
        {caps.canSmash && (
          <div className="flex items-center gap-2">
            <span className="text-orange-400">💥</span>
            <span className="text-white">Smashing</span>
            <span className="ml-auto text-orange-300 font-mono">{caps.shatterForce.toFixed(1)}</span>
          </div>
        )}
        {caps.isLuminaTool && (
          <div className="flex items-center gap-2">
            <span className="text-cyan-400">✨</span>
            <span className="text-white">Lumina</span>
            <span className="ml-auto text-cyan-300 font-mono">×{caps.luminaCount}</span>
          </div>
        )}

        {/* Show damage stats if no special capabilities */}
        {!caps.canDig && !caps.canChop && !caps.canSmash && (
          <>
            <div className="flex items-center gap-2 text-white/70">
              <span>Wood Dmg</span>
              <span className="ml-auto font-mono">{caps.woodDamage.toFixed(1)}</span>
            </div>
            <div className="flex items-center gap-2 text-white/70">
              <span>Stone Dmg</span>
              <span className="ml-auto font-mono">{caps.stoneDamage.toFixed(1)}</span>
            </div>
          </>
        )}
      </div>

      {/* Tip for unlocking capabilities */}
      {!caps.canDig && !caps.canChop && attachmentCount < 2 && (
        <p className="mt-3 text-xs text-white/40 italic">
          Add more shards to unlock abilities
        </p>
      )}
    </div>
  );
};


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
  const { isOpen, closeCrafting, attachedItems, attach, detach, draggedItem, baseItem, editingToolId } = useCraftingStore();
  const { removeItem, addItem, addCustomTool, updateCustomTool } = useInventoryStore();

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

    // If slot is already filled, return previous item to inventory
    if (attachedItems[slotId]) {
      addItem(attachedItems[slotId], 1);
    }

    removeItem(itemType, 1);
    attach(slotId, itemType);
  };

  const handleDetach = (slotId: string, itemType: ItemType) => {
    addItem(itemType, 1);
    detach(slotId);
  };

  const handleFinish = () => {
    if (Object.keys(attachedItems).length === 0) {
      closeCrafting();
      return;
    }

    if (editingToolId) {
      updateCustomTool(editingToolId, {
        attachments: { ...attachedItems }
      });
    } else {
      addCustomTool({
        id: `tool_${Date.now()}`,
        baseType: baseItem || ItemType.STICK,
        attachments: { ...attachedItems }
      });
    }
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

      {/* Tool Stats Panel */}
      <ToolStatsPanel attachedItems={attachedItems} />

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

            {/* Lashings - rendered before attachments so they appear underneath */}
            {Object.entries(attachedItems).map(([slotId, itemType]) => (
              <LashingMesh
                key={`lashing-${slotId}`}
                slotId={slotId}
                attachmentType={itemType}
              />
            ))}

            {/* Slots & Attachments */}
            {STICK_SLOTS.map(slot => (
              <group key={slot.id}>
                {/* Render Item if attached */}
                {attachedItems[slot.id] && (
                  <group
                    position={slot.position}
                    rotation={slot.rotation}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDetach(slot.id, attachedItems[slot.id]);
                    }}
                    onPointerOver={(e) => {
                      e.stopPropagation();
                      document.body.style.cursor = 'pointer';
                    }}
                    onPointerOut={(e) => {
                      e.stopPropagation();
                      document.body.style.cursor = 'auto';
                    }}
                  >
                    {attachedItems[slot.id] === ItemType.SHARD && <ShardMesh scale={0.6} />}
                    {attachedItems[slot.id] === ItemType.STONE && <StoneMesh scale={0.5} />}
                    {attachedItems[slot.id] === ItemType.STICK && <StickMesh scale={0.4} height={0.5} />}
                    {attachedItems[slot.id] === ItemType.FLORA && <FloraMesh scale={0.4} />}

                    {/* Subtle highlight ring for detachability */}
                    <mesh rotation={[Math.PI / 2, 0, 0]}>
                      <torusGeometry args={[0.15, 0.01, 8, 24]} />
                      <meshBasicMaterial color="#ef4444" transparent opacity={0.3} />
                    </mesh>
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
