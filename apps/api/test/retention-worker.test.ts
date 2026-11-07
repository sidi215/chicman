import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createAdvisoryLock } from "../src/workers/advisory-lock.js";
import {
  RETENTION_INTERVAL_MS,
  createRetentionSchedule,
  type WorkerLock,
} from "../src/workers/retention-schedule.js";

const fixedNow = () => new Date("2026-11-07T00:00:00.000Z");

function fakeLock(acquired = true): WorkerLock & { released: number } {
  return {
    released: 0,
    async tryAcquire() {
      return acquired;
    },
    async release() {
      this.released += 1;
    },
  };
}

/** A manual timer: `tick()` fires the scheduled callback. */
function manualTimer() {
  let callback: (() => void) | null = null;
  let intervalMs: number | null = null;
  let cleared = false;
  return {
    setInterval: (run: () => void, ms: number) => {
      callback = run;
      intervalMs = ms;
      return 1;
    },
    clearInterval: () => {
      cleared = true;
    },
    tick: () => callback?.(),
    get intervalMs() {
      return intervalMs;
    },
    get cleared() {
      return cleared;
    },
  };
}

describe("retention worker schedule (spec 04)", () => {
  it("keeps the 24-hour interval", () => {
    assert.equal(RETENTION_INTERVAL_MS, 86_400_000);
  });

  it("runs once at start, then on every 24-hour tick, and logs each run", async () => {
    const timer = manualTimer();
    const lines: string[] = [];
    let purges = 0;
    const schedule = createRetentionSchedule({
      purge: async () => ++purges,
      lock: fakeLock(),
      log: (line) => lines.push(line),
      logError: () => assert.fail("no failure expected"),
      now: fixedNow,
      setInterval: timer.setInterval,
      clearInterval: timer.clearInterval,
    });
    await schedule.start();
    assert.equal(purges, 1);
    assert.equal(timer.intervalMs, RETENTION_INTERVAL_MS);
    timer.tick();
    await schedule.running;
    assert.equal(purges, 2);
    assert.match(lines[0]!, /run #1 succeeded at 2026-11-07T00:00:00.000Z: deleted 1 row\(s\).*next run at 2026-11-08T00:00:00.000Z/);
    assert.match(lines[1]!, /run #2 succeeded/);
    await schedule.stop();
  });

  it("never overlaps runs", async () => {
    const timer = manualTimer();
    const lines: string[] = [];
    let release!: () => void;
    let purges = 0;
    const schedule = createRetentionSchedule({
      purge: () => {
        purges += 1;
        return new Promise<number>((resolve) => {
          release = () => resolve(0);
        });
      },
      lock: fakeLock(),
      log: (line) => lines.push(line),
      logError: () => undefined,
      setInterval: timer.setInterval,
      clearInterval: timer.clearInterval,
    });
    const started = schedule.start();
    await new Promise((resolve) => setImmediate(resolve));
    timer.tick();
    assert.equal(purges, 1);
    assert.ok(lines.some((line) => line.includes("tick skipped")));
    release();
    await started;
    await schedule.stop();
  });

  it("stop waits for the in-flight run, clears the timer, and releases the lock", async () => {
    const timer = manualTimer();
    const lock = fakeLock();
    let finished = false;
    let release!: () => void;
    const schedule = createRetentionSchedule({
      purge: () =>
        new Promise<number>((resolve) => {
          release = () => {
            finished = true;
            resolve(0);
          };
        }),
      lock,
      log: () => undefined,
      logError: () => undefined,
      setInterval: timer.setInterval,
      clearInterval: timer.clearInterval,
    });
    void schedule.start();
    await new Promise((resolve) => setImmediate(resolve));
    const stopped = schedule.stop();
    setImmediate(() => release());
    await stopped;
    assert.equal(finished, true);
    assert.equal(timer.cleared, true);
    assert.equal(lock.released, 1);
    timer.tick();
    assert.equal(schedule.running, null);
  });

  it("skips runs without the lock (another instance is active)", async () => {
    const lines: string[] = [];
    let purges = 0;
    const schedule = createRetentionSchedule({
      purge: async () => ++purges,
      lock: fakeLock(false),
      log: (line) => lines.push(line),
      logError: () => undefined,
      setInterval: manualTimer().setInterval,
    });
    await schedule.start();
    assert.equal(purges, 0);
    assert.match(lines[0]!, /skipped .*another worker instance holds the retention lock/);
    await schedule.stop();
  });

  it("a failed run is logged and the schedule continues", async () => {
    const timer = manualTimer();
    const failures: unknown[] = [];
    let calls = 0;
    const schedule = createRetentionSchedule({
      purge: async () => {
        calls += 1;
        if (calls === 1) throw new Error("connection to +22222123456 failed");
        return 0;
      },
      lock: fakeLock(),
      log: () => undefined,
      logError: (line, error) => failures.push([line, error]),
      setInterval: timer.setInterval,
      clearInterval: timer.clearInterval,
    });
    await schedule.start();
    assert.equal(failures.length, 1);
    timer.tick();
    await schedule.running;
    assert.equal(calls, 2);
    await schedule.stop();
  });
});

const databaseUrl = process.env["TEST_DATABASE_URL"];

describe("retention worker lock (PostgreSQL)", { skip: databaseUrl === undefined ? "TEST_DATABASE_URL is not set" : false }, () => {
  it("only one worker holds the lock; it is free again after release", async () => {
    const url = databaseUrl!;
    const lost = () => assert.fail("lock connection lost");
    const first = createAdvisoryLock(url, lost);
    const second = createAdvisoryLock(url, lost);
    try {
      assert.equal(await first.tryAcquire(), true);
      assert.equal(await first.tryAcquire(), true, "re-acquiring by the holder is a no-op");
      assert.equal(await second.tryAcquire(), false);
      await first.release();
      assert.equal(await second.tryAcquire(), true);
    } finally {
      await first.release();
      await second.release();
    }
  });
});
