import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { backoffStrategy, MAX_ATTEMPTS } from "./retry.js";
import { DEAD_QUEUE_NAME, makeDeadLetterHandler } from "./dead-letter.js";
import { defaultHandler, type WebhookHandler } from "./handler.js";

export interface WorkerOptions {
  redisUrl?: string;
  queueName?: string;
  concurrency?: number;
}

export interface RunningWorker {
  start: () => Promise<void>;
  close: () => Promise<void>;
}

/**
 * Build the main-queue worker: runs the handler, retries on the backoff
 * schedule, and dead-letters after MAX_ATTEMPTS. The dead-letter queue is
 * written to but never consumed here — replay is a separate process.
 */
export function createWorker(
  handler: WebhookHandler = defaultHandler,
  opts: WorkerOptions = {},
): RunningWorker {
  const {
    redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379",
    queueName = "webhooks",
    concurrency = 4,
  } = opts;

  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });
  const deadQueue = new Queue(DEAD_QUEUE_NAME, { connection });
  const onDead = makeDeadLetterHandler(deadQueue);

  let worker: Worker | null = null;

  return {
    start: async () => {
      worker = new Worker(
        queueName,
        async (job: Job) => handler(job.data, job),
        {
          connection,
          concurrency,
          settings: { backoffStrategy },
        },
      );
      worker.on("failed", async (job, err) => {
        if (job && job.attemptsMade >= MAX_ATTEMPTS) {
          await onDead(job, err);
        }
      });
    },
    close: async () => {
      if (worker) await worker.close();
      await deadQueue.close();
      await connection.quit();
    },
  };
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const w = createWorker();
  void w.start().then(() => console.log("anvil worker started"));
  process.on("SIGINT", () => void w.close().then(() => process.exit(0)));
}
