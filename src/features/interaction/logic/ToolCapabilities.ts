import { ItemType, CustomTool } from '@/types';

export const getToolCapabilities = (item: ItemType | CustomTool | null | undefined) => {
    if (!item) {
        return {
            canDig: false,
            digPower: 0,
            canChop: false,
            canSmash: false,
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
            isNormalDig: type === ItemType.PICKAXE,

            woodDamage: type === ItemType.AXE ? 5.0 : (type === ItemType.SAW ? 8.0 : (type === ItemType.SHARD ? 1.0 : 0.2)),
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
    const hasBlade1Shard = tool.attachments['blade_1'] === ItemType.SHARD;
    const hasBlade2Shard = tool.attachments['blade_2'] === ItemType.SHARD;
    const hasBlade3Shard = tool.attachments['blade_3'] === ItemType.SHARD;
    const hasRightShard = tool.attachments['side_right'] === ItemType.SHARD;
    const hasRightStone = tool.attachments['side_right'] === ItemType.STONE;

    const canDig = hasBlade2Shard && hasRightShard;
    const canChop = hasBlade1Shard && hasBlade2Shard && hasRightStone;
    const canSaw = hasBlade1Shard && hasBlade2Shard && hasBlade3Shard;

    return {
        canDig,
        digPower: canDig ? (shards * 0.5 + stones * 0.4) : 0,
        canChop,
        canSaw,
        canSmash: stones >= 1 && shards === 0,          // Blunt only
        isNormalDig: canDig,
        isLuminaTool: floras > 0,
        luminaCount: floras,

        // Damage Logic (All interaction has logic)
        woodDamage: shards * 2.0 + stones * 0.5,
        stoneDamage: shards * 1.5 + stones * 1.0,
        shatterForce: stones * 2.0 + shards * 0.5
    };
};
