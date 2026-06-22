/**
 * Re-export of the canonical retry backoff schedule.
 *
 * The implementation lives in the SDK at
 * `@ykstormsorg/anvil/internal/retry`. See
 * packages/sdk/src/internal/retry.ts.
 */
export {
  BACKOFF_MS,
  MAX_ATTEMPTS,
  RETRY_JOB_OPTIONS,
  backoffDelay,
  backoffStrategy,
} from "@ykstormsorg/anvil/internal/retry";
