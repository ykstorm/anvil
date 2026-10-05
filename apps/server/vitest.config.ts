import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: "threads",
    include: ["test/**/*.test.ts"],
    // The one test imports the whole server; a cold import of the SDK, bullmq
    // and ioredis has taken close to 6 s on a loaded machine.
    testTimeout: 15_000,
  },
});
