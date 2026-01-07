export class WorkerPool {
    private workers: Worker[] = [];
    private queue: { payload: any; resolve: (val: any) => void; reject: (err: any) => void; transferables?: Transferable[] }[] = [];
    private activeWorkers = 0;
    private maxWorkers: number;

    constructor(workerUrl: URL, maxWorkers: number = 4) {
        this.maxWorkers = Math.min(maxWorkers, navigator.hardwareConcurrency || 4);
        for (let i = 0; i < this.maxWorkers; i++) {
            const worker = new Worker(workerUrl, { type: 'module' });
            this.workers.push(worker);
        }
    }

    public post(payload: any, transferables?: Transferable[]): Promise<any> {
        return new Promise((resolve, reject) => {
            this.queue.push({ payload, resolve, reject, transferables });
            this.processQueue();
        });
    }

    private processQueue() {
        if (this.activeWorkers >= this.maxWorkers || this.queue.length === 0) return;

        const { payload, resolve, reject, transferables } = this.queue.shift()!;
        const workerIndex = this.activeWorkers;
        const worker = this.workers[workerIndex];

        this.activeWorkers++;

        const handler = (e: MessageEvent) => {
            worker.removeEventListener('message', handler);
            worker.removeEventListener('error', errorHandler);
            this.activeWorkers--;
            resolve(e.data);
            this.processQueue();
        };

        const errorHandler = (err: ErrorEvent) => {
            worker.removeEventListener('message', handler);
            worker.removeEventListener('error', errorHandler);
            this.activeWorkers--;
            reject(err);
            this.processQueue();
        };

        worker.addEventListener('message', handler);
        worker.addEventListener('error', errorHandler);
        worker.postMessage(payload, transferables || []);
    }

    public terminate() {
        this.workers.forEach(w => w.terminate());
    }

    // Direct access for long-running subscriptions (like terrain.onmessage)
    // Note: This bypasses the promise-based queueing logic
    public addMessageListener(handler: (e: MessageEvent) => void) {
        this.workers.forEach(w => w.addEventListener('message', handler));
    }

    public postToAll(payload: any) {
        this.workers.forEach(w => w.postMessage(payload));
    }

    public postToOne(index: number, payload: any, transferables?: Transferable[]) {
        this.workers[Math.abs(index) % this.maxWorkers].postMessage(payload, transferables || []);
    }
}
