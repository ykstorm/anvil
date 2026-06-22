import { replayDeadLetter as replayInternal } from "./internal/deadLetter.js";
import type { ReplayResult } from "./internal/deadLetter.js";

export interface ReplayOptions {
  redisUrl?: string;
  mainQueueName?: string;
}

export type { ReplayResult };

/**
 * Move a single dead-lettered job back onto the main queue. This is a separate
 * consumer from the worker on purpose: replaying is a manual, gated action so a
 * broken handler cannot put failures into an endless auto-retry loop. Importing
 * this module starts no worker.
 *
 * Delegates to ./internal/deadLetter — the single source of truth shared with
 * apps/worker.
 */
export async function replayDeadLetter(
  jobId: string,
  opts: ReplayOptions = {},
): Promise<ReplayResult> {
  return replayInternal(jobId, {
    redisUrl: opts.redisUrl,
    mainQueueName: opts.mainQueueName,
  });
}
