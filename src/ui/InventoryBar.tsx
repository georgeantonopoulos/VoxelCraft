
import React from 'react';
import { useInventoryStore } from '@/state/InventoryStore';
import torchImg from '@/assets/images/torch_gemini.png';
import floraImg from '@/assets/images/flora_icon.png';
import stickImg from '@/assets/images/stick.svg';
import stoneImg from '@/assets/images/stone.svg';
// Reuse stone image for shard for now, or just use a generic shape if we had one.
// Using stoneImg but maybe tinted or just same for now as placeholder is acceptable per requirements.
// Requirement said: "reusing Stone or a simple SVG is fine"

export const InventoryBar: React.FC = () => {
    const inventorySlots = useInventoryStore(state => state.inventorySlots);
    const selectedSlotIndex = useInventoryStore(state => state.selectedSlotIndex);
    const floraCount = useInventoryStore(state => state.inventoryCount);
    const torchCount = useInventoryStore(state => state.torchCount);
    const stickCount = useInventoryStore(state => state.stickCount);
    const stoneCount = useInventoryStore(state => state.stoneCount);
    const shardCount = useInventoryStore(state => state.shardCount);

    return (
        <div className="absolute bottom-6 left-6 z-50 flex gap-2 p-2 bg-slate-900/80 backdrop-blur-md rounded-xl border border-white/10 shadow-xl pointer-events-auto">
            {inventorySlots.map((item, index) => {
                const isSelected = index === selectedSlotIndex;
                const showCount = item === 'flora' || item === 'torch' || item === 'stick' || item === 'stone' || item === 'shard';
                const count = item === 'flora'
                    ? floraCount
                    : (item === 'torch'
                        ? torchCount
                        : (item === 'stick'
                            ? stickCount
                            : (item === 'stone'
                                ? stoneCount
                                : (item === 'shard'
                                    ? shardCount
                                    : 0))));
                return (
                    <div
                        key={index}
                        className={`
              relative w-12 h-12 flex items-center justify-center rounded-lg border-2 transition-all duration-200
              ${isSelected ? 'border-amber-400 bg-white/10 scale-105 shadow-[0_0_10px_rgba(251,191,36,0.5)]' : 'border-white/20 bg-black/40'}
            `}
                    >
                        {/* Slot Number (small overlay) */}
                        <span className="absolute top-0.5 left-1 text-[8px] font-mono text-white/50">
                            {index + 1}
                        </span>

                        {/* Item Icon */}
                        {item === 'torch' && (
                            <img
                                src={torchImg}
                                alt="Torch"
                                className={`w-8 h-8 object-contain drop-shadow-md ${count > 0 ? '' : 'opacity-30'}`}
                            />
                        )}
                        {item === 'flora' && (
                            <img
                                src={floraImg}
                                alt="Flora"
                                className={`w-8 h-8 object-contain drop-shadow-md ${count > 0 ? '' : 'opacity-30'}`}
                            />
                        )}
                        {item === 'stick' && (
                            <img
                                src={stickImg}
                                alt="Stick"
                                className={`w-8 h-8 object-contain drop-shadow-md ${count > 0 ? '' : 'opacity-30'}`}
                            />
                        )}
                        {item === 'stone' && (
                            <img
                                src={stoneImg}
                                alt="Stone"
                                className={`w-8 h-8 object-contain drop-shadow-md ${count > 0 ? '' : 'opacity-30'}`}
                            />
                        )}
                        {item === 'shard' && (
                            <div className={`relative w-8 h-8 flex items-center justify-center ${count > 0 ? '' : 'opacity-30'}`}>
                                {/* Simple CSS shape for shard if no image */}
                                <div className="w-0 h-0 border-l-[6px] border-l-transparent border-b-[16px] border-b-slate-300 border-r-[6px] border-r-transparent transform rotate-45 drop-shadow-md"></div>
                            </div>
                        )}
                        {item === 'pickaxe' && (
                            <div className="w-8 h-8 flex items-center justify-center rounded bg-slate-700/50 border border-white/10 text-[10px] font-mono text-white/90">
                                PX
                            </div>
                        )}
                        {item === 'axe' && (
                            <div className="w-8 h-8 flex items-center justify-center rounded bg-slate-700/50 border border-white/10 text-[10px] font-mono text-white/90">
                                AX
                            </div>
                        )}
                        {item == null && (
                            <div className="w-8 h-8 flex items-center justify-center rounded bg-black/20 border border-white/5 text-[10px] font-mono text-white/40">
                                --
                            </div>
                        )}

                        {/* Stack Count */}
                        {showCount && count > 0 && (
                            <span className="absolute bottom-0.5 right-1 text-[10px] font-mono text-white/90 drop-shadow">
                                {count}
                            </span>
                        )}
                    </div>
                );
            })}
        </div>
    );
};
