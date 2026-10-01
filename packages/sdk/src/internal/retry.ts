/**
 * Retry backoff schedule, in milliseconds: 1s, 5s, 30s, 5m.
 *
 * Four entries, four attempts before a job is dead-lettered. The spread rides
 * out short provider blips early and gives a downstream outage time to recover
 * before the last try, without retrying so long that a poison message clogs the
 * queue for hours.
 */
export const BACKOFF_MS: readonly number[] = [1000, 5000, 30000, 300000];

export const MAX_ATTEMPTS = BACKOFF_MS.length;

/**
 * Per-job retry options every main-queue job must carry. Apply these on enqueue
 * and on replay, otherwise a job gets a single attempt and either never retries
 * or dead-letters immediately.
 */
export const RETRY_JOB_OPTIONS = {
  attempts: MAX_ATTEMPTS,
  backoff: { type: "custom" as const },
};

/**
 * Delay before the retry for a given attempt (1-based, matching BullMQ's
 * attemptsMade at the backoff decision). Returns 0 once the schedule is spent,
 * signalling no further retry. Register it as a Worker's backoffStrategy.
 */
export function backoffDelay(attempt: number): number {
  const idx = attempt - 1;
  if (idx < 0 || idx >= BACKOFF_MS.length) return 0;
  return BACKOFF_MS[idx]!;
}
