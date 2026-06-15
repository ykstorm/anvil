variable "hcloud_token" {
  description = "Hetzner Cloud API token with read/write on the target project."
  type        = string
  sensitive   = true
}

variable "name_prefix" {
  description = "Prefix applied to every resource name so a project can host more than one Anvil stack."
  type        = string
  default     = "anvil"
}

variable "ssh_public_key" {
  description = "SSH public key attached to every server for operator access."
  type        = string
}

variable "location" {
  description = "Hetzner location for the servers (for example nbg1, fsn1, hel1, ash)."
  type        = string
  default     = "nbg1"
}

variable "network_zone" {
  description = "Hetzner network zone that the subnet lives in. Must contain var.location."
  type        = string
  default     = "eu-central"
}

variable "network_ip_range" {
  description = "CIDR for the private network."
  type        = string
  default     = "10.0.0.0/16"
}

variable "subnet_ip_range" {
  description = "CIDR for the subnet the servers attach to."
  type        = string
  default     = "10.0.1.0/24"
}

variable "image" {
  description = "Base OS image for every server."
  type        = string
  default     = "ubuntu-24.04"
}

# --- Redis ---

variable "redis_server_type" {
  description = "Hetzner server type for the Redis VM. cx22 is 2 vCPU / 4 GB."
  type        = string
  default     = "cx22"
}

variable "redis_private_ip" {
  description = "Static private IP for the Redis VM inside the subnet. The app servers connect here."
  type        = string
  default     = "10.0.1.10"
}

variable "redis_maxmemory_mb" {
  description = "maxmemory ceiling passed to the Redis config, in megabytes."
  type        = number
  default     = 2048
}

# --- App: server ---

variable "server_server_type" {
  description = "Hetzner server type for the Anvil webhook server VM."
  type        = string
  default     = "cx22"
}

variable "server_port" {
  description = "Port the Anvil server listens on. Matches PORT in apps/server."
  type        = number
  default     = 3000
}

variable "webhook_secret" {
  description = "HMAC secret the server verifies signatures against (WEBHOOK_SECRET). Provide a real value at apply time; do not commit it."
  type        = string
  sensitive   = true
}

# --- App: worker pool ---

variable "worker_count" {
  description = "Number of worker VMs in the pool. Each runs one Anvil worker process."
  type        = number
  default     = 2

  validation {
    condition     = var.worker_count >= 0
    error_message = "worker_count must be zero or greater."
  }
}

variable "worker_server_type" {
  description = "Hetzner server type for each worker VM."
  type        = string
  default     = "cx22"
}
