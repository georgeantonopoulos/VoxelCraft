import React from 'react';
import { ItemType } from '@/types';
import { useInventoryStore } from '@/state/InventoryStore';

interface CustomToolIconProps {
    toolId: string;
}

export const CustomToolIcon: React.FC<CustomToolIconProps> = ({ toolId }) => {
    const customTools = useInventoryStore(state => state.customTools);
    const tool = customTools[toolId];

    if (!tool) return null;

    // Render a tiny diagram of the tool
    return (
        <div className="relative w-8 h-8 flex items-center justify-center bg-slate-800 rounded border border-white/10 overflow-hidden">
            {/* Handle (Stick) */}
            <div
                className="absolute w-1 h-6 bg-amber-900 rounded-full rotate-[15deg] shadow-sm"
                style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%) rotate(15deg)' }}
            />

            {/* Attachments (mini dots) */}
            {Object.entries(tool.attachments).map(([slotId, type]) => {
                // Simple positioning logic based on slot IDs (assuming they map to top/bottom/sides)
                let style: React.CSSProperties = {};
                const isSharp = type === ItemType.SHARD;
                const color = type === ItemType.STONE ? '#888888' : type === ItemType.SHARD ? '#00ffff' : '#5c4033';
                const size = type === ItemType.STICK ? 4 : 6;

                if (slotId.includes('top')) style = { top: '10%', left: '50%' };
                else if (slotId.includes('bottom')) style = { bottom: '10%', left: '50%' };
                else if (slotId.includes('left')) style = { left: '10%', top: '40%' };
                else if (slotId.includes('right')) style = { right: '10%', top: '40%' };
                else style = { top: '30%', left: '30%' }; // default

                return (
                    <div
                        key={slotId}
                        className={`absolute rounded-full border border-white/20 shadow-[0_0_2px_rgba(255,255,255,0.3)] ${isSharp ? 'animate-pulse' : ''}`}
                        style={{
                            ...style,
                            width: size,
                            height: size,
                            backgroundColor: color,
                            transform: 'translate(-50%, -50%)'
                        }}
                    />
                );
            })}

            {/* "LVL" badge or something? */}
            <div className="absolute bottom-0 right-0 bg-blue-500/80 text-[6px] font-black px-0.5 rounded-tl text-white leading-none">
                CUST
            </div>
        </div>
    );
};
