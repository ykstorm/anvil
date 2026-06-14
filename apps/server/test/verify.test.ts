import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { verify } from "../src/verify.js";

const secret = "whsec_test_secret";

function sign(body: string, key = secret): string {
  return "sha256=" + createHmac("sha256", key).update(body).digest("hex");
}

describe("verify (HMAC-SHA256, constant-time)", () => {
  it("accepts a valid sha256=<hex> signature", () => {
    const body = '{"event":"charge.succeeded","id":"evt_1"}';
    expect(verify(body, sign(body), secret)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const body = '{"amount":100}';
    const sig = sign(body);
    const tampered = '{"amount":999}';
    expect(verify(tampered, sig, secret)).toBe(false);
  });

  it("rejects a signature with one flipped byte", () => {
    const body = '{"amount":100}';
    const sig = sign(body);
    // Flip the last hex char so length stays equal but content differs.
    const lastChar = sig.at(-1) === "a" ? "b" : "a";
    const flipped = sig.slice(0, -1) + lastChar;
    expect(verify(body, flipped, secret)).toBe(false);
  });

  it("rejects a signature signed with the wrong secret", () => {
    const body = '{"amount":100}';
    expect(verify(body, sign(body, "wrong_secret"), secret)).toBe(false);
  });

  it("rejects a malformed signature header (no sha256= prefix)", () => {
    const body = "{}";
    expect(verify(body, "deadbeef", secret)).toBe(false);
  });

  it("rejects when the hex digest length does not match (no throw)", () => {
    const body = "{}";
    // A short hex string would make timingSafeEqual throw if passed buffers of
    // unequal length; verify must guard against that and return false.
    expect(verify(body, "sha256=abcd", secret)).toBe(false);
  });

  it("accepts an empty body when correctly signed", () => {
    expect(verify("", sign(""), secret)).toBe(true);
  });
});
