import { ItemType } from '@/types';
import torchImg from '@/assets/images/torch_gemini.png';
import floraImg from '@/assets/images/flora_icon.png';
import stickImg from '@/assets/images/stick.svg';
import stoneImg from '@/assets/images/stone.svg';

export interface ItemMetadata {
    name: string;
    color: string;
    isStackable: boolean;
    stateKey?: string; // Mapping to InventoryStore property
    icon?: string;
    emissive?: string;
    emissiveIntensity?: number;
}

export const ITEM_REGISTRY: Record<ItemType, ItemMetadata> = {
    [ItemType.STONE]: {
        name: 'Stone',
        color: '#cfcfd6',
        isStackable: true,
        stateKey: 'stoneCount',
        icon: stoneImg,
    },
    [ItemType.STICK]: {
        name: 'Stick',
        color: '#c99a63',
        isStackable: true,
        stateKey: 'stickCount',
        icon: stickImg,
    },
    [ItemType.SHARD]: {
        name: 'Shard',
        color: '#aaaaaa',
        isStackable: true,
        stateKey: 'shardCount',
        // Shard currently uses no icon (renders CSS shape)
    },
    [ItemType.PICKAXE]: {
        name: 'Pickaxe',
        color: '#666666',
        isStackable: false,
    },
    [ItemType.FIRE]: {
        name: 'Fire',
        color: '#ffaa00',
        isStackable: false,
        emissive: '#ff5500',
        emissiveIntensity: 2.5,
    },
    [ItemType.FLORA]: {
        name: 'Flora',
        color: '#00FFFF',
        isStackable: true,
        stateKey: 'inventoryCount',
        icon: floraImg,
        emissive: '#00FFFF',
        emissiveIntensity: 1.2,
    },
    [ItemType.TORCH]: {
        name: 'Torch',
        color: '#ffdbb1',
        isStackable: true,
        stateKey: 'torchCount',
        icon: torchImg,
        emissive: '#ffdbb1',
        emissiveIntensity: 1.5,
    },
    [ItemType.AXE]: {
        name: 'Axe',
        color: '#777777',
        isStackable: false,
    },
};

export const STACKABLE_ITEMS = Object.values(ItemType).filter(t => ITEM_REGISTRY[t].isStackable);

export const getItemMetadata = (type: ItemType | string): ItemMetadata | undefined => {
    return ITEM_REGISTRY[type as ItemType];
};

export const getItemColor = (type: ItemType | string): string => {
    return getItemMetadata(type)?.color || '#ffffff';
};
