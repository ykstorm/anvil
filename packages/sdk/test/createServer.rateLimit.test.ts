import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { TEST_SECRET } from "./helpers.js";
import { createServer } from "../src/createServer.js";

// The limiter runs before the body is read and before the signature check, so
// these requests are unsigned: a request that gets through answers 401, one the
// limiter stops answers 429. No Redis is involved.

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

async function post(url: string, headers: Record<string, string> = {}): Promise<number> {
  const res = await fetch(`${url}/webhooks`, { method: "POST", headers, body: "{}" });
  return res.status;
}

describe("createServer rateLimit", () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (close) await close();
    close = undefined;
  });

  it("is off unless configured", async () => {
    const started = await listen(createServer({ secret: TEST_SECRET }));
    close = started.close;

    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) statuses.push(await post(started.url));
    expect(statuses.every((s) => s === 401)).toBe(true);
  });

  it("answers 429 above max requests per window from one address", async () => {
    const started = await listen(
      createServer({ secret: TEST_SECRET, rateLimit: { windowMs: 60_000, max: 2 } }),
    );
    close = started.close;

    expect(await post(started.url)).toBe(401);
    expect(await post(started.url)).toBe(401);
    expect(await post(started.url)).toBe(429);
  });

  it("counts by the connection address, so a proxy needs trust proxy set", async () => {
    const forwarded = (ip: string) => ({ "x-forwarded-for": ip });

    // Without trust proxy the header is ignored: both callers share one count.
    const plain = await listen(
      createServer({ secret: TEST_SECRET, rateLimit: { windowMs: 60_000, max: 1 } }),
    );
    expect(await post(plain.url, forwarded("203.0.113.1"))).toBe(401);
    expect(await post(plain.url, forwarded("203.0.113.2"))).toBe(429);
    await plain.close();

    // With trust proxy set on the returned app, each forwarded address has its own count.
    const app = createServer({ secret: TEST_SECRET, rateLimit: { windowMs: 60_000, max: 1 } });
    app.set("trust proxy", 1);
    const behindProxy = await listen(app);
    close = behindProxy.close;
    expect(await post(behindProxy.url, forwarded("203.0.113.1"))).toBe(401);
    expect(await post(behindProxy.url, forwarded("203.0.113.2"))).toBe(401);
    expect(await post(behindProxy.url, forwarded("203.0.113.1"))).toBe(429);
  });
});
