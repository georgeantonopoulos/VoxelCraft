import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useGroveStore, GroveToast } from '@state/GroveStore';
import { playerState, subscribeThrottled } from '@core/player/PlayerState';
import { questAt, questProgress, RANKS, rankIndexFor, STRIDE_PER_RANK } from '@features/grove/questLine';

/**
 * Grove HUD — the Keeper's view of their progress.
 *
 *  - Quest tracker (top-left): current Keeper's Path step with progress.
 *  - Keeper badge: rank, essence and world vitality.
 *  - Lumina Sense (top-centre): compass strip pointing at the next hollow.
 *  - Toasts: quest completions, rank-ups and discoveries.
 *  - Controls reference: toggled with H so it never crowds the screen.
 */

const TOAST_LIFETIME_MS = 4200;

const QuestTracker: React.FC = () => {
  const progression = useGroveStore((s) => s.progression);
  const quest = questAt(progression.questIndex);
  const { value, goal } = questProgress(progression);
  const pct = Math.round((value / goal) * 100);

  return (
    <div className="grove-panel w-[260px] px-4 py-3">
      <div className="text-[10px] uppercase tracking-[0.25em] text-emerald-300/70">Keeper&apos;s Path</div>
      <div className="mt-0.5 flex items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-emerald-50">{quest.title}</h2>
        <span className="font-mono text-xs text-emerald-200/80">{value}/{goal}</span>
      </div>
      <p className="mt-0.5 text-[11px] italic leading-snug text-emerald-100/55">{quest.lore}</p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-emerald-950/70">
        <div
          className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-cyan-300 transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-2 text-xs leading-snug text-slate-100/90">{quest.hint}</p>
    </div>
  );
};

const KeeperBadge: React.FC = () => {
  const essence = useGroveStore((s) => s.progression.essence);
  const vitality = useGroveStore((s) => s.vitality);
  const restored = useGroveStore((s) => s.progression.stats.hollowsRestored);
  const rankIdx = rankIndexFor(essence);
  const rank = RANKS[rankIdx];
  const next = RANKS[rankIdx + 1];
  const rankPct = next ? ((essence - rank.minEssence) / (next.minEssence - rank.minEssence)) * 100 : 100;

  return (
    <div className="grove-panel mt-2 w-[260px] px-4 py-2.5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.25em] text-amber-200/70">Rank</div>
          <div className="text-sm font-semibold text-amber-100">{rank.title}</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-[0.25em] text-cyan-200/70">Essence</div>
          <div className="font-mono text-sm text-cyan-100">{essence}</div>
        </div>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-amber-950/60" title={next ? `Next: ${next.title}` : 'Max rank'}>
        <div className="h-full bg-amber-300/80 transition-[width] duration-700" style={{ width: `${rankPct}%` }} />
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-emerald-200/70">
        <span>World Vitality</span>
        <span className="font-mono normal-case tracking-normal">{Math.round(vitality * 100)}% · {restored} hollow{restored === 1 ? '' : 's'}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-900/70">
        <div
          className="h-full rounded-full transition-[width] duration-1000"
          style={{
            width: `${vitality * 100}%`,
            background: 'linear-gradient(90deg, #64748b, #34d399 55%, #fde68a)',
          }}
        />
      </div>
    </div>
  );
};

/**
 * Compass strip: a 180° field of view where the marker slides horizontally.
 * Heading updates come from the throttled player subscription and are written
 * straight to the DOM to avoid React work at 10 Hz.
 */
const LuminaCompass: React.FC = () => {
  const compass = useGroveStore((s) => s.compass);
  const markerRef = useRef<HTMLDivElement>(null);
  const compassRef = useRef(compass);
  compassRef.current = compass;

  useLayoutEffect(() => {
    const update = () => {
      const el = markerRef.current;
      const target = compassRef.current;
      if (!el || !target) return;
      // playerState.rotation is counter-clockwise; the bearing is clockwise.
      let rel = target.bearing + playerState.rotation;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      const clamped = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, rel));
      const x = (clamped / (Math.PI / 2)) * 50;
      el.style.left = `${50 + x}%`;
      el.style.opacity = Math.abs(rel) > Math.PI / 2 ? '0.45' : '1';
    };
    update();
    return subscribeThrottled(update);
  }, [compass]);

  if (!compass) {
    return (
      <div className="grove-panel px-4 py-1.5 text-[11px] tracking-wide text-slate-300/70">
        The Lumina is silent here. Wander farther.
      </div>
    );
  }

  const label = compass.kind === 'hollow' ? 'Root Hollow' : 'Sacred Grove';
  const dist = compass.distance < 1000 ? `${Math.round(compass.distance)}m` : `${(compass.distance / 1000).toFixed(1)}km`;

  return (
    <div className="flex flex-col items-center">
      <div className="grove-panel relative h-7 w-[320px] overflow-hidden">
        <div className="absolute inset-y-0 left-1/2 w-px bg-white/25" />
        <div className="absolute inset-x-4 top-1/2 h-px bg-gradient-to-r from-transparent via-cyan-200/30 to-transparent" />
        <div ref={markerRef} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 transition-[left] duration-100">
          <div className="lumina-marker h-3.5 w-3.5 rotate-45 rounded-[3px]" />
        </div>
      </div>
      <div className="mt-1 text-[10px] uppercase tracking-[0.3em] text-cyan-100/80 drop-shadow">
        Lumina Sense · {label} · {dist}
      </div>
    </div>
  );
};

const ToastItem: React.FC<{ toast: GroveToast }> = ({ toast }) => {
  const dismiss = useGroveStore((s) => s.dismissToast);
  useEffect(() => {
    const handle = window.setTimeout(() => dismiss(toast.id), TOAST_LIFETIME_MS);
    return () => window.clearTimeout(handle);
  }, [toast.id, dismiss]);

  const n = toast.notice;
  let eyebrow = '';
  let title = '';
  let detail = '';
  let tone = 'text-emerald-200';
  switch (n.kind) {
    case 'quest-complete':
      eyebrow = 'Path Complete'; title = n.title; detail = `+${n.essence} essence`; tone = 'text-emerald-200';
      break;
    case 'quest-start':
      eyebrow = 'New Path'; title = n.title; detail = n.hint; tone = 'text-cyan-200';
      break;
    case 'rank-up':
      eyebrow = 'You are now'; title = n.title; detail = `Keeper's Stride +${Math.round(STRIDE_PER_RANK * 100)}% · The Grove remembers your name`; tone = 'text-amber-200';
      break;
    case 'discovery':
      eyebrow = n.detail; title = n.title; detail = ''; tone = 'text-sky-200';
      break;
  }

  return (
    <div className="grove-toast grove-panel min-w-[280px] max-w-[420px] px-5 py-2.5 text-center">
      <div className={`text-[10px] uppercase tracking-[0.3em] ${tone} opacity-80`}>{eyebrow}</div>
      <div className="text-lg font-semibold text-white">{title}</div>
      {detail && <div className="text-xs text-slate-200/80">{detail}</div>}
    </div>
  );
};

const ToastStack: React.FC = () => {
  const toasts = useGroveStore((s) => s.toasts);
  return (
    <div className="absolute left-1/2 top-24 flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => <ToastItem key={t.id} toast={t} />)}
    </div>
  );
};

const ControlsHelp: React.FC = () => {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    // First-time players see controls briefly; afterwards H toggles them.
    const auto = window.setTimeout(() => setOpen(false), 20000);
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'h' && !e.repeat) setOpen((o) => !o);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(auto);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  if (!open) {
    return <div className="grove-panel px-3 py-1 text-[10px] tracking-wider text-slate-300/70">H · Controls</div>;
  }

  const rows: Array<[string, string]> = [
    ['WASD / Space', 'Move · Jump (double-tap to fly)'],
    ['Left Click', 'Dig · Chop · Strike'],
    ['Right Click', 'Place · Throw · Use'],
    ['Q', 'Gather what you look at'],
    ['C', 'Craft (with a stick selected)'],
    ['1-9 / Scroll', 'Select item'],
    ['H', 'Hide controls'],
  ];
  return (
    <div className="grove-panel px-4 py-2.5 text-[11px] text-slate-100/90">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4 leading-5">
          <span className="font-mono text-emerald-200/90">{k}</span>
          <span className="text-right text-slate-200/80">{v}</span>
        </div>
      ))}
    </div>
  );
};

export const GroveHUD: React.FC<{ showControls?: boolean }> = ({ showControls = true }) => (
  <>
    <div className="absolute left-4 top-4">
      <QuestTracker />
      <KeeperBadge />
    </div>
    <div className="absolute left-1/2 top-4 -translate-x-1/2">
      <LuminaCompass />
    </div>
    <ToastStack />
    {showControls && (
      <div className="absolute bottom-6 right-6 max-w-[280px]">
        <ControlsHelp />
      </div>
    )}
  </>
);
