import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorldType } from '@features/terrain/logic/BiomeManager';
import { listWorlds, playedAgo, recordWorldEntered, worldNameFor } from '@state/savedWorlds';

const store = new Map<string, string>();
vi.stubGlobal('window', {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  },
});

describe('saved worlds', () => {
  beforeEach(() => store.clear());

  it('names a world the same way every time, without doubled words', () => {
    expect(worldNameFor(1337)).toBe(worldNameFor(1337));
    for (let seed = 1; seed < 400; seed++) {
      const n = worldNameFor(seed);
      expect(n).toMatch(/^[A-Z][a-z]+$/);
      expect(n.toLowerCase()).not.toMatch(/^(\w+)\1$/);
    }
  });

  it('lists entered worlds most recent first, once each', () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1000);
    recordWorldEntered(WorldType.DEFAULT, 11);
    now.mockReturnValue(2000);
    recordWorldEntered(WorldType.FROZEN, 22);
    now.mockReturnValue(3000);
    recordWorldEntered(WorldType.DEFAULT, 11);
    now.mockRestore();
    const list = listWorlds();
    expect(list.map((w) => w.seed)).toEqual([11, 22]);
    expect(list[0].createdAt).toBe(1000);
    expect(list[0].lastPlayed).toBe(3000);
  });

  it('keeps the same seed in two realms as two worlds', () => {
    recordWorldEntered(WorldType.DEFAULT, 5);
    recordWorldEntered(WorldType.LUSH, 5);
    expect(listWorlds()).toHaveLength(2);
  });

  it('carries over the old single last-world record', () => {
    store.set('vc-last-world-v1', JSON.stringify({ type: WorldType.FROZEN, seed: 77, enteredAt: 500 }));
    const list = listWorlds();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ type: WorldType.FROZEN, seed: 77, lastPlayed: 500 });
  });

  it('describes how long ago a world was played', () => {
    const now = 10_000_000_000;
    expect(playedAgo(now - 30_000, now)).toBe('just now');
    expect(playedAgo(now - 3 * 3600_000, now)).toBe('3 hours ago');
    expect(playedAgo(now - 86400_000, now)).toBe('1 day ago');
  });
});
