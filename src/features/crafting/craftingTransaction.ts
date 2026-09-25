import { ItemType } from '@/types';

/**
 * Crafting is a transaction against the inventory.
 *
 * While the crafting UI is open, attaching an item debits it from the
 * inventory and detaching refunds it, so the player sees live counts. If the
 * session is cancelled, the inventory must return exactly to its state at open
 * time; the net debit is the difference between the attachments now and the
 * attachments the session started with (non-empty when editing a tool).
 */
export type Attachments = Readonly<Record<string, ItemType>>;

const countItems = (attachments: Attachments): Map<ItemType, number> => {
  const counts = new Map<ItemType, number>();
  for (const item of Object.values(attachments)) counts.set(item, (counts.get(item) ?? 0) + 1);
  return counts;
};

/**
 * Items the inventory has lost (positive) or gained (negative) during the
 * session. Cancelling must add positive entries back and remove negative ones.
 */
export const netAttachmentDebit = (initial: Attachments, current: Attachments): Map<ItemType, number> => {
  const out = new Map<ItemType, number>();
  const a = countItems(initial);
  const b = countItems(current);
  for (const item of new Set([...a.keys(), ...b.keys()])) {
    const delta = (b.get(item) ?? 0) - (a.get(item) ?? 0);
    if (delta !== 0) out.set(item, delta);
  }
  return out;
};

export type FinishOutcome =
  | { kind: 'cancel' }                 // nothing to create: revert like a cancel
  | { kind: 'create'; consumeBase: ItemType }
  | { kind: 'update' }
  | { kind: 'dismantle'; refundBase: ItemType };

/** Decide what "Finish" means for the current session. */
export const resolveFinish = (
  editingToolId: string | null,
  baseItem: ItemType | null,
  current: Attachments,
  baseAvailable: number
): FinishOutcome => {
  const hasAttachments = Object.keys(current).length > 0;
  const base = baseItem ?? ItemType.STICK;
  if (editingToolId) {
    return hasAttachments ? { kind: 'update' } : { kind: 'dismantle', refundBase: base };
  }
  if (!hasAttachments || baseAvailable < 1) return { kind: 'cancel' };
  return { kind: 'create', consumeBase: base };
};
