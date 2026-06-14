import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Queue } from "bullmq";
import IORedis, { type Redis } from "ioredis";
import { computeIdempotencyKey } from "../src/idempotency.js";
import { enqueueWebhook } from "../src/enqueue.js";
import { REDIS_URL, signBody, uniqueQueueName } from "./helpers.js";

/**
 * computeIdempotencyKey is pure, so its assertions run everywhere.
 * The enqueue de-dupe assertions need a real Redis (BullMQ jobId + Lua), so
 * they are gated behind REDIS_URL: they skip locally and run in CI.
 */
describe("idempotency key = sha256(signature_header + raw_payload_bytes)", () => {
  it("produces the same key for the same signature + body", () => {
    const body = '{"id":"evt_1"}';
    const sig = signBody(body);
    expect(computeIdempotencyKey(sig, Buffer.from(body))).toBe(
      computeIdempotencyKey(sig, Buffer.from(body)),
    );
  });

  it("produces different keys for the same signature but different body", () => {
    const sig = "sha256=deadbeef";
    const a = computeIdempotencyKey(sig, Buffer.from('{"id":"a"}'));
    const b = computeIdempotencyKey(sig, Buffer.from('{"id":"b"}'));
    expect(a).not.toBe(b);
  });

  it("produces a 64-char hex sha256 digest", () => {
    const key = computeIdempotencyKey("sha256=x", Buffer.from("body"));
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });
});

const gated = REDIS_URL ? describe : describe.skip;

gated("enqueue de-dupe (Redis-gated: skips locally, runs in CI)", () => {
  let connection: Redis;
  let queue: Queue;
  let queueName: string;

  beforeAll(async () => {
    connection = new IORedis(REDIS_URL!, { maxRetriesPerRequest: null });
    queueName = uniqueQueueName();
    queue = new Queue(queueName, { connection });
    await queue.obliterate({ force: true }).catch(() => {});
  });

  afterAll(async () => {
    await queue.obliterate({ force: true }).catch(() => {});
    await queue.close();
    await connection.quit();
  });

  it("re-delivering the same key N times enqueues exactly one job", async () => {
    const body = '{"id":"evt_dupe"}';
    const sig = signBody(body);
    const key = computeIdempotencyKey(sig, Buffer.from(body));

    const first = await enqueueWebhook(queue, key, { body, sig });
    const second = await enqueueWebhook(queue, key, { body, sig });
    const third = await enqueueWebhook(queue, key, { body, sig });

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(third.replayed).toBe(true);
    expect(second.jobId).toBe(first.jobId);
    expect(third.jobId).toBe(first.jobId);

    const counts = await queue.getJobCounts("waiting", "active", "completed");
    const total = counts.waiting + counts.active + counts.completed;
    expect(total).toBe(1);
  });

  it("same signature + different body enqueues two jobs", async () => {
    const sig = signBody('{"id":"shared"}');
    const keyA = computeIdempotencyKey(sig, Buffer.from('{"n":1}'));
    const keyB = computeIdempotencyKey(sig, Buffer.from('{"n":2}'));

    const a = await enqueueWebhook(queue, keyA, { body: '{"n":1}', sig });
    const b = await enqueueWebhook(queue, keyB, { body: '{"n":2}', sig });

    expect(a.replayed).toBe(false);
    expect(b.replayed).toBe(false);
    expect(a.jobId).not.toBe(b.jobId);
  });
});
