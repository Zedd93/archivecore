export class SerialScanQueue {
  private pending: string[] = [];
  private queued = new Set<string>();
  private active: string | null = null;
  private draining: Promise<void> | null = null;
  private generation = 0;

  constructor(
    private readonly process: (code: string) => Promise<void>,
    private readonly onError: (error: unknown) => void,
  ) {}

  get isBusy() {
    return this.draining !== null;
  }

  enqueue(rawCode: string): boolean {
    const code = rawCode.trim();
    if (!code || code === this.active || this.queued.has(code)) return false;
    this.pending.push(code);
    this.queued.add(code);
    if (!this.draining) this.draining = Promise.resolve().then(() => this.drain());
    return true;
  }

  clear() {
    this.generation++;
    this.pending = [];
    this.queued.clear();
  }

  async whenIdle() {
    while (this.draining) await this.draining;
  }

  private async drain() {
    const generation = this.generation;
    try {
      while (generation === this.generation && this.pending.length > 0) {
        const code = this.pending.shift()!;
        this.queued.delete(code);
        this.active = code;
        try {
          await this.process(code);
        } catch (error) {
          this.onError(error);
        } finally {
          this.active = null;
        }
      }
    } finally {
      this.draining = null;
      if (this.pending.length > 0) this.draining = Promise.resolve().then(() => this.drain());
    }
  }
}
