import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Queue, QueueEvents, Worker } from "bullmq";
import IORedis, { type Redis } from "ioredis";
import { BACKOFF_MS, backoffDelay, MAX_ATTEMPTS } from "../src/internal/retry.js";
import { makeDeadLetterHandler, replayDeadLetter } from "../src/internal/deadLetter.js";
import { REDIS_URL, uniqueQueueName, waitFor } from "./helpers.js";

/**
 * A replayed dead-lettered job that fails again must still follow the full
 * [1s, 5s, 30s] backoff and dead-letter after the 4th attempt, rather than
 * resetting to a single-attempt job. Redis-gated like the rest of the suite.
 */
const gated = REDIS_URL ? describe : describe.skip;

gated("replay follows the backoff schedule and re-dead-letters", () => {
  let connection: Redis;
  let mainQueue: Queue;
  let deadQueue: Queue;
  let worker: Worker;
  let events: QueueEvents;
  let queueName: string;

  // Records the real schedule delay for each attempt while only waiting 10ms.
  const observedDelays: number[] = [];

  beforeAll(async () => {
    connection = new IORedis(REDIS_URL!, { maxRetriesPerRequest: null });
    queueName = uniqueQueueName();
    mainQueue = new Queue(queueName, { connection });
    deadQueue = new Queue(`${queueName}.dead`, { connection });
    events = new QueueEvents(queueName, { connection });
    await events.waitUntilReady();
    await mainQueue.obliterate({ force: true }).catch(() => {});
    await deadQueue.obliterate({ force: true }).catch(() => {});

    const onDead = makeDeadLetterHandler(deadQueue);

    worker = new Worker(
      queueName,
      async () => {
        throw new Error("replayed handler still fails");
      },
      {
        connection,
        settings: {
          backoffStrategy: (attemptsMade: number) => {
            observedDelays.push(backoffDelay(attemptsMade));
            return 10;
          },
        },
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
    await mainQueue.obliterate({ force: true }).catch(() => {});
    await deadQueue.obliterate({ force: true }).catch(() => {});
    await mainQueue.close();
    await deadQueue.close();
    await connection.quit();
  });

  it("replayed job exhausts [1s,5s,30s] and dead-letters after the 4th attempt", async () => {
    const seeded = await deadQueue.add(queueName, {
      body: '{"id":"evt_replay_fail"}',
      sig: "sha256=deadbeef",
      receivedAt: "2026-01-01T00:00:00.000Z",
      failureContext: { attempts: MAX_ATTEMPTS, lastError: "original failure" },
    });

    const result = await replayDeadLetter(seeded.id!, { mainQueue, deadQueue });
    expect(result.replayed).toBe(true);

    await waitFor(async () => (await deadQueue.getJobCounts("waiting")).waiting >= 1, {
      timeoutMs: 15000,
    });

    const dead = await deadQueue.getJobs(["waiting"]);
    expect(dead).toHaveLength(1);
    const ctx = dead[0]!.data.failureContext;
    expect(ctx.attempts).toBe(MAX_ATTEMPTS);
    expect(ctx.lastError).toContain("replayed handler still fails");

    // BullMQ asks for a delay before each retry (attempts 1..MAX_ATTEMPTS-1),
    // and each consult returns the production schedule value, in order.
    expect(observedDelays.length).toBeGreaterThanOrEqual(MAX_ATTEMPTS - 1);
    const expectedPrefix = BACKOFF_MS.slice(0, MAX_ATTEMPTS - 1);
    expect(observedDelays.slice(0, MAX_ATTEMPTS - 1)).toEqual(expectedPrefix);
  }, 20000);
});
