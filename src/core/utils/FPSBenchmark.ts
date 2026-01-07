/**
 * FPS Benchmark System
 *
 * Measures frame rate during initial load and reports results.
 * Useful for detecting performance regressions.
 *
 * Usage:
 *   - URL: ?benchmark to run 5-second benchmark after load
 *   - URL: ?benchmark=10 to run 10-second benchmark
 *   - Console: window.__fpsBenchmark.start() to manually trigger
 *
 * Results are logged to console and stored in window.__fpsBenchmarkResult
 * Returns { avgFps, minFps, maxFps, p1Fps (1st percentile), passed }
 *
 * Minimum FPS threshold: 40 FPS (set via MIN_FPS_THRESHOLD)
 */

export interface BenchmarkResult {
  avgFps: number;
  minFps: number;
  maxFps: number;
  p1Fps: number; // 1st percentile (worst 1% of frames)
  p5Fps: number; // 5th percentile
  frameCount: number;
  durationMs: number;
  passed: boolean;
  threshold: number;
}

const MIN_FPS_THRESHOLD = 40; // Minimum acceptable FPS
const DEFAULT_DURATION_SECONDS = 5;
const WARMUP_FRAMES = 30; // Skip initial frames for warmup

class FPSBenchmark {
  private enabled: boolean = false;
  private durationMs: number = DEFAULT_DURATION_SECONDS * 1000;
  private frameTimes: number[] = [];
  private startTime: number = 0;
  private lastFrameTime: number = 0;
  private warmupFrames: number = WARMUP_FRAMES;
  private frameCount: number = 0;
  private onComplete: ((result: BenchmarkResult) => void) | null = null;
  private result: BenchmarkResult | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.has('benchmark')) {
        const durationParam = params.get('benchmark');
        if (durationParam && !isNaN(parseInt(durationParam))) {
          this.durationMs = parseInt(durationParam) * 1000;
        }
        // Auto-start after a short delay to let initial chunks load
        setTimeout(() => this.start(), 2000);
      }

      // Expose globally for console access
      (window as any).__fpsBenchmark = this;
    }
  }

  /**
   * Start the benchmark. Optionally pass a callback for when complete.
   */
  start(onComplete?: (result: BenchmarkResult) => void) {
    if (this.enabled) {
      console.log('[FPSBenchmark] Already running');
      return;
    }

    console.log(`[FPSBenchmark] Starting ${this.durationMs / 1000}s benchmark...`);
    console.log(`[FPSBenchmark] Minimum FPS threshold: ${MIN_FPS_THRESHOLD}`);

    this.enabled = true;
    this.frameTimes = [];
    this.frameCount = 0;
    this.warmupFrames = WARMUP_FRAMES;
    this.startTime = 0;
    this.lastFrameTime = 0;
    this.onComplete = onComplete || null;
    this.result = null;
  }

  /**
   * Call this every frame (e.g., in useFrame hook).
   * Returns true if benchmark is complete.
   */
  tick(): boolean {
    if (!this.enabled) return false;

    const now = performance.now();

    // Skip warmup frames
    if (this.warmupFrames > 0) {
      this.warmupFrames--;
      this.lastFrameTime = now;
      return false;
    }

    // Initialize start time after warmup
    if (this.startTime === 0) {
      this.startTime = now;
      this.lastFrameTime = now;
      console.log('[FPSBenchmark] Warmup complete, measuring...');
      return false;
    }

    // Record frame time
    const frameTime = now - this.lastFrameTime;
    this.lastFrameTime = now;
    this.frameCount++;

    // Only record valid frame times (skip anomalies like tab switches)
    if (frameTime > 0 && frameTime < 1000) {
      this.frameTimes.push(frameTime);
    }

    // Check if benchmark duration has elapsed
    const elapsed = now - this.startTime;
    if (elapsed >= this.durationMs) {
      this.complete();
      return true;
    }

    return false;
  }

  private complete() {
    this.enabled = false;

    if (this.frameTimes.length === 0) {
      console.error('[FPSBenchmark] No frames recorded!');
      return;
    }

    // Sort frame times for percentile calculations
    const sorted = [...this.frameTimes].sort((a, b) => a - b);

    // Calculate FPS values (FPS = 1000 / frameTimeMs)
    const fpsValues = this.frameTimes.map(t => 1000 / t);

    // Sort FPS for percentiles (ascending, so p1 is worst)
    const sortedFps = [...fpsValues].sort((a, b) => a - b);

    const avgFrameTime = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    const avgFps = 1000 / avgFrameTime;
    const minFps = Math.min(...fpsValues);
    const maxFps = Math.max(...fpsValues);

    // Percentiles (lower is worse for FPS)
    const p1Index = Math.floor(sortedFps.length * 0.01);
    const p5Index = Math.floor(sortedFps.length * 0.05);
    const p1Fps = sortedFps[p1Index] || minFps;
    const p5Fps = sortedFps[p5Index] || minFps;

    const passed = p1Fps >= MIN_FPS_THRESHOLD;

    this.result = {
      avgFps: Math.round(avgFps * 10) / 10,
      minFps: Math.round(minFps * 10) / 10,
      maxFps: Math.round(maxFps * 10) / 10,
      p1Fps: Math.round(p1Fps * 10) / 10,
      p5Fps: Math.round(p5Fps * 10) / 10,
      frameCount: this.frameCount,
      durationMs: this.durationMs,
      passed,
      threshold: MIN_FPS_THRESHOLD,
    };

    // Store result globally for CI/automation access
    if (typeof window !== 'undefined') {
      (window as any).__fpsBenchmarkResult = this.result;
    }

    // Log results
    console.log('\n========================================');
    console.log('        FPS BENCHMARK RESULTS          ');
    console.log('========================================');
    console.log(`Duration:     ${(this.durationMs / 1000).toFixed(1)}s`);
    console.log(`Frames:       ${this.frameCount}`);
    console.log(`Average FPS:  ${this.result.avgFps}`);
    console.log(`Min FPS:      ${this.result.minFps}`);
    console.log(`Max FPS:      ${this.result.maxFps}`);
    console.log(`P1 FPS:       ${this.result.p1Fps} (worst 1%)`);
    console.log(`P5 FPS:       ${this.result.p5Fps} (worst 5%)`);
    console.log('----------------------------------------');
    console.log(`Threshold:    ${MIN_FPS_THRESHOLD} FPS (P1)`);
    console.log(`Status:       ${passed ? '✅ PASSED' : '❌ FAILED'}`);
    console.log('========================================\n');

    if (!passed) {
      console.error(
        `[FPSBenchmark] FAILED: P1 FPS (${this.result.p1Fps}) is below threshold (${MIN_FPS_THRESHOLD})`
      );
    }

    // Call completion callback if provided
    if (this.onComplete) {
      this.onComplete(this.result);
    }
  }

  /**
   * Get the last benchmark result (or null if not run yet).
   */
  getResult(): BenchmarkResult | null {
    return this.result;
  }

  /**
   * Check if benchmark is currently running.
   */
  isRunning(): boolean {
    return this.enabled;
  }
}

export const fpsBenchmark = new FPSBenchmark();
