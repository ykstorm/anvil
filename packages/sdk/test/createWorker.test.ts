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
