import { pathToFileURL } from "node:url";
import { createWorker } from "@ykstormsorg/anvil";
import { defaultHandler } from "./handler.js";

/**
 * CLI entrypoint for the Anvil queue worker. The builder lives in the SDK
 * (createWorker); this supplies the default handler and process lifecycle.
 * Run: `node dist/index.js`.
 */
async function main(): Promise<void> {
  const worker = createWorker(defaultHandler);
  await worker.start();
  console.log("anvil worker started");

  const shutdown = () => void worker.close().then(() => process.exit(0));
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

// Run only when invoked directly (not when imported). pathToFileURL keeps the
// comparison correct on Windows, where process.argv[1] is a drive path.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
