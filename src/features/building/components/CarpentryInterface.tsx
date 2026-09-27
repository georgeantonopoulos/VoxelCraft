import React, { useEffect, useMemo, useState, useCallback } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment, ContactShadows } from '@react-three/drei';
import { useCarpentryStore } from '@/state/CarpentryStore';
import { useLogStore, type LogData, type NotchFormation } from '@/state/LogStore';
import { useMaterialsStore } from '@/state/MaterialsStore';
import { useInventoryStore } from '@/state/InventoryStore';
import { getToolCapabilities } from '@features/interaction/logic/ToolCapabilities';
import type { CustomTool } from '@/types';
import { emitImpact } from '@features/interaction/components/ImpactFX';
import { cutsFor, missingFor, applyCut, needsSawFor, type Cut, type CutId, type CarpentryTools, type PieceTemplate } from '../logic/carpentry';
import { workpieceOn } from '../logic/benches';
import { frameOf, lyingQuat } from '../logic/pieceFrame';
import { PieceMesh } from './PieceMeshes';
import { pieceName } from '../buildModeStore';

/**
 * The carpentry menu: opens when a log or plank is set on a workbench
 * (BuildPreview sends vc-carpentry-open), or on right click at a bench with
 * a piece on it. Choose a cut, its notches and lengths; the preview shows
 * what comes off the bench. Cutting replaces the workpiece with the new
 * pieces, left lying on the bench to be carried away (Q).
 */

const common = { fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, stroke: '#d8bb8a', strokeWidth: 1.5 };

const CutGlyph: React.FC<{ id: CutId }> = ({ id }) => {
  let body: React.ReactNode;
  switch (id) {
    case 'wall': body = (<g {...common}><path d="M4 12 H28 M4 20 H28" /><path d="M8 12 C8 15,11 15,11 12 M21 20 C21 17,24 17,24 20" /></g>); break;
    case 'post': body = (<g {...common}><path d="M12 28 V8 H20 V28 Z" /><path d="M14 8 V5 H18 V8" /></g>); break;
    case 'tall': body = (<g {...common}><path d="M7 5 V27 M13 5 V27 M19 5 V27 M25 5 V27" /></g>); break;
    case 'short': body = (<g {...common}><path d="M7 7 V15 M13 7 V15 M19 7 V15 M7 18 V26 M13 18 V26 M19 18 V26" /></g>); break;
    case 'roof': body = (<g {...common}><path d="M4 24 L16 8 L28 24" /><path d="M8 24 L17 12" opacity={0.6} /></g>); break;
    case 'door': body = (<g {...common}><path d="M9 28 V5 H23 V28" /><path d="M9 11 H14 M9 22 H14" stroke="#c47a45" /><circle cx="20" cy="17" r="1" /></g>); break;
    case 'hinges': body = (<g {...common}><path d="M6 12 H22 M6 20 H22" stroke="#c47a45" /><circle cx="24" cy="12" r="2" /><circle cx="24" cy="20" r="2" /></g>); break;
    case 'cut': body = (<g {...common}><path d="M4 16 H28" /><path d="M16 8 V24" strokeDasharray="2 2" /></g>); break;
    case 'apart': body = (<g {...common}><path d="M8 6 V26 M16 6 V26 M24 6 V26" /><path d="M5 16 H27" opacity={0.4} /></g>); break;
  }
  return <svg viewBox="0 0 32 32" className="h-7 w-7 shrink-0" aria-hidden="true">{body}</svg>;
};

const describe = (p: Pick<LogData, 'kind' | 'length' | 'radius' | 'notches'>): string => {
  const size = p.kind === 'door' ? `${p.length.toFixed(2)} m tall` : `${p.length.toFixed(1)} m`;
  return `${pieceName(p.kind, p.notches)}, ${size}`;
};

/** Pieces laid out for the preview: lying across the view, one above another (a door stands). */
const PreviewPieces: React.FC<{ pieces: PieceTemplate[] }> = ({ pieces }) => {
  const shown = pieces.slice(0, 8);
  const gap = (p: PieceTemplate) => (p.kind === 'plank' || p.kind === 'roof' ? 0.1 : p.radius * 2 + 0.08);
  const total = shown.reduce((h, p) => h + gap(p), 0);
  let y = total / 2;
  // Long pieces are scaled down to fit the frame (a 3 m log is wider than the view).
  const longest = shown.reduce((m, p) => Math.max(m, p.kind === 'door' ? p.length * 1.3 : p.length), 0);
  const fit = Math.min(1, 2.5 / Math.max(longest, total * 1.4, 0.1));
  return (
    <group rotation={[0.3, 0, 0]} scale={fit}>
      {shown.map((p, i) => {
        const h = gap(p);
        y -= h;
        if (p.kind === 'door') return <group key={i}><PieceMesh piece={p} seed={i + 1} /></group>;
        return (
          // Boards lie face up, tilted toward the viewer so their faces show.
          <group key={i} position={[0, y + h / 2, 0]} rotation={[p.kind === 'plank' || p.kind === 'roof' ? -1.1 : 0, 0, Math.PI / 2]}>
            <PieceMesh piece={p} seed={i + 1} />
          </group>
        );
      })}
    </group>
  );
};

const ownedTools = (customTools: Record<string, CustomTool>): CarpentryTools => {
  let saw = false, axe = false;
  for (const t of Object.values(customTools)) {
    const c = getToolCapabilities(t);
    saw ||= c.canSaw;
    axe ||= c.canChop;
  }
  return { saw, axe };
};

export const CarpentryInterface: React.FC = () => {
  const benchId = useCarpentryStore((s) => s.benchId);
  const close = useCarpentryStore((s) => s.close);
  const logs = useLogStore((s) => s.logs);
  const copper = useMaterialsStore((s) => s.copper);
  const hinges = useMaterialsStore((s) => s.hinges);
  const piece = benchId ? workpieceOn(benchId, Object.values(logs)) : undefined;
  const cuts = useMemo(() => (piece ? cutsFor(piece) : []), [piece]);
  const [cutId, setCutId] = useState<CutId | null>(null);
  const [formation, setFormation] = useState<NotchFormation>('both');
  const [pieces, setPieces] = useState(1);
  const customTools = useInventoryStore((s) => s.customTools);
  const tools = useMemo(() => ownedTools(customTools), [customTools]);

  // Opened by placing a piece on a bench.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent<{ benchId: string }>).detail?.benchId;
      if (!id) return;
      document.exitPointerLock?.();
      useCarpentryStore.getState().open(id);
    };
    window.addEventListener('vc-carpentry-open', onOpen);
    return () => window.removeEventListener('vc-carpentry-open', onOpen);
  }, []);

  // A fresh workpiece starts on its first cut.
  useEffect(() => {
    setCutId(cuts[0]?.id ?? null);
    setFormation('both');
    setPieces(1);
  }, [piece?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Nothing left on the bench (cut, or lifted off): close.
  useEffect(() => { if (benchId && !piece) close(); }, [benchId, piece, close]);

  useEffect(() => {
    if (!benchId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key.toLowerCase() === 'c') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [benchId, close]);

  const cut: Cut | undefined = cuts.find((c) => c.id === cutId) ?? cuts[0];
  const opts = { formation: cut?.formations ? formation : undefined, pieces: cut?.lengths ? pieces : undefined };
  // A lengths choice made for another cut may not exist on this one.
  const validPieces = cut?.lengths?.some((l) => Number(l.id) === pieces) ?? true;
  const effOpts = validPieces ? opts : { ...opts, pieces: Number(cut?.lengths?.[0]?.id ?? 1) };
  const missing = cut && piece ? missingFor(cut, piece, tools, { copper, hinges }, effOpts) : null;
  const result = cut && piece ? applyCut(piece, cut, effOpts) : null;

  const doCut = useCallback(() => {
    if (!cut || !piece || !result || missing || !benchId) return;
    const store = useLogStore.getState();
    const top = store.logs[benchId];
    if (!top) return;
    const f = frameOf(top);
    const along = f.axis.clone().setY(0).normalize();
    const across = f.width.clone().setY(0).normalize();
    const rot = lyingQuat(along);
    const base = new THREE.Vector3(...piece.position);
    const now = Date.now();
    const made: LogData[] = result.pieces.map((t, i) => {
      const row = i % 3, layer = Math.floor(i / 3);
      const p = base.clone()
        .addScaledVector(across, (row - 1) * Math.min(0.2, top.radius * 0.7))
        .addScaledVector(new THREE.Vector3(0, 1, 0), 0.12 + layer * 0.14);
      return {
        ...t,
        id: `pc_${now}_${i}`,
        position: [p.x, p.y, p.z],
        rotation: [rot.x, rot.y, rot.z, rot.w],
        state: 'loose',
      };
    });
    store.removeLog(piece.id);
    if (made.length) store.addLogs(made);
    const mats = useMaterialsStore.getState();
    for (const [k, v] of Object.entries(result.materials) as [keyof typeof result.materials, number][]) {
      if (v < 0) mats.spend(k, -v); else if (v > 0) mats.add(k, v);
    }
    const sawn = needsSawFor(cut, effOpts);
    window.dispatchEvent(new CustomEvent('vc-audio-woodwork', { detail: { kind: sawn ? 'sawDone' : 'splitDone' } }));
    emitImpact({ position: base.clone().add(new THREE.Vector3(0, 0.1, 0)), direction: new THREE.Vector3(0, 1, 0), kind: 'wood', color: '#d8bb8a', strength: 1.4, floorY: base.y - 0.9 });
    close();
  }, [cut, piece, result, missing, benchId, effOpts, close]);

  const takeBack = () => {
    if (!piece) return;
    if (!useLogStore.getState().pickUp(piece.id)) {
      window.dispatchEvent(new CustomEvent('vc-hud-note', { detail: { text: 'Your arms are full · set the load down first' } }));
      return;
    }
    close();
  };

  if (!benchId || !piece || !cut) return null;

  const need = cut.needs;
  const needRow = (label: string, ok: boolean, detail?: string) => (
    <div className="flex items-baseline gap-3 text-[14px]">
      <span className="h-1.5 w-1.5 translate-y-[-1px] rotate-45 rounded-[1px]" style={{ background: ok ? '#9dbd62' : '#b4745f' }} />
      <span className={ok ? 'text-parchment/90' : 'text-[#e0a58f]'}>{label}</span>
      {detail && <span className="grove-num ml-auto text-lichen/70">{detail}</span>}
    </div>
  );
  const counts = new Map<string, number>();
  for (const p of result?.pieces ?? []) counts.set(describe(p), (counts.get(describe(p)) ?? 0) + 1);

  return (
    <div className="absolute inset-0 z-[55] pointer-events-none">
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 60% 60% at 50% 50%, rgba(7,11,10,0.4), rgba(7,11,10,0.85))', backdropFilter: 'blur(3px)' }} />

      <div className="absolute top-10 left-0 right-0 text-center">
        <div className="grove-eyebrow">The workbench</div>
        <h2 className="grove-text-shadow mt-1 font-display text-[42px] font-semibold leading-none text-parchment">Shape the {pieceName(piece.kind, piece.notches)}</h2>
        <p className="mt-2 font-display text-[17px] italic text-lichen/70">{describe(piece)} · choose what comes off the bench</p>
      </div>

      <div className="absolute inset-0 pointer-events-auto">
        <Canvas camera={{ position: [0, 0.9, 4.6], fov: 40 }}>
          <OrbitControls enablePan={false} minDistance={1.6} maxDistance={7} makeDefault autoRotate autoRotateSpeed={0.25} />
          <Environment preset="forest" environmentIntensity={0.55} />
          <ambientLight intensity={0.2} />
          <pointLight position={[3, 6, 4]} intensity={0.9} />
          <pointLight position={[-4, 3, -3]} intensity={0.5} color="#f2cf7c" />
          <PreviewPieces pieces={result?.pieces.length ? result.pieces : [piece]} />
          <ContactShadows position={[0, -1.1, 0]} opacity={0.5} scale={6} blur={2.4} far={2.5} />
        </Canvas>
      </div>

      {/* Cuts */}
      <div className="grove-panel absolute left-8 top-1/2 w-[270px] -translate-y-1/2 px-3 py-3 pointer-events-auto">
        <div className="grove-eyebrow mb-2 px-2">Cuts</div>
        <div className="flex flex-col gap-1">
          {cuts.map((c) => {
            const why = missingFor(c, piece, tools, { copper, hinges }, { formation, pieces: c.lengths ? Number(c.lengths[0]?.id ?? 1) : undefined });
            return (
              <button
                key={c.id}
                onClick={() => setCutId(c.id)}
                data-on={c.id === cut.id}
                className="grove-choice flex items-center gap-3 rounded-lg px-3 py-2 text-left"
                style={why && c.id !== cut.id ? { opacity: 0.55 } : undefined}
              >
                <CutGlyph id={c.id} />
                <span className="font-display text-[17px] font-semibold leading-tight">{c.title}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Details */}
      <div className="grove-panel absolute right-8 top-1/2 w-[320px] -translate-y-1/2 px-5 py-4 pointer-events-auto">
        <p className="font-display text-[24px] font-semibold leading-tight text-parchment">{cut.title}</p>
        <p className="mt-1 text-[14px] leading-snug text-lichen/80">{cut.blurb}</p>

        {cut.formations && (
          <div className="mt-4">
            <div className="grove-eyebrow mb-1.5">Notches</div>
            <div className="grid grid-cols-3 gap-1.5">
              {cut.formations.map((f) => (
                <button key={f.id} onClick={() => setFormation(f.id)} data-on={formation === f.id} className="grove-choice rounded-lg px-1 py-1.5 text-[12px] font-medium leading-tight">
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {cut.lengths && cut.lengths.length > 0 && (
          <div className="mt-3">
            <div className="grove-eyebrow mb-1.5">Lengths</div>
            <div className="flex flex-col gap-1.5">
              {cut.lengths.map((l) => (
                <button key={l.id} onClick={() => setPieces(Number(l.id))} data-on={effOpts.pieces === Number(l.id)} className="grove-choice rounded-lg px-3 py-1.5 text-left text-[13px] font-medium">
                  {l.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 border-t border-lichen/15 pt-3">
          <div className="grove-eyebrow mb-1.5">Comes off the bench</div>
          {counts.size === 0 && result?.materials.hinges ? (
            <p className="text-[14px] text-parchment/90">A pair of hinges, into your pouch</p>
          ) : (
            [...counts].map(([label, k]) => <p key={label} className="text-[14px] text-parchment/90">{k} × {label}</p>)
          )}
        </div>

        <div className="mt-3 space-y-1.5">
          <div className="grove-eyebrow mb-1">It takes</div>
          {need.axe && needRow('Flint axe', tools.axe)}
          {needsSawFor(cut, effOpts) && needRow('Flint saw', tools.saw)}
          {need.copper ? needRow('Copper nuggets', copper >= need.copper, `${copper} / ${need.copper}`) : null}
          {need.hinges ? needRow('Pair of hinges', hinges >= need.hinges, `${hinges} / ${need.hinges}`) : null}
          {need.minLength ? needRow(`At least ${need.minLength.toFixed(1)} m long`, piece.length >= need.minLength - 1e-6) : null}
          {!need.axe && !needsSawFor(cut, effOpts) && !need.copper && !need.hinges && needRow('Your hands', true)}
        </div>
        {missing && <p className="mt-3 font-display text-[15px] italic text-[#e0a58f]">{missing}</p>}
        <p className="mt-3 text-[12px] text-lichen/55">Pouch: {copper} copper · {hinges} {hinges === 1 ? 'pair' : 'pairs'} of hinges</p>
      </div>

      <div className="absolute bottom-[132px] left-0 right-0 flex justify-center gap-4 pointer-events-auto">
        <button onClick={close} className="grove-button-quiet px-6 py-2.5 text-[14px]">Leave it on the bench</button>
        <button onClick={takeBack} className="grove-button-quiet px-6 py-2.5 text-[14px]">Take it back</button>
        <button onClick={doCut} disabled={!!missing} className="grove-button px-10 py-2.5 text-[18px]">
          {cut.id === 'apart' ? 'Take apart' : cut.id === 'hinges' ? 'Carve' : 'Cut'}
        </button>
      </div>
    </div>
  );
};
