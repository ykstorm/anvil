/**
 * Re-export of the canonical constant-time HMAC verifier.
 *
 * The implementation lives in the SDK at
 * `@ykstormsorg/anvil/internal/verify` so there is exactly one copy of the
 * security-critical crypto. See packages/sdk/src/internal/verify.ts.
 */
export { verify } from "@ykstormsorg/anvil/internal/verify";
