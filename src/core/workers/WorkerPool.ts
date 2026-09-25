/**
 * WorkerPool — a fixed set of long-lived module workers with load-aware dispatch.
 *
 * Jobs are fire-and-forget messages; results come back through listeners added
 * with `addMessageListener`. The pool tracks in-flight jobs per worker by
 * watching for completion message types, so it can:
 *  - send each job to the least-loaded worker (instead of a static hash), and
 *  - keep a "priority lane" (worker 0) free of bulk work so latency-sensitive
 *    jobs (e.g. REMESH after digging) never queue behind chunk generation.
 */
export interface WorkerPoolOptions {
  /** Number of workers. Defaults to `WorkerPool.recommendedSize()`. */
  size?: number;
  /** Message `type`s that mark a job as finished. */
  completionTypes?: readonly string[];
}

export class WorkerPool {
  private readonly workers: Worker[] = [];
  private readonly inFlight: number[] = [];
  private readonly completionTypes: ReadonlySet<string>;

  /** Leave headroom for the main thread and the browser; 2..6 workers. */
  static recommendedSize(): number {
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
    return Math.max(2, Math.min(6, cores - 1));
  }

  /**
   * @param createWorker Must contain the literal
   *   `new Worker(new URL('./x.worker.ts', import.meta.url), { type: 'module' })`
   *   at the call site: Vite only bundles workers written in that exact form.
   *   Passing a URL through a variable made production builds inline the raw
   *   TypeScript as a data: URL, so no worker ever started.
   */
  constructor(createWorker: () => Worker, options: WorkerPoolOptions = {}) {
    const size = Math.max(1, options.size ?? WorkerPool.recommendedSize());
    this.completionTypes = new Set(options.completionTypes ?? []);
    for (let i = 0; i < size; i++) {
      const worker = createWorker();
      this.inFlight.push(0);
      worker.addEventListener('message', (e: MessageEvent) => {
        const type = (e.data as { type?: string } | null)?.type;
        if (type && this.completionTypes.has(type)) this.markDone(i);
      });
      // A crashed job must not pin the worker as "busy" forever.
      worker.addEventListener('error', () => this.markDone(i));
      this.workers.push(worker);
    }
  }

  get size(): number {
    return this.workers.length;
  }

  /** Total jobs currently dispatched and not yet completed. */
  get pending(): number {
    let n = 0;
    for (const c of this.inFlight) n += c;
    return n;
  }

  private markDone(index: number): void {
    this.inFlight[index] = Math.max(0, this.inFlight[index] - 1);
  }

  private dispatch(index: number, payload: unknown, transferables?: Transferable[]): void {
    this.inFlight[index]++;
    this.workers[index].postMessage(payload, transferables ?? []);
  }

  private leastLoaded(from: number, to: number): number {
    let best = from;
    for (let i = from + 1; i < to; i++) {
      if (this.inFlight[i] < this.inFlight[best]) best = i;
    }
    return best;
  }

  /**
   * Bulk work (chunk generation). Avoids the priority lane when the pool has
   * more than one worker.
   */
  postBulk(payload: unknown, transferables?: Transferable[]): void {
    const from = this.workers.length > 1 ? 1 : 0;
    this.dispatch(this.leastLoaded(from, this.workers.length), payload, transferables);
  }

  /**
   * Latency-sensitive work (remeshing after an edit). Uses the priority lane
   * unless another worker is strictly idler.
   */
  postPriority(payload: unknown, transferables?: Transferable[]): void {
    const best = this.leastLoaded(0, this.workers.length);
    const target = this.inFlight[best] < this.inFlight[0] ? best : 0;
    this.dispatch(target, payload, transferables);
  }

  /** Configuration/broadcast messages (not tracked as jobs). */
  postToAll(payload: unknown): void {
    this.workers.forEach((w) => w.postMessage(payload));
  }

  addMessageListener(handler: (e: MessageEvent) => void): void {
    this.workers.forEach((w) => w.addEventListener('message', handler));
  }

  terminate(): void {
    this.workers.forEach((w) => w.terminate());
    this.workers.length = 0;
    this.inFlight.length = 0;
  }
}
