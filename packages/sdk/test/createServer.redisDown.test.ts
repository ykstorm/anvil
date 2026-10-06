import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import { TEST_SECRET, signBody } from "./helpers.js";

/**
 * Redis is unreachable when the server starts and comes back later.
 *
 * The ioredis stub models a client that keeps reconnecting: flipping
 * `redis.up` marks every connection ready and emits "ready". The BullMQ stub
 * models what a real Queue does with its connection: it makes one attempt when
 * constructed (connect() if the client is still lazy) and keeps that promise
 * as queue.client for good (bullmq redis-connection.js init()).
 */
const redis = vi.hoisted(() => ({
  up: false,
  clients: [] as Array<{ status: string; emit: (event: string) => boolean }>,
  options: [] as Array<Record<string, unknown>>,
}));

vi.mock("ioredis", async () => {
  const { EventEmitter } = await import("node:events");
  class FakeRedis extends EventEmitter {
    status: string;
    constructor(_url: string, opts: Record<string, unknown> = {}) {
      super();
      redis.options.push(opts);
      redis.clients.push(this);
      this.status = opts.lazyConnect ? "wait" : redis.up ? "ready" : "reconnecting";
    }
    async connect() {
      if (!redis.up) {
        this.status = "reconnecting";
        throw new Error("connect ECONNREFUSED 127.0.0.1:6379");
      }
      this.status = "ready";
    }
    private check() {
      if (this.status !== "ready") {
        throw new Error("Stream isn't writeable and enableOfflineQueue options is false");
      }
    }
    async ping() {
      this.check();
      return "PONG";
    }
    async set() {
      this.check();
      return "OK";
    }
    async eval() {
      this.check();
      return 1;
    }
  }
  return { default: FakeRedis };
});

vi.mock("bullmq", async () => {
  const { EventEmitter } = await import("node:events");
  class Queue extends EventEmitter {
    client: Promise<unknown>;
    constructor(
      public name: string,
      opts: { connection: { status: string; connect: () => Promise<void> } },
    ) {
      super();
      const conn = opts.connection;
      const init =
        conn.status === "ready"
          ? Promise.resolve()
          : conn.status === "wait"
            ? conn.connect()
            : Promise.reject(new Error("Connection is closed."));
      this.client = init.then(() => conn);
      this.client.catch(() => {});
    }
    async add(_name: string, _data: unknown, opts: { jobId: string }) {
      return { id: opts.jobId };
    }
    async close() {}
  }
  return { Queue };
});

const { createServer } = await import("../src/createServer.js");

function redisComesBack() {
  redis.up = true;
  for (const client of redis.clients) {
    client.status = "ready";
    client.emit("ready");
  }
}

describe("createServer started while Redis is down", () => {
  let server: Server | undefined;
  let url = "";

  beforeEach(async () => {
    redis.up = false;
    redis.clients.length = 0;
    redis.options.length = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const app = createServer({ secret: TEST_SECRET });
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const addr = server.address();
    url = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  });

  const post = (body: string) =>
    fetch(`${url}/webhooks`, { method: "POST", headers: { "x-signature": signBody(body) }, body });

  it("is not ready and sheds webhooks with 503 while Redis is away", async () => {
    expect((await fetch(`${url}/readyz`)).status).toBe(503);
    expect((await post('{"id":"evt_down"}')).status).toBe(503);
    // Liveness is only about the process.
    expect((await fetch(`${url}/healthz`)).status).toBe(200);
  });

  it("becomes ready and accepts webhooks once Redis comes back, without a restart", async () => {
    expect((await fetch(`${url}/readyz`)).status).toBe(503);

    redisComesBack();

    expect((await fetch(`${url}/readyz`)).status).toBe(200);
    const res = await post('{"id":"evt_back"}');
    expect(res.status).toBe(202);
    expect((await res.json()) as { replayed: boolean }).toMatchObject({ replayed: false });
  });

  it("leaves ioredis reconnecting: no lazy connect, no custom retryStrategy", () => {
    const opts = redis.options[0]!;
    expect(opts.lazyConnect).toBeFalsy();
    expect(opts).not.toHaveProperty("retryStrategy");
  });
});
