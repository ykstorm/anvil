import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Queue, UnrecoverableError } from "bullmq";
import IORedis, { type Redis } from "ioredis";
import { createWorker, replayDeadLetter, type RunningWorker } from "../src/index.js";
import { deadQueueName } from "../src/internal/defaults.js";
import { MAX_ATTEMPTS } from "../src/internal/retry.js";
import { REDIS_URL, uniqueQueueName, waitFor } from "./helpers.js";

/**
 * The public createWorker and replayDeadLetter on a real Redis, with a custom
 * queue name. Jobs carry a 10 ms fixed backoff so four attempts take well under
 * a second instead of the 36 s production schedule.
 */
const gated = REDIS_URL ? describe : describe.skip;

gated("createWorker with a custom queue name (Redis-gated)", () => {
  let connection: Redis;
  let queueName: string;
  let mainQueue: Queue;
  let deadQueue: Queue;
  let worker: RunningWorker;

  beforeAll(async () => {
    connection = new IORedis(REDIS_URL!, { maxRetriesPerRequest: null });
    queueName = uniqueQueueName("orders");
    mainQueue = new Queue(queueName, { connection });
    deadQueue = new Queue(deadQueueName(queueName), { connection });

    worker = createWorker(
      async (data) => {
        if (data.body.includes("unrecoverable")) {
          throw new UnrecoverableError("never retry this one");
        }
        throw new Error("handler always fails");
      },
      { redisUrl: REDIS_URL, queueName },
    );
    await worker.start();
  }, 20000);

  afterAll(async () => {
    // The replay case closes the worker itself; a second close finds the
    // connection already ended.
    await worker.close().catch(() => {});
    await mainQueue.obliterate({ force: true }).catch(() => {});
    await deadQueue.obliterate({ force: true }).catch(() => {});
    await mainQueue.close();
    await deadQueue.close();
    await connection.quit();
  });

  it("dead-letters an UnrecoverableError after one attempt", async () => {
    const job = await mainQueue.add(
      "webhook",
      { body: '{"id":"evt_unrecoverable"}', sig: "sha256=x", receivedAt: "2026-01-01T00:00:00.000Z" },
      { attempts: MAX_ATTEMPTS, backoff: { type: "fixed", delay: 10 } },
    );

    await waitFor(async () => {
      const dead = await deadQueue.getJobs(["waiting"]);
      return dead.some((d) => d.data.originalJobId === job.id);
    });
    const dead = (await deadQueue.getJobs(["waiting"])).find((d) => d.data.originalJobId === job.id);
    expect(dead!.data.failureContext).toEqual({ attempts: 1, lastError: "never retry this one" });
    await dead!.remove();
  }, 20000);

  it("dead-letters to <queueName>.dead, where replayDeadLetter finds the job", async () => {
    await mainQueue.add(
      "webhook",
      { body: '{"id":"evt_orders"}', sig: "sha256=x", receivedAt: "2026-01-01T00:00:00.000Z" },
      { attempts: MAX_ATTEMPTS, backoff: { type: "fixed", delay: 10 } },
    );

    await waitFor(async () => (await deadQueue.getJobCounts("waiting")).waiting >= 1);
    const [dead] = await deadQueue.getJobs(["waiting"]);
    expect(dead!.data.failureContext.attempts).toBe(MAX_ATTEMPTS);

    await worker.close();
    const result = await replayDeadLetter(dead!.id!, { redisUrl: REDIS_URL, mainQueueName: queueName });
    expect(result.replayed).toBe(true);
    expect(await deadQueue.getJob(dead!.id!)).toBeUndefined();
    expect(await mainQueue.getJob(result.jobId)).toBeDefined();
  }, 20000);
});
