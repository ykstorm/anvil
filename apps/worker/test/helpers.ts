/**
 * Worker test helpers.
 *
 * The retry and dead-letter behaviours need BullMQ's Worker, which runs Lua
 * scripts ioredis-mock cannot execute. Those tests are gated behind REDIS_URL:
 * skipped locally, run in CI against a real redis:7 service.
 */
export const REDIS_URL = process.env.REDIS_URL;

export function uniqueQueueName(prefix = "webhooks"): string {
  return `${prefix}.test.${process.pid}.${Math.random().toString(36).slice(2, 8)}`;
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
