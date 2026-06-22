/**
 * Re-export of the canonical idempotent enqueue.
 *
 * The implementation lives in the SDK at
 * `@ykstormsorg/anvil/internal/enqueue`. See
 * packages/sdk/src/internal/enqueue.ts.
 */
export { enqueueWebhook } from "@ykstormsorg/anvil/internal/enqueue";
export type { WebhookJobData, EnqueueResult } from "@ykstormsorg/anvil/internal/enqueue";
