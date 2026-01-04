import React from 'react';
import { useSettingsStore, QualityPreset } from '@/state/SettingsStore';
import { WorldSeed } from '@core/WorldSeed';
import { BiomeManager } from '@features/terrain/logic/BiomeManager';

interface SettingsMenuProps {
  onRestartWorld?: () => void;
}

export const SettingsMenu: React.FC<SettingsMenuProps> = ({ onRestartWorld }) => {
  const isOpen = useSettingsStore(s => s.isSettingsOpen);
  const toggle = useSettingsStore(s => s.toggleSettings);

  const resolutionScale = useSettingsStore(s => s.resolutionScale);
  const setResolutionScale = useSettingsStore(s => s.setResolutionScale);

  const qualityPreset = useSettingsStore(s => s.qualityPreset);
  const setQualityPreset = useSettingsStore(s => s.setQualityPreset);

  const inputMode = useSettingsStore(s => s.inputMode);
  const setInputMode = useSettingsStore(s => s.setInputMode);

  if (!isOpen) return null;

  const handleRestartWorld = () => {
    toggle(); // Close settings first
    onRestartWorld?.();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700 p-6 rounded-lg shadow-2xl max-w-md w-full text-white m-4">
        <h2 className="text-2xl font-bold mb-6 text-emerald-400">Settings</h2>

        {/* World Info */}
        <div className="mb-6 p-3 bg-slate-800/50 rounded-lg border border-slate-700">
          <div className="flex justify-between items-center">
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wide">Current World</p>
              <p className="text-sm font-mono text-slate-300">
                Seed: <span className="text-emerald-400">{WorldSeed.get()}</span>
              </p>
              <p className="text-xs text-slate-500">
                Type: {BiomeManager.getWorldType()}
              </p>
            </div>
            {onRestartWorld && (
              <button
                onClick={handleRestartWorld}
                className="px-3 py-1.5 text-xs bg-amber-600/80 hover:bg-amber-500 rounded transition-colors"
                title="Return to world selection"
              >
                New World
              </button>
            )}
          </div>
        </div>

        {/* Quality Preset */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-slate-400 mb-2">Graphics Quality</label>
          <div className="flex gap-2">
            {(['low', 'medium', 'high'] as QualityPreset[]).map((p) => (
              <button
                key={p}
                onClick={() => setQualityPreset(p)}
                className={`flex-1 py-2 rounded font-medium transition-colors ${
                  qualityPreset === p
                    ? 'bg-emerald-600 text-white shadow-lg'
                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
              >
                {p.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Resolution Slider */}
        <div className="mb-6">
          <div className="flex justify-between mb-2">
            <label className="text-sm font-medium text-slate-400">Resolution</label>
            <span className="text-sm font-mono text-emerald-400">
              {resolutionScale.toFixed(2)}x
              <span className="text-slate-500 ml-1">
                ({Math.round(window.innerWidth * resolutionScale)}×{Math.round(window.innerHeight * resolutionScale)})
              </span>
            </span>
          </div>
          <input
            type="range"
            min="0.25"
            max="2.0"
            step="0.25"
            value={resolutionScale}
            onChange={(e) => setResolutionScale(parseFloat(e.target.value))}
            className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
          />
          <div className="flex justify-between text-xs text-slate-500 mt-1">
            <span>Performance</span>
            <span>Quality</span>
          </div>
        </div>

        {/* Input Mode */}
        <div className="mb-8">
          <label className="block text-sm font-medium text-slate-400 mb-2">Input Mode</label>
          <div className="flex gap-2 bg-slate-800 p-1 rounded-lg">
            <button
              onClick={() => setInputMode('mouse')}
              className={`flex-1 py-1.5 rounded text-sm font-medium transition-all ${
                inputMode === 'mouse' ? 'bg-slate-600 text-white shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              Mouse & Keyboard
            </button>
            <button
              onClick={() => setInputMode('touch')}
              className={`flex-1 py-1.5 rounded text-sm font-medium transition-all ${
                inputMode === 'touch' ? 'bg-slate-600 text-white shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              Touchscreen
            </button>
          </div>
        </div>

        <button
          onClick={toggle}
          className="w-full py-3 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded-lg font-bold transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
};
