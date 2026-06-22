/**
 * Re-export of the canonical idempotency-key function.
 *
 * The implementation lives in the SDK at
 * `@ykstormsorg/anvil/internal/idempotency` so the key derivation is shared,
 * not copy-pasted. See packages/sdk/src/internal/idempotency.ts.
 */
export { computeIdempotencyKey } from "@ykstormsorg/anvil/internal/idempotency";
