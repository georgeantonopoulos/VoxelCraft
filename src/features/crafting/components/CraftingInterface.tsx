import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Environment, ContactShadows } from '@react-three/drei';
import { Vector2, AdditiveBlending, CanvasTexture } from 'three';

import { useCraftingStore } from '@/state/CraftingStore';
import { useInventoryStore } from '@/state/InventoryStore';
import { STICK_SLOTS } from '../CraftingData';
import { netAttachmentDebit, resolveFinish } from '../craftingTransaction';
import { ItemType, CustomTool } from '@/types';
import { getToolCapabilities, toolDisplayName } from '@/features/interaction/logic/ToolCapabilities';

import { StickMesh, StoneMesh, ShardMesh, FloraMesh, LashingMesh } from '@/features/interaction/components/UniversalTool';

/** Radial glow for empty attachment points (shared by all slots). */
let slotGlowTexture: CanvasTexture | null = null;
const getSlotGlowTexture = (): CanvasTexture => {
  if (slotGlowTexture) return slotGlowTexture;
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.18, 'rgba(255,255,255,0.75)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.18)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  slotGlowTexture = new CanvasTexture(c);
  return slotGlowTexture;
};

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

  // What this would be called if bound now.
  const formName = useMemo(() => toolDisplayName(previewTool), [previewTool]);

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
          Drag stones, shards or flora from your items onto the glowing points of the stick, or tap one, then a point.
        </p>
      ) : (
        <>
          <div className="mb-3 border-b border-lichen/15 pb-3">
            <div className="grove-eyebrow" style={{ color: '#b5d178' }}>Taking shape</div>
            <p className="font-display text-[22px] font-semibold text-parchment">{formName}</p>
          </div>

          <div className="grove-eyebrow mb-2">What it can do</div>
          <div className="space-y-1.5 text-[14px]">
            {caps.canDig && statRow('Mining', caps.digPower.toFixed(1), '#f2cf7c')}
            {caps.canChop && statRow('Chopping', caps.woodDamage.toFixed(1), '#9dbd62')}
            {caps.canSmash && statRow('Smashing', caps.shatterForce.toFixed(1), '#f0b3a3')}
            {caps.canSaw && statRow('Sawing', 'felled trees', '#d9b98a')}
            {caps.isLuminaTool && statRow('Lumina', `×${caps.luminaCount}`, '#a4f2e4')}
            {caps.isLuminaTool && (
              <p className="pl-4 font-display text-[13px] italic text-lumina/70">In a cave, tap three times to follow the light out.</p>
            )}
            {!caps.canDig && !caps.canChop && !caps.canSmash && !caps.canSaw && (
              <>
                {statRow('Against wood', caps.woodDamage.toFixed(1), 'rgba(215,220,182,0.5)')}
                {statRow('Against stone', caps.stoneDamage.toFixed(1), 'rgba(215,220,182,0.5)')}
              </>
            )}
          </div>

          {!caps.canDig && !caps.canChop && attachmentCount < 2 && (
            <p className="mt-3 font-display text-[14px] italic text-lichen/55">More shards will give it purpose.</p>
          )}
          <p className="mt-3 text-[12px] text-lichen/50">Click a bound part to take it off.</p>
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
        {/* Generous invisible hit area, small visible seed of light. */}
        <sphereGeometry args={[0.1, 12, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {/* A soft point of light, not a solid bead: an additive glow sprite. */}
      <sprite scale={(hovered || isCompatible ? 0.2 : 0.14) * (hovered ? 1.2 : 1)}>
        <spriteMaterial
          map={getSlotGlowTexture()}
          color={isCompatible ? (hovered ? "#d9eea0" : "#9dbd62") : (isIncompatible ? "#b4745f" : "#a4f2e4")}
          transparent
          opacity={isIncompatible ? 0.35 : 0.95}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </sprite>
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
    // Tap-to-attach keeps the item in hand: stop once none are left.
    if (useInventoryStore.getState().getItemCount(itemType) <= 0) { useCraftingStore.getState().setDraggedItem(null); return; }

    // If slot is already filled, return previous item to inventory
    if (attachedItems[slotId]) {
      addItem(attachedItems[slotId], 1);
    }

    removeItem(itemType, 1);
    attach(slotId, itemType);
    if (useInventoryStore.getState().getItemCount(itemType) <= 0) useCraftingStore.getState().setDraggedItem(null);
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
        {/* Framed so the whole stick sits between the title and the buttons. */}
        <Canvas shadows camera={{ position: [0, 0, 2.5], fov: 45 }}>
          <DropManager onDrop={handleSlotDrop} />
          <OrbitControls
            enablePan={false}
            minDistance={1.2}
            maxDistance={3.2}
            makeDefault
            autoRotate={!draggedItem}
            autoRotateSpeed={0.5}
          />

          <Environment preset="forest" />
          <ambientLight intensity={0.5} />
          <pointLight position={[5, 10, 5]} intensity={1.5} castShadow />
          <pointLight position={[-5, 5, -5]} intensity={0.5} color="#a4f2e4" />

          <group position={[0, 0.05, 0]}>
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
                    scale={slot.scale ?? 1}
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
                    {attachedItems[slot.id] === ItemType.SHARD && <ShardMesh scale={1.2} />}
                    {attachedItems[slot.id] === ItemType.STONE && <StoneMesh scale={0.5} />}
                    {attachedItems[slot.id] === ItemType.STICK && <StickMesh scale={0.4} height={0.5} />}
                    {attachedItems[slot.id] === ItemType.FLORA && <FloraMesh scale={0.4} />}

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

          <ContactShadows position={[0, -0.5, 0]} opacity={0.6} scale={5} blur={2.4} far={2} />
        </Canvas>
      </div>

      {/* Action Buttons (above the hotbar, which stays usable for dragging) */}
      <div className="absolute bottom-[132px] left-0 right-0 flex justify-center gap-4 pointer-events-auto">
        <button onClick={cancelCrafting} className="grove-button-quiet px-7 py-2.5 text-[14px]">
          Set aside
        </button>
        <button
          onClick={handleFinish}
          disabled={!editingToolId && Object.keys(attachedItems).length === 0}
          className="grove-button px-10 py-2.5 text-[18px]"
        >
          {editingToolId && Object.keys(attachedItems).length === 0 ? 'Take it apart' : 'Bind the tool'}
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
