import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WorkerPool } from '@core/workers/WorkerPool';

/** Minimal Worker stand-in: records posted messages and lets tests emit replies. */
class FakeWorker extends EventTarget {
  static instances: FakeWorker[] = [];
  posted: unknown[] = [];
  constructor() { super(); FakeWorker.instances.push(this); }
  postMessage(msg: unknown) { this.posted.push(msg); }
  reply(type: string) { this.dispatchEvent(new MessageEvent('message', { data: { type } })); }
  terminate() {}
}

describe('WorkerPool scheduling', () => {
  beforeEach(() => { FakeWorker.instances = []; vi.stubGlobal('Worker', FakeWorker); });
  afterEach(() => vi.unstubAllGlobals());

  const make = (size: number) => new WorkerPool(() => new Worker('w.js'), { size, completionTypes: ['DONE'] });

  it('spreads bulk jobs across non-priority workers by load', () => {
    const pool = make(4);
    for (let i = 0; i < 6; i++) pool.postBulk({ i });
    const counts = FakeWorker.instances.map((w) => w.posted.length);
    expect(counts[0]).toBe(0); // priority lane untouched
    expect(counts.slice(1)).toEqual([2, 2, 2]);
    expect(pool.pending).toBe(6);
  });

  it('sends priority jobs to the reserved lane even while bulk work is queued', () => {
    const pool = make(3);
    for (let i = 0; i < 8; i++) pool.postBulk({ i });
    pool.postPriority({ remesh: true });
    expect(FakeWorker.instances[0].posted).toEqual([{ remesh: true }]);
  });

  it('frees capacity when completion messages arrive', () => {
    const pool = make(3);
    pool.postBulk({ a: 1 });
    pool.postBulk({ b: 1 });
    expect(pool.pending).toBe(2);
    FakeWorker.instances[1].reply('DONE');
    FakeWorker.instances[1].reply('IGNORED');
    expect(pool.pending).toBe(1);
    pool.postBulk({ c: 1 }); // worker 1 is now idle again
    expect(FakeWorker.instances[1].posted.length).toBe(2);
  });

  it('works with a single worker', () => {
    const pool = make(1);
    pool.postBulk({ a: 1 });
    pool.postPriority({ b: 1 });
    expect(FakeWorker.instances[0].posted.length).toBe(2);
  });
});
