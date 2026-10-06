import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * createWorker and replayDeadLetter against a stubbed BullMQ, so the wiring
 * (which queue names they open, what the failed listener does) is checked
 * without Redis. worker.e2e.test.ts runs the same paths on a real Redis.
 */
const bull = vi.hoisted(() => ({
  queues: [] as Array<{ name: string; add: ReturnType<typeof vi.fn> }>,
  workers: [] as Array<{ name: string; emit: (event: string, ...args: unknown[]) => boolean }>,
}));

vi.mock("bullmq", async () => {
  const { EventEmitter } = await import("node:events");
  class Queue {
    add = vi.fn(async () => ({ id: "1" }));
    constructor(public name: string) {
      bull.queues.push(this);
    }
    async getJob() {
      return undefined;
    }
    async close() {}
  }
  class Worker extends EventEmitter {
    constructor(public name: string) {
      super();
      bull.workers.push(this);
    }
    async close() {}
  }
  return { Queue, Worker };
});

vi.mock("ioredis", () => ({
  default: class {
    async quit() {}
  },
}));

const { createWorker } = await import("../src/createWorker.js");
const { replayDeadLetter } = await import("../src/replayDeadLetter.js");

beforeEach(() => {
  bull.queues.length = 0;
  bull.workers.length = 0;
});

describe("dead queue name", () => {
  it("is webhooks.dead for the default queue", () => {
    createWorker(async () => {});
    expect(bull.queues.map((q) => q.name)).toEqual(["webhooks.dead"]);
  });

  it("follows a custom queue name, and replay reads the queue the worker writes", async () => {
    createWorker(async () => {}, { queueName: "orders" });
    const written = bull.queues.map((q) => q.name);

    bull.queues.length = 0;
    await replayDeadLetter("1", { mainQueueName: "orders" });
    const read = bull.queues.map((q) => q.name);

    expect(written).toEqual(["orders.dead"]);
    expect(read).toContain("orders.dead");
  });
});

describe("the failed listener", () => {
  function startedWorker() {
    const running = createWorker(async () => {});
    const deadQueue = bull.queues[0]!;
    return { running, deadQueue };
  }

  function failedJob(attemptsMade: number) {
    return {
      id: "job-1",
      name: "webhook",
      attemptsMade,
      data: { body: "{}", sig: "sha256=x", receivedAt: "2026-01-01T00:00:00.000Z" },
      remove: vi.fn(async () => {}),
    };
  }

  function unrecoverable(message: string): Error {
    const err = new Error(message);
    err.name = "UnrecoverableError";
    return err;
  }

  async function fail(job: ReturnType<typeof failedJob>, err: Error) {
    bull.workers[0]!.emit("failed", job, err, "active");
    await new Promise((resolve) => setImmediate(resolve));
  }

  it("dead-letters a job BullMQ failed for stalling more than maxStalledCount times", async () => {
    const { running, deadQueue } = startedWorker();
    await running.start();
    const job = failedJob(1);

    await fail(job, unrecoverable("job stalled more than allowable limit"));

    expect(deadQueue.add).toHaveBeenCalledTimes(1);
    expect(deadQueue.add.mock.calls[0]![1]).toMatchObject({
      failureContext: { attempts: 1, lastError: "job stalled more than allowable limit" },
      originalJobId: "job-1",
    });
    expect(job.remove).toHaveBeenCalled();
  });

  it("dead-letters after the last attempt", async () => {
    const { running, deadQueue } = startedWorker();
    await running.start();

    await fail(failedJob(4), new Error("handler failed"));

    expect(deadQueue.add).toHaveBeenCalledTimes(1);
  });

  it("leaves a failure that BullMQ will retry alone", async () => {
    const { running, deadQueue } = startedWorker();
    await running.start();
    const job = failedJob(2);

    await fail(job, new Error("handler failed"));

    expect(deadQueue.add).not.toHaveBeenCalled();
    expect(job.remove).not.toHaveBeenCalled();
  });
});
