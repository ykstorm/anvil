import { afterEach, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import { TEST_SECRET, signBody } from "./helpers.js";

// Make the enqueue step reject so we exercise the handler's try/catch without a
// Redis round trip. The server must answer 503 and the process must survive.
vi.mock("../src/internal/enqueue.js", () => ({
  DEDUPE_TTL_SECONDS: 604800,
  enqueueWebhook: vi.fn(async () => {
    throw new Error("redis unreachable");
  }),
}));

const { createServer } = await import("../src/createServer.js");

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

describe("createServer returns 503 when enqueue fails", () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (close) await close();
    close = undefined;
  });

  it("answers 503 and stays up after an enqueue rejection", async () => {
    const started = await listen(createServer({ secret: TEST_SECRET }));
    close = started.close;

    const body = '{"id":"evt_1"}';
    const res = await fetch(`${started.url}/webhooks`, {
      method: "POST",
      headers: { "x-signature": signBody(body) },
      body,
    });
    expect(res.status).toBe(503);

    // The process survived the rejection: a second request is still served.
    const again = await fetch(`${started.url}/healthz`);
    expect(again.status).toBe(200);
  });
});
