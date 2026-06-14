import { defineConfig } from "vitest/config";

// The forks pool crashes under Node 24 with this vitest line; threads is
// stable here. Each workspace package inherits this via its own config.
export default defineConfig({
  test: {
    pool: "threads",
    include: ["test/**/*.test.ts"],
  },
});
