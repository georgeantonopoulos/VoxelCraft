import { ItemType, CustomTool } from '@/types';

export const getToolCapabilities = (tool: CustomTool) => {
    const attachments = Object.values(tool.attachments);
    const shards = attachments.filter(t => t === ItemType.SHARD).length;
    const stones = attachments.filter(t => t === ItemType.STONE).length;

    // Requirement logic based on user input:
    // - One shard on one side: tiny dig (we'll call it a weak dig)
    // - One shard on each side (2 shards): normal dig
    // - Two shards on one side/etc (>= 2 sharp/heavy items): can chop trees

    return {
        canDig: shards > 0 || stones > 0,
        digPower: (shards * 0.5 + stones * 0.3),
        canChop: (shards + stones) >= 2,
        isNormalDig: shards >= 2 || (shards >= 1 && stones >= 1)
    };
};
