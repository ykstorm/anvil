# Hetzner Cloud has no managed Redis offering. Anvil needs exactly one Redis,
# so this provisions a single VM that installs and runs Redis 7 via cloud-init.
# Redis binds to the private IP only; it is never exposed on the public side.
# See README.md for the honesty note on this choice.

resource "hcloud_server" "redis" {
  name        = "${var.name_prefix}-redis"
  server_type = var.redis_server_type
  image       = var.image
  location    = var.location
  ssh_keys    = [hcloud_ssh_key.anvil.id]

  user_data = templatefile("${path.module}/templates/redis-cloud-init.yaml.tftpl", {
    redis_bind_ip = var.redis_private_ip
    maxmemory_mb  = var.redis_maxmemory_mb
  })

  network {
    network_id = hcloud_network.anvil.id
    ip         = var.redis_private_ip
  }

  labels = {
    app  = "anvil"
    role = "redis"
  }

  depends_on = [hcloud_network_subnet.anvil]
}

# Redis is reachable only from inside the private network.
resource "hcloud_firewall" "redis" {
  name = "${var.name_prefix}-redis-fw"

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "6379"
    source_ips = [var.subnet_ip_range]
  }

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = ["0.0.0.0/0", "::/0"]
  }
}

resource "hcloud_firewall_attachment" "redis" {
  firewall_id = hcloud_firewall.redis.id
  server_ids  = [hcloud_server.redis.id]
}
