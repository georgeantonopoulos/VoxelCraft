import React, { useEffect } from 'react';
import { useSketchbookStore } from '@/state/SketchbookStore';
import { isPointerCaptured } from '@core/input/pointerCapture';
import { useSettingsStore } from '@/state/SettingsStore';
import benchImg from '@/assets/sketches/bench.webp';
import piecesImg from '@/assets/sketches/pieces.webp';
import cornerImg from '@/assets/sketches/corner.webp';
import doorwayImg from '@/assets/sketches/doorway.webp';
import postsImg from '@/assets/sketches/posts.webp';
import roofImg from '@/assets/sketches/roof.webp';
import doorImg from '@/assets/sketches/door.webp';

/**
 * The Keeper's building sketches: an old, worn sheaf of ink drawings on how
 * wood goes together. The drawings are ink-and-wash illustrations generated
 * from screenshots of the real pieces (captured with the test harness), so
 * they match what the player builds; the last page is an SVG diagram. Not a blueprint: each page shows one way pieces join
 * (a bench, a notched corner, a doorway, posts on a slope, a roof, a door,
 * what holds and what falls), so players can build whatever stands.
 * J opens it (or the pause screen's button); arrows or A/D turn pages.
 */

// --- Drawing helpers: an isometric ink sketch ---------------------------------

const INK = '#3a2a1b';
const INK_SOFT = 'rgba(58, 42, 27, 0.55)';
const WASH = 'rgba(120, 84, 48, 0.10)';
const WASH_DARK = 'rgba(80, 56, 32, 0.18)';

interface View { ox: number; oy: number; s: number }
type V3 = [number, number, number];

const iso = (v: View, [x, y, z]: V3): [number, number] => [v.ox + (x - z) * 0.866 * v.s, v.oy + (x + z) * 0.5 * v.s - y * v.s];

/** A log from a to b (world metres), radius r: body, and a ringed end facing us. */
const Log: React.FC<{ v: View; a: V3; b: V3; r: number; notch?: 'a' | 'b' | 'both'; endAt?: 'a' | 'b' }> = ({ v, a, b, r, notch, endAt = 'b' }) => {
  const A = iso(v, a), B = iso(v, b);
  const dx = B[0] - A[0], dy = B[1] - A[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const R = r * v.s;
  const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
  const E = endAt === 'b' ? B : A;
  const body = `M${A[0] + nx * R},${A[1] + ny * R} L${B[0] + nx * R},${B[1] + ny * R} L${B[0] - nx * R},${B[1] - ny * R} L${A[0] - nx * R},${A[1] - ny * R} Z`;
  // Bark streaks along the log.
  const streaks = [0.45, -0.1, -0.55].map((k, i) => (
    <path key={i} d={`M${A[0] + nx * R * k + dx * 0.08},${A[1] + ny * R * k + dy * 0.08} L${A[0] + nx * R * k + dx * (0.55 + i * 0.12)},${A[1] + ny * R * k + dy * (0.55 + i * 0.12)}`} stroke={INK_SOFT} strokeWidth={0.8} />
  ));
  // A saddle scoop on the top edge near an end.
  const scoop = (t: number) => {
    const px = A[0] + dx * t, py = A[1] + dy * t;
    const ex = px - nx * R, ey = py - ny * R; // top edge (screen "up" side is -n when drawing left to right)
    const w = R * 1.1;
    return <path key={t} d={`M${ex - (dx / len) * w},${ey - (dy / len) * w} Q${ex + nx * R * 0.9},${ey + ny * R * 0.9} ${ex + (dx / len) * w},${ey + (dy / len) * w}`} fill={WASH_DARK} stroke={INK} strokeWidth={1.1} />;
  };
  const inset = (r + 0.05) / Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  return (
    <g>
      <path d={body} fill="#e9dcbd" stroke={INK} strokeWidth={1.3} strokeLinejoin="round" />
      <path d={body} fill={WASH} stroke="none" />
      {streaks}
      {(notch === 'a' || notch === 'both') && scoop(inset)}
      {(notch === 'b' || notch === 'both') && scoop(1 - inset)}
      <ellipse cx={E[0]} cy={E[1]} rx={R * 0.55} ry={R} transform={`rotate(${ang} ${E[0]} ${E[1]})`} fill="#efe3c6" stroke={INK} strokeWidth={1.2} />
      <ellipse cx={E[0]} cy={E[1]} rx={R * 0.3} ry={R * 0.55} transform={`rotate(${ang} ${E[0]} ${E[1]})`} fill="none" stroke={INK_SOFT} strokeWidth={0.7} />
      <ellipse cx={E[0]} cy={E[1]} rx={R * 0.1} ry={R * 0.2} transform={`rotate(${ang} ${E[0]} ${E[1]})`} fill="none" stroke={INK_SOFT} strokeWidth={0.6} />
    </g>
  );
};

/** An axis-aligned box (a board, a post): centre c, size [x, y, z] in metres. */
const Box: React.FC<{ v: View; c: V3; size: V3; shade?: string }> = ({ v, c, size, shade = '#eadfc4' }) => {
  const [hx, hy, hz] = size.map((n) => n / 2);
  const P = (x: number, y: number, z: number) => iso(v, [c[0] + x, c[1] + y, c[2] + z]).join(',');
  const top = `${P(-hx, hy, -hz)} ${P(hx, hy, -hz)} ${P(hx, hy, hz)} ${P(-hx, hy, hz)}`;
  const right = `${P(hx, hy, -hz)} ${P(hx, hy, hz)} ${P(hx, -hy, hz)} ${P(hx, -hy, -hz)}`;
  const front = `${P(-hx, hy, hz)} ${P(hx, hy, hz)} ${P(hx, -hy, hz)} ${P(-hx, -hy, hz)}`;
  return (
    <g stroke={INK} strokeWidth={1.2} strokeLinejoin="round">
      <polygon points={front} fill={shade} />
      <polygon points={front} fill={WASH_DARK} stroke="none" />
      <polygon points={right} fill={shade} />
      <polygon points={right} fill={WASH} stroke="none" />
      <polygon points={top} fill={shade} />
    </g>
  );
};

const Label: React.FC<{ x: number; y: number; children: React.ReactNode; anchor?: 'start' | 'middle' | 'end' }> = ({ x, y, children, anchor = 'start' }) => (
  <text x={x} y={y} textAnchor={anchor} fontSize={12} fontStyle="italic" fill={INK} fontFamily="Cormorant Garamond, serif">{children}</text>
);

const Tick: React.FC<{ x: number; y: number; ok: boolean }> = ({ x, y, ok }) => (ok
  ? <path d={`M${x - 7},${y} L${x - 2},${y + 6} L${x + 8},${y - 7}`} fill="none" stroke="#3f5a2a" strokeWidth={2} strokeLinecap="round" />
  : <path d={`M${x - 6},${y - 6} L${x + 6},${y + 6} M${x + 6},${y - 6} L${x - 6},${y + 6}`} fill="none" stroke="#8a3322" strokeWidth={2} strokeLinecap="round" />);

// --- The pages -------------------------------------------------------------

/**
 * A page: its drawing is either an ink-and-wash illustration (generated from
 * screenshots of the real pieces, in src/assets/sketches) or an SVG sketch.
 */
interface Page { title: string; image?: string; drawing?: React.ReactNode; notes: React.ReactNode[] }

const K: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="mx-0.5 inline-block rounded-[3px] border border-[#3a2a1b]/40 px-1 font-body text-[12px] not-italic leading-tight">{children}</span>
);

const PAGES: Page[] = [
  {
    title: 'A bench to work on',
    image: benchImg,
    notes: [
      <>Stand a plank up: lift it with <K>Q</K>, press <K>R</K> until it says <em>standing</em>, set it down with a right click. Saw a long plank in half first for shorter legs.</>,
      <>Set a second one beside it. It steps into place, faces the first, and both sink to a working height.</>,
      <>Lay any plank across the two. (Two short logs lying side by side work as sawhorses too.)</>,
    ],
  },
  {
    title: 'What the bench makes',
    image: piecesImg,
    notes: [
      <>Carry a log or plank to the bench and set it on the top: the carpentry opens.</>,
      <>An <em>axe</em> hews, notches and splits: wall logs, planks, roof boards, posts. A <em>saw</em> cuts lengths, and halves a loose log or plank anywhere.</>,
      <>Notch <em>both ends</em> for wall logs, <em>one end</em> for the logs that meet a doorway.</>,
    ],
  },
  {
    title: 'Notched corners',
    image: cornerImg,
    notes: [
      <>Lay the first log. Aim near the end of a log to <em>turn the corner</em>: the new one crosses it and drops half a log into the notches.</>,
      <>Aim along the middle of a log to lay the <em>next course</em> on it. Two walls go up level, the other two half a log offset.</>,
      <>Near a build every log turns square to it, so four walls close into a room.</>,
    ],
  },
  {
    title: 'Leaving a doorway',
    image: doorwayImg,
    notes: [
      <>Cut halves or thirds <em>notched one end</em>. Start them from a corner (aim near the corner end); their free end is the doorpost.</>,
      <>Above the doorway, a <em>whole log</em> laid along the wall bridges the gap, held at both corners.</>,
      <>A gap of a little under a metre fits a door.</>,
    ],
  },
  {
    title: 'On a slope, posts first',
    image: postsImg,
    notes: [
      <>Stand short posts (cut at the bench, or sawn) at the corners: each snaps a wall-log apart, square to the others, and all level themselves.</>,
      <>Lay a notched log on a post: it reaches across to the post opposite. Then the opposite side.</>,
      <>The other two logs cross them half a log higher, locking the corners. Build the walls up from there.</>,
    ],
  },
  {
    title: 'A roof that sheds rain',
    image: roofImg,
    notes: [
      <>Split roof boards at the bench. Carry one and aim at the <em>top log of a wall</em>: it leans from the eave up to meet the opposite wall.</>,
      <>Go along the wall board by board (aim at the last board's side), then the other side. The two meet at the ridge.</>,
      <>Under a roof, a fire keeps burning in the rain.</>,
    ],
  },
  {
    title: 'Hinges and a door',
    image: doorImg,
    notes: [
      <>Copper lies in thin veins well down in the rock. Dig: green flecks in the chips mean a vein is close.</>,
      <>At the bench, a plank and two copper nuggets make a pair of hinges; a long log and the hinges make a door.</>,
      <>Stand the door beside a doorway log: it hangs from it. Right click swings it.</>,
    ],
  },
  {
    title: 'What holds, what falls',
    drawing: (() => {
      const a: View = { ox: 80, oy: 150, s: 34 };
      const b: View = { ox: 215, oy: 150, s: 34 };
      const c: View = { ox: 350, oy: 150, s: 34 };
      return (
        <g>
          <Box v={a} c={[-1.2, 0.45, 0]} size={[0.25, 0.9, 0.25]} />
          <Box v={a} c={[1.2, 0.45, 0]} size={[0.25, 0.9, 0.25]} />
          <Log v={a} a={[-1.5, 1.1, 0]} b={[1.5, 1.1, 0]} r={0.2} />
          <Tick x={80} y={185} ok />
          <Box v={b} c={[-1.2, 0.45, 0]} size={[0.25, 0.9, 0.25]} />
          <Log v={b} a={[-1.5, 1.1, 0]} b={[1.5, 1.1, 0]} r={0.2} />
          <path d={`M${iso(b, [1.5, 1.3, 0])[0]},${iso(b, [1.5, 1.3, 0])[1]} q18,10 10,34`} stroke="#8a3322" strokeWidth={1.2} fill="none" markerEnd="url(#sk-arrow)" />
          <Tick x={215} y={185} ok={false} />
          <Log v={c} a={[-0.7, 0.2, 0]} b={[0.7, 0.2, 0]} r={0.2} />
          <Log v={c} a={[-0.7, 0.6, 0]} b={[2.3, 0.6, 0]} r={0.2} />
          <Tick x={350} y={185} ok={false} />
          <Label x={80} y={215} anchor="middle">held both ends</Label>
          <Label x={215} y={215} anchor="middle">held at one end</Label>
          <Label x={350} y={215} anchor="middle">hangs past its end</Label>
        </g>
      );
    })(),
    notes: [
      <>A lying piece needs something under its middle, or under both ends. An upright one needs its foot on something.</>,
      <>An <span style={{ color: '#a45a1f' }}>orange</span> shadow when you aim means nothing would hold it: set it there and it falls.</>,
      <>Take a log out of a wall and whatever it held comes down with it.</>,
    ],
  },
];

// --- The book ----------------------------------------------------------------

const PAPER_NOISE = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.35 0 0 0 0 0.25 0 0 0 0 0.12 0 0 0 0.22 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;

export const Sketchbook: React.FC = () => {
  const open = useSketchbookStore((s) => s.open);
  const page = useSketchbookStore((s) => s.page);
  const setOpen = useSketchbookStore((s) => s.setOpen);
  const setPage = useSketchbookStore((s) => s.setPage);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const st = useSketchbookStore.getState();
      if (e.code === 'KeyJ') {
        if (st.open) { st.setOpen(false); return; }
        if (!isPointerCaptured() || useSettingsStore.getState().isSettingsOpen) return;
        document.exitPointerLock?.();
        st.setOpen(true);
        return;
      }
      if (!st.open) return;
      if (e.code === 'Escape') st.setOpen(false);
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') st.setPage(Math.min(PAGES.length - 1, st.page + 1));
      else if (e.code === 'ArrowLeft' || e.code === 'KeyA') st.setPage(Math.max(0, st.page - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!open) return null;
  const p = PAGES[page];
  return (
    <div className="absolute inset-0 z-[56] flex items-center justify-center p-4" style={{ background: 'radial-gradient(ellipse at center, rgba(7,11,10,0.55), rgba(7,11,10,0.88))' }}
      onClick={() => setOpen(false)}>
      <div
        className="relative w-full max-w-[640px] overflow-hidden rounded-[3px] px-7 pb-6 pt-5 text-[#3a2a1b] sm:px-10"
        style={{
          transform: 'rotate(-0.6deg)',
          background: `${PAPER_NOISE}, radial-gradient(circle at 82% 18%, rgba(120,80,40,0.18) 0 7%, transparent 7.5% 100%), radial-gradient(circle at 12% 88%, rgba(110,70,35,0.12) 0 11%, transparent 12%), radial-gradient(ellipse at center, #efe4c8 0%, #e3d3ad 70%, #c9b385 100%)`,
          boxShadow: 'inset 0 0 60px rgba(90,60,30,0.45), inset 0 0 6px rgba(60,40,20,0.5), 0 18px 60px rgba(0,0,0,0.6)',
          clipPath: 'polygon(0% 1%, 3% 0%, 18% 0.6%, 40% 0%, 63% 0.8%, 86% 0%, 100% 1.2%, 99.4% 22%, 100% 48%, 99.3% 77%, 100% 99%, 81% 100%, 57% 99.3%, 30% 100%, 8% 99.4%, 0% 100%, 0.6% 70%, 0% 41%, 0.7% 17%)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* The old fold across the middle. */}
        <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(80,55,30,0.35), rgba(255,250,235,0.4), rgba(80,55,30,0.3), transparent)' }} />
        <div className="flex items-baseline justify-between">
          <div className="font-display text-[13px] italic tracking-wide opacity-70">Sketches for building · {page + 1} of {PAGES.length}</div>
          <button className="font-display text-[13px] italic opacity-70 hover:opacity-100" onClick={() => setOpen(false)}>close <K>J</K></button>
        </div>
        <h2 className="mt-1 font-display text-[30px] font-semibold italic leading-tight">{p.title}</h2>
        {p.image ? (
          <img
            src={p.image}
            alt=""
            className="mx-auto mt-1 block h-auto max-h-[46vh] w-auto max-w-full select-none"
            draggable={false}
            // Multiply lays the ink and wash into this page's paper; the soft
            // mask fades the drawing's own paper edge away.
            style={{
              mixBlendMode: 'multiply', filter: 'sepia(0.1)',
              WebkitMaskImage: 'radial-gradient(ellipse 75% 75% at 50% 50%, #000 70%, transparent 100%)',
              maskImage: 'radial-gradient(ellipse 75% 75% at 50% 50%, #000 70%, transparent 100%)',
            }}
          />
        ) : (
        <svg viewBox="0 0 440 250" className="mt-1 w-full" aria-hidden="true">
          <defs>
            <filter id="sk-ink">
              <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves={2} seed={4} />
              <feDisplacementMap in="SourceGraphic" scale={2.4} />
            </filter>
            <marker id="sk-arrow" viewBox="0 0 10 10" refX={8} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse">
              <path d="M0,1 L9,5 L0,9" fill="none" stroke={INK} strokeWidth={1.4} />
            </marker>
          </defs>
          <g filter="url(#sk-ink)" opacity={0.92}>{p.drawing}</g>
        </svg>
        )}
        <ol className="mt-2 space-y-1.5 font-display text-[16.5px] italic leading-snug">
          {p.notes.map((n, i) => (
            <li key={i} className="flex gap-2.5">
              <span className="mt-[1px] flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full border border-[#3a2a1b]/60 text-[12px] not-italic">{i + 1}</span>
              <span>{n}</span>
            </li>
          ))}
        </ol>
        <div className="mt-4 flex items-center justify-between font-display text-[15px] italic">
          <button disabled={page === 0} className="opacity-80 hover:opacity-100 disabled:opacity-25" onClick={() => setPage(page - 1)}>‹ back</button>
          <div className="flex gap-1.5">
            {PAGES.map((_, i) => (
              <button key={i} aria-label={`Page ${i + 1}`} onClick={() => setPage(i)} className="h-2 w-2 rounded-full border border-[#3a2a1b]/60" style={{ background: i === page ? '#3a2a1b' : 'transparent' }} />
            ))}
          </div>
          <button disabled={page === PAGES.length - 1} className="opacity-80 hover:opacity-100 disabled:opacity-25" onClick={() => setPage(page + 1)}>next ›</button>
        </div>
      </div>
    </div>
  );
};
