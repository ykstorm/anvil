# Anvil Helm chart

Deploys the Anvil pipeline to Kubernetes: the webhook **server**, the queue
**worker**, and **Redis**. Anvil has no database, so neither does this chart.
Redis is the only datastore.

## What it deploys

| Component | Kind | Notes |
| --- | --- | --- |
| Server | Deployment + Service + Ingress | Runs `apps/server`. Verifies HMAC, dedupes, enqueues, returns 202. Ingress exposes `POST /webhooks`. Liveness/readiness on `/healthz`. |
| Worker | Deployment | Runs `apps/worker`. `worker.replicas` pods drain the BullMQ queue. No ingress. |
| Redis | Deployment + Service | In-cluster Redis 7 with `appendonly` and `noeviction`. Toggle with `redis.deploy`. |
| Secret | Secret | Holds `WEBHOOK_SECRET`. Create here or reference an existing one. |

The server and worker both get `REDIS_URL` pointing at the Redis Service. The
server gets `WEBHOOK_SECRET` from the Secret via `secretKeyRef`.

## Image

The repo does not publish a container image yet. Set `image.repository` and
`image.tag` to your own build that contains the built `apps/server` and
`apps/worker`. The server and worker pods select which app to run through the
container `command` (`node apps/server/dist/index.js` and
`node apps/worker/dist/index.js`).

## Install

```bash
helm install anvil ./charts/anvil \
  --set image.repository=ghcr.io/you/anvil \
  --set image.tag=0.1.0 \
  --set secret.webhookSecret=whsec_real \
  --set worker.replicas=3 \
  --set server.ingress.host=anvil.example.com
```

To use a Secret you already manage instead of having the chart create one:

```bash
helm install anvil ./charts/anvil \
  --set secret.create=false \
  --set secret.existingSecret=my-anvil-secret \
  --set secret.existingSecretKey=webhook-secret
```

To point at an external Redis rather than the bundled one:

```bash
helm install anvil ./charts/anvil \
  --set redis.deploy=false \
  --set redis.url=redis://my-redis:6379
```

## Values

See `values.yaml`. Common ones:

- `worker.replicas` — number of worker pods. Mirror to Terraform `worker_count`.
- `server.ingress.host` / `server.ingress.path` — webhook ingress address.
- `secret.create` / `secret.webhookSecret` / `secret.existingSecret`.
- `redis.deploy` / `redis.url`.

## Validation

```bash
helm lint charts/anvil
helm template charts/anvil | kubeconform -strict -ignore-missing-schemas
```

## Scope

0.x scaffold. The bundled Redis is a single pod with an `emptyDir` for its AOF,
so it is not durable across restarts. For anything beyond testing, run Redis
outside the chart (`redis.deploy=false`) against a durable, replicated instance.
The pods run as non-root with a read-only root filesystem and all capabilities
dropped.
