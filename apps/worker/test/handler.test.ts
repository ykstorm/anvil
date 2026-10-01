import { describe, expect, it } from "vitest";
import type { Job } from "bullmq";
import { defaultHandler } from "../src/handler.js";

const job = {} as Job;
const data = (body: string) => ({ body, sig: "sha256=x", receivedAt: "2026-01-01T00:00:00.000Z" });

describe("defaultHandler", () => {
  it("processes a valid JSON body without throwing", async () => {
    await expect(defaultHandler(data('{"id":"evt_1"}'), job)).resolves.toBeUndefined();
  });

  it("throws on a body that is not valid JSON (so it retries, not crashes)", async () => {
    await expect(defaultHandler(data("not json"), job)).rejects.toThrow(/not valid JSON/);
  });
});
