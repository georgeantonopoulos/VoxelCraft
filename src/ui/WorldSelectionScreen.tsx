import { WorldPreview } from './WorldPreview';
import React, { useState, useCallback } from 'react';
import { WorldType } from '@features/terrain/logic/BiomeManager';
import { WorldSeed } from '@core/WorldSeed';

interface WorldSelectionScreenProps {
    onSelect: (type: WorldType, seed: number) => void;
}

interface WorldOption {
    type: WorldType;
    name: string;
    description: string;
    color: string;
}

const OPTIONS: WorldOption[] = [
    {
        type: WorldType.DEFAULT,
        name: "The Grove",
        description: "A balanced world with temperate plains, forests, and varied terrain.",
        color: "bg-emerald-600"
    },
    {
        type: WorldType.SKY_ISLANDS,
        name: "Sky Archipelago",
        description: "Floating islands suspended in an endless void.",
        color: "bg-sky-500"
    },
    {
        type: WorldType.FROZEN,
        name: "Frozen Wastes",
        description: "An eternal winter landscape of snow and ice.",
        color: "bg-slate-400"
    },
    {
        type: WorldType.LUSH,
        name: "Lush Jungle",
        description: "Dense, humid vegetation and towering trees.",
        color: "bg-green-700"
    },
    {
        type: WorldType.CHAOS,
        name: "Chaos Realm",
        description: "A fractured world where the laws of nature are broken.",
        color: "bg-purple-600"
    }
];

export const WorldSelectionScreen: React.FC<WorldSelectionScreenProps> = ({ onSelect }) => {
    const [selected, setSelected] = useState<WorldType | null>(null);
    const [seedInput, setSeedInput] = useState<string>(() => String(WorldSeed.fromURLOrRandom()));
    const [showSeedInput, setShowSeedInput] = useState(false);

    const handleRandomSeed = useCallback(() => {
        setSeedInput(String(WorldSeed.generateRandom()));
    }, []);

    const parsedSeed = parseInt(seedInput, 10) || 1337;

    return (
        <div className="world-selection absolute inset-0 z-50 flex flex-col items-center text-white select-none overflow-y-auto">

            {/* Header */}
            <div className="mt-12 mb-6 text-center animate-fade-in-down">
                <p className="text-[11px] tracking-[0.4em] uppercase text-stone-400 mb-3">VoxelCraft</p>
                <h1 className="text-3xl sm:text-4xl font-light tracking-wide text-stone-100 mb-3">Select World Type</h1>
                <p className="text-zinc-400 tracking-wide">Choose your reality</p>
            </div>

            {/* Seed Input Section */}
            <div className="mb-8 text-center">
                <button
                    onClick={() => setShowSeedInput(!showSeedInput)}
                    className="text-sm text-zinc-400 hover:text-white transition-colors underline underline-offset-4"
                >
                    {showSeedInput ? 'Hide Seed Options' : 'Custom Seed'}
                </button>

                {showSeedInput && (
                    <div className="mt-4 flex items-center gap-3 justify-center animate-fade-in-down">
                        <label className="text-sm text-zinc-400">Seed:</label>
                        <input
                            type="text"
                            value={seedInput}
                            onChange={(e) => setSeedInput(e.target.value.replace(/[^0-9]/g, ''))}
                            className="w-40 px-3 py-2 bg-zinc-800 border border-zinc-600 rounded text-center
                                     focus:outline-none focus:border-white/50 font-mono"
                            placeholder="Enter seed..."
                        />
                        <button
                            onClick={handleRandomSeed}
                            className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 rounded text-sm transition-colors"
                            title="Generate random seed"
                        >
                            🎲
                        </button>
                    </div>
                )}
            </div>

            {/* Cards Container */}
            <div className="world-cards grid gap-4 px-6 mb-8 w-full">
                {OPTIONS.map((opt) => (
                    <button
                        key={opt.type}
                        type="button"
                        aria-pressed={selected === opt.type}
                        onClick={() => setSelected(opt.type)}
                        className={`
              world-card relative h-80 rounded-xl p-5 cursor-pointer text-left overflow-hidden transition-all duration-300 border
              flex flex-col justify-end
              ${selected === opt.type
                                ? 'border-amber-100/80 -translate-y-1 shadow-[0_12px_32px_rgba(0,0,0,0.35)]'
                                : 'border-white/10 hover:border-white/40 hover:-translate-y-1 bg-zinc-800/50'
                            }
            `}
                    >
                        {/* Background Color Indicator */}
                        <WorldPreview type={opt.type} />
                        <div className="absolute inset-0 bg-gradient-to-t from-[#101c1c] via-[#101c1c]/30 to-transparent" />

                        {/* Content */}
                        <div className="relative z-10">
                            <h2 className="text-xl font-bold mb-2 tracking-wider uppercase">{opt.name}</h2>
                            <div className="h-1 w-8 bg-white/50 mb-3" />
                            <p className="text-sm text-zinc-300 leading-relaxed min-h-[4rem]">
                                {opt.description}
                            </p>
                        </div>

                        {/* Selection Checkmark */}
                        {selected === opt.type && (
                            <div className="absolute top-4 right-4 w-6 h-6 bg-white rounded-full flex items-center justify-center text-black">
                                ✓
                            </div>
                        )}
                    </button>
                ))}
            </div>

            {/* Action Button */}
            <div className="min-h-24 pb-10 flex flex-col items-center gap-2">
                {selected && (
                    <>
                        <button
                            onClick={() => onSelect(selected, parsedSeed)}
                            className="px-16 py-4 text-xl font-bold tracking-[0.1em] uppercase
                             bg-[#d9dec3] text-[#172720] rounded-lg hover:bg-[#edf0df]
                             shadow-lg
                             transition-all duration-300 animate-fade-in-up"
                        >
                            Enter World
                        </button>
                        <p className="text-xs text-zinc-500 font-mono">Seed: {parsedSeed}</p>
                    </>
                )}
            </div>

        </div>
    );
};
