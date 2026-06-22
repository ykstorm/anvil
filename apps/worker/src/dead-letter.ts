/**
 * Re-export of the canonical dead-letter handler + replay.
 *
 * The implementation lives in the SDK at
 * `@ykstormsorg/anvil/internal/deadLetter` so the dead-letter / replay logic is
 * shared, not copy-pasted. See packages/sdk/src/internal/deadLetter.ts.
 *
 * Note: this module deliberately never constructs a BullMQ Worker — importing
 * it starts no consumer. The dead-letter queue is drained by a separate,
 * manually run process.
 */
export {
  DEAD_QUEUE_NAME,
  makeDeadLetterHandler,
  replayDeadLetter,
} from "@ykstormsorg/anvil/internal/deadLetter";
export type {
  FailureContext,
  DeadJobData,
  ReplayDeps,
  ReplayResult,
} from "@ykstormsorg/anvil/internal/deadLetter";
