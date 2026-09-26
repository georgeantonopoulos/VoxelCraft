import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useGroveStore, GroveToast } from '@state/GroveStore';
import { playerState, subscribeThrottled } from '@core/player/PlayerState';
import { questAt, questProgress, RANKS, rankIndexFor, STRIDE_PER_RANK } from '@features/grove/questLine';
import { VineRule } from '@ui/grove/GroveOrnaments';
import { useHudPresence, presenceStyle } from '@state/HudPresenceStore';

/**
 * Grove HUD — the Keeper's view of their progress.
 *
 *  - Quest tracker (top-left): current Keeper's Path step, on a soft shadow
 *    rather than a box, with rank and essence underneath.
 *  - Lumina Sense (top-centre): heading strip with cardinal points and the
 *    glowing marker for the next hollow.
 *  - World vitality (top-right): ring meter beside the settings button (HUD.tsx).
 *  - Toasts: quest completions, rank-ups and discoveries.
 *  - Controls reference: toggled with H so it never crowds the screen.
 */

const TOAST_LIFETIME_MS = 4600;

/** Turns "press Q" / "right click" in hint text into key caps. */
export const renderHint = (text: string): React.ReactNode[] =>
  text.split(/(\b[QCHZ]\b|right click|left click)/gi).map((part, i) => {
    if (/^[QCHZ]$/.test(part)) return <span key={i} className="grove-key">{part}</span>;
    if (/^(right|left) click$/i.test(part)) {
      return <span key={i} className="grove-key">{part.toLowerCase().startsWith('right') ? 'Right click' : 'Left click'}</span>;
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });

const ProgressPips: React.FC<{ value: number; goal: number }> = ({ value, goal }) => {
  if (goal > 10) {
    const pct = Math.min(100, (value / goal) * 100);
    return (
      <div className="h-[3px] w-40 overflow-hidden rounded-full bg-lichen/15">
        <div className="h-full rounded-full bg-gradient-to-r from-moss to-lumina transition-[width] duration-700" style={{ width: `${pct}%` }} />
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: goal }, (_, i) => {
        const done = i < value;
        return (
          <span
            key={i}
            className="h-2 w-2 rotate-45 rounded-[2px] transition-all duration-500"
            style={done
              ? { background: 'linear-gradient(135deg, #d9eea0, #9dbd62)', boxShadow: '0 0 8px rgba(157,189,98,0.7)' }
              : { border: '1px solid rgba(215,220,182,0.45)' }}
          />
        );
      })}
    </div>
  );
};

const QuestTracker: React.FC = () => {
  const progression = useGroveStore((s) => s.progression);
  const quest = questAt(progression.questIndex);
  const { value, goal } = questProgress(progression);
  const essence = progression.essence;
  const rankIdx = rankIndexFor(essence);
  const rank = RANKS[rankIdx];
  const next = RANKS[rankIdx + 1];
  const rankPct = next ? ((essence - rank.minEssence) / (next.minEssence - rank.minEssence)) * 100 : 100;

  return (
    <div className="grove-veil grove-text-shadow w-[300px]">
      <div className="grove-eyebrow">Keeper&apos;s Path</div>
      <h2 className="mt-0.5 font-display text-[27px] font-semibold leading-[1.05] text-parchment">{quest.title}</h2>
      <p className="mt-1 font-display text-[16px] font-semibold italic leading-snug text-lichen">{quest.lore}</p>
      <div className="mt-2.5 flex items-center gap-3">
        <ProgressPips value={value} goal={goal} />
        <span className="grove-num text-[12px] text-lichen/90">{value} / {goal}</span>
      </div>
      <p className="mt-2 text-[14px] font-medium leading-snug text-parchment">{renderHint(quest.hint)}</p>

      <div className="mt-4 flex items-center gap-2 text-[12px]" title={next ? `${next.minEssence - essence} essence to ${next.title}` : 'Highest rank'}>
        <span className="font-display text-[16px] font-semibold italic text-ember">{rank.title}</span>
        <span className="h-[3px] w-16 overflow-hidden rounded-full bg-ember/15">
          <span className="block h-full rounded-full bg-ember/80 transition-[width] duration-700" style={{ width: `${rankPct}%` }} />
        </span>
        <span className="grove-num font-medium text-lumina">{essence}</span>
        <span className="font-medium text-lichen">essence</span>
      </div>
    </div>
  );
};

/** Ring meter for world vitality (restored hollows raise it). */
export const VitalityRing: React.FC = () => {
  const vitality = useGroveStore((s) => s.vitality);
  const restored = useGroveStore((s) => s.progression.stats.hollowsRestored);
  const r = 17;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, vitality));
  return (
    <div className="flex items-center gap-2.5 grove-text-shadow" title={`World vitality · ${restored} hollow${restored === 1 ? '' : 's'} restored`}>
      <div className="text-right leading-tight">
        <div className="grove-eyebrow">Vitality</div>
        <div className="text-[11.5px] font-medium text-lichen">{restored} hollow{restored === 1 ? '' : 's'}</div>
      </div>
      <div className="relative h-11 w-11">
        <svg viewBox="0 0 44 44" className="h-11 w-11 -rotate-90">
          <circle cx="22" cy="22" r={r} fill="rgba(7,11,10,0.45)" stroke="rgba(215,220,182,0.16)" strokeWidth="3" />
          <circle
            cx="22" cy="22" r={r} fill="none"
            stroke="url(#vit-grad)" strokeWidth="3" strokeLinecap="round"
            strokeDasharray={`${c * pct} ${c}`}
            style={{ transition: 'stroke-dasharray 1200ms ease' }}
          />
          <defs>
            <linearGradient id="vit-grad" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stopColor="#9dbd62" />
              <stop offset="1" stopColor="#f2cf7c" />
            </linearGradient>
          </defs>
        </svg>
        <div className="grove-num absolute inset-0 flex items-center justify-center text-[11px] font-bold text-parchment">
          {Math.round(pct * 100)}
        </div>
      </div>
    </div>
  );
};

/**
 * Heading strip: ticks and cardinal points slide with the view (±90°), the
 * Lumina marker shows where the next hollow lies. Heading updates arrive from
 * the throttled player subscription and are written straight to the DOM.
 */
const STRIP_HALF_FOV = Math.PI / 2;
const CARDINALS: Array<[string, number]> = [
  ['N', 0], ['NE', Math.PI / 4], ['E', Math.PI / 2], ['SE', (3 * Math.PI) / 4],
  ['S', Math.PI], ['SW', -(3 * Math.PI) / 4], ['W', -Math.PI / 2], ['NW', -Math.PI / 4],
];

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

const LuminaCompass: React.FC = () => {
  const compass = useGroveStore((s) => s.compass);
  const markerRef = useRef<HTMLDivElement>(null);
  const cardinalRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const compassRef = useRef(compass);
  compassRef.current = compass;

  useLayoutEffect(() => {
    const place = (el: HTMLElement | null, bearing: number, clampEdge: boolean) => {
      if (!el) return;
      // playerState.rotation is counter-clockwise; bearings are clockwise.
      const rel = wrapAngle(bearing + playerState.rotation);
      const out = Math.abs(rel) > STRIP_HALF_FOV;
      const clamped = Math.max(-STRIP_HALF_FOV, Math.min(STRIP_HALF_FOV, rel));
      el.style.left = `${50 + (clamped / STRIP_HALF_FOV) * 50}%`;
      if (clampEdge) {
        el.style.opacity = out ? '0.5' : '1';
      } else {
        // Fade ticks towards the strip ends.
        el.style.opacity = out ? '0' : String(1 - Math.pow(Math.abs(rel) / STRIP_HALF_FOV, 2));
      }
    };
    const update = () => {
      CARDINALS.forEach(([, b], i) => place(cardinalRefs.current[i], b, false));
      const target = compassRef.current;
      if (target) place(markerRef.current, target.bearing, true);
    };
    update();
    return subscribeThrottled(update);
  }, [compass]);

  const label = compass ? (compass.kind === 'hollow' ? 'Root Hollow' : 'Sacred Grove') : '';
  const dist = compass
    ? (compass.distance < 1000 ? `${Math.round(compass.distance)} m` : `${(compass.distance / 1000).toFixed(1)} km`)
    : '';

  return (
    <div className="flex flex-col items-center grove-text-shadow">
      <div className="relative h-8 w-[380px]">
        <div
          className="absolute inset-x-0 top-1/2 h-px"
          style={{ background: 'linear-gradient(90deg, transparent, rgba(215,220,182,0.45) 20%, rgba(215,220,182,0.45) 80%, transparent)' }}
        />
        <div className="absolute left-1/2 top-[6px] h-[18px] w-px -translate-x-1/2 bg-parchment/70" />
        {CARDINALS.map(([name], i) => (
          <span
            key={name}
            ref={(el) => { cardinalRefs.current[i] = el; }}
            className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 font-display leading-none ${name.length === 1 ? 'text-[15px] font-bold text-parchment' : 'text-[11px] text-lichen/60'}`}
            style={{ paddingBottom: 1, textShadow: '0 0 6px rgba(0,0,0,0.9), 0 0 2px rgba(0,0,0,0.9)' }}
          >
            {name}
          </span>
        ))}
        {compass && (
          <div ref={markerRef} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 transition-[left] duration-100">
            <div className="lumina-marker h-3.5 w-3.5" />
          </div>
        )}
      </div>
      <div className="mt-0.5 text-[11px] font-medium tracking-[0.2em] text-lumina uppercase">
        {compass ? <>Lumina Sense · {label} · <span className="grove-num tracking-normal">{dist}</span></> : <span className="text-lichen/55">The Lumina is silent here</span>}
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

  // A short musical motif marks the moment (AudioManager handles vc-music-cue).
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('vc-music-cue', { detail: { kind: toast.notice.kind } }));
  }, [toast.id, toast.notice.kind]);

  const n = toast.notice;
  let eyebrow = '';
  let title = '';
  let detail: React.ReactNode = '';
  let tone = '#9dbd62';
  switch (n.kind) {
    case 'quest-complete':
      eyebrow = 'Path complete'; title = n.title; detail = `+${n.essence} essence`; tone = '#b5d178';
      break;
    case 'quest-start':
      eyebrow = 'A new path'; title = n.title; detail = renderHint(n.hint); tone = '#a4f2e4';
      break;
    case 'rank-up':
      eyebrow = 'You are now'; title = n.title; detail = `Keeper's Stride +${Math.round(STRIDE_PER_RANK * 100)}% · The Grove remembers your name`; tone = '#f2cf7c';
      break;
    case 'discovery':
      eyebrow = n.detail; title = n.title; detail = ''; tone = '#d7dcb6';
      break;
  }

  return (
    <div className="grove-toast grove-veil grove-text-shadow flex min-w-[300px] max-w-[460px] flex-col items-center px-6 text-center">
      <div className="grove-eyebrow" style={{ color: tone }}>{eyebrow}</div>
      <div className="mt-0.5 font-display text-[30px] font-semibold leading-tight text-parchment">{title}</div>
      <VineRule className="my-1 opacity-90" width={150} />
      {detail && <div className="text-[14px] font-medium text-parchment/90">{detail}</div>}
    </div>
  );
};

const ToastStack: React.FC = () => {
  const toasts = useGroveStore((s) => s.toasts);
  // Held while the pause/begin screen is up (it has its own centred title);
  // the queue plays once the player is in the world, since a toast's timer
  // starts when it mounts.
  const paused = useHudPresence((s) => !!s.holds.paused);
  if (paused) return null;
  // One at a time, in order: a burst (quest done, rank up, new quest) plays as
  // a short sequence instead of stacking mid-screen. Each dismisses itself.
  const shown = toasts.slice(0, 1);
  return (
    <div className="absolute left-1/2 top-[18%] flex -translate-x-1/2 flex-col items-center gap-7">
      {shown.map((t) => <ToastItem key={t.id} toast={t} />)}
    </div>
  );
};

const CONTROL_ROWS: Array<[string[], string]> = [
  [['W', 'A', 'S', 'D'], 'Walk'],
  [['Space'], 'Jump · double-tap to fly'],
  [['Z'], 'Crouch'],
  [['Shift'], 'Descend when flying or swimming'],
  [['Left click'], 'Dig · chop · strike'],
  [['Right click'], 'Place · throw · use'],
  [['Q'], 'Gather what you look at'],
  [['C'], 'Craft (with a stick selected)'],
  [['1–9'], 'Choose item (or scroll)'],
  [['Esc'], 'Pause'],
];

const ControlsHelp: React.FC = () => {
  const [open, setOpen] = useState(true);
  const hold = useHudPresence((s) => s.hold);
  useEffect(() => hold('controls', open), [open, hold]);
  useEffect(() => () => hold('controls', false), [hold]);

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
    return (
      <div className="grove-text-shadow text-[12px] text-lichen/60">
        <span className="grove-key">H</span> controls
      </div>
    );
  }

  return (
    <div className="grove-text-shadow text-[12.5px]">
      <div className="grove-eyebrow mb-1.5 text-right">Controls</div>
      {CONTROL_ROWS.map(([keys, action]) => (
        <div key={action} className="flex items-center justify-end gap-3 leading-[25px]">
          <span className="text-right font-medium text-parchment">{action}</span>
          <span className="min-w-[88px] whitespace-nowrap text-right">{keys.map((k) => <span key={k} className="grove-key">{k}</span>)}</span>
        </div>
      ))}
      <div className="mt-1.5 text-right text-[11px] text-lichen/75"><span className="grove-key">H</span> to hide</div>
    </div>
  );
};

export const GroveHUD: React.FC<{ showControls?: boolean }> = ({ showControls = true }) => {
  const awake = useHudPresence((s) => s.awake);
  return (
    <>
      <div className="absolute left-7 top-6" style={presenceStyle(awake, 0)}>
        <QuestTracker />
      </div>
      <div className="absolute left-1/2 top-3 -translate-x-1/2" style={presenceStyle(awake, 0.5)}>
        <LuminaCompass />
      </div>
      <ToastStack />
      {showControls && (
        <div className="absolute bottom-6 right-6 max-w-[320px]" style={presenceStyle(awake, 0)}>
          <ControlsHelp />
        </div>
      )}
    </>
  );
};
