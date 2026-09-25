import { describe, it, expect } from 'vitest';
import { ItemType } from '@/types';
import { netAttachmentDebit, resolveFinish } from '@features/crafting/craftingTransaction';

describe('Crafting transaction', () => {
  it('cancelling a new tool refunds everything attached', () => {
    const debit = netAttachmentDebit({}, { tip: ItemType.SHARD, side: ItemType.STONE });
    expect(debit.get(ItemType.SHARD)).toBe(1);
    expect(debit.get(ItemType.STONE)).toBe(1);
  });

  it('detach-then-cancel while editing re-debits the refunded item (no duplication)', () => {
    const initial = { tip: ItemType.SHARD };
    const debit = netAttachmentDebit(initial, {});
    expect(debit.get(ItemType.SHARD)).toBe(-1);
  });

  it('swapping attachments nets out per item type', () => {
    const debit = netAttachmentDebit({ a: ItemType.SHARD, b: ItemType.STONE }, { a: ItemType.STONE, b: ItemType.SHARD });
    expect(debit.size).toBe(0);
  });

  it('finish decides create / update / dismantle / cancel', () => {
    expect(resolveFinish(null, ItemType.STICK, { tip: ItemType.SHARD }, 1)).toEqual({ kind: 'create', consumeBase: ItemType.STICK });
    expect(resolveFinish(null, ItemType.STICK, { tip: ItemType.SHARD }, 0)).toEqual({ kind: 'cancel' });
    expect(resolveFinish(null, ItemType.STICK, {}, 3)).toEqual({ kind: 'cancel' });
    expect(resolveFinish('tool_1', ItemType.STICK, { tip: ItemType.SHARD }, 0)).toEqual({ kind: 'update' });
    expect(resolveFinish('tool_1', ItemType.STICK, {}, 0)).toEqual({ kind: 'dismantle', refundBase: ItemType.STICK });
  });
});
