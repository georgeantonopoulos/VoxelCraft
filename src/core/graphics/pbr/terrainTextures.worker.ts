import { synthesizeLayer, packLayer } from './textureSynth';

/**
 * Synthesises terrain PBR layers off the main thread.
 * In:  { layers: number[], size: number }
 * Out: { type: 'LAYER', layer, a, b } per layer (buffers transferred), then { type: 'DONE' }.
 */
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<{ layers: number[]; size: number }>) => void) | null;
  postMessage: (msg: unknown, transfer?: Transferable[]) => void;
};

ctx.onmessage = (e) => {
  const { layers, size } = e.data;
  for (const layer of layers) {
    const packed = packLayer(synthesizeLayer(layer, size));
    ctx.postMessage({ type: 'LAYER', layer, a: packed.a, b: packed.b }, [packed.a.buffer, packed.b.buffer]);
  }
  ctx.postMessage({ type: 'DONE' });
};
