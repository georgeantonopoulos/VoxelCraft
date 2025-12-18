import { describe, it, expect } from 'vitest';
import { ITEM_REGISTRY, getItemColor, STACKABLE_ITEMS } from '../features/interaction/logic/ItemRegistry';
import { ItemType } from '../types';

describe('ItemRegistry', () => {
    it('should have all ItemType members mapped', () => {
        Object.values(ItemType).forEach(type => {
            expect(ITEM_REGISTRY[type]).toBeDefined();
            expect(ITEM_REGISTRY[type].name).toBeDefined();
            expect(ITEM_REGISTRY[type].color).toBeDefined();
        });
    });

    it('should correctly identify stackable items', () => {
        expect(STACKABLE_ITEMS).toContain(ItemType.STICK);
        expect(STACKABLE_ITEMS).toContain(ItemType.STONE);
        expect(STACKABLE_ITEMS).toContain(ItemType.FLORA);
        expect(STACKABLE_ITEMS).toContain(ItemType.TORCH);
        expect(STACKABLE_ITEMS).toContain(ItemType.SHARD);

        expect(STACKABLE_ITEMS).not.toContain(ItemType.PICKAXE);
        expect(STACKABLE_ITEMS).not.toContain(ItemType.AXE);
        expect(STACKABLE_ITEMS).not.toContain(ItemType.FIRE);
    });

    it('should retrieve correct colors', () => {
        expect(getItemColor(ItemType.FLORA)).toBe('#00FFFF');
        expect(getItemColor('invalid')).toBe('#ffffff');
    });

    it('should have stateKey for all stackable items', () => {
        STACKABLE_ITEMS.forEach(type => {
            expect(ITEM_REGISTRY[type].stateKey).toBeDefined();
        });
    });
});
