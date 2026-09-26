import React, { useEffect } from 'react';
import { useSettingsStore, QualityPreset } from '@/state/SettingsStore';
import { WorldSeed } from '@core/WorldSeed';
import { BiomeManager, WorldType } from '@features/terrain/logic/BiomeManager';
import { audioManager } from '@core/audio/AudioManager';
import { VineRule } from '@ui/grove/GroveOrnaments';

interface SettingsMenuProps {
  onRestartWorld?: () => void;
}

const WORLD_NAMES: Record<WorldType, string> = {
  [WorldType.DEFAULT]: 'The Grove',
  [WorldType.SKY_ISLANDS]: 'Sky Archipelago',
  [WorldType.FROZEN]: 'Frozen Wastes',
  [WorldType.LUSH]: 'Lush Jungle',
  [WorldType.CHAOS]: 'Chaos Realm',
};

const PRESETS: Array<[QualityPreset, string]> = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']];

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="mt-6">
    <h3 className="grove-eyebrow mb-3">{title}</h3>
    {children}
  </section>
);

const Slider: React.FC<{
  label: string; value: number; min: number; max: number; step: number;
  display: string; onChange: (v: number) => void;
}> = ({ label, value, min, max, step, display, onChange }) => (
  <label className="mb-4 block">
    <div className="mb-2 flex items-baseline justify-between text-[14px]">
      <span className="text-lichen/85">{label}</span>
      <span className="grove-num text-[12.5px] text-lichen/55">{display}</span>
    </div>
    <input
      type="range" min={min} max={max} step={step} value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="grove-range w-full cursor-pointer"
    />
  </label>
);

/** Keeps audio volumes in step with the saved settings. Always mounted. */
const useAudioSettings = () => {
  const master = useSettingsStore((s) => s.masterVolume);
  const ambience = useSettingsStore((s) => s.ambienceVolume);
  useEffect(() => {
    audioManager.setMasterVolume(master);
    audioManager.ambience.setVolume(master * ambience);
  }, [master, ambience]);
};

export const SettingsMenu: React.FC<SettingsMenuProps> = ({ onRestartWorld }) => {
  useAudioSettings();

  const isOpen = useSettingsStore(s => s.isSettingsOpen);
  const toggle = useSettingsStore(s => s.toggleSettings);

  const resolutionScale = useSettingsStore(s => s.resolutionScale);
  const setResolutionScale = useSettingsStore(s => s.setResolutionScale);
  const qualityPreset = useSettingsStore(s => s.qualityPreset);
  const setQualityPreset = useSettingsStore(s => s.setQualityPreset);
  const viewDistance = useSettingsStore(s => s.viewDistance);
  const setViewDistance = useSettingsStore(s => s.setViewDistance);

  const shadows = useSettingsStore(s => s.shadows);
  const setShadows = useSettingsStore(s => s.setShadows);
  const bloom = useSettingsStore(s => s.bloom);
  const setBloom = useSettingsStore(s => s.setBloom);
  const ao = useSettingsStore(s => s.ao);
  const setAo = useSettingsStore(s => s.setAo);
  const godRays = useSettingsStore(s => s.godRays);
  const setGodRays = useSettingsStore(s => s.setGodRays);
  const antialias = useSettingsStore(s => s.antialias);
  const setAntialias = useSettingsStore(s => s.setAntialias);
  const dynamicResolution = useSettingsStore(s => s.dynamicResolution);
  const setDynamicResolution = useSettingsStore(s => s.setDynamicResolution);

  const masterVolume = useSettingsStore(s => s.masterVolume);
  const setMasterVolume = useSettingsStore(s => s.setMasterVolume);
  const ambienceVolume = useSettingsStore(s => s.ambienceVolume);
  const setAmbienceVolume = useSettingsStore(s => s.setAmbienceVolume);

  const inputMode = useSettingsStore(s => s.inputMode);
  const setInputMode = useSettingsStore(s => s.setInputMode);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') toggle(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, toggle]);

  if (!isOpen) return null;

  const handleRestartWorld = () => {
    toggle();
    onRestartWorld?.();
  };

  const worldType = BiomeManager.getWorldType();

  return (
    <div
      className="grove-fade-in fixed inset-0 z-[80] flex items-center justify-center p-4 text-parchment"
      style={{ background: 'radial-gradient(ellipse 70% 60% at 50% 50%, rgba(7,11,10,0.55), rgba(7,11,10,0.85))', animationDuration: '250ms' }}
      onClick={toggle}
    >
      <div
        className="grove-panel grove-rise max-h-[92vh] w-full max-w-[460px] overflow-y-auto rounded-2xl px-7 py-6"
        style={{ animationDuration: '450ms' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-display text-[34px] font-semibold leading-none">Settings</h2>
            <VineRule className="mt-2 -ml-4" width={160} />
          </div>
          <button onClick={toggle} className="-mr-2 rounded-full p-2 text-lichen/60 hover:text-parchment" aria-label="Close settings">
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M5 5 L15 15 M15 5 L5 15" /></svg>
          </button>
        </div>

        <Section title="This world">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="font-display text-[20px] font-semibold">{worldType ? WORLD_NAMES[worldType as WorldType] ?? worldType : 'The Grove'}</div>
              <div className="text-[12.5px] text-lichen/55">seed <span className="grove-num">{WorldSeed.get()}</span> · your progress is kept for this seed</div>
            </div>
            {onRestartWorld && (
              <button onClick={handleRestartWorld} className="grove-button-quiet shrink-0 px-4 py-1.5 text-[12.5px]" title="Return to the title screen">
                Leave world
              </button>
            )}
          </div>
        </Section>

        <Section title="Sound">
          <Slider label="Volume" value={masterVolume} min={0} max={1} step={0.05} display={`${Math.round(masterVolume * 100)}%`} onChange={setMasterVolume} />
          <Slider label="Nature ambience" value={ambienceVolume} min={0} max={1} step={0.05} display={`${Math.round(ambienceVolume * 100)}%`} onChange={setAmbienceVolume} />
        </Section>

        <Section title="Graphics">
          <div className="mb-4 grid grid-cols-4 gap-1.5">
            {PRESETS.map(([p, label]) => (
              <button key={p} onClick={() => setQualityPreset(p)} data-on={qualityPreset === p} className="grove-choice rounded-lg py-2 text-[13px] font-medium">
                {label}
              </button>
            ))}
          </div>
          <Slider
            label="Resolution" value={resolutionScale} min={0.5} max={2} step={0.25}
            display={`${resolutionScale.toFixed(2)}× · ${Math.round(window.innerWidth * resolutionScale)}×${Math.round(window.innerHeight * resolutionScale)}`}
            onChange={setResolutionScale}
          />
          <Slider
            label="View distance" value={viewDistance} min={0.5} max={1.5} step={0.05}
            display={viewDistance < 0.8 ? 'close' : viewDistance > 1.2 ? 'far' : 'balanced'}
            onChange={setViewDistance}
          />
          <div className="grid grid-cols-2 gap-1.5">
            {([
              ['Shadows', shadows, setShadows],
              ['Bloom', bloom, setBloom],
              ['Sun shafts', godRays, setGodRays],
              ['Ambient occlusion', ao, setAo],
              ['Anti-aliasing', antialias, setAntialias],
              ['Dynamic resolution', dynamicResolution, setDynamicResolution],
            ] as Array<[string, boolean, (v: boolean) => void]>).map(([label, value, setter]) => (
              <button
                key={label}
                onClick={() => setter(!value)}
                className="flex items-center justify-between rounded-lg border px-3 py-2 text-[13px] transition-colors"
                style={{
                  borderColor: value ? 'rgba(157,189,98,0.45)' : 'rgba(215,220,182,0.12)',
                  background: value ? 'rgba(157,189,98,0.1)' : 'rgba(241,234,211,0.03)',
                  color: value ? '#f1ead3' : 'rgba(215,220,182,0.6)',
                }}
                aria-pressed={value}
              >
                <span>{label}</span>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: value ? '#b5d178' : 'rgba(215,220,182,0.25)', boxShadow: value ? '0 0 6px #9dbd62' : 'none' }} />
              </button>
            ))}
          </div>
        </Section>

        <Section title="Controls">
          <div className="grid grid-cols-2 gap-1.5">
            {([['mouse', 'Mouse & keyboard'], ['touch', 'Touchscreen']] as const).map(([mode, label]) => (
              <button key={mode} onClick={() => setInputMode(mode)} data-on={inputMode === mode} className="grove-choice rounded-lg py-2 text-[13px] font-medium">
                {label}
              </button>
            ))}
          </div>
          <p className="mt-3 text-[12px] text-lichen/50">
            Hold <span className="grove-key">Tab</span> to show your path and items. <span className="grove-key">H</span> lists the controls.
          </p>
        </Section>

        <button onClick={toggle} className="grove-button mt-7 w-full py-2.5 text-[17px]">
          Return to the Grove
        </button>
      </div>
    </div>
  );
};
