import { createHmac } from "node:crypto";

/**
 * Shared test helpers for the SDK suite.
 *
 * REDIS_URL gates the BullMQ-backed tests. BullMQ runs Lua scripts that
 * ioredis-mock does not implement, so those tests skip when REDIS_URL is unset
 * (local, no Redis) and run in CI against a real redis:7 service. Pure tests
 * (verify, idempotency key) always run everywhere.
 */
export const REDIS_URL = process.env.REDIS_URL;

export const TEST_SECRET = "whsec_test_secret";

export function signBody(body: string, secret = TEST_SECRET): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

/** A unique queue name per test run so parallel CI jobs do not collide. */
export function uniqueQueueName(prefix = "webhooks"): string {
  return `${prefix}.test.${process.pid}.${Math.random().toString(36).slice(2, 8)}`;
}

/** A nonce to keep idempotency keys distinct across reruns within the TTL. */
export function nonce(): string {
  return `${Date.now()}.${Math.random().toString(36).slice(2, 10)}`;
}

export function waitFor(
  predicate: () => boolean | Promise<boolean>,
  { timeoutMs = 15000, intervalMs = 50 } = {},
): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        if (await predicate()) return resolve();
      } catch (err) {
        return reject(err);
      }
      if (Date.now() - start > timeoutMs) {
        return reject(new Error("waitFor timed out"));
      }
      setTimeout(tick, intervalMs);
    };
    void tick();
  });
}
