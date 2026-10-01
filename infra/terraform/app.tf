locals {
  # Every app VM talks to Redis over the private network. When a password is
  # set, it is folded into the URL (url-encoded) so the app authenticates.
  redis_auth = var.redis_password != "" ? ":${urlencode(var.redis_password)}@" : ""
  redis_url  = "redis://${local.redis_auth}${var.redis_private_ip}:6379"
}

# --- Anvil webhook server ---
# Verifies HMAC, dedupes, enqueues, returns 202. Public ingress on var.server_port.

resource "hcloud_server" "server" {
  name        = "${var.name_prefix}-server"
  server_type = var.server_server_type
  image       = var.image
  location    = var.location
  ssh_keys    = [hcloud_ssh_key.anvil.id]

  user_data = templatefile("${path.module}/templates/server-cloud-init.yaml.tftpl", {
    redis_url = local.redis_url
    port      = var.server_port
    git_ref   = var.anvil_git_ref
  })

  network {
    network_id = hcloud_network.anvil.id
  }

  labels = {
    app  = "anvil"
    role = "server"
  }

  depends_on = [hcloud_server.redis]
}

resource "hcloud_firewall" "server" {
  name = "${var.name_prefix}-server-fw"

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = tostring(var.server_port)
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  # SSH is opened only to the CIDRs you name. With the default empty list there
  # is no SSH rule at all, so the box is not reachable on 22 from anywhere.
  dynamic "rule" {
    for_each = length(var.ssh_allowed_cidrs) > 0 ? [1] : []
    content {
      direction  = "in"
      protocol   = "tcp"
      port       = "22"
      source_ips = var.ssh_allowed_cidrs
    }
  }
}

resource "hcloud_firewall_attachment" "server" {
  firewall_id = hcloud_firewall.server.id
  server_ids  = [hcloud_server.server.id]
}

# --- Anvil worker pool ---
# Each VM runs one worker process draining the BullMQ queue. No public ingress;
# workers only reach out to Redis on the private network.

resource "hcloud_server" "worker" {
  count       = var.worker_count
  name        = "${var.name_prefix}-worker-${count.index + 1}"
  server_type = var.worker_server_type
  image       = var.image
  location    = var.location
  ssh_keys    = [hcloud_ssh_key.anvil.id]

  user_data = templatefile("${path.module}/templates/worker-cloud-init.yaml.tftpl", {
    redis_url = local.redis_url
    git_ref   = var.anvil_git_ref
  })

  network {
    network_id = hcloud_network.anvil.id
  }

  labels = {
    app  = "anvil"
    role = "worker"
  }

  depends_on = [hcloud_server.redis]
}

# Workers accept no inbound application traffic. SSH is opened only to the CIDRs
# you name; with the default empty list the worker firewall has no rules at all.
resource "hcloud_firewall" "worker" {
  count = var.worker_count > 0 ? 1 : 0
  name  = "${var.name_prefix}-worker-fw"

  dynamic "rule" {
    for_each = length(var.ssh_allowed_cidrs) > 0 ? [1] : []
    content {
      direction  = "in"
      protocol   = "tcp"
      port       = "22"
      source_ips = var.ssh_allowed_cidrs
    }
  }
}

resource "hcloud_firewall_attachment" "worker" {
  count       = var.worker_count > 0 ? 1 : 0
  firewall_id = hcloud_firewall.worker[0].id
  server_ids  = hcloud_server.worker[*].id
}
