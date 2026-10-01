import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Queue, QueueEvents, Worker } from "bullmq";
import IORedis, { type Redis } from "ioredis";
import {
  makeDeadLetterHandler,
  replayDeadLetter,
  sanitizeErrorMessage,
} from "../src/internal/deadLetter.js";
import { MAX_ATTEMPTS } from "../src/internal/retry.js";
import { REDIS_URL, uniqueQueueName, waitFor } from "./helpers.js";

/**
 * Static contract (runs everywhere): the dead-letter module must not construct
 * a BullMQ Worker. Importing it starts no consumer on the main queue.
 */
describe("dead-letter module does not start a Worker", () => {
  it("never constructs `new Worker(` in deadLetter.ts source", () => {
    const src = readFileSync(
      fileURLToPath(new URL("../src/internal/deadLetter.ts", import.meta.url)),
      "utf8",
    );
    expect(src.includes("new Worker(")).toBe(false);
  });
});

describe("sanitizeErrorMessage", () => {
  it("redacts secret-looking query params", () => {
    const msg = "POST https://x.test/hook?token=abc123&key=sk_live_9&ok=1 failed";
    const out = sanitizeErrorMessage(msg);
    expect(out).not.toContain("abc123");
    expect(out).not.toContain("sk_live_9");
    expect(out).toContain("token=REDACTED");
    expect(out).toContain("key=REDACTED");
    expect(out).toContain("ok=1");
  });

  it("truncates to 2048 characters", () => {
    expect(sanitizeErrorMessage("x".repeat(5000))).toHaveLength(2048);
  });
});

const gated = REDIS_URL ? describe : describe.skip;

gated("replayDeadLetter (Redis-gated)", () => {
  let connection: Redis;
  let mainQueue: Queue;
  let deadQueue: Queue;

  beforeAll(async () => {
    connection = new IORedis(REDIS_URL!, { maxRetriesPerRequest: null });
    const mainName = uniqueQueueName();
    mainQueue = new Queue(mainName, { connection });
    deadQueue = new Queue(`${mainName}.dead`, { connection });
    await mainQueue.obliterate({ force: true }).catch(() => {});
    await deadQueue.obliterate({ force: true }).catch(() => {});
  });

  afterAll(async () => {
    await mainQueue.obliterate({ force: true }).catch(() => {});
    await deadQueue.obliterate({ force: true }).catch(() => {});
    await mainQueue.close();
    await deadQueue.close();
    await connection.quit();
  });

  it("moves a dead job back, strips failureContext + originalJobId, removes the dead copy", async () => {
    const deadJob = await deadQueue.add("webhook", {
      body: '{"id":"evt_replay"}',
      sig: "sha256=abc",
      receivedAt: "2026-01-01T00:00:00.000Z",
      failureContext: { attempts: 4, lastError: "boom" },
      originalJobId: "orig-123",
    });

    const result = await replayDeadLetter(deadJob.id!, { mainQueue, deadQueue });
    expect(result.replayed).toBe(true);

    await waitFor(async () => (await mainQueue.getJobCounts("waiting")).waiting >= 1);
    const main = await mainQueue.getJobs(["waiting"]);
    expect(main).toHaveLength(1);
    expect(main[0]!.data.body).toBe('{"id":"evt_replay"}');
    expect(main[0]!.data.failureContext).toBeUndefined();
    expect(main[0]!.data.originalJobId).toBeUndefined();

    expect(await deadQueue.getJob(deadJob.id!)).toBeUndefined();
  });
});

gated("makeDeadLetterHandler removes the main copy and sanitizes the error (Redis-gated)", () => {
  let connection: Redis;
  let queue: Queue;
  let deadQueue: Queue;
  let worker: Worker;
  let events: QueueEvents;

  beforeAll(async () => {
    connection = new IORedis(REDIS_URL!, { maxRetriesPerRequest: null });
    const queueName = uniqueQueueName();
    queue = new Queue(queueName, { connection });
    deadQueue = new Queue(`${queueName}.dead`, { connection });
    events = new QueueEvents(queueName, { connection });
    await events.waitUntilReady();
    await queue.obliterate({ force: true }).catch(() => {});
    await deadQueue.obliterate({ force: true }).catch(() => {});

    const onDead = makeDeadLetterHandler(deadQueue);
    worker = new Worker(
      queueName,
      async () => {
        throw new Error("downstream https://x.test/cb?secret=topsecret failed");
      },
      { connection, settings: { backoffStrategy: () => 10 } },
    );
    worker.on("failed", async (job, err) => {
      if (job && job.attemptsMade >= MAX_ATTEMPTS) {
        await onDead(job, err);
      }
    });
  }, 20000);

  afterAll(async () => {
    await worker.close();
    await events.close();
    await queue.obliterate({ force: true }).catch(() => {});
    await deadQueue.obliterate({ force: true }).catch(() => {});
    await queue.close();
    await deadQueue.close();
    await connection.quit();
  });

  it("dead-letters a redacted record and drops the main-queue copy", async () => {
    await queue.add(
      "webhook",
      { body: '{"id":"evt_dead"}' },
      { attempts: MAX_ATTEMPTS, backoff: { type: "custom" } },
    );

    await waitFor(async () => (await deadQueue.getJobCounts("waiting")).waiting >= 1);

    const dead = await deadQueue.getJobs(["waiting"]);
    expect(dead).toHaveLength(1);
    expect(dead[0]!.data.failureContext.lastError).toContain("secret=REDACTED");
    expect(dead[0]!.data.failureContext.lastError).not.toContain("topsecret");

    const counts = await queue.getJobCounts("waiting", "active", "failed", "completed");
    expect(counts.waiting + counts.active + counts.failed + counts.completed).toBe(0);
  }, 20000);
});
