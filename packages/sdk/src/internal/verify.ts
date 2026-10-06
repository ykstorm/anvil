import { createHmac, timingSafeEqual } from "node:crypto";

const SIGNATURE_PREFIX = "sha256=";

/** A SHA-256 digest is 32 bytes, which is exactly 64 hex characters. */
const DIGEST_HEX = /^[0-9a-f]{64}$/i;

/**
 * The digest from a `sha256=<hex>` header as 64 lower-case hex characters, or
 * null when the header does not have exactly that shape.
 *
 * The length is checked on the text, not on the decoded bytes, because
 * Buffer.from(hex, "hex") silently drops a trailing odd digit: without this a
 * 65-character value would decode to the right 32 bytes and verify. Upper-case
 * hex is accepted and lower-cased, so every accepted spelling of one signature
 * maps to one canonical form, which is what the idempotency key is built from.
 */
export function canonicalSignatureHex(signatureHeader: string): string | null {
  if (typeof signatureHeader !== "string" || !signatureHeader.startsWith(SIGNATURE_PREFIX)) {
    return null;
  }
  const hex = signatureHeader.slice(SIGNATURE_PREFIX.length);
  return DIGEST_HEX.test(hex) ? hex.toLowerCase() : null;
}

/**
 * Verify an HMAC-SHA256 webhook signature in constant time.
 *
 * The header has the shape `sha256=<64 hex>`. We recompute the digest over the
 * raw body bytes with the shared secret and compare with crypto.timingSafeEqual
 * after a length check. The length guard matters twice over: timingSafeEqual
 * throws on unequal-length buffers, which would both crash the request and leak
 * a length oracle, so a mismatch returns false up front.
 *
 * Pass the raw body exactly as received. Do not JSON.parse and re-stringify
 * first, that changes the bytes and breaks the signature. See docs/SECURITY.md.
 */
export function verify(
  body: string | Buffer,
  signatureHeader: string,
  secret: string,
): boolean {
  // An empty secret can never produce a trustworthy HMAC; reject outright.
  if (!secret) {
    return false;
  }

  const provided = canonicalSignatureHex(signatureHeader);
  if (provided === null) {
    return false;
  }

  const expected = createHmac("sha256", secret).update(body).digest("hex");

  const providedBuf = Buffer.from(provided, "hex");
  const expectedBuf = Buffer.from(expected, "hex");

  if (providedBuf.length !== expectedBuf.length) {
    return false;
  }

  return timingSafeEqual(providedBuf, expectedBuf);
}
