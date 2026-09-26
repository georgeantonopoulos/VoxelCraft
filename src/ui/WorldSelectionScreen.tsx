import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { audioManager } from '@core/audio/AudioManager';
import { WorldType } from '@features/terrain/logic/BiomeManager';
import { WorldSeed } from '@core/WorldSeed';
import { readLastWorld } from '@state/lastWorld';
import { peekGroveProgress } from '@state/GroveStore';
import { RANKS, rankIndexFor } from '@features/grove/questLine';
import logo from '@assets/images/thegrove_logo.jpg';
import { FireflyField, GroveLogo, RealmGlyph, RealmGlyphKind, VineRule } from '@ui/grove/GroveOrnaments';

interface WorldSelectionScreenProps {
  onSelect: (type: WorldType, seed: number) => void;
}

interface RealmOption {
  type: WorldType;
  name: string;
  line: string;
  glyph: RealmGlyphKind;
  tint: string;
}

const REALMS: RealmOption[] = [
  { type: WorldType.DEFAULT, name: 'The Grove', glyph: 'grove', tint: '#9dbd62',
    line: 'Temperate valleys, old forests and quiet rivers. Where the Lumina began.' },
  { type: WorldType.SKY_ISLANDS, name: 'Sky Archipelago', glyph: 'sky', tint: '#9fd3e6',
    line: 'Islands adrift above an endless haze. Mind the edges.' },
  { type: WorldType.FROZEN, name: 'Frozen Wastes', glyph: 'frozen', tint: '#cfe0ea',
    line: 'An eternal winter. The Lumina sleeps inside the ice.' },
  { type: WorldType.LUSH, name: 'Lush Jungle', glyph: 'lush', tint: '#6fbf73',
    line: 'Dense, humid canopy and towering trees, loud with life.' },
  { type: WorldType.CHAOS, name: 'Chaos Realm', glyph: 'chaos', tint: '#c7a3e6',
    line: 'A fractured land where the old laws of nature no longer hold.' },
];

const realmName = (type: WorldType) => REALMS.find((r) => r.type === type)?.name ?? 'Unknown land';

/**
 * Title screen: the key art over a night backdrop, Continue for the last world
 * (terrain edits and Keeper progress are saved per seed), or a new world.
 */
export const WorldSelectionScreen: React.FC<WorldSelectionScreenProps> = ({ onSelect }) => {
  const lastWorld = useMemo(() => readLastWorld(), []);
  const lastProgress = useMemo(() => (lastWorld ? peekGroveProgress(lastWorld.seed) : null), [lastWorld]);

  const [choosing, setChoosing] = useState(!lastWorld);
  const [selected, setSelected] = useState<WorldType>(WorldType.DEFAULT);
  const [hovered, setHovered] = useState<WorldType | null>(null);
  const [seedInput, setSeedInput] = useState<string>(() => String(WorldSeed.fromURLOrRandom()));
  const [editingSeed, setEditingSeed] = useState(false);

  const parsedSeed = parseInt(seedInput, 10) || 1337;

  // A night glade plays behind the title (it starts on the first click or key,
  // as browsers require); the world's own ambience takes over in game.
  useEffect(() => {
    audioManager.ambience.setMenuMood(true);
    return () => audioManager.ambience.setMenuMood(false);
  }, []);

  const enter = useCallback((type: WorldType, seed: number) => {
    window.dispatchEvent(new CustomEvent('vc-music-cue', { detail: { kind: 'quest-start' } }));
    onSelect(type, seed);
  }, [onSelect]);
  const shown = REALMS.find((r) => r.type === (hovered ?? selected)) ?? REALMS[0];

  const reroll = useCallback(() => setSeedInput(String(WorldSeed.generateRandom())), []);

  const continueLabel = useMemo(() => {
    if (!lastWorld) return '';
    const parts = [realmName(lastWorld.type)];
    if (lastProgress) {
      parts.push(RANKS[rankIndexFor(lastProgress.essence)].title);
      if (lastProgress.hollowsRestored > 0) {
        parts.push(`${lastProgress.hollowsRestored} hollow${lastProgress.hollowsRestored === 1 ? '' : 's'} restored`);
      }
    }
    return parts.join(' · ');
  }, [lastWorld, lastProgress]);

  return (
    <div className="absolute inset-0 z-50 overflow-y-auto overflow-x-hidden bg-night text-parchment select-none">
      {/* Night backdrop */}
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            'radial-gradient(ellipse 70% 55% at 50% 38%, rgba(38, 58, 44, 0.55), rgba(7, 11, 10, 0) 70%),' +
            'radial-gradient(ellipse 90% 60% at 50% 110%, rgba(20, 34, 30, 0.9), rgba(7, 11, 10, 0) 70%),' +
            '#070b0a',
        }}
      />
      <div className="grove-mist pointer-events-none fixed inset-0" />
      <FireflyField count={70} className="fixed" />

      <div className="relative flex min-h-full flex-col items-center justify-center px-6 py-10">
        <div className="w-[min(860px,94vw)]">
          <GroveLogo src={logo} />
        </div>

        <p className="grove-rise -mt-2 max-w-[560px] text-center font-display text-[19px] italic leading-snug text-parchment/75" style={{ animationDelay: '250ms' }}>
          The Lumina that once joined every land is fading.
          Follow its light to the sleeping Root Hollows and wake them.
        </p>

        <VineRule className="grove-rise my-6" width={220} />

        {!choosing && lastWorld ? (
          <div className="grove-rise flex flex-col items-center gap-4" style={{ animationDelay: '450ms' }}>
            <button
              className="grove-button px-14 py-3.5 text-[22px]"
              onClick={() => enter(lastWorld.type, lastWorld.seed)}
            >
              Continue
            </button>
            <div className="-mt-1 text-center text-[13px] tracking-wide text-lichen/80">
              {continueLabel}
              <span className="text-lichen/55"> · seed <span className="grove-num">{lastWorld.seed}</span></span>
            </div>
            <button className="grove-button-quiet mt-2 px-6 py-1.5 text-[13px]" onClick={() => setChoosing(true)}>
              Begin a new world
            </button>
          </div>
        ) : (
          <div className="grove-rise flex w-full max-w-[780px] flex-col items-center" style={{ animationDelay: '450ms' }}>
            <div className="grove-eyebrow mb-4">Choose a land</div>

            <div className="flex flex-wrap justify-center gap-2 sm:gap-3" onMouseLeave={() => setHovered(null)}>
              {REALMS.map((realm) => {
                const on = realm.type === selected;
                return (
                  <button
                    key={realm.type}
                    onClick={() => setSelected(realm.type)}
                    onMouseEnter={() => setHovered(realm.type)}
                    onFocus={() => setHovered(realm.type)}
                    className="group relative flex w-[128px] flex-col items-center gap-2 rounded-xl px-2 pb-3 pt-4 transition-all duration-300"
                    style={{
                      color: on ? realm.tint : 'rgba(215, 220, 182, 0.62)',
                      background: on ? 'rgba(241, 234, 211, 0.06)' : 'transparent',
                      boxShadow: on ? `inset 0 0 0 1px ${realm.tint}55, 0 0 30px ${realm.tint}22` : 'inset 0 0 0 1px rgba(215,220,182,0.08)',
                    }}
                  >
                    <RealmGlyph kind={realm.glyph} className="h-9 w-9 transition-transform duration-300 group-hover:-translate-y-0.5" />
                    <span className={`font-display text-[17px] font-semibold leading-tight ${on ? 'text-parchment' : 'text-lichen/80 group-hover:text-parchment'}`}>
                      {realm.name}
                    </span>
                  </button>
                );
              })}
            </div>

            <p className="mt-4 h-6 text-center font-display text-[17px] italic text-lichen/75">{shown.line}</p>

            <div className="mt-4 flex items-center gap-2 text-[13px] text-lichen/55">
              <span className="tracking-wide">Seed</span>
              {editingSeed ? (
                <input
                  autoFocus
                  value={seedInput}
                  onChange={(e) => setSeedInput(e.target.value.replace(/[^0-9]/g, '').slice(0, 10))}
                  onBlur={() => setEditingSeed(false)}
                  onKeyDown={(e) => { if (e.key === 'Enter') setEditingSeed(false); }}
                  className="grove-input grove-num w-32 px-2 py-0.5 text-center text-[13px]"
                  aria-label="World seed"
                />
              ) : (
                <button onClick={() => setEditingSeed(true)} className="grove-num rounded px-1.5 py-0.5 text-lichen/80 underline decoration-lichen/25 underline-offset-4 hover:text-parchment" title="Type a seed">
                  {parsedSeed}
                </button>
              )}
              <button onClick={reroll} className="rounded-full px-2 py-0.5 text-lichen/60 hover:text-parchment" title="Roll a new seed" aria-label="Roll a new seed">
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                  <path d="M16 7 A6.5 6.5 0 1 0 16.5 12" />
                  <path d="M16.5 3.5 V7.5 H12.5" />
                </svg>
              </button>
            </div>

            <div className="mt-6 flex items-center gap-4">
              {lastWorld && (
                <button className="grove-button-quiet px-5 py-2 text-[13px]" onClick={() => setChoosing(false)}>
                  Back
                </button>
              )}
              <button className="grove-button px-14 py-3.5 text-[20px]" onClick={() => enter(selected, parsedSeed)}>
                Begin
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
