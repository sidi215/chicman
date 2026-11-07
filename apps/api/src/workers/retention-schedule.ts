/** Phone-history retention runs once at start, then every 24 hours (spec 04). */
export const RETENTION_INTERVAL_MS = 24 * 60 * 60_000;

/** Single-instance guard: `true` when this process may run the job. */
export interface WorkerLock {
  tryAcquire(): Promise<boolean>;
  release(): Promise<void>;
}

export interface RetentionScheduleOptions {
  /** Deletes expired rows and returns how many were deleted. */
  purge: () => Promise<number>;
  lock: WorkerLock;
  log: (line: string) => void;
  /** Logs a failure. Receives the error so the caller can redact it. */
  logError: (line: string, error: unknown) => void;
  intervalMs?: number;
  now?: () => Date;
  setInterval?: (run: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
}

export interface RetentionSchedule {
  /** Runs once immediately, then on the interval. */
  start(): Promise<void>;
  /** Stops the timer and waits for an in-flight run; releases the lock. */
  stop(): Promise<void>;
  /** The current run, if any (for tests). */
  readonly running: Promise<void> | null;
}

/**
 * The retention schedule. Runs never overlap: a tick that fires while a run
 * is still in progress is skipped. A process that does not hold the lock
 * skips its runs, so two workers never purge at the same time.
 */
export function createRetentionSchedule(options: RetentionScheduleOptions): RetentionSchedule {
  const intervalMs = options.intervalMs ?? RETENTION_INTERVAL_MS;
  const now = options.now ?? (() => new Date());
  const schedule = options.setInterval ?? ((run, ms) => globalThis.setInterval(run, ms));
  const unschedule =
    options.clearInterval ?? ((handle) => globalThis.clearInterval(handle as ReturnType<typeof globalThis.setInterval>));

  let timer: unknown = null;
  let running: Promise<void> | null = null;
  let stopped = false;
  let runNumber = 0;

  async function runOnce(): Promise<void> {
    runNumber += 1;
    const label = `phone-change retention run #${runNumber}`;
    const startedAt = now();
    try {
      if (!(await options.lock.tryAcquire())) {
        options.log(`${label} skipped at ${startedAt.toISOString()}: another worker instance holds the retention lock`);
        return;
      }
      const deleted = await options.purge();
      const next = new Date(startedAt.getTime() + intervalMs);
      options.log(
        `${label} succeeded at ${startedAt.toISOString()}: deleted ${deleted} row(s) older than 12 months; next run at ${next.toISOString()}`,
      );
    } catch (error) {
      options.logError(`${label} failed at ${startedAt.toISOString()}`, error);
    }
  }

  function trigger(): Promise<void> {
    if (stopped) return Promise.resolve();
    if (running) {
      options.log("phone-change retention tick skipped: the previous run is still in progress");
      return running;
    }
    running = runOnce().finally(() => {
      running = null;
    });
    return running;
  }

  return {
    get running() {
      return running;
    },
    async start() {
      const first = trigger();
      timer = schedule(() => void trigger(), intervalMs);
      await first;
    },
    async stop() {
      stopped = true;
      if (timer !== null) unschedule(timer);
      timer = null;
      if (running) await running;
      await options.lock.release();
    },
  };
}
