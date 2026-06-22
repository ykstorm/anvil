/**
 * Retry backoff schedule, in milliseconds: 1s, 5s, 30s, 5m.
 *
 * Four entries means four attempts total before a job is dead-lettered. The
 * spread (1s up to 5 minutes) rides out short provider blips early and gives a
 * downstream outage time to recover before the last try, without retrying so
 * long that a poison message clogs the queue for hours.
 *
 * Single source of truth, shared by the SDK's createWorker and apps/worker.
 */
export const BACKOFF_MS: readonly number[] = [1000, 5000, 30000, 300000];

export const MAX_ATTEMPTS = BACKOFF_MS.length;

/**
 * Delay before the retry for a given attempt number (1-based, matching
 * BullMQ's attemptsMade at the point of the backoff decision). Returns 0 once
 * the schedule is exhausted, signalling no further retry.
 */
export function backoffDelay(attempt: number): number {
  const idx = attempt - 1;
  if (idx < 0 || idx >= BACKOFF_MS.length) return 0;
  return BACKOFF_MS[idx]!;
}

/**
 * BullMQ custom backoff strategy. Register on a Worker as
 * `settings: { backoffStrategy }` and add jobs with
 * `{ attempts: MAX_ATTEMPTS, backoff: { type: "custom" } }`.
 */
export function backoffStrategy(attemptsMade: number): number {
  return backoffDelay(attemptsMade);
}
