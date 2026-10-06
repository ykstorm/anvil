import { createHash } from "node:crypto";
import { canonicalSignatureHex } from "./verify.js";

/**
 * Idempotency key = sha256("sha256=" + canonical signature hex + raw body).
 *
 * Call this only after verify() has accepted the header. The signature is
 * reduced to its canonical form first (64 lower-case hex characters), so the
 * spellings verify accepts for one signature, such as upper-case hex, cannot
 * produce different keys and get one delivery processed twice. For the
 * lower-case form providers send, the key is the same as hashing the header
 * text as received, so keys from older releases still match.
 *
 * A verified signature is the HMAC of this body under the configured secret,
 * so for one secret the key is fixed by the body: an exact re-delivery
 * collapses to one key and two different bodies never collide. A re-delivery
 * that carries a different signature for the same body, for example after the
 * secret is rotated, gets a different key and is not deduped. See
 * docs/IDEMPOTENCY.md.
 */
export function computeIdempotencyKey(
  signatureHeader: string,
  rawPayload: Buffer,
): string {
  const hex = canonicalSignatureHex(signatureHeader);
  if (hex === null) {
    throw new TypeError(
      "computeIdempotencyKey: expected a verified sha256=<64 hex> signature header",
    );
  }
  return createHash("sha256")
    .update(`sha256=${hex}`, "utf8")
    .update(rawPayload)
    .digest("hex");
}
