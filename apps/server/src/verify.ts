import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify an HMAC-SHA256 webhook signature in constant time.
 *
 * The signature header has the shape `sha256=<hex>`. We recompute the digest
 * over the raw body bytes with the shared secret, then compare in constant
 * time. The length guard before timingSafeEqual matters: timingSafeEqual
 * throws RangeError when the two buffers differ in length, which would both
 * crash and leak a length oracle. Reject length mismatches up front instead.
 *
 * Pass the raw body string or Buffer exactly as received. Do NOT JSON.parse
 * and re-stringify before calling this — re-serialization changes bytes and
 * breaks the signature.
 */
export function verify(
  body: string | Buffer,
  signatureHeader: string,
  secret: string,
): boolean {
  if (typeof signatureHeader !== "string" || !signatureHeader.startsWith("sha256=")) {
    return false;
  }

  const provided = signatureHeader.slice("sha256=".length);
  // A valid hex sha256 digest is 64 chars; bail on anything malformed.
  if (!/^[0-9a-f]+$/i.test(provided)) {
    return false;
  }

  const expected = createHmac("sha256", secret).update(body).digest("hex");

  const providedBuf = Buffer.from(provided, "hex");
  const expectedBuf = Buffer.from(expected, "hex");

  // Length guard before timingSafeEqual: unequal lengths throw otherwise.
  if (providedBuf.length !== expectedBuf.length) {
    return false;
  }

  return timingSafeEqual(providedBuf, expectedBuf);
}
