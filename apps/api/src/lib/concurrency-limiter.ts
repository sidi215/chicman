/** Runs at most `limit` tasks at once; the others wait in order. A failed task frees its slot. */
export class ConcurrencyLimiter {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.active += 1;
    }
    try {
      return await task();
    } finally {
      // The slot passes directly to the next task, or is freed.
      const next = this.waiting.shift();
      if (next === undefined) this.active -= 1;
      else next();
    }
  }
}
