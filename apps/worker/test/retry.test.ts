import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Queue, QueueEvents, Worker } from "bullmq";
import IORedis, { type Redis } from "ioredis";
import { BACKOFF_MS, backoffDelay, MAX_ATTEMPTS } from "../src/retry.js";
import { DEAD_QUEUE_NAME, makeDeadLetterHandler } from "../src/dead-letter.js";
import { REDIS_URL, uniqueQueueName, waitFor } from "./helpers.js";

/** Pure backoff-schedule assertions run everywhere. */
describe("retry backoff schedule", () => {
  it("is [1000, 5000, 30000, 300000] ms", () => {
    expect(BACKOFF_MS).toEqual([1000, 5000, 30000, 300000]);
  });

  it("MAX_ATTEMPTS equals the schedule length (4)", () => {
    expect(MAX_ATTEMPTS).toBe(4);
  });

  it("backoffDelay maps attempt number to the right delay", () => {
    // BullMQ passes attemptsMade starting at 1 for the first retry decision.
    expect(backoffDelay(1)).toBe(1000);
    expect(backoffDelay(2)).toBe(5000);
    expect(backoffDelay(3)).toBe(30000);
    expect(backoffDelay(4)).toBe(300000);
  });

  it("returns 0 past the schedule (no more retries)", () => {
    expect(backoffDelay(5)).toBe(0);
  });
});

const gated = REDIS_URL ? describe : describe.skip;

gated("dead-letter after exhaustion (Redis-gated: skips locally, runs in CI)", () => {
  let connection: Redis;
  let queue: Queue;
  let deadQueue: Queue;
  let worker: Worker;
  let events: QueueEvents;
  let queueName: string;

  beforeAll(async () => {
    connection = new IORedis(REDIS_URL!, { maxRetriesPerRequest: null });
    queueName = uniqueQueueName();
    queue = new Queue(queueName, { connection });
    deadQueue = new Queue(`${queueName}.dead`, { connection });
    events = new QueueEvents(queueName, { connection });
    await events.waitUntilReady();
    await queue.obliterate({ force: true }).catch(() => {});
    await deadQueue.obliterate({ force: true }).catch(() => {});

    const onDead = makeDeadLetterHandler(deadQueue);

    // A handler that always throws, with a fast backoff override so the test
    // exhausts all 4 attempts in well under a second instead of ~5.5 minutes.
    worker = new Worker(
      queueName,
      async () => {
        throw new Error("handler always fails");
      },
      {
        connection,
        settings: { backoffStrategy: () => 10 },
      },
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

  it("moves a job to webhooks.dead with failureContext after the 4th failure", async () => {
    await queue.add(
      "webhook",
      { body: '{"id":"evt_fail"}' },
      { attempts: MAX_ATTEMPTS, backoff: { type: "custom" } },
    );

    await waitFor(async () => (await deadQueue.getJobCounts("waiting")).waiting >= 1);

    const dead = await deadQueue.getJobs(["waiting"]);
    expect(dead).toHaveLength(1);
    const ctx = dead[0]!.data.failureContext;
    expect(ctx.attempts).toBe(MAX_ATTEMPTS);
    expect(ctx.lastError).toContain("handler always fails");
  }, 20000);

  it("the dead queue name is webhooks.dead", () => {
    expect(DEAD_QUEUE_NAME).toBe("webhooks.dead");
  });
});
