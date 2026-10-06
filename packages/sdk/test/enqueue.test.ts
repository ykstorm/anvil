import { describe, expect, it, vi } from "vitest";
import type { Queue } from "bullmq";
import { enqueueWebhook } from "../src/internal/enqueue.js";

/**
 * A queue stub with an in-memory Redis: SET NX EX, a compare-and-delete EVAL
 * and a plain DEL. Enough to drive the claim, the add and the release without
 * a Redis server. idempotency.test.ts runs the same path against real Redis.
 */
function stubQueue(add: (...args: unknown[]) => Promise<unknown>) {
  const store = new Map<string, string>();
  const client = {
    set: vi.fn(async (key: string, value: string) => {
      if (store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
    eval: vi.fn(async (_script: string, _numKeys: number, key: string, token: string) => {
      if (store.get(key) !== token) return 0;
      store.delete(key);
      return 1;
    }),
    del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
  };
  const addSpy = vi.fn(add);
  const queue = { client: Promise.resolve(client), add: addSpy } as unknown as Queue;
  return { queue, store, client, add: addSpy };
}

const data = { body: '{"id":"evt_1"}', sig: "sha256=x", receivedAt: "2026-01-01T00:00:00.000Z" };

describe("enqueueWebhook when the add fails after the claim", () => {
  it("gives the claim back so the provider's retry enqueues the job", async () => {
    const { queue, store, add } = stubQueue(async () => ({ id: "key-1" }));
    add.mockRejectedValueOnce(new Error("add failed"));

    await expect(enqueueWebhook(queue, "key-1", data)).rejects.toThrow("add failed");
    expect(store.size).toBe(0);

    const retry = await enqueueWebhook(queue, "key-1", data);
    expect(retry).toEqual({ jobId: "key-1", replayed: false });
    expect(add).toHaveBeenCalledTimes(2);
  });

  it("leaves a claim alone once it is no longer ours", async () => {
    const { queue, store } = stubQueue(async () => {
      // Our claim expired mid-add and another delivery claimed the key.
      store.set("anvil:dedupe:key-2", "someone-else");
      throw new Error("add failed");
    });

    await expect(enqueueWebhook(queue, "key-2", data)).rejects.toThrow("add failed");
    expect(store.get("anvil:dedupe:key-2")).toBe("someone-else");
  });

  it("still surfaces the add error when the release fails too", async () => {
    const { queue, client } = stubQueue(async () => {
      throw new Error("add failed");
    });
    client.eval.mockRejectedValueOnce(new Error("redis gone"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(enqueueWebhook(queue, "key-3", data)).rejects.toThrow("add failed");
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("does not touch the queue for a key that is already claimed", async () => {
    const { queue, add } = stubQueue(async () => ({ id: "key-4" }));

    await enqueueWebhook(queue, "key-4", data);
    const again = await enqueueWebhook(queue, "key-4", data);

    expect(again).toEqual({ jobId: "key-4", replayed: true });
    expect(add).toHaveBeenCalledTimes(1);
  });
});
