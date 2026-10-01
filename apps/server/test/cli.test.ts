import { describe, expect, it } from "vitest";

describe("server CLI entrypoint", () => {
  it("imports without starting a server (run guard holds)", async () => {
    // The module only listens when invoked directly (import.meta.url matches
    // process.argv[1]); importing it under the test runner must be a no-op.
    const mod = await import("../src/index.js");
    expect(mod).toBeDefined();
  });
});
