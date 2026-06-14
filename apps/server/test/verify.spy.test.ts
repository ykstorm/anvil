import { describe, expect, it, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";

const secret = "whsec_test_secret";

function sign(body: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

// Wrap node:crypto so we can observe timingSafeEqual without redefining a
// non-configurable ESM namespace property (vi.spyOn fails on those). vi.mock
// is hoisted; we keep a reference to the spy on a module-level holder.
const timingSafeEqualSpy = vi.fn();

vi.mock("node:crypto", async () => {
  const actual = await vi.importActual<typeof import("node:crypto")>("node:crypto");
  return {
    ...actual,
    timingSafeEqual: (a: NodeJS.ArrayBufferView, b: NodeJS.ArrayBufferView) => {
      timingSafeEqualSpy(a, b);
      return actual.timingSafeEqual(a, b);
    },
  };
});

beforeEach(() => {
  timingSafeEqualSpy.mockClear();
});

describe("verify uses crypto.timingSafeEqual", () => {
  it("calls timingSafeEqual for a length-matched comparison", async () => {
    const { verify } = await import("../src/verify.js");
    const body = '{"amount":100}';
    verify(body, sign(body), secret);
    expect(timingSafeEqualSpy).toHaveBeenCalledTimes(1);
  });

  it("does NOT call timingSafeEqual when digest lengths differ (guards the throw)", async () => {
    const { verify } = await import("../src/verify.js");
    // A short, length-mismatched hex must be rejected before timingSafeEqual,
    // otherwise timingSafeEqual throws RangeError on unequal-length buffers.
    const result = verify("{}", "sha256=abcd", secret);
    expect(result).toBe(false);
    expect(timingSafeEqualSpy).not.toHaveBeenCalled();
  });
});
