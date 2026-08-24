import { describe, it, expect, beforeEach } from 'vitest';
import { useInventoryStore } from '../state/InventoryStore';
import { ItemType } from '../types';

describe('InventoryStore', () => {
    beforeEach(() => {
        // Reset mutable store data so inventory behavior is isolated between tests.
        useInventoryStore.setState({
            inventoryCount: 0,
            torchCount: 0,
            stickCount: 0,
            stoneCount: 0,
            shardCount: 0,
            luminousFloraCount: 0,
            hasPickaxe: false,
            hasAxe: false,
            currentTool: ItemType.PICKAXE,
            customTools: {},
            customToolIds: [],
            inventorySlots: new Array(8).fill(null),
            selectedSlotIndex: 0,
        });
    });

    it('should add stackable items correctly', () => {
        const store = useInventoryStore.getState();
        const initialCount = store.getItemCount(ItemType.STICK);

        store.addItem(ItemType.STICK, 5);

        expect(useInventoryStore.getState().getItemCount(ItemType.STICK)).toBe(initialCount + 5);
    });

    it('should remove items correctly', () => {
        const store = useInventoryStore.getState();
        store.addItem(ItemType.STONE, 10);
        const countAfterAdd = store.getItemCount(ItemType.STONE);

        store.removeItem(ItemType.STONE, 3);

        expect(useInventoryStore.getState().getItemCount(ItemType.STONE)).toBe(countAfterAdd - 3);
    });

    it('should not allow negative counts', () => {
        const store = useInventoryStore.getState();
        store.addItem(ItemType.SHARD, 1);
        store.removeItem(ItemType.SHARD, 10);

        expect(useInventoryStore.getState().getItemCount(ItemType.SHARD)).toBe(0);
    });

    it('keeps fixed hotkeys and the selected custom tool stable while gathering', () => {
        const store = useInventoryStore.getState();
        const tool = { id: 'tool_test', baseType: ItemType.STICK, attachments: {} };

        store.addCustomTool(tool);
        expect(useInventoryStore.getState().inventorySlots[8]).toBe(tool.id);
        expect(useInventoryStore.getState().selectedSlotIndex).toBe(8);

        useInventoryStore.getState().addItem(ItemType.STICK, 1);
        useInventoryStore.getState().setHasPickaxe(true);

        const next = useInventoryStore.getState();
        expect(next.inventorySlots[1]).toBe(ItemType.PICKAXE);
        expect(next.inventorySlots[5]).toBe(ItemType.STICK);
        expect(next.inventorySlots[8]).toBe(tool.id);
        expect(next.selectedSlotIndex).toBe(8);
    });

    it('keeps legacy flora actions synchronized with the fixed flora slot', () => {
        useInventoryStore.getState().addFlora();
        expect(useInventoryStore.getState().inventorySlots[4]).toBe(ItemType.FLORA);

        useInventoryStore.getState().removeFlora();
        expect(useInventoryStore.getState().inventorySlots[4]).toBeNull();
    });

    it('keeps a preselected fixed hotkey when its first item is acquired', () => {
        useInventoryStore.getState().setSelectedSlotIndex(5);
        useInventoryStore.getState().addItem(ItemType.STICK, 1);

        expect(useInventoryStore.getState().inventorySlots[5]).toBe(ItemType.STICK);
        expect(useInventoryStore.getState().selectedSlotIndex).toBe(5);
    });
});
