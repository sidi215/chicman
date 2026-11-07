/** Manually advanced clock for cooldown and cache-lifetime tests. */
export class TestClock {
  constructor(private current = Date.now()) {}
  now = (): number => this.current;
  advance(ms: number): void {
    this.current += ms;
  }
}
