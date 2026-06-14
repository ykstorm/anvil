import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Queue } from "bullmq";
import IORedis, { type Redis } from "ioredis";
import { replayDeadLetter } from "../src/dead-letter.js";
import { REDIS_URL, uniqueQueueName, waitFor } from "./helpers.js";

/**
 * Static assertion (runs everywhere): the dead-letter module must NOT
 * construct a BullMQ Worker. Importing it should start no worker on the main
 * queue. We assert this at the source level so the contract holds even where
 * Redis is unavailable.
 */
describe("dead-letter module does not start a Worker", () => {
  it("never constructs `new Worker(` in dead-letter.ts source", () => {
    const src = readFileSync(
      fileURLToPath(new URL("../src/dead-letter.ts", import.meta.url)),
      "utf8",
    );
    expect(src.includes("new Worker(")).toBe(false);
  });
});

const gated = REDIS_URL ? describe : describe.skip;

gated("replayDeadLetter (Redis-gated: skips locally, runs in CI)", () => {
  let connection: Redis;
  let mainQueue: Queue;
  let deadQueue: Queue;
  let mainName: string;

  beforeAll(async () => {
    connection = new IORedis(REDIS_URL!, { maxRetriesPerRequest: null });
    mainName = uniqueQueueName();
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

  it("moves a dead job back to the main queue and returns { replayed: true }", async () => {
    const deadJob = await deadQueue.add("webhook", {
      body: '{"id":"evt_replay"}',
      failureContext: { attempts: 4, lastError: "boom" },
    });

    const result = await replayDeadLetter(deadJob.id!, {
      mainQueue,
      deadQueue,
    });

    expect(result.replayed).toBe(true);

    await waitFor(async () => (await mainQueue.getJobCounts("waiting")).waiting >= 1);
    const main = await mainQueue.getJobs(["waiting"]);
    expect(main).toHaveLength(1);
    expect(main[0]!.data.body).toBe('{"id":"evt_replay"}');

    // The job is removed from the dead queue once replayed.
    const stillDead = await deadQueue.getJob(deadJob.id!);
    expect(stillDead).toBeUndefined();
  });
});
