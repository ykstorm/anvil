import { createHash } from "node:crypto";

/**
 * Idempotency key = sha256(signature_header + raw_payload_bytes).
 *
 * The signature header alone is not enough: some providers rotate the
 * signature when they re-deliver the same logical event (clock skew, key
 * rotation, retried delivery with a fresh timestamp). Folding the raw payload
 * bytes into the key means a genuine re-delivery of the same body collapses to
 * one key, while two different bodies never collide even under a shared
 * signature. See docs/IDEMPOTENCY.md.
 */
export function computeIdempotencyKey(
  signatureHeader: string,
  rawPayload: Buffer,
): string {
  return createHash("sha256")
    .update(signatureHeader, "utf8")
    .update(rawPayload)
    .digest("hex");
}
