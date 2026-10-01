import { describe, expect, it } from "vitest";
import * as sdk from "../src/index.js";
import { createServer, createWorker, replayDeadLetter } from "../src/index.js";
import { TEST_SECRET } from "./helpers.js";

describe("SDK public surface", () => {
  it("exports exactly createServer, createWorker, replayDeadLetter", () => {
    expect(Object.keys(sdk).sort()).toEqual(
      ["createServer", "createWorker", "replayDeadLetter"].sort(),
    );
  });

  it("createServer({ secret }) returns an Express app (has .listen)", () => {
    const app = createServer({ secret: TEST_SECRET });
    expect(typeof app.listen).toBe("function");
    expect(typeof app.use).toBe("function");
  });

  it("createWorker(handler, opts) returns { start, close }", () => {
    const w = createWorker(async () => {}, { redisUrl: "redis://localhost:6379" });
    expect(typeof w.start).toBe("function");
    expect(typeof w.close).toBe("function");
  });

  it("replayDeadLetter is async (returns a Promise)", () => {
    const ret = replayDeadLetter("job_1", { redisUrl: "redis://localhost:6379" });
    expect(typeof (ret as Promise<unknown>).then).toBe("function");
    void (ret as Promise<unknown>).catch(() => {});
  });
});
