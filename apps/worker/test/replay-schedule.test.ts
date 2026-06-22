import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Queue, QueueEvents, Worker } from "bullmq";
import IORedis, { type Redis } from "ioredis";
import {
  BACKOFF_MS,
  backoffDelay,
  MAX_ATTEMPTS,
} from "../src/retry.js";
import { makeDeadLetterHandler, replayDeadLetter } from "../src/dead-letter.js";
import { REDIS_URL, uniqueQueueName, waitFor } from "./helpers.js";

/**
 * Task 3: a replayed dead-lettered job that fails again must still follow the
 * full [1s, 5s, 30s, 5m] backoff schedule and dead-letter after the 4th
 * attempt — replay does not reset it to a single-attempt job.
 *
 * Redis-gated, mirroring the rest of the worker suite: the assertion needs
 * BullMQ's Worker + Lua, which ioredis-mock cannot run, so it skips locally and
 * runs in CI against redis:7.
 */
const gated = REDIS_URL ? describe : describe.skip;

gated("replay follows the backoff schedule and re-dead-letters", () => {
  let connection: Redis;
  let mainQueue: Queue;
  let deadQueue: Queue;
  let worker: Worker;
  let events: QueueEvents;
  let queueName: string;

  // Records the REAL schedule delay the strategy would return for each attempt,
  // while only actually waiting 10ms so the test finishes fast.
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
          // Spy: record what the production schedule WOULD wait, then collapse
          // the actual delay to 10ms so all 4 attempts run in well under a second.
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

  it("replayed job exhausts [1s,5s,30s,5m] and dead-letters after the 4th attempt", async () => {
    // Seed a job already in the dead-letter queue (as if it failed once before).
    const seeded = await deadQueue.add(queueName, {
      body: '{"id":"evt_replay_fail"}',
      sig: "sha256=deadbeef",
      failureContext: { attempts: MAX_ATTEMPTS, lastError: "original failure" },
    });

    // Replay it back onto the main queue. The revived job must carry the full
    // retry schedule (RETRY_JOB_OPTIONS), not a single attempt.
    const result = await replayDeadLetter(seeded.id!, {
      mainQueue,
      deadQueue,
    });
    expect(result.replayed).toBe(true);

    // The worker now fails the replayed job repeatedly. Wait until it lands back
    // in the dead-letter queue after exhausting all attempts.
    await waitFor(async () => (await deadQueue.getJobCounts("waiting")).waiting >= 1, {
      timeoutMs: 15000,
    });

    const dead = await deadQueue.getJobs(["waiting"]);
    expect(dead).toHaveLength(1);
    const ctx = dead[0]!.data.failureContext;
    expect(ctx.attempts).toBe(MAX_ATTEMPTS);
    expect(ctx.lastError).toContain("replayed handler still fails");

    // The backoff strategy was consulted for the retries between attempts, and
    // each consult returned the production schedule value in order. BullMQ asks
    // for a delay before each retry (attempts 1..MAX_ATTEMPTS-1), so we observe
    // at least the first three schedule entries, in order.
    expect(observedDelays.length).toBeGreaterThanOrEqual(MAX_ATTEMPTS - 1);
    const expectedPrefix = BACKOFF_MS.slice(0, MAX_ATTEMPTS - 1);
    expect(observedDelays.slice(0, MAX_ATTEMPTS - 1)).toEqual(expectedPrefix);
  }, 20000);
});
