import { describe, it, expect, beforeEach } from 'vitest';
import { useInventoryStore } from '../state/InventoryStore';
import { ItemType } from '../types';

describe('InventoryStore', () => {
    beforeEach(() => {
        // Reset store state could be missing, but we'll check the current behavior
        // For now we just check if it works as expected.
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
});
