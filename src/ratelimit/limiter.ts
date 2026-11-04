export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  tryAcquire(key: string): boolean {
    const ts = this.now();
    const recent = (this.hits.get(key) ?? []).filter((item) => ts - item < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(ts);
    this.hits.set(key, recent);
    return true;
  }
}

export class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
    this.active += 1;
  }

  release(): void {
    this.active -= 1;
    const next = this.queue.shift();
    if (next) next();
  }
}
