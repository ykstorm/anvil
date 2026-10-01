import { pathToFileURL } from "node:url";
import { createServer } from "@ykstormsorg/anvil";

/**
 * CLI entrypoint for the Anvil webhook server. The builder itself lives in the
 * SDK (createServer); this wires it to the environment and process lifecycle.
 * Run: `node dist/index.js`.
 */
function main(): void {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) {
    console.error("WEBHOOK_SECRET is required");
    process.exit(1);
  }

  const port = Number(process.env.PORT ?? 3000);
  const server = createServer({ secret }).listen(port, () => {
    console.log(`anvil server listening on :${port}`);
  });

  const shutdown = () => server.close(() => process.exit(0));
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

// Run only when invoked directly (not when imported). pathToFileURL keeps the
// comparison correct on Windows, where process.argv[1] is a drive path.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
