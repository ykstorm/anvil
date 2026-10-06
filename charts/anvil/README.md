# Anvil Helm chart

Deploys the Anvil pipeline to Kubernetes: the webhook **server**, the queue
**worker**, and **Redis**. Anvil has no database, so neither does this chart.
Redis is the only datastore.

## What it deploys

| Component | Kind | Notes |
| --- | --- | --- |
| Server | Deployment + Service + Ingress | Runs `apps/server`. Verifies HMAC, dedupes, enqueues, returns 202. Ingress exposes `POST /webhooks`. Liveness on `/healthz`, readiness on `/readyz` (503 until Redis answers). |
| Worker | Deployment | Runs `apps/worker`. `worker.replicas` pods drain the BullMQ queue. No ingress. |
| Redis | Deployment + Service + NetworkPolicy | In-cluster Redis 7 with `appendonly` and `noeviction`. A NetworkPolicy limits ingress on 6379 to the server and worker pods. Optional `requirepass` via `redis.password`. Toggle with `redis.deploy`. |
| Secret | Secret | Holds `WEBHOOK_SECRET`. Create here or reference an existing one. |

The server and worker both get `REDIS_URL` pointing at the Redis Service. The
server gets `WEBHOOK_SECRET` from the Secret via `secretKeyRef`.

## Image

The repo does not publish a container image. `image.repository` has no default
and must be set; the chart fails to render without it. Build
`apps/server/Dockerfile` and `apps/worker/Dockerfile` (each image runs
`node dist/index.js`) and push them. The two are separate builds, so set
`server.image.repository` and `worker.image.repository` when they differ;
otherwise both fall back to `image.repository`.

## Install

```bash
helm install anvil ./charts/anvil \
  --set image.repository=ghcr.io/you/anvil \
  --set image.tag=0.1.0 \
  --set secret.webhookSecret=whsec_dev_only_not_a_real_secret \
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

- `worker.replicas`, number of worker pods. Mirror to Terraform `worker_count`.
- `server.ingress.host` / `server.ingress.path`, webhook ingress address.
- `secret.create` / `secret.webhookSecret` / `secret.existingSecret`. The chart
  refuses to render the placeholder `whsec_changeme`, an empty secret, or one
  shorter than 16 characters, which the server would refuse at start. The
  value in the install example above is public; use your provider's signing
  secret for anything real.
- `redis.deploy` / `redis.url`.
- `redis.password` / `redis.existingSecret` for Redis `requirepass`.

## Validation

The chart needs an image and a secret to render, so pass placeholders, as CI
does:

```bash
helm lint charts/anvil \
  --set image.repository=ghcr.io/example/anvil --set secret.webhookSecret=whsec_ci_placeholder
helm template charts/anvil \
  --set image.repository=ghcr.io/example/anvil --set secret.webhookSecret=whsec_ci_placeholder \
  | kubeconform -strict -ignore-missing-schemas
```

## Scope

0.x scaffold. The bundled Redis is a single pod with an `emptyDir` for its AOF,
so it is not durable across restarts. For anything beyond testing, run Redis
outside the chart (`redis.deploy=false`) against a durable, replicated instance.
The pods run as non-root with a read-only root filesystem and all capabilities
dropped.
