/**
 * Retry backoff: 1s, 5s, 30s. Three waits, four attempts; after the fourth
 * failure the job is dead-lettered.
 *
 * A wait only happens between two attempts, so N waits make N + 1 attempts and
 * nothing waits after the last one. That is why the schedule has three entries
 * and not four: a fourth would never be used. The waits add up to 36 seconds.
 * Values are in milliseconds.
 */
export const BACKOFF_MS: readonly number[] = [1000, 5000, 30000];

/** The first try plus one retry per wait: 4. */
export const MAX_ATTEMPTS = BACKOFF_MS.length + 1;

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
