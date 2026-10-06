/** Defaults shared by the server, the worker and replay. */

/** Main queue name when none is given. */
export const DEFAULT_QUEUE_NAME = "webhooks";

/** Redis address when neither the options nor REDIS_URL name one. */
export const DEFAULT_REDIS_URL = "redis://localhost:6379";

/** The Redis URL from the options, then the REDIS_URL environment variable. */
export function resolveRedisUrl(redisUrl?: string): string {
  return redisUrl ?? process.env.REDIS_URL ?? DEFAULT_REDIS_URL;
}

/**
 * The dead-letter queue that belongs to a main queue. The worker writes dead
 * jobs to it and replay reads them back, so both take the name from here.
 */
export function deadQueueName(queueName: string): string {
  return `${queueName}.dead`;
}
