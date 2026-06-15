# Anvil on Hetzner Cloud (Terraform)

This module provisions the runtime Anvil needs: one Redis instance, one webhook
server, and a worker pool. It provisions only what Anvil uses. There is no
database here because Anvil has no database. Redis is the only datastore.

## What it creates

- A private network and subnet so the app VMs reach Redis on an internal
  address.
- **Redis VM** (`redis.tf`). Hetzner Cloud has no managed Redis product, so
  this is a single VM that installs Redis 7 from the Ubuntu archive via
  cloud-init and binds it to its private IP. It is not exposed publicly. A
  firewall allows port 6379 only from inside the subnet. This is the honest
  trade: there is no managed option to point at, so the module stands up a real
  Redis box and configures it for queue use (`appendonly yes`,
  `maxmemory-policy noeviction` so jobs are never evicted).
- **Server VM** (`app.tf`). Runs the Anvil webhook server as a systemd unit on
  `var.server_port` (default 3000). A firewall opens that port to the internet
  so providers can deliver webhooks. Env: `REDIS_URL`, `WEBHOOK_SECRET`, `PORT`.
- **Worker pool** (`app.tf`). `var.worker_count` VMs, each running one Anvil
  worker process as a systemd unit draining the BullMQ queue. No public ingress.
  Env: `REDIS_URL`.

Each app VM clones the Anvil repo, runs `pnpm install` and `pnpm -r build`, then
starts its systemd unit. The same `REDIS_URL` (the Redis private IP) is wired
into every app VM.

## Files

| File | Purpose |
| --- | --- |
| `versions.tf` | Required Terraform and pinned `hetznercloud/hcloud` provider. |
| `main.tf` | Provider, SSH key, private network and subnet. |
| `redis.tf` | Redis VM, its cloud-init, and its firewall. |
| `app.tf` | Server VM and worker pool, their cloud-init, and firewalls. |
| `variables.tf` | Inputs, including `worker_count`. |
| `outputs.tf` | Server IP, webhook URL, Redis private IP, worker IPs. |
| `templates/` | cloud-init for Redis, server, and worker. |

## Usage

```hcl
module "anvil" {
  source = "./infra/terraform"

  hcloud_token   = var.hcloud_token
  ssh_public_key = file("~/.ssh/id_ed25519.pub")
  webhook_secret = var.webhook_secret # the WEBHOOK_SECRET the server verifies against

  worker_count = 3
  location     = "nbg1"
}
```

Or run it directly:

```bash
export TF_VAR_hcloud_token=...
export TF_VAR_webhook_secret=whsec_...
export TF_VAR_ssh_public_key="$(cat ~/.ssh/id_ed25519.pub)"

terraform init
terraform plan
terraform apply
```

After apply, `terraform output server_webhook_url` gives the address to point a
provider's webhook at.

## Validation

CI runs, and you can run locally:

```bash
terraform -chdir=infra/terraform init -backend=false
terraform -chdir=infra/terraform validate
terraform -chdir=infra/terraform fmt -check
```

No backend is configured. Add one (for example the `hcloud` object storage or an
S3-compatible bucket) before using this for shared state.

## Scope and limitations

This is a 0.x scaffold.

- The Redis VM is a single box with no replica or failover. It fits Anvil's
  current "one Redis, one region" assumption (see the project README). High
  availability is out of scope here.
- `webhook_secret` is a Terraform variable. Pass it from a secret store or
  `TF_VAR_webhook_secret`; do not commit it. It lands in `/etc/anvil/server.env`
  (mode 0600) on the server VM.
- App VMs build from source at boot. For repeatable images, bake an artifact
  (or a container) and skip the in-place build. That is a later step.
