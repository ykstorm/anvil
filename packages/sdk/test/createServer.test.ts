import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { Queue } from "bullmq";
import IORedis, { type Redis } from "ioredis";
import { createServer } from "../src/createServer.js";
import { computeIdempotencyKey } from "../src/internal/idempotency.js";
import { REDIS_URL, TEST_SECRET, nonce, signBody, uniqueQueueName, waitFor } from "./helpers.js";

/** Start an app on an ephemeral port and return its base URL + closer. */
async function listen(app: ReturnType<typeof createServer>): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

describe("createServer construction", () => {
  it("throws when the secret is too short", () => {
    expect(() => createServer({ secret: "short" })).toThrow(/at least 16/);
  });

  it("accepts a secret of at least 16 characters", () => {
    expect(() => createServer({ secret: TEST_SECRET })).not.toThrow();
  });
});

describe("createServer HTTP (no Redis needed)", () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (closers.length) await closers.pop()!();
  });

  async function start(opts: Parameters<typeof createServer>[0]) {
    const { url, close } = await listen(createServer(opts));
    closers.push(close);
    return url;
  }

  it("rejects a missing signature header with 401", async () => {
    const url = await start({ secret: TEST_SECRET });
    const res = await fetch(`${url}/webhooks`, { method: "POST", body: '{"a":1}' });
    expect(res.status).toBe(401);
  });

  it("rejects a wrong-secret signature with 401", async () => {
    const url = await start({ secret: TEST_SECRET });
    const body = '{"a":1}';
    const res = await fetch(`${url}/webhooks`, {
      method: "POST",
      headers: { "x-signature": signBody(body, "a-different-secret") },
      body,
    });
    expect(res.status).toBe(401);
  });

  it("rejects a valid signature with an extra hex digit with 401", async () => {
    const url = await start({ secret: TEST_SECRET });
    const body = '{"a":1}';
    const res = await fetch(`${url}/webhooks`, {
      method: "POST",
      headers: { "x-signature": signBody(body) + "0" },
      body,
    });
    expect(res.status).toBe(401);
  });

  it("rejects an over-limit body with 413", async () => {
    const url = await start({ secret: TEST_SECRET, maxBodyBytes: 100 });
    const body = "x".repeat(500);
    const res = await fetch(`${url}/webhooks`, {
      method: "POST",
      headers: { "x-signature": signBody(body) },
      body,
    });
    expect(res.status).toBe(413);
  });

  it("rejects a gzip-encoded body before verify (inflate disabled)", async () => {
    const url = await start({ secret: TEST_SECRET });
    const body = '{"a":1}';
    const res = await fetch(`${url}/webhooks`, {
      method: "POST",
      headers: { "x-signature": signBody(body), "content-encoding": "gzip" },
      body,
    });
    // Not 401 (never reached verify) and not 202; collapses to 400.
    expect(res.status).toBe(400);
  });

  it("sheds load with 429 when in-flight cap is reached", async () => {
    const url = await start({ secret: TEST_SECRET, maxInFlight: 0 });
    const res = await fetch(`${url}/webhooks`, { method: "POST", body: "{}" });
    expect(res.status).toBe(429);
  });

  it("answers /healthz with 200", async () => {
    const url = await start({ secret: TEST_SECRET });
    const res = await fetch(`${url}/healthz`);
    expect(res.status).toBe(200);
  });
});

const gated = REDIS_URL ? describe : describe.skip;

gated("createServer HTTP (Redis-gated)", () => {
  let connection: Redis;
  let queue: Queue;
  let queueName: string;
  let url: string;
  let close: () => Promise<void>;

  beforeAll(async () => {
    connection = new IORedis(REDIS_URL!, { maxRetriesPerRequest: null });
    queueName = uniqueQueueName();
    queue = new Queue(queueName, { connection });
    await queue.obliterate({ force: true }).catch(() => {});
    ({ url, close } = await listen(
      createServer({ secret: TEST_SECRET, redisUrl: REDIS_URL, queueName }),
    ));
    // Requests before the Redis connection is ready get 503, as a readiness
    // probe would keep traffic away; wait the way Kubernetes does.
    await waitFor(async () => (await fetch(`${url}/readyz`)).status === 200);
  });

  afterAll(async () => {
    await close();
    await queue.obliterate({ force: true }).catch(() => {});
    await queue.close();
    await connection.quit();
  });

  it("accepts a valid signature with 202, jobId, replayed:false, then dedupes", async () => {
    const body = `{"id":"evt_${nonce()}"}`;
    const sig = signBody(body);
    const expectedKey = computeIdempotencyKey(sig, Buffer.from(body));

    const first = await fetch(`${url}/webhooks`, {
      method: "POST",
      headers: { "x-signature": sig },
      body,
    });
    expect(first.status).toBe(202);
    const firstJson = await first.json();
    expect(firstJson.jobId).toBe(expectedKey);
    expect(firstJson.replayed).toBe(false);

    const second = await fetch(`${url}/webhooks`, {
      method: "POST",
      headers: { "x-signature": sig },
      body,
    });
    expect(second.status).toBe(202);
    const secondJson = await second.json();
    expect(secondJson.jobId).toBe(expectedKey);
    expect(secondJson.replayed).toBe(true);
  });

  it("reports ready on /readyz when Redis is reachable", async () => {
    const res = await fetch(`${url}/readyz`);
    expect(res.status).toBe(200);
  });
});
