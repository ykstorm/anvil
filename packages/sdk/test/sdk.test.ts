import { describe, expect, it } from "vitest";
import * as sdk from "../src/index.js";
import { createServer, createWorker, replayDeadLetter } from "../src/index.js";

describe("SDK public surface", () => {
  it("exports exactly createServer, createWorker, replayDeadLetter", () => {
    expect(Object.keys(sdk).sort()).toEqual(
      ["createServer", "createWorker", "replayDeadLetter"].sort(),
    );
  });

  it("createServer({ secret }) returns an Express app (has .listen)", () => {
    const app = createServer({ secret: "whsec_x" });
    expect(typeof app.listen).toBe("function");
    expect(typeof app.use).toBe("function");
  });

  it("createWorker(handler, opts) returns { start, close }", () => {
    const w = createWorker(async () => {}, { redisUrl: "redis://localhost:6379" });
    expect(typeof w.start).toBe("function");
    expect(typeof w.close).toBe("function");
  });

  it("replayDeadLetter is async (returns a Promise)", () => {
    // Call shape only; no Redis round-trip. We assert the return is thenable.
    const ret = replayDeadLetter("job_1", { redisUrl: "redis://localhost:6379" });
    expect(typeof (ret as Promise<unknown>).then).toBe("function");
    // Swallow the rejection (no Redis here) so the test does not warn.
    void (ret as Promise<unknown>).catch(() => {});
  });
});
