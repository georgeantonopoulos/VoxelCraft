import React from 'react';
import { useInventoryStore, InventoryItemId } from '@/state/InventoryStore';
import { useCraftingStore } from '@/state/CraftingStore';
import { getItemMetadata } from '@/features/interaction/logic/ItemRegistry';
import { ItemType } from '@/types';
import { ItemThumbnail } from '@/features/interaction/components/ItemThumbnail';

export const InventoryBar: React.FC = React.memo(() => {
    const inventorySlots = useInventoryStore(state => state.inventorySlots);
    const selectedSlotIndex = useInventoryStore(state => state.selectedSlotIndex);

    // Subscribe to counts individually for stability and reactivity
    const floraCount = useInventoryStore(state => state.inventoryCount);
    const torchCount = useInventoryStore(state => state.torchCount);
    const stickCount = useInventoryStore(state => state.stickCount);
    const stoneCount = useInventoryStore(state => state.stoneCount);
    const shardCount = useInventoryStore(state => state.shardCount);

    const setDraggedItem = useCraftingStore(state => state.setDraggedItem);
    const isCraftingOpen = useCraftingStore(state => state.isOpen);

    const getCount = (item: InventoryItemId) => {
        if (!item) return 0;
        if (item === ItemType.FLORA) return floraCount;
        if (item === ItemType.TORCH) return torchCount;
        if (item === ItemType.STICK) return stickCount;
        if (item === ItemType.STONE) return stoneCount;
        if (item === ItemType.SHARD) return shardCount;
        return 0;
    };

    const handleDragStart = (item: InventoryItemId) => {
        if (!isCraftingOpen || !item) return;

        // Only standard items can be used as attachments for now
        if (Object.values(ItemType).includes(item as ItemType)) {
            setDraggedItem(item as ItemType);
        }
    };

    const handleDragEnd = () => {
        setDraggedItem(null);
    };

    return (
        <div className={`absolute bottom-6 left-6 flex gap-2 p-2 bg-slate-900/80 backdrop-blur-md rounded-xl border border-white/10 shadow-xl pointer-events-auto transition-all duration-300 ${isCraftingOpen ? 'z-[60] scale-110 translate-x-4 -translate-y-4' : 'z-50'}`}>
            {inventorySlots.map((item, index) => {
                const isSelected = index === selectedSlotIndex;
                const metadata = item ? getItemMetadata(item) : null;
                const isCustom = typeof item === 'string' && item.startsWith('tool_');
                const count = getCount(item);
                const showCount = !isCustom && (metadata?.isStackable ?? false);

                return (
                    <div
                        key={index}
                        draggable={isCraftingOpen && !!item && (count > 0 || isCustom)}
                        onDragStart={() => item && handleDragStart(item)}
                        onDragEnd={handleDragEnd}
                        className={`
              relative w-12 h-12 flex items-center justify-center rounded-lg border-2 transition-all duration-200
              ${isSelected ? 'border-amber-400 bg-white/10 scale-105 shadow-[0_0_10px_rgba(251,191,36,0.5)]' : 'border-white/20 bg-black/40'}
              ${isCraftingOpen && !!item && (count > 0 || isCustom) ? 'cursor-grab active:cursor-grabbing' : ''}
            `}
                    >
                        {/* Slot Number (small overlay) */}
                        <span className="absolute top-0.5 left-1 text-[8px] font-mono text-white/50">
                            {index + 1}
                        </span>

                        {/* 3D Item Thumbnail */}
                        {item ? (
                            <ItemThumbnail item={item} />
                        ) : (
                            <div className="w-8 h-8 flex items-center justify-center rounded bg-black/20 border border-white/5 text-[10px] font-mono text-white/40">
                                --
                            </div>
                        )}

                        {/* Stack Count */}
                        {showCount && count > 0 && (
                            <span className="absolute bottom-0.5 right-1 text-[10px] font-mono text-white/90 drop-shadow">
                                {count}
                            </span>
                        )}
                    </div>
                );
            })}
        </div>
    );
});
