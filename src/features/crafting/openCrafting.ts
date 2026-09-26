import { ItemType } from '@/types';
import { useInventoryStore } from '@/state/InventoryStore';
import { useCraftingStore } from '@/state/CraftingStore';

/** Can the selected item be worked on the bench (a stick, or a tool to rework)? */
export const canCraftSelected = (): boolean => {
  const inv = useInventoryStore.getState();
  const item = inv.inventorySlots[inv.selectedSlotIndex];
  return item === ItemType.STICK || (typeof item === 'string' && item.startsWith('tool_'));
};

/**
 * Opens the crafting bench for the selected stick or tool (key C, or the touch
 * Craft button). Returns false when the selection cannot be crafted.
 */
export const openCraftingForSelected = (): boolean => {
  const inv = useInventoryStore.getState();
  const item = inv.inventorySlots[inv.selectedSlotIndex];
  const crafting = useCraftingStore.getState();
  if (crafting.isOpen || !canCraftSelected()) return false;
  document.exitPointerLock?.();
  if (typeof item === 'string' && item.startsWith('tool_')) {
    const tool = inv.customTools[item];
    if (!tool) return false;
    crafting.openCrafting(tool.baseType, tool.id, { ...tool.attachments });
  } else {
    crafting.openCrafting(ItemType.STICK);
  }
  return true;
};
