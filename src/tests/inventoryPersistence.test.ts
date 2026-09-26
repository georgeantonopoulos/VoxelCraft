import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ItemType } from '@/types';

const store = new Map<string, string>();
vi.stubGlobal('window', {
  location: { search: '' },
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  },
});

const { useInventoryStore } = await import('@state/InventoryStore');
const { bindInventoryToWorld } = await import('@state/inventoryPersistence');

describe('inventory per world', () => {
  beforeEach(() => store.clear());

  it('starts a new world empty, even after carrying items elsewhere', () => {
    const leaveA = bindInventoryToWorld('DEFAULT', 1);
    useInventoryStore.getState().addItem(ItemType.STICK, 4);
    useInventoryStore.getState().addItem(ItemType.STONE, 2);
    leaveA();
    const leaveB = bindInventoryToWorld('DEFAULT', 2);
    expect(useInventoryStore.getState().stickCount).toBe(0);
    expect(useInventoryStore.getState().stoneCount).toBe(0);
    expect(useInventoryStore.getState().inventorySlots.filter(Boolean)).toHaveLength(0);
    leaveB();
  });

  it('gives a world back what the player carried there', () => {
    const leaveA = bindInventoryToWorld('FROZEN', 9);
    useInventoryStore.getState().addItem(ItemType.SHARD, 3);
    useInventoryStore.getState().addCustomTool({ id: 't1', baseType: ItemType.STICK, attachments: { tip: ItemType.SHARD } });
    leaveA();
    bindInventoryToWorld('DEFAULT', 5)();
    const leave = bindInventoryToWorld('FROZEN', 9);
    const s = useInventoryStore.getState();
    expect(s.shardCount).toBe(3);
    expect(s.customToolIds).toEqual(['t1']);
    expect(s.inventorySlots).toContain('t1');
    leave();
  });
});
