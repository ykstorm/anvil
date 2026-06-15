output "server_public_ip" {
  description = "Public IPv4 of the Anvil webhook server. Point your provider's webhook at http://<ip>:<server_port>/webhooks."
  value       = hcloud_server.server.ipv4_address
}

output "server_webhook_url" {
  description = "Full webhook ingress URL for the server."
  value       = "http://${hcloud_server.server.ipv4_address}:${var.server_port}/webhooks"
}

output "redis_private_ip" {
  description = "Private IP of the Redis VM. Server and workers reach it at this address."
  value       = var.redis_private_ip
}

output "redis_url" {
  description = "Internal REDIS_URL handed to the app VMs."
  value       = local.redis_url
}

output "worker_private_ips" {
  description = "Private IPs of the worker pool VMs."
  value       = hcloud_server.worker[*].network[*]
}

output "worker_count" {
  description = "Number of worker VMs provisioned."
  value       = var.worker_count
}
