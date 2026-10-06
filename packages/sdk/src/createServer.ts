import express, {
  type Express,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import { Queue } from "bullmq";
import IORedis, { type Redis } from "ioredis";
import { verify } from "./internal/verify.js";
import { computeIdempotencyKey } from "./internal/idempotency.js";
import { enqueueWebhook } from "./internal/enqueue.js";
import { DEFAULT_QUEUE_NAME, resolveRedisUrl } from "./internal/defaults.js";

export interface ServerOptions {
  secret: string;
  redisUrl?: string;
  queueName?: string;
  signatureHeader?: string;
  /** Max accepted body size, passed to express.raw's limit. Default "256kb". */
  maxBodyBytes?: string | number;
  /** Reject with 429 once this many requests are in flight. Default 1000. */
  maxInFlight?: number;
  /** Dedupe window in seconds. Default one week. */
  dedupeTtlSeconds?: number;
  /** Optional per-IP fixed-window rate limit. Off unless set. */
  rateLimit?: { windowMs: number; max: number };
}

const SECRET_MIN_LENGTH = 16;
const READYZ_TIMEOUT_MS = 1000;

/**
 * Express handler for a single webhook: verify the HMAC over the raw body,
 * dedupe, enqueue, return 202. Enqueue failures surface as 503 rather than
 * crashing the process.
 */
function makeWebhookHandler(
  getQueue: () => Promise<Queue>,
  opts: { secret: string; headerName: string; dedupeTtlSeconds?: number },
): RequestHandler {
  return async (req: Request, res: Response) => {
    const sig = req.header(opts.headerName) ?? "";
    const raw: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");

    if (!verify(raw, sig, opts.secret)) {
      res.status(401).json({ error: "invalid signature" });
      return;
    }

    const key = computeIdempotencyKey(sig, raw);
    try {
      const queue = await getQueue();
      const result = await enqueueWebhook(
        queue,
        key,
        { body: raw.toString("utf8"), sig, receivedAt: new Date().toISOString() },
        { dedupeTtlSeconds: opts.dedupeTtlSeconds },
      );
      res.status(202).json(result);
    } catch {
      // Redis unreachable or not ready yet, command timed out, etc. Shed load;
      // do not crash.
      res.status(503).json({ error: "service unavailable" });
    }
  };
}

/**
 * Hands out the BullMQ queue, building it only once the Redis connection is
 * ready.
 *
 * A BullMQ Queue makes one attempt to initialise its connection when it is
 * constructed and keeps that promise (queue.client) for its whole life. Built
 * while Redis is unreachable, the promise stays rejected after ioredis has
 * reconnected, and the queue never works again. So nothing builds the queue
 * until the connection reports ready, and a queue whose initialisation still
 * failed is dropped and rebuilt on the next call. While the connection is not
 * ready this fails at once, which the callers turn into 503.
 */
function makeQueueSource(queueName: string, connection: Redis): () => Promise<Queue> {
  let queue: Queue | undefined;
  return async () => {
    if (connection.status !== "ready") {
      throw new Error(`redis not ready (${connection.status})`);
    }
    if (!queue) {
      queue = new Queue(queueName, { connection });
      // BullMQ re-emits connection errors on the queue; the connection's own
      // listener in createServer already reports them.
      queue.on("error", () => {});
    }
    const current = queue;
    try {
      await current.client;
      return current;
    } catch (err) {
      if (queue === current) queue = undefined;
      void current.close().catch(() => {});
      throw err;
    }
  };
}

/** Reject after `ms` unless `work` settles first. */
async function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("deadline exceeded")), ms);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** Cap concurrent in-flight requests; excess gets 429 before the body is read. */
function makeInFlightGuard(maxInFlight: number): RequestHandler {
  let inFlight = 0;
  return (_req: Request, res: Response, next: NextFunction) => {
    if (inFlight >= maxInFlight) {
      res.status(429).json({ error: "too many requests" });
      return;
    }
    inFlight++;
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        inFlight--;
      }
    };
    res.on("finish", release);
    res.on("close", release);
    next();
  };
}

/** Minimal per-IP fixed-window limiter, used only when rateLimit is configured. */
function makeRateLimiter(windowMs: number, max: number): RequestHandler {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const ip = req.ip ?? "unknown";
    const entry = hits.get(ip);
    if (!entry || now >= entry.resetAt) {
      hits.set(ip, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    if (entry.count >= max) {
      res.status(429).json({ error: "too many requests" });
      return;
    }
    entry.count++;
    next();
  };
}

/**
 * Build the Anvil webhook ingress app. Verifies the HMAC over the raw body,
 * dedupes by sha256(canonical signature + payload), enqueues to BullMQ,
 * returns 202.
 */
export function createServer(opts: ServerOptions): Express {
  const {
    secret,
    queueName = DEFAULT_QUEUE_NAME,
    signatureHeader = "x-signature",
    maxBodyBytes = "256kb",
    maxInFlight = 1000,
    dedupeTtlSeconds,
    rateLimit,
  } = opts;

  if (!secret || secret.length < SECRET_MIN_LENGTH) {
    throw new Error(
      `createServer: secret must be at least ${SECRET_MIN_LENGTH} characters`,
    );
  }

  // Connects now and, with the default retryStrategy, keeps reconnecting for
  // as long as Redis is away; nothing here may turn that off, because the
  // server only recovers from an outage through it. enableOfflineQueue: false
  // makes commands fail at once while disconnected instead of piling up.
  const connection = new IORedis(resolveRedisUrl(opts.redisUrl), {
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
    connectTimeout: 5000,
    commandTimeout: 5000,
  });
  // One line per outage rather than one stack trace per reconnect attempt.
  let outageLogged = false;
  connection.on("error", (err: Error) => {
    if (!outageLogged) {
      outageLogged = true;
      console.error(`anvil: redis connection error: ${err.message}`);
    }
  });
  connection.on("ready", () => {
    outageLogged = false;
  });
  const getQueue = makeQueueSource(queueName, connection);

  const headerName = signatureHeader.toLowerCase();

  const app = express();
  app.disable("x-powered-by");

  const chain: RequestHandler[] = [makeInFlightGuard(maxInFlight)];
  if (rateLimit) {
    chain.push(makeRateLimiter(rateLimit.windowMs, rateLimit.max));
  }
  chain.push(
    express.raw({ type: "*/*", limit: maxBodyBytes, inflate: false }),
    makeWebhookHandler(getQueue, { secret, headerName, dedupeTtlSeconds }),
  );

  app.post("/webhooks", ...chain);

  // Liveness: the process is up.
  app.get("/healthz", (_req, res) => res.status(200).json({ ok: true }));

  // Readiness: 200 only when the queue is usable and Redis answers a PING
  // now. 503 until then, including when the server started before Redis was
  // reachable. The deadline covers the whole step, so a connection that never
  // comes up still gets an answer within a second.
  app.get("/readyz", async (_req, res) => {
    try {
      await withDeadline(
        (async () => {
          await getQueue();
          await connection.ping();
        })(),
        READYZ_TIMEOUT_MS,
      );
      res.status(200).json({ ready: true });
    } catch {
      res.status(503).json({ ready: false });
    }
  });

  // Terminal error handler: fixed response bodies, never the stack. Body-size
  // overflow is 413; other client errors collapse to 400; anything else 500.
  app.use(
    (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
      const e = err as { type?: string; status?: number; statusCode?: number };
      const status = e.status ?? e.statusCode;
      if (e.type === "entity.too.large" || status === 413) {
        res.status(413).json({ error: "payload too large" });
        return;
      }
      if (typeof status === "number" && status >= 400 && status < 500) {
        res.status(400).json({ error: "bad request" });
        return;
      }
      res.status(500).json({ error: "internal error" });
    },
  );

  return app;
}
