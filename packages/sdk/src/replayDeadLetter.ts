import { Queue } from "bullmq";
import IORedis from "ioredis";

export interface ReplayOptions {
  redisUrl?: string;
  mainQueueName?: string;
}

export interface ReplayResult {
  replayed: boolean;
  jobId: string;
}

/**
 * Move a single dead-lettered job back onto the main queue. This is a separate
 * consumer from the worker on purpose: replaying is a manual, gated action so a
 * broken handler cannot put failures into an endless auto-retry loop. Importing
 * this module starts no worker.
 */
export async function replayDeadLetter(
  jobId: string,
  opts: ReplayOptions = {},
): Promise<ReplayResult> {
  const redisUrl = opts.redisUrl ?? process.env.REDIS_URL ?? "redis://localhost:6379";
  const mainName = opts.mainQueueName ?? "webhooks";

  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });
  const mainQueue = new Queue(mainName, { connection });
  const deadQueue = new Queue(`${mainName}.dead`, { connection });

  try {
    const dead = await deadQueue.getJob(jobId);
    if (!dead) {
      return { replayed: false, jobId };
    }
    const { failureContext, ...payload } = dead.data as Record<string, unknown>;
    void failureContext;
    const revived = await mainQueue.add(dead.name, payload);
    await dead.remove();
    return { replayed: true, jobId: revived.id ?? jobId };
  } finally {
    await mainQueue.close();
    await deadQueue.close();
    await connection.quit();
  }
}
