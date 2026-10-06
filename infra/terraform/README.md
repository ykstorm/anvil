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
  `maxmemory-policy noeviction` so jobs are never evicted). Redis stays stopped
  until you provision its password after boot (see Secrets below).
- **Server VM** (`app.tf`). Runs the Anvil webhook server as a systemd unit on
  `var.server_port` (default 3000). A firewall opens that port to the internet
  so providers can deliver webhooks. cloud-init writes `REDIS_URL` and `PORT` to
  `/etc/anvil/server.env`; `WEBHOOK_SECRET` is provisioned after boot (see
  Secrets below).
- **Worker pool** (`app.tf`). `var.worker_count` VMs, each running one Anvil
  worker process as a systemd unit draining the BullMQ queue. No public ingress.
  Env: `REDIS_URL`.

Each app VM clones the Anvil repo at `var.anvil_git_ref`, runs `pnpm install` and
`pnpm -r build`, then starts its systemd unit. The same `REDIS_URL` (the Redis
private IP, without the password) is wired into every app VM; the password is
added after boot.

## Secrets and SSH

- **`WEBHOOK_SECRET` is not a Terraform variable and is never templated into
  cloud-init.** Instance `user_data` is readable from the metadata service and
  the provider console, so a secret placed there is effectively exposed. The
  server unit restarts until the secret is present; provision it after boot, for
  example:

  ```bash
  ssh root@<server_ip> 'echo WEBHOOK_SECRET=whsec_... >> /etc/anvil/server.env && systemctl restart anvil-server'
  ```

- **SSH is closed by default.** No firewall opens port 22 unless you set
  `ssh_allowed_cidrs` to the CIDRs that should reach it. With the default empty
  list the boxes are unreachable over SSH, so plan access (or a bastion) ahead.

- **The Redis password is not a Terraform variable either, for the same
  reason.** Earlier versions took `redis_password` and wrote it into user_data
  twice: as `requirepass` on the Redis VM and inside `REDIS_URL` on every app
  VM. Now cloud-init installs Redis, writes a config that includes
  `/etc/redis/anvil-auth.conf`, and leaves Redis stopped and disabled. Redis
  will not start until that file exists. Provision it after boot, then put the
  password into `REDIS_URL` on the app VMs. Use a URL-safe password so it can
  go into the URL as is, and run the Redis step first:

  ```bash
  REDIS_PASSWORD="$(openssl rand -hex 32)"   # keep it in your secret store

  # 1. Redis VM: write requirepass and start Redis.
  ssh root@"$(terraform output -raw redis_public_ip)" \
    "umask 077 && echo 'requirepass $REDIS_PASSWORD' > /etc/redis/anvil-auth.conf \
     && chown redis:redis /etc/redis/anvil-auth.conf && systemctl enable --now redis-server"

  # 2. Server and workers: add the password to REDIS_URL and restart the unit.
  REDIS_URL="redis://:$REDIS_PASSWORD@$(terraform output -raw redis_private_ip):6379"
  for ip in $(terraform output -raw server_public_ip) \
            $(terraform output -json worker_public_ips | jq -r '.[]'); do
    ssh root@"$ip" "sed -i 's|^REDIS_URL=.*|REDIS_URL=$REDIS_URL|' /etc/anvil/*.env \
      && systemctl restart 'anvil-*'"
  done
  ```

  For a throwaway stack without auth, write an empty
  `/etc/redis/anvil-auth.conf` instead and skip step 2. Either way Redis
  listens only on localhost and its private IP.

## Files

| File | Purpose |
| --- | --- |
| `versions.tf` | Required Terraform and pinned `hetznercloud/hcloud` provider. |
| `main.tf` | Provider, SSH key, private network and subnet. |
| `redis.tf` | Redis VM, its cloud-init, and its firewall. |
| `app.tf` | Server VM and worker pool, their cloud-init, and firewalls. |
| `variables.tf` | Inputs, including `worker_count`. |
| `outputs.tf` | Server IP, webhook URL, Redis private and public IPs, worker IPs. |
| `templates/` | cloud-init for Redis, server, and worker. |

## Usage

```hcl
module "anvil" {
  source = "./infra/terraform"

  hcloud_token   = var.hcloud_token
  ssh_public_key = file("~/.ssh/id_ed25519.pub")

  ssh_allowed_cidrs = ["203.0.113.4/32"] # your operator IPs; omit to close SSH

  worker_count = 3
  location     = "nbg1"
}
```

Or run it directly:

```bash
export TF_VAR_hcloud_token=...
export TF_VAR_ssh_public_key="$(cat ~/.ssh/id_ed25519.pub)"

terraform init
terraform plan
terraform apply
```

After apply, provision the Redis password and `WEBHOOK_SECRET` (see Secrets and
SSH above); neither is passed through Terraform. Both steps need SSH, so set
`ssh_allowed_cidrs` (or reach the VMs through a bastion).

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
- `WEBHOOK_SECRET` and the Redis password are provisioned after boot, not
  through Terraform, because cloud-init user_data is readable. They land in
  `/etc/anvil/server.env` (mode 0600) on the server VM, `/etc/anvil/worker.env`
  on the workers and `/etc/redis/anvil-auth.conf` on the Redis VM.
- The cloud-init changes that keep the Redis password out of user_data are
  checked by `terraform validate` only; they have not been applied against a
  Hetzner project in CI.
- App VMs build from source at boot. For repeatable images, bake an artifact
  (or a container) and skip the in-place build. That is a later step.
