/**
 * Lightweight frame profiler for identifying performance bottlenecks.
 *
 * Usage:
 *   // In useFrame hooks:
 *   frameProfiler.begin('terrain');
 *   // ... terrain update code ...
 *   frameProfiler.end('terrain');
 *
 *   // View results in console:
 *   frameProfiler.log();
 *
 * Enable via: localStorage.setItem('vcProfiler', '1') or ?profile URL param
 */

interface ProfileEntry {
  totalMs: number;
  callCount: number;
  maxMs: number;
  samples: number[];
}

class FrameProfiler {
  private enabled: boolean = false;
  private profiles: Map<string, ProfileEntry> = new Map();
  private activeTimers: Map<string, number> = new Map();
  private frameCount: number = 0;
  private lastReportTime: number = 0;
  private readonly MAX_SAMPLES = 60; // Keep last 60 samples for averaging

  // Spike detection
  private frameStartTime: number = 0;
  private spikeThresholdMs: number = 50; // Log frames taking > 50ms
  private lastSpikeLog: number = 0;
  private spikeLabelsThisFrame: string[] = [];

  constructor() {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const viaQuery = params.has('profile');
      let viaStorage = false;
      try {
        viaStorage = localStorage.getItem('vcProfiler') === '1';
      } catch { /* ignore */ }
      this.enabled = viaQuery || viaStorage;

      if (this.enabled) {
        console.log('[FrameProfiler] Enabled. Use frameProfiler.log() to see results.');
        // Auto-log every 5 seconds
        setInterval(() => this.log(), 5000);
      }

      // Expose globally for console access
      (window as any).frameProfiler = this;
    }
  }

  enable() {
    this.enabled = true;
    console.log('[FrameProfiler] Enabled');
  }

  disable() {
    this.enabled = false;
    console.log('[FrameProfiler] Disabled');
  }

  begin(label: string) {
    if (!this.enabled) return;
    this.activeTimers.set(label, performance.now());
  }

  end(label: string) {
    if (!this.enabled) return;
    const start = this.activeTimers.get(label);
    if (start === undefined) return;

    const elapsed = performance.now() - start;
    this.activeTimers.delete(label);

    let entry = this.profiles.get(label);
    if (!entry) {
      entry = { totalMs: 0, callCount: 0, maxMs: 0, samples: [] };
      this.profiles.set(label, entry);
    }

    entry.totalMs += elapsed;
    entry.callCount++;
    entry.maxMs = Math.max(entry.maxMs, elapsed);
    entry.samples.push(elapsed);
    if (entry.samples.length > this.MAX_SAMPLES) {
      entry.samples.shift();
    }
  }

  // Call once per frame to track frame boundaries
  tick() {
    if (!this.enabled) return;

    const now = performance.now();

    // End previous frame spike detection
    if (this.frameStartTime > 0) {
      const frameTime = now - this.frameStartTime;
      if (frameTime > this.spikeThresholdMs && now - this.lastSpikeLog > 500) {
        this.lastSpikeLog = now;
        const labels = this.spikeLabelsThisFrame.join(', ') || 'unknown';
        console.warn(`[FrameProfiler] SPIKE: ${frameTime.toFixed(1)}ms frame (operations: ${labels})`);
      }
    }

    // Start new frame
    this.frameStartTime = now;
    this.spikeLabelsThisFrame = [];
    this.frameCount++;
  }

  // Track what operations happen this frame for spike debugging
  trackOperation(label: string) {
    if (!this.enabled) return;
    this.spikeLabelsThisFrame.push(label);
  }

  reset() {
    this.profiles.clear();
    this.frameCount = 0;
    this.lastReportTime = performance.now();
  }

  log() {
    if (!this.enabled || this.profiles.size === 0) return;

    const now = performance.now();
    const elapsed = now - this.lastReportTime;
    const fps = (this.frameCount / elapsed) * 1000;

    console.group(`[FrameProfiler] ${this.frameCount} frames, ~${fps.toFixed(1)} FPS`);

    // Sort by total time descending
    const sorted = Array.from(this.profiles.entries())
      .sort((a, b) => b[1].totalMs - a[1].totalMs);

    console.table(sorted.map(([label, entry]) => {
      const avgMs = entry.samples.length > 0
        ? entry.samples.reduce((a, b) => a + b, 0) / entry.samples.length
        : 0;
      return {
        label,
        'avg (ms)': avgMs.toFixed(2),
        'max (ms)': entry.maxMs.toFixed(2),
        'calls': entry.callCount,
        'calls/frame': (entry.callCount / Math.max(1, this.frameCount)).toFixed(1),
      };
    }));

    console.groupEnd();
    this.reset();
  }

  // Get current stats without logging
  getStats(): Record<string, { avgMs: number; maxMs: number; callsPerFrame: number }> {
    const stats: Record<string, { avgMs: number; maxMs: number; callsPerFrame: number }> = {};

    for (const [label, entry] of this.profiles) {
      const avgMs = entry.samples.length > 0
        ? entry.samples.reduce((a, b) => a + b, 0) / entry.samples.length
        : 0;
      stats[label] = {
        avgMs,
        maxMs: entry.maxMs,
        callsPerFrame: entry.callCount / Math.max(1, this.frameCount),
      };
    }

    return stats;
  }

  isEnabled() {
    return this.enabled;
  }
}

export const frameProfiler = new FrameProfiler();
