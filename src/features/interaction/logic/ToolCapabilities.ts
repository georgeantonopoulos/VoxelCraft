import { ItemType, CustomTool } from '@/types';
import { SAW_EDGE_SLOTS } from '@features/crafting/CraftingData';

export const getToolCapabilities = (item: ItemType | CustomTool | null | undefined) => {
    if (!item) {
        return {
            canDig: false,
            digPower: 0,
            canChop: false,
            canSmash: false,
            canSaw: false,
            isNormalDig: false,
            woodDamage: 0,
            stoneDamage: 0,
            shatterForce: 0
        };
    }

    if (typeof item === 'string' && !item.startsWith('tool_')) {
        // Standard item capabilities
        const type = item as ItemType;
        return {
            canDig: type === ItemType.PICKAXE,
            digPower: type === ItemType.PICKAXE ? 1.0 : 0.0,
            canChop: type === ItemType.AXE,
            canSmash: type === ItemType.STONE,
            canSaw: false,
            isNormalDig: type === ItemType.PICKAXE,

            woodDamage: type === ItemType.AXE ? 5.0 : (type === ItemType.SHARD ? 1.0 : 0.2),
            stoneDamage: type === ItemType.PICKAXE ? 3.0 : (type === ItemType.SHARD ? 0.5 : 2.5),
            shatterForce: type === ItemType.STONE ? 1.5 : 0.3
        };
    }

    const tool = item as unknown as CustomTool;
    const attachments = Object.values(tool.attachments);
    const shards = attachments.filter(t => t === ItemType.SHARD).length;
    const stones = attachments.filter(t => t === ItemType.STONE).length;
    const floras = attachments.filter(t => t === ItemType.FLORA).length;

    // Slot Analysis
    const hasLeftShard = tool.attachments['side_left'] === ItemType.SHARD;
    const hasRightShard = tool.attachments['side_right'] === ItemType.SHARD;
    const hasTopShard = tool.attachments['tip_center'] === ItemType.SHARD;

    const canDig = hasLeftShard && hasRightShard;
    const canChop = hasTopShard && (hasLeftShard || hasRightShard);
    // A full edge of three flakes makes a saw (cuts felled trees into logs).
    const canSaw = SAW_EDGE_SLOTS.every(id => tool.attachments[id] === ItemType.SHARD);

    return {
        canDig,
        digPower: canDig ? (shards * 0.5 + stones * 0.4) : 0,
        canChop,
        canSmash: stones >= 1 && shards === 0,          // Blunt only
        canSaw,
        isNormalDig: canDig,
        isLuminaTool: floras > 0,
        luminaCount: floras,

        // Damage Logic (All interaction has logic)
        woodDamage: shards * 2.0 + stones * 0.5,
        stoneDamage: shards * 1.5 + stones * 1.0,
        shatterForce: stones * 2.0 + shards * 0.5
    };
};

/**
 * What a crafted tool is called, from what it can do (players saw
 * "Custom Tool" for everything). Pure; used by the hotbar, pickups and the
 * crafting bench.
 */
export const toolDisplayName = (tool: CustomTool | null | undefined): string => {
    if (!tool) return 'Tool';
    const caps = getToolCapabilities(tool);
    const parts = Object.values(tool.attachments);
    const shards = parts.filter(t => t === ItemType.SHARD).length;
    const lumina = (caps.luminaCount ?? 0) > 0;
    let base: string;
    if (caps.canSaw && !caps.canDig && !caps.canChop) base = 'saw';
    else if (caps.canDig && caps.canChop) base = 'pick-axe';
    else if (caps.canDig) base = 'pick';
    else if (caps.canChop) base = 'axe';
    else if (caps.canSmash) base = 'maul';
    else if (shards > 0) base = 'spear';
    else if (lumina) return 'Lumina wand';
    else return 'Bound stick';
    const material = base === 'maul' ? 'Stone' : 'Flint';
    return lumina ? `Lumina ${base}` : `${material} ${base}`;
};
