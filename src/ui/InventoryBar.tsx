import React, { useEffect, useState } from 'react';

/** Name of the selected item, shown above the hotbar for a moment after switching. */
const SelectedName: React.FC<{ name: string; slot: number }> = ({ name, slot }) => {
    const [visible, setVisible] = useState(false);
    useEffect(() => {
        if (!name) { setVisible(false); return; }
        setVisible(true);
        const id = window.setTimeout(() => setVisible(false), 1800);
        return () => window.clearTimeout(id);
    }, [name, slot]);
    return (
        <div
            className="grove-text-shadow mb-3 h-6 font-display text-[19px] font-semibold text-parchment transition-opacity duration-500"
            style={{ opacity: visible ? 1 : 0 }}
        >
            {name}
        </div>
    );
};
import { toolDisplayName } from '@features/interaction/logic/ToolCapabilities';
import { useLogStore } from '@/state/LogStore';
import { useInventoryStore, InventoryItemId } from '@/state/InventoryStore';
import { useCraftingStore } from '@/state/CraftingStore';
import { getItemMetadata } from '@/features/interaction/logic/ItemRegistry';
import { ItemType } from '@/types';
import { useHudPresence, presenceStyle } from '@/state/HudPresenceStore';
import { ItemGlyph } from '@/ui/grove/ItemGlyph';

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
    const hudAwake = useHudPresence(state => state.awake);

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

    const selectedItem = inventorySlots[selectedSlotIndex];
    const customTools = useInventoryStore(state => state.customTools);
    const carrying = useLogStore(state => (state.carriedId ? state.logs[state.carriedId]?.kind ?? 'log' : null));
    const selectedName = carrying ? `Carrying a ${carrying} · right click to place · Q to set down`
        : !selectedItem ? ''
        : (typeof selectedItem === 'string' && selectedItem.startsWith('tool_'))
            ? toolDisplayName(customTools[selectedItem])
            : (getItemMetadata(selectedItem)?.name ?? '');

    return (
        <div className={`absolute bottom-5 left-1/2 flex -translate-x-1/2 flex-col items-center pointer-events-auto transition-all duration-300 ${isCraftingOpen ? 'z-[60] -translate-y-3 scale-110' : 'z-50'}`}>
            <SelectedName name={selectedName} slot={selectedSlotIndex} />
            {/* No tray: a row of hollows strung on a faint vine thread. */}
            <div className="relative flex items-center gap-1" style={presenceStyle(hudAwake || isCraftingOpen, 0.28)}>
            <div aria-hidden="true" className="grove-thread pointer-events-none absolute inset-x-2 top-1/2 h-px -translate-y-1/2" />
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
                        // Tap/click to select (touch has no number keys or wheel).
                        onClick={() => { if (!isCraftingOpen) useInventoryStore.getState().setSelectedSlotIndex(index); }}
                        data-selected={isSelected}
                        data-empty={!item}
                        title={metadata?.name}
                        className={`grove-slot relative flex h-[54px] w-[54px] items-center justify-center
              ${isCraftingOpen && !!item && (count > 0 || isCustom) ? 'cursor-grab active:cursor-grabbing' : ''}
            `}
                    >
                        {item ? (
                            <ItemGlyph item={item} className="grove-slot-glyph relative h-8 w-8" />
                        ) : (
                            <span className="relative h-[3px] w-[3px] rounded-full bg-lichen/35" />
                        )}

                        {showCount && count > 0 && (
                            <span className="grove-num grove-text-shadow absolute bottom-1 right-1.5 text-[11px] font-semibold text-parchment/90">
                                {count}
                            </span>
                        )}
                        <span className={`grove-num grove-text-shadow absolute -top-2.5 text-[9px] transition-opacity duration-500 ${isSelected ? 'text-ember/85' : 'text-lichen/40'}`}
                            style={{ opacity: hudAwake || isCraftingOpen ? 1 : 0 }}>
                            {index + 1}
                        </span>
                    </div>
                );
            })}
            </div>
        </div>
    );
});
