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
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-zinc-900 text-white select-none overflow-hidden">

            {/* Header */}
            <div className="mb-8 text-center animate-fade-in-down">
                <h1 className="text-4xl font-bold tracking-[0.2em] text-white/90 mb-2 uppercase">Select World Type</h1>
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
            <div className="flex flex-wrap gap-6 justify-center max-w-6xl px-8 mb-16">
                {OPTIONS.map((opt) => (
                    <div
                        key={opt.type}
                        onClick={() => setSelected(opt.type)}
                        className={`
              relative w-64 h-80 rounded-xl p-6 cursor-pointer transition-all duration-300 border-2
              flex flex-col justify-end
              ${selected === opt.type
                                ? 'border-white scale-105 shadow-[0_0_30px_rgba(255,255,255,0.2)]'
                                : 'border-white/10 hover:border-white/40 hover:-translate-y-2 bg-zinc-800/50'
                            }
            `}
                    >
                        {/* Background Color Indicator */}
                        <div className={`absolute inset-0 opacity-20 ${opt.color} rounded-xl`} />

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
                    </div>
                ))}
            </div>

            {/* Action Button */}
            <div className="h-24 flex flex-col items-center gap-2">
                {selected && (
                    <>
                        <button
                            onClick={() => onSelect(selected, parsedSeed)}
                            className="px-16 py-4 text-xl font-bold tracking-[0.1em] uppercase
                             bg-white text-black rounded hover:bg-zinc-200
                             shadow-[0_0_20px_rgba(255,255,255,0.3)]
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
