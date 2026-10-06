import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { Queue } from "bullmq";
import IORedis, { type Redis } from "ioredis";
import { computeIdempotencyKey } from "../src/internal/idempotency.js";
import { enqueueWebhook } from "../src/internal/enqueue.js";
import { REDIS_URL, nonce, signBody, uniqueQueueName } from "./helpers.js";

/**
 * computeIdempotencyKey is pure, so its assertions run everywhere. The atomic
 * dedupe assertions need a real Redis (SET NX + BullMQ), so they are gated.
 */
describe("idempotency key = sha256(canonical signature + raw_payload_bytes)", () => {
  it("produces the same key for the same signature + body", () => {
    const body = '{"id":"evt_1"}';
    const sig = signBody(body);
    expect(computeIdempotencyKey(sig, Buffer.from(body))).toBe(
      computeIdempotencyKey(sig, Buffer.from(body)),
    );
  });

  it("produces different keys for the same signature but different body", () => {
    const sig = signBody("shared");
    const a = computeIdempotencyKey(sig, Buffer.from('{"id":"a"}'));
    const b = computeIdempotencyKey(sig, Buffer.from('{"id":"b"}'));
    expect(a).not.toBe(b);
  });

  it("produces a 64-char hex sha256 digest", () => {
    const key = computeIdempotencyKey(signBody("body"), Buffer.from("body"));
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it("gives one key for every spelling of a signature that verify accepts", () => {
    const body = '{"id":"evt_case"}';
    const sig = signBody(body);
    const upper = "sha256=" + sig.slice("sha256=".length).toUpperCase();
    expect(computeIdempotencyKey(upper, Buffer.from(body))).toBe(
      computeIdempotencyKey(sig, Buffer.from(body)),
    );
  });

  it("keeps the key of a lower-case signature equal to sha256(header + body)", () => {
    // Providers send lower-case hex; those keys match the ones older releases made.
    const body = '{"id":"evt_compat"}';
    const sig = signBody(body);
    const old = createHash("sha256").update(sig, "utf8").update(body).digest("hex");
    expect(computeIdempotencyKey(sig, Buffer.from(body))).toBe(old);
  });

  it("refuses a header that is not sha256=<64 hex>", () => {
    const body = '{"id":"evt_bad"}';
    expect(() => computeIdempotencyKey(signBody(body) + "0", Buffer.from(body))).toThrow(
      TypeError,
    );
    expect(() => computeIdempotencyKey("sha256=deadbeef", Buffer.from(body))).toThrow(
      TypeError,
    );
  });
});

const gated = REDIS_URL ? describe : describe.skip;

gated("atomic dedupe (Redis-gated)", () => {
  let connection: Redis;
  let queue: Queue;

  beforeAll(async () => {
    connection = new IORedis(REDIS_URL!, { maxRetriesPerRequest: null });
    queue = new Queue(uniqueQueueName(), { connection });
    await queue.obliterate({ force: true }).catch(() => {});
  });

  afterAll(async () => {
    await queue.obliterate({ force: true }).catch(() => {});
    await queue.close();
    await connection.quit();
  });

  const data = (body: string, sig: string) => ({
    body,
    sig,
    receivedAt: new Date().toISOString(),
  });

  it("re-delivering the same key N times enqueues exactly one job", async () => {
    const body = `{"id":"evt_${nonce()}"}`;
    const sig = signBody(body);
    const key = computeIdempotencyKey(sig, Buffer.from(body));

    const first = await enqueueWebhook(queue, key, data(body, sig));
    const second = await enqueueWebhook(queue, key, data(body, sig));
    const third = await enqueueWebhook(queue, key, data(body, sig));

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(third.replayed).toBe(true);
    expect(second.jobId).toBe(first.jobId);
    expect(third.jobId).toBe(first.jobId);
  });

  it("20 concurrent identical deliveries yield exactly one replayed:false", async () => {
    const body = `{"id":"evt_${nonce()}"}`;
    const sig = signBody(body);
    const key = computeIdempotencyKey(sig, Buffer.from(body));

    const results = await Promise.all(
      Array.from({ length: 20 }, () => enqueueWebhook(queue, key, data(body, sig))),
    );

    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(results.filter((r) => r.replayed)).toHaveLength(19);
  });

  it("same signature + different body enqueues two jobs", async () => {
    const tag = nonce();
    const sig = signBody(`{"id":"shared_${tag}"}`);
    const bodyA = `{"n":1,"t":"${tag}"}`;
    const bodyB = `{"n":2,"t":"${tag}"}`;
    const keyA = computeIdempotencyKey(sig, Buffer.from(bodyA));
    const keyB = computeIdempotencyKey(sig, Buffer.from(bodyB));

    const a = await enqueueWebhook(queue, keyA, data(bodyA, sig));
    const b = await enqueueWebhook(queue, keyB, data(bodyB, sig));

    expect(a.replayed).toBe(false);
    expect(b.replayed).toBe(false);
    expect(a.jobId).not.toBe(b.jobId);
  });

  it("a failed add gives the claim back, so the retry queues exactly one job", async () => {
    const body = `{"id":"evt_${nonce()}"}`;
    const sig = signBody(body);
    const key = computeIdempotencyKey(sig, Buffer.from(body));
    const add = vi.spyOn(queue, "add").mockRejectedValueOnce(new Error("add failed"));

    await expect(enqueueWebhook(queue, key, data(body, sig))).rejects.toThrow("add failed");
    expect(await connection.exists(`anvil:dedupe:${key}`)).toBe(0);

    const retry = await enqueueWebhook(queue, key, data(body, sig));
    expect(retry.replayed).toBe(false);
    expect(await queue.getJob(key)).toBeDefined();
    add.mockRestore();
  });
});
