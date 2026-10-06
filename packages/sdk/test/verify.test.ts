import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { verify } from "../src/internal/verify.js";

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
    expect(verify('{"amount":999}', sig, secret)).toBe(false);
  });

  it("rejects a signature with one flipped byte", () => {
    const body = '{"amount":100}';
    const sig = sign(body);
    const lastChar = sig.at(-1) === "a" ? "b" : "a";
    expect(verify(body, sig.slice(0, -1) + lastChar, secret)).toBe(false);
  });

  it("rejects a signature signed with the wrong secret", () => {
    const body = '{"amount":100}';
    expect(verify(body, sign(body, "wrong_secret"), secret)).toBe(false);
  });

  it("rejects a malformed signature header (no sha256= prefix)", () => {
    expect(verify("{}", "deadbeef", secret)).toBe(false);
  });

  it("rejects when the hex digest length does not match (no throw)", () => {
    // A short hex would make timingSafeEqual throw on unequal-length buffers;
    // verify must guard that and return false.
    expect(verify("{}", "sha256=abcd", secret)).toBe(false);
  });

  it("rejects a valid signature with one extra hex digit", () => {
    // Buffer.from(hex) drops a trailing odd digit, so this decodes to the right
    // 32 bytes; the length check has to happen on the text.
    const body = '{"amount":100}';
    expect(verify(body, sign(body) + "0", secret)).toBe(false);
  });

  it("rejects a hex digest that is not exactly 64 characters", () => {
    const body = '{"amount":100}';
    const hex = sign(body).slice("sha256=".length);
    expect(verify(body, "sha256=" + hex.slice(0, 63), secret)).toBe(false);
    expect(verify(body, "sha256=" + hex + hex, secret)).toBe(false);
  });

  it("accepts the same signature written in upper-case hex", () => {
    const body = '{"amount":100}';
    const hex = sign(body).slice("sha256=".length);
    expect(verify(body, "sha256=" + hex.toUpperCase(), secret)).toBe(true);
  });

  it("accepts an empty body when correctly signed", () => {
    expect(verify("", sign(""), secret)).toBe(true);
  });

  it("rejects when the secret is empty", () => {
    const body = '{"amount":100}';
    // An empty secret can never produce a trustworthy HMAC.
    expect(verify(body, sign(body, ""), "")).toBe(false);
  });
});
