import { describe, it, expect } from 'vitest';
import {
  applyStat,
  computeVitality,
  initialProgression,
  questAt,
  questProgress,
  rankIndexFor,
  QUEST_LINE,
  RANKS,
  BASE_VITALITY,
  EMPTY_STATS,
} from '@features/grove/questLine';
import { nearestInPacked, bearingTo } from '@features/grove/hollowSense';
import { hollowIdAt } from '@features/grove/groveEvents';

describe('Keeper quest line', () => {
  it('starts at the first quest with zero progress', () => {
    const s = initialProgression();
    expect(questAt(s.questIndex).id).toBe(QUEST_LINE[0].id);
    expect(questProgress(s)).toEqual({ value: 0, goal: QUEST_LINE[0].goal });
  });

  it('completes a quest once its goal is reached and grants essence', () => {
    let s = initialProgression();
    const first = QUEST_LINE[0];
    for (let i = 0; i < first.goal - 1; i++) s = applyStat(s, first.stat).state;
    expect(s.questIndex).toBe(0);

    const { state, notices } = applyStat(s, first.stat);
    expect(state.questIndex).toBe(1);
    expect(state.essence).toBeGreaterThanOrEqual(first.essence);
    expect(notices.some((n) => n.kind === 'quest-complete')).toBe(true);
    expect(notices.some((n) => n.kind === 'quest-start')).toBe(true);
  });

  it('measures the next quest from a fresh baseline (no instant completion)', () => {
    let s = initialProgression();
    // Hoard stones before the stone quest is active.
    s = applyStat(s, 'stonesGathered', 10).state;
    // Finish quest 0 (sticks).
    s = applyStat(s, 'sticksGathered', QUEST_LINE[0].goal).state;
    expect(questAt(s.questIndex).stat).toBe('stonesGathered');
    expect(questProgress(s).value).toBe(0);
    s = applyStat(s, 'stonesGathered', QUEST_LINE[1].goal).state;
    expect(s.questIndex).toBe(2);
  });

  it('ignores non-positive increments', () => {
    const s = initialProgression();
    expect(applyStat(s, 'sticksGathered', 0).state).toBe(s);
    expect(applyStat(s, 'sticksGathered', -3).state).toBe(s);
  });

  it('continues with endless renewal quests after the authored chain', () => {
    const endless = questAt(QUEST_LINE.length);
    expect(endless.stat).toBe('hollowsRestored');
    expect(endless.goal).toBeGreaterThan(0);
    expect(questAt(QUEST_LINE.length + 1).goal).toBeGreaterThan(endless.goal);
  });

  it('announces rank-ups when essence crosses a threshold', () => {
    let s = initialProgression();
    s = { ...s, essence: RANKS[1].minEssence - 1 };
    const { notices } = applyStat(s, 'floraGathered', 1);
    expect(notices.some((n) => n.kind === 'rank-up' && n.title === RANKS[1].title)).toBe(true);
    expect(rankIndexFor(0)).toBe(0);
    expect(rankIndexFor(1e9)).toBe(RANKS.length - 1);
  });
});

describe('World vitality', () => {
  it('starts at the base value and grows monotonically with restored hollows', () => {
    expect(computeVitality(EMPTY_STATS)).toBeCloseTo(BASE_VITALITY);
    let last = computeVitality(EMPTY_STATS);
    for (let h = 1; h <= 12; h++) {
      const v = computeVitality({ ...EMPTY_STATS, hollowsRestored: h });
      expect(v).toBeGreaterThan(last);
      expect(v).toBeLessThanOrEqual(1);
      last = v;
    }
  });

  it('stays within [0, 1] for extreme stats', () => {
    const v = computeVitality({ ...EMPTY_STATS, hollowsRestored: 999, biomesDiscovered: 999, nightsEndured: 999 });
    expect(v).toBeLessThanOrEqual(1);
    expect(v).toBeGreaterThan(0.9);
  });
});

describe('Lumina Sense helpers', () => {
  it('finds the nearest hollow in a packed stride-6 buffer, skipping restored ones', () => {
    // Two hollows in chunk (1, 0): local (4, y, 4) and (20, y, 20).
    const packed = new Float32Array([4, 10, 4, 0, 1, 0, 20, 12, 20, 0, 1, 0]);
    const originX = 32;
    const originZ = 0;
    const near = nearestInPacked(packed, originX, originZ, 30, 0, () => false, null);
    expect(near?.id).toBe(hollowIdAt(36, 4));

    const skipFirst = nearestInPacked(packed, originX, originZ, 30, 0, (id) => id === hollowIdAt(36, 4), null);
    expect(skipFirst?.id).toBe(hollowIdAt(52, 20));
  });

  it('computes clockwise bearings from world -Z', () => {
    expect(bearingTo(0, 0, 0, -10)).toBeCloseTo(0);
    expect(bearingTo(0, 0, 10, 0)).toBeCloseTo(Math.PI / 2);
    expect(bearingTo(0, 0, -10, 0)).toBeCloseTo(-Math.PI / 2);
  });
});

describe("Keeper's Stride", () => {
  it('grows with rank and starts at 1x', async () => {
    const { strideMultiplier, STRIDE_PER_RANK } = await import('@features/grove/questLine');
    expect(strideMultiplier(0)).toBe(1);
    expect(strideMultiplier(RANKS[2].minEssence)).toBeCloseTo(1 + 2 * STRIDE_PER_RANK);
  });
});
