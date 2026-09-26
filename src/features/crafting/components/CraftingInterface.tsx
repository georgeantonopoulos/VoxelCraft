import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Environment, ContactShadows } from '@react-three/drei';
import { Vector2 } from 'three';

import { useCraftingStore } from '@/state/CraftingStore';
import { useInventoryStore } from '@/state/InventoryStore';
import { STICK_SLOTS, RECIPES } from '../CraftingData';
import { netAttachmentDebit, resolveFinish } from '../craftingTransaction';
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

  const statRow = (label: string, value: string, color: string) => (
    <div className="flex items-baseline gap-3">
      <span className="h-1.5 w-1.5 translate-y-[-1px] rotate-45 rounded-[1px]" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
      <span className="text-parchment/90">{label}</span>
      <span className="grove-num ml-auto text-lichen/75">{value}</span>
    </div>
  );

  return (
    <div className="grove-panel absolute left-8 top-1/2 min-w-[220px] -translate-y-1/2 px-5 py-4 pointer-events-none">
      {attachmentCount === 0 ? (
        <p className="max-w-[200px] font-display text-[16px] italic leading-snug text-lichen/75">
          Drag stones, shards or flora from your items onto the glowing points of the stick.
        </p>
      ) : (
        <>
          {matchedRecipe && (
            <div className="mb-3 border-b border-lichen/15 pb-3">
              <div className="grove-eyebrow" style={{ color: '#b5d178' }}>Known form</div>
              <p className="font-display text-[22px] font-semibold text-parchment">{matchedRecipe}</p>
            </div>
          )}

          <div className="grove-eyebrow mb-2">What it can do</div>
          <div className="space-y-1.5 text-[14px]">
            {caps.canDig && statRow('Mining', caps.digPower.toFixed(1), '#f2cf7c')}
            {caps.canChop && statRow('Chopping', caps.woodDamage.toFixed(1), '#9dbd62')}
            {caps.canSmash && statRow('Smashing', caps.shatterForce.toFixed(1), '#f0b3a3')}
            {caps.isLuminaTool && statRow('Lumina', `×${caps.luminaCount}`, '#a4f2e4')}
            {!caps.canDig && !caps.canChop && !caps.canSmash && (
              <>
                {statRow('Against wood', caps.woodDamage.toFixed(1), 'rgba(215,220,182,0.5)')}
                {statRow('Against stone', caps.stoneDamage.toFixed(1), 'rgba(215,220,182,0.5)')}
              </>
            )}
          </div>

          {!caps.canDig && !caps.canChop && attachmentCount < 2 && (
            <p className="mt-3 font-display text-[14px] italic text-lichen/55">More shards will give it purpose.</p>
          )}
        </>
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
          color={isCompatible ? (hovered ? "#d9eea0" : "#9dbd62") : (isIncompatible ? (hovered ? "#e08a74" : "#b4745f") : "#f1ead3")}
          transparent
          opacity={(hovered || isIncompatible) ? 0.6 : 0.2}
          wireframe={!hovered && !isCompatible && !isIncompatible}
        />
      </mesh>
      {/* Visual guide for compatibility */}
      {isCompatible && (
        <mesh scale={hovered ? 1.1 : 1.0}>
          <sphereGeometry args={[0.12, 16, 16]} />
          <meshBasicMaterial color="#a4f2e4" transparent opacity={0.12} />
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
  const { removeItem, addItem, addCustomTool, updateCustomTool, removeCustomTool } = useInventoryStore();

  /**
   * Leave without changes: return the inventory to its state at open time
   * (attach/detach debit and refund live, see craftingTransaction.ts).
   */
  const cancelCrafting = useCallback(() => {
    const { initialAttachments, attachedItems: current } = useCraftingStore.getState();
    const inventory = useInventoryStore.getState();
    for (const [item, debit] of netAttachmentDebit(initialAttachments, current)) {
      if (debit > 0) inventory.addItem(item, debit);
      else inventory.removeItem(item, -debit);
    }
    closeCrafting();
  }, [closeCrafting]);

  // Keyboard Exit (C / Escape) cancels the session.
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key.toLowerCase() === 'c' || e.key === 'Escape') {
        cancelCrafting();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, cancelCrafting]);

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
    const base = baseItem || ItemType.STICK;
    const outcome = resolveFinish(editingToolId, baseItem, attachedItems, useInventoryStore.getState().getItemCount(base));
    switch (outcome.kind) {
      case 'cancel':
        cancelCrafting();
        return;
      case 'update':
        updateCustomTool(editingToolId!, { attachments: { ...attachedItems } });
        break;
      case 'dismantle':
        // Every attachment was detached (and refunded); the base returns too.
        removeCustomTool(editingToolId!);
        addItem(outcome.refundBase, 1);
        break;
      case 'create':
        removeItem(outcome.consumeBase, 1);
        addCustomTool({
          id: `tool_${Date.now()}`,
          baseType: base,
          attachments: { ...attachedItems }
        });
        break;
    }
    closeCrafting();
  };

  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 z-[55] pointer-events-none">
      {/* Semi-transparent blur background only in a central vignette to keep inventory clear */}
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 55% 55% at 50% 50%, rgba(7,11,10,0.35), rgba(7,11,10,0.8))', backdropFilter: 'blur(3px)' }} />

      {/* UI Overlay */}
      <div className="absolute top-12 left-0 right-0 text-center pointer-events-none">
        <div className="grove-eyebrow">The Keeper&apos;s bench</div>
        <h2 className="grove-text-shadow mt-1 font-display text-[44px] font-semibold leading-none text-parchment">Shape a tool</h2>
        <p className="mt-2 font-display text-[17px] italic text-lichen/70">Bind what the land gave you to a sturdy stick.</p>
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
          <pointLight position={[-5, 5, -5]} intensity={0.5} color="#a4f2e4" />

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
                      <meshBasicMaterial color="#f2cf7c" transparent opacity={0.35} />
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

      {/* Action Buttons (above the hotbar, which stays usable for dragging) */}
      <div className="absolute bottom-[132px] left-0 right-0 flex justify-center gap-4 pointer-events-auto">
        <button onClick={cancelCrafting} className="grove-button-quiet px-7 py-2.5 text-[14px]">
          Set aside
        </button>
        <button onClick={handleFinish} className="grove-button px-10 py-2.5 text-[18px]">
          Bind the tool
        </button>
      </div>

      <button
        onClick={cancelCrafting}
        className="absolute right-8 top-8 z-[70] flex h-11 w-11 items-center justify-center rounded-full border border-lichen/20 bg-night/50 text-lichen/70 transition-colors hover:border-lichen/45 hover:text-parchment pointer-events-auto"
        title="Close (C)"
        aria-label="Close crafting"
      >
        <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M5 5 L15 15 M15 5 L5 15" /></svg>
      </button>
    </div>
  );
};
