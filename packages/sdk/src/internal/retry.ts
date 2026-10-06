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

/**
 * The `attempts` every job carries: the first try plus one retry per wait, 4.
 * This is what ends retries. Once a job has failed this many times BullMQ
 * moves it to the failed list without asking backoffDelay again, and the
 * worker dead-letters it.
 */
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
 * Delay before the retry that follows a failed attempt. `attempt` is 1-based:
 * BullMQ passes attemptsMade + 1, the number of the attempt that just failed.
 * Register it as a Worker's backoffStrategy.
 *
 * BullMQ only asks while attempts remain, so with MAX_ATTEMPTS it asks for
 * attempts 1, 2 and 3 and never past the schedule. The 0 returned out of range
 * is therefore unused, and it would not stop anything: BullMQ reads 0 as "retry
 * now" and -1 as "do not retry". MAX_ATTEMPTS is what ends the retries.
 */
export function backoffDelay(attempt: number): number {
  const idx = attempt - 1;
  if (idx < 0 || idx >= BACKOFF_MS.length) return 0;
  return BACKOFF_MS[idx]!;
}
