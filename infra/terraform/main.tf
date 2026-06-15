provider "hcloud" {
  token = var.hcloud_token
}

# An SSH key registered with the project, attached to every server so the
# operator can reach the boxes after cloud-init runs.
resource "hcloud_ssh_key" "anvil" {
  name       = "${var.name_prefix}-ssh"
  public_key = var.ssh_public_key
}

# A private network so the server and workers reach Redis over a stable
# internal address instead of the public internet.
resource "hcloud_network" "anvil" {
  name     = "${var.name_prefix}-net"
  ip_range = var.network_ip_range
}

resource "hcloud_network_subnet" "anvil" {
  network_id   = hcloud_network.anvil.id
  type         = "cloud"
  network_zone = var.network_zone
  ip_range     = var.subnet_ip_range
}
