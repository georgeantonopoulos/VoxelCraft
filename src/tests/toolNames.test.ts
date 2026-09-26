import { describe, it, expect } from 'vitest';
import { ItemType, CustomTool } from '@/types';
import { getToolCapabilities, toolDisplayName } from '@features/interaction/logic/ToolCapabilities';

const tool = (attachments: Record<string, ItemType>): CustomTool => ({ id: 'tool_t', baseType: ItemType.STICK, attachments });

describe('crafted tool names follow what the tool can do', () => {
  it('names the classic forms', () => {
    expect(toolDisplayName(tool({ side_left: ItemType.SHARD, side_right: ItemType.SHARD }))).toBe('Flint pick');
    expect(toolDisplayName(tool({ tip_center: ItemType.SHARD, side_left: ItemType.SHARD }))).toBe('Flint axe');
    expect(toolDisplayName(tool({ tip_center: ItemType.SHARD, side_left: ItemType.SHARD, side_right: ItemType.SHARD }))).toBe('Flint pick-axe');
    expect(toolDisplayName(tool({ tip_center: ItemType.STONE }))).toBe('Stone maul');
    expect(toolDisplayName(tool({ tip_center: ItemType.SHARD }))).toBe('Flint spear');
    expect(toolDisplayName(tool({ tip_center: ItemType.FLORA }))).toBe('Lumina wand');
    expect(toolDisplayName(tool({ side_left: ItemType.STICK }))).toBe('Bound stick');
  });

  it('marks Lumina-bound tools', () => {
    const t = tool({ tip_center: ItemType.SHARD, side_left: ItemType.SHARD, side_right: ItemType.FLORA });
    expect(getToolCapabilities(t).canChop).toBe(true);
    expect(toolDisplayName(t)).toBe('Lumina axe');
  });
});
