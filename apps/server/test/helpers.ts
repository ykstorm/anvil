import { createHmac } from "node:crypto";

/**
 * Test helpers shared by the server suite.
 *
 * `REDIS_URL` gates the BullMQ-backed tests. BullMQ runs Lua scripts that
 * ioredis-mock does not implement, so those tests skip locally (no Redis here)
 * and run in CI where a real redis:7 service is provided. The pure crypto
 * tests (verify, verify.spy) always run, everywhere.
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
