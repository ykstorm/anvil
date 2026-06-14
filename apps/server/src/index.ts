import express, { type Express, type Request, type Response } from "express";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { verify } from "./verify.js";
import { computeIdempotencyKey } from "./idempotency.js";
import { enqueueWebhook } from "./enqueue.js";

export interface ServerOptions {
  secret: string;
  redisUrl?: string;
  queueName?: string;
  signatureHeader?: string;
}

/**
 * Build the webhook ingress app: verify HMAC -> dedupe by idempotency key ->
 * enqueue -> 202. The body is read raw (express.raw) because the signature
 * covers the exact received bytes; parsing JSON first would change them.
 */
export function createServer(opts: ServerOptions): Express {
  const {
    secret,
    redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379",
    queueName = "webhooks",
    signatureHeader = "x-signature",
  } = opts;

  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });
  const queue = new Queue(queueName, { connection });

  const app = express();

  app.post(
    "/webhooks",
    express.raw({ type: "*/*" }),
    async (req: Request, res: Response) => {
      const sig = req.header(signatureHeader) ?? "";
      const raw: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");

      if (!verify(raw, sig, secret)) {
        res.status(401).json({ error: "invalid signature" });
        return;
      }

      const key = computeIdempotencyKey(sig, raw);
      const result = await enqueueWebhook(queue, key, {
        body: raw.toString("utf8"),
        sig,
      });

      res.status(202).json(result);
    },
  );

  app.get("/healthz", (_req, res) => res.status(200).json({ ok: true }));

  return app;
}

// Run directly: `node dist/index.js`.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) {
    console.error("WEBHOOK_SECRET is required");
    process.exit(1);
  }
  const port = Number(process.env.PORT ?? 3000);
  createServer({ secret }).listen(port, () => {
    console.log(`anvil server listening on :${port}`);
  });
}
